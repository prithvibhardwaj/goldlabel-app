const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// CORS: native app requests carry no Origin header and are always allowed.
// Browser requests must match ALLOWED_ORIGINS (comma-separated) when it is set;
// if unset (local dev), all origins are allowed.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // native app / server-to-server
    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS'));
  },
}));

// Bound the JSON body. The base64 image path is validated further per-request.
app.use(express.json({ limit: '8mb' }));

// --- Simple in-memory rate limiter -------------------------------------------
// Dependency-free per-IP fixed-window limiter. Keeps the open OCR endpoint and
// the anonymous contribution endpoint from being trivially spammed (cost DoS /
// dataset poisoning). For multi-instance deploys, swap for a shared store.
function rateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now > entry.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    entry.count += 1;
    return next();
  };
}

// Occasional sweep so the map doesn't grow unbounded.
const ocrLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 40 });
const contributeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60 });

// Health check — lets the host (Railway) and a browser confirm the service is up.
app.get('/', (req, res) => {
  res.json({ service: 'goldlabel-backend', status: 'ok' });
});

// --- Google Gen AI (Gemini Developer API) ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_KEY
);

const CATEGORIES = [
  'how_to_take',
  'side_effects',
  'duration',
  'dosage',
  'time_of_day',
  'precautions',
];

// Cache the allowed pictogram IDs so we don't query on every request.
let ALLOWED_IDS = new Set();
// Same IDs, grouped by category, used to tell the LLM exactly what it may pick.
let IDS_BY_CATEGORY = {};

async function loadAllowedIds() {
  const { data, error } = await supabase
    .from('pictogram_assets')
    .select('pictogram_id, category_key')
    .eq('language_code', 'none'); // any single language has the full set

  if (error || !data) {
    console.error('Failed to load allowed pictogram IDs:', error);
    return;
  }
  ALLOWED_IDS = new Set(data.map((r) => r.pictogram_id));

  // Build { how_to_take: [...], dosage: [...], ... } with de-duplicated, sorted IDs
  const grouped = {};
  for (const cat of CATEGORIES) grouped[cat] = new Set();
  for (const r of data) {
    if (grouped[r.category_key]) grouped[r.category_key].add(r.pictogram_id);
  }
  IDS_BY_CATEGORY = {};
  for (const cat of CATEGORIES) {
    IDS_BY_CATEGORY[cat] = [...grouped[cat]].sort();
  }

  console.log(`Loaded ${ALLOWED_IDS.size} allowed pictogram IDs`);
}

const MEDICATION_SCHEMA = {
  type: "object",
  required: ["raw_ocr_reference", "medication_name", "language", "pictogram_categories", "confidence", "requires_review"],
  properties: {
    raw_ocr_reference: { type: "string" },
    medication_name: { type: "string" },
    language: { type: "string", enum: ["none","en","bn","hi","kn","ml","te","my","th","vi","zh","ms","ta"] },
    confidence: { type: "number" },
    requires_review: { type: "boolean" },
    pictogram_categories: {
      type: "object",
      properties: {
        how_to_take:   { type: ["string", "null"] },
        side_effects:  { type: ["string", "null"] },
        duration:      { type: ["string", "null"] },
        dosage:        { type: ["string", "null"] },
        time_of_day:   { type: ["string", "null"] },
        precautions:   { type: ["string", "null"] }
      }
    }
  }
};

