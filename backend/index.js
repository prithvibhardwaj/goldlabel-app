const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

app.use(cors());

app.post('/api/ocr/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Expecting field name "file".' });
    }

    const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
    // const apiKey = AIzaSyB5_D6sJvFsEVpSxhNLZSdYVe3JQz52Cqg;
    if (!apiKey) {
      return res.status(500).json({ error: 'OCR service is not configured (missing GOOGLE_CLOUD_VISION_API_KEY).' });
    }

    const imageBase64 = req.file.buffer.toString('base64');

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: imageBase64 },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Vision API error', response.status, errorBody);
      let message = 'Cloud Vision API error';
      try {
        const parsed = JSON.parse(errorBody);
        message = parsed?.error?.message ?? message;
      } catch {}
      return res.status(502).json({ error: message });
    }

    const json = await response.json();
    const first = json.responses && json.responses[0];
    const text = first?.fullTextAnnotation?.text || '';

    return res.json({
      text,
      raw: first,
    });
  } catch (err) {
    console.error('OCR endpoint error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`OCR backend listening on http://localhost:${PORT}`);
});

