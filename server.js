const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const app = express();

// Configure CORS only for your dashboard
app.use(cors({ origin: 'https://dashboard.rythenox.com' }));
app.use(express.json());
app.set('trust proxy', true);

// Initialize SQLite DB
const db = new sqlite3.Database(path.join(__dirname, 'marengo.db'));

// Rate limiter for license verification
const licenseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: "Too many attempts. Try again later." }
});

// Whitelisted files
const allowedFiles = [
  'marengo-win.exe',
  'marengo-linux',
  'gui-builder.exe',
  'documentation.pdf'
];

// ✅ License Verification Endpoint
app.post('/api/auth/verify-license', licenseLimiter, (req, res) => {
  const { licenseKey } = req.body;
  if (!licenseKey) {
    return res.status(400).json({ success: false, error: "No license key provided." });
  }

  db.get("SELECT * FROM licenses WHERE key = ?", [licenseKey.trim()], (err, row) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({ success: false, error: "Internal server error." });
    }

    if (!row) {
      return res.status(403).json({ success: false, error: "Invalid license key." });
    }

    const now = new Date();
    const expiry = new Date(row.expiry);

    if (expiry < now) {
      return res.status(403).json({
        success: false,
        error: "License has expired. Please contact support@rythenox.com."
      });
    }

    const sessionId = "sess-" + uuidv4();

    return res.json({
      success: true,
      sessionId,
      data: {
        organization: row.organization,
        licenseType: row.license_type,
        products: row.products.split(','),
        expiryDate: row.expiry,
        supportContact: row.support_email,
        sessionId
      }
    });
  });
});

// ✅ Download Route
app.post('/api/download/:file', (req, res) => {
  const { licenseKey } = req.body;
  const fileName = req.params.file;
  const userIP = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';

  if (!licenseKey) {
    return res.status(400).json({ success: false, error: "Missing license key." });
  }

  if (!allowedFiles.includes(fileName)) {
    return res.status(403).json({ success: false, error: "Unauthorized file request." });
  }

  db.get("SELECT id FROM licenses WHERE key = ?", [licenseKey.trim()], (err, row) => {
    if (err || !row) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    db.run("INSERT INTO downloads (license_id, file, ip) VALUES (?, ?, ?)", [row.id, fileName, userIP]);

    const filePath = path.join(__dirname, 'downloads', fileName);
    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) {
        console.error("File not found:", filePath);
        return res.status(404).json({ success: false, error: "File not found." });
      }

      res.download(filePath, err => {
        if (err) {
          console.error("File download error:", err.message);
          res.status(500).json({ success: false, error: "Download failed." });
        }
      });
    });
  });
});
// ✅ S3 Secure Download Route for Marengo Documentation
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  region: 'eu-central-1',
  signatureVersion: 'v4',
});

const BUCKET_NAME = 'rythenox-downloads'; // Replace if you named it differently

app.post('/api/downloads/request', async (req, res) => {
  const { fileId, clientId, timestamp } = req.body;

  if (!fileId || !clientId || !timestamp) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }

  if (fileId !== 'documentation') {
    return res.status(404).json({ success: false, error: "File not found" });
  }

  const fileKey = 'Marengo-product-desc-2025-uncensored.pdf';

  const params = {
    Bucket: BUCKET_NAME,
    Key: fileKey,
    Expires: 60,
    ResponseContentDisposition: 'attachment',
  };

  try {
    const signedUrl = await s3.getSignedUrlPromise('getObject', params);
    res.json({
      success: true,
      downloadUrl: signedUrl,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
  } catch (err) {
    console.error('S3 Error:', err);
    res.status(500).json({ success: false, error: "Failed to generate download link" });
  }
});

// ✅ Start the server
app.listen(5000, () => {
  console.log("✅ Marengo secure backend running");
});