//Communicates with supabase
async function parseMedicationLabel(ocrText) {
  
  if (!ocrText) {
    throw new Error('parseMedicationLabel: ocrText is required');
  }

  // Build a readable, per-category list of the ONLY IDs the model may choose from.
  const allowedList = CATEGORIES
    .map((cat) => `  ${cat}:\n${IDS_BY_CATEGORY[cat].map((id) => `    - ${id}`).join('\n')}`)
    .join('\n');

  const prompt = `
    Extract medication information from the following OCR text.
    Return the data strictly following this JSON schema: ${JSON.stringify(MEDICATION_SCHEMA)}

    For each category, you may ONLY choose from these exact pictogram IDs (or null if not mentioned):
    ${allowedList}

    Common label phrasings and their correct pictogram IDs — use these mappings:
    - "tablet" / "capsule" / "pill" → dosage_form indicator only (does NOT by itself imply swallow_whole)
    - "oral solution" / "liquid" / "syrup" / "suspension" / "elixir" → dosage_form indicator only (does NOT by itself imply with_water or any how_to_take ID)
    - "by mouth" / "orally" / "oral" / "PO" / "drink" → route information only. Do NOT map this to any how_to_take ID by itself — see strict rules below.
    - "with food" / "with meals" → how_to_take.with_food
    - "on empty stomach" / "before meals" → how_to_take.empty_stomach
    - "with water" / "with a full glass of water" → how_to_take.with_water
    - "dissolve" / "effervescent" / "dissolve in water" → how_to_take.dissolve_in_water
    - "30 min before food" / "half hour before eating" → how_to_take.take_30_min_before_food
    - "30 min after food" / "half hour after eating" → how_to_take.take_30_min_after_food
    - "may cause drowsiness" / "causes sleepiness" → side_effects.drowsiness
    - "may cause dizziness" → side_effects.dizziness
    - "avoid alcohol" / "no alcohol" → precautions.no_alcohol
    - "once a day" / "once daily" → time_of_day.once_daily
    - "twice a day" / "twice daily" → time_of_day.twice_daily
    - "three times a day" / "thrice daily" → time_of_day.thrice_daily

    Strict rules for "how_to_take" — read carefully, these override the mappings above where they conflict:
    - Do NOT infer "take with water" or "swallow whole" from the dosage form or route alone (e.g. "orally", "syrup", "liquid", "oral solution" do NOT by themselves justify any how_to_take ID).
    - Only output "swallow whole" if BOTH: (1) the dosage form is tablet/capsule/caplet, AND (2) the instruction explicitly says swallow whole, do not chew, do not crush, or an equivalent phrase.
    - Only output "with water" if the instruction explicitly says "with water" or "with a full glass of water" — do not infer this from the medicine being liquid or from the word "drink".
    - Only output "dissolve in water" if the instruction explicitly says to dissolve, mix, or that it's effervescent.
    - If the OCR text only indicates route or dosage form (e.g. "orally", "by mouth", "PO", "syrup", "liquid") with no explicit how-to-take instruction, output null for how_to_take and set needs_review to true.
    - If the dosage form is unknown or not stated in the OCR text, output null for how_to_take and set needs_review to true.

    Instructions:
    1. The 'raw_ocr_reference' field MUST be the exact OCR text provided below, copied verbatim.
    2. Use ONLY information explicitly found in the OCR text. Do NOT invent dosage, duration, timing, or warnings.
    3. For each pictogram category, pick ONE pictogram ID from the allowed list above that best matches the label, or null if not mentioned.
    4. You MUST use an ID exactly as written in the allowed list. Do NOT invent, modify, combine, or guess new IDs. If nothing fits, use null.
    5. Set requires_review to true if you are uncertain about any field.
    6. Set confidence to a number between 0 and 1 based on how clearly the label states the information.
    7. Return valid JSON only — no explanation, no markdown, no code fences.

    OCR Text: "${ocrText}"
`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  return response.text;
}

