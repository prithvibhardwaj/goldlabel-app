const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- Google Gen AI (Gemini Developer API) ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

async function parseMedicationLabel(ocrText) {
  const prompt = `
    Extract medication information from the following OCR text.
    Return the data strictly following this JSON schema: ${JSON.stringify(MEDICATION_SCHEMA)}

    Instructions:
    1. The 'raw_ocr_reference' field MUST be the exact OCR text provided below, copied verbatim.
    2. Use ONLY information explicitly found in the OCR text. Do NOT invent dosage, duration, timing, or warnings.
    3. For each pictogram category, pick ONE pictogram ID that best matches the label, or null if not mentioned.
    4. Pictogram IDs MUST use the format "category.action" (e.g. "dosage.tablet_1", "time_of_day.twice_daily"). Do NOT invent new IDs.
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

  return JSON.parse(response.text);
}

// --- Main Route ---
app.post('/api/ocr/extract', upload.single('file'), async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
    let imageBase64 = req.body?.imageBase64;

    if (!imageBase64 && req.file) {
      imageBase64 = req.file.buffer.toString('base64');
    }

    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided.' });
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

    // 2. Parse text into structured schema using Gemini via Vertex AI
    const structuredData = await parseMedicationLabel(extractedText);

    // 3. Return structured data to the mobile app (app then saves to Supabase)
    return res.json(structuredData);

  } catch (err) {
    console.error('Processing error:', err);
    return res.status(500).json({ error: 'Internal server error during processing.' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`GoldLabel Backend running on http://localhost:${PORT}`);
  console.log(`Gemini API key: ${process.env.GEMINI_API_KEY ? '✓ set' : '⚠ GEMINI_API_KEY not set'}`);
});