// --- Validation ----------------------------------------------------------
// Returns { valid: true, data } or { valid: false, errors: [...] }
function validateLlmOutput(rawText) {
  const errors = [];

  // 1. Valid JSON
  let parsed;
  try {
    // Strip code fences just in case the model added them
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { valid: false, errors: ['Response is not valid JSON'] };
  }

  // 2. Required top-level fields exist
  const requiredFields = [
    'raw_ocr_reference',
    'medication_name',
    'language',
    'pictogram_categories',
    'confidence',
    'requires_review',
  ];
  for (const field of requiredFields) {
    if (!(field in parsed)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // 3. confidence is a number (between 0 and 1)
  if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
    errors.push('confidence must be a number between 0 and 1');
  }

  // 4. requires_review is a boolean
  if (typeof parsed.requires_review !== 'boolean') {
    errors.push('requires_review must be true or false');
  }

  // 5. language is in the allowed enum
  const allowedLangs = ["none","en","bn","hi","kn","ml","te","my","th","vi","zh","ms","ta"];
  if (!allowedLangs.includes(parsed.language)) {
    errors.push(`language "${parsed.language}" is not an allowed language code`);
  }

  // 6. pictogram_categories is an object with the 6 keys, each a valid ID or null
  const cats = parsed.pictogram_categories;
  if (typeof cats !== 'object' || cats === null || Array.isArray(cats)) {
    errors.push('pictogram_categories must be an object');
  } else {
    for (const cat of CATEGORIES) {
      if (!(cat in cats)) {
        errors.push(`pictogram_categories missing key: ${cat}`);
        continue;
      }
      const val = cats[cat];
      if (val === null) continue; // null is allowed
      if (typeof val !== 'string') {
        errors.push(`${cat} must be a string or null`);
        continue;
      }
      // Every pictogram ID must be in the allowed set
      if (!ALLOWED_IDS.has(val)) {
        errors.push(`${cat} has invalid pictogram ID: ${val}`);
      }
      // And the ID must belong to the right category
      if (!val.startsWith(cat + '.')) {
        errors.push(`${cat} has mismatched ID: ${val}`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, data: parsed };
}

// Strip control characters and cap length on model free-text. Preserves
// non-Latin scripts (the app supports many languages); only removes control
// chars and bounds the size so nothing injected can blow up the label UI.
function sanitizeText(value, maxLen) {
  let out = '';
  for (const ch of String(value || '')) {
    const c = ch.codePointAt(0);
    out += (c < 32 || c === 127) ? ' ' : ch;
  }
  return out.trim().slice(0, maxLen);
}

// --- Main Route ---
app.post('/api/ocr/extract', ocrLimiter, upload.single('file'), async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
    let imageBase64 = req.body?.imageBase64;

    if (!imageBase64 && req.file) {
      imageBase64 = req.file.buffer.toString('base64');
    }

    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided.' });
    }

    // Validate the base64 image before spending a paid Vision call.
    if (typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Invalid image payload.' });
    }
    // Accept and strip an optional data-URI prefix (data:image/png;base64,...).
    imageBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB, matching the multer limit
    if (imageBase64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) {
      return res.status(413).json({ error: 'Image too large (max 5MB).' });
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
      return res.status(400).json({ error: 'Image is not valid base64.' });
    }

    // 1. Get raw text from Google Vision
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: imageBase64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          }],
        }),
      }
    );

    const visionJson = await visionResponse.json();

    if (!visionResponse.ok || visionJson.error) {
      const errMsg = visionJson.error?.message || 'Vision API request failed.';
      console.error('Vision API error:', visionJson.error);
      return res.status(502).json({ error: `Vision API error: ${errMsg}` });
    }

    const extractedText = visionJson.responses?.[0]?.fullTextAnnotation?.text || '';

    if (!extractedText) {
      return res.status(422).json({ error: 'Could not detect any text in the image.' });
    }

    // 2. Parse text into structured schema using Gemini — validate, retry once if needed
    let validation;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const rawLlm = await parseMedicationLabel(extractedText);
      validation = validateLlmOutput(rawLlm);
      if (validation.valid) break;
      console.warn(`LLM validation failed (attempt ${attempt})`);
    }

    if (!validation.valid) {
      return res.status(422).json({
        error: 'LLM output failed validation after retry.',
        details: validation.errors,
      });
    }

    // Sanitize model free-text before it is shown/printed on a label.
    // Strip control characters and cap length (prompt-injection hardening).
    validation.data.medication_name = sanitizeText(validation.data.medication_name, 120);
    validation.data.raw_ocr_reference = sanitizeText(validation.data.raw_ocr_reference, 4000);

    // 3. Return validated structured data to the mobile app
    return res.json(validation.data);

  } catch (err) {
    console.error('Processing error:', err);
    return res.status(500).json({ error: 'Internal server error during processing.' });
  }
});

// --- Anonymization (server-side scrub) ---------------------------------------
// Strips personal information from raw OCR text before it is stored in the
// anonymized contributions dataset. Runs server-side so the logic can be
// improved without an app release and cannot be bypassed by a modified client.
async function scrubOcrText(ocrText) {
  if (!ocrText || typeof ocrText !== 'string') return '';

  const prompt = `
You are a privacy filter for medication-label text. Remove ALL personal and
identifying information, returning only the medically relevant content.

REMOVE (replace each with a placeholder token in square brackets):
- Patient names -> [NAME]
- Prescriber / doctor names -> [PRESCRIBER]
- Pharmacy or clinic names and addresses -> [PHARMACY]
- Phone/fax numbers, emails, URLs -> [CONTACT]
- Dates of any kind (dispensing, DOB, expiry printed as a personal date) -> [DATE]
- Prescription numbers, NRIC/ID/MRN, patient IDs, barcodes -> [ID]
- Any street address, postal code, or unit number -> [ADDRESS]

KEEP (do not alter): medication name, strength/dose, dosage form, quantity,
directions for use (how/when to take), warnings, side effects, storage advice.

Rules:
- Output ONLY the scrubbed text. No explanation, no JSON, no code fences.
- When unsure whether a token is a personal identifier, remove it. Prefer
  over-redaction to leaking personal data.

TEXT:
"""
${ocrText}
"""`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    const cleaned = (response.text || '').trim();
    return cleaned;
  } catch (err) {
    console.error('Scrub failed:', err.message);
    return null; // caller treats null as "could not anonymize" and rejects
  }
}

// Validate a { category: id|null } map against the allowed pictogram IDs.
// Returns a sanitized copy containing only the 6 known category keys.
function sanitizeCategoryMap(map) {
  const out = {};
  const src = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
  for (const cat of CATEGORIES) {
    const val = src[cat];
    if (val === null || val === undefined) {
      out[cat] = null;
    } else if (typeof val === 'string' && ALLOWED_IDS.has(val) && val.startsWith(cat + '.')) {
      out[cat] = val;
    } else {
      out[cat] = null; // drop anything not on the allowlist
    }
  }
  return out;
}

const ALLOWED_LANGS = ["none","en","bn","hi","kn","ml","te","my","th","vi","zh","ms","ta"];

// --- Contribution Route (insert-only, anonymized) ----------------------------
// The app posts a confirmed scan: the raw OCR text, the model's original
// suggestion, and the user's final correction. We scrub the OCR server-side and
// insert into scan_contributions. RLS makes this table insert-only for the
// shipped key, so nothing here can read other users' data.
app.post('/api/contribute', contributeLimiter, async (req, res) => {
  try {
    const { raw_ocr_reference, suggested, correction, language, app_version } = req.body || {};

    if (!raw_ocr_reference || typeof raw_ocr_reference !== 'string') {
      return res.status(400).json({ error: 'raw_ocr_reference (string) is required.' });
    }
    // Bound the input so a single request can't ship an essay.
    if (raw_ocr_reference.length > 8000) {
      return res.status(413).json({ error: 'raw_ocr_reference too large.' });
    }

    const lang = ALLOWED_LANGS.includes(language) ? language : 'none';
    const cleanSuggested = sanitizeCategoryMap(suggested);
    const cleanCorrection = sanitizeCategoryMap(correction);

    const scrubbed_ocr = await scrubOcrText(raw_ocr_reference);
    if (scrubbed_ocr === null) {
      return res.status(502).json({ error: 'Could not anonymize text; contribution skipped.' });
    }

    const { error } = await supabase
      .from('scan_contributions')
      .insert([{
        language: lang,
        scrubbed_ocr,
        suggested: cleanSuggested,
        correction: cleanCorrection,
        app_version: typeof app_version === 'string' ? app_version.slice(0, 40) : null,
      }]);
      // NOTE: no .select() — the table is insert-only, so we must not read back.

    if (error) {
      console.error('Contribution insert error:', error.message);
      return res.status(502).json({ error: 'Could not save contribution.' });
    }

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Contribution error:', err);
    return res.status(500).json({ error: 'Internal server error during contribution.' });
  }
});

// Centralized error handler — always returns clean JSON, never a stack trace,
// so internal paths and library internals are not disclosed to callers.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (err && err.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large.' });
  }
  console.error('Unhandled error:', err && err.message);
  return res.status(500).json({ error: 'Internal server error.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', async () => {
  await loadAllowedIds();
  console.log(`GoldLabel Backend running on http://localhost:${PORT}`);
  console.log(`Gemini API key: ${process.env.GEMINI_API_KEY ? '✓ set' : '⚠ GEMINI_API_KEY not set'}`);
});