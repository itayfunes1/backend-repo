import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(cors({ origin: 'https://dashboard.rythenox.com' }));
app.use(express.json());
app.set('trust proxy', 1);

const db = new sqlite3.Database(path.join(__dirname, 'marengo.db'));

const licenseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: "Too many attempts. Try again later." }
});

const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: "Too many download attempts. Try again later." }
});

const allowedFiles = [
  'documentation.pdf'
];

const s3 = new S3Client({ region: 'eu-central-1' });
const BUCKET_NAME = 'rythenox-downloads';

app.post('/api/auth/verify-license', licenseLimiter, (req, res) => {
  const { licenseKey } = req.body;
  if (!licenseKey) return res.status(400).json({ success: false, error: "No license key provided." });

  db.get("SELECT * FROM licenses WHERE key = ?", [licenseKey.trim()], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: "Internal server error." });
    if (!row) return res.status(403).json({ success: false, error: "Invalid license key." });

    const now = new Date();
    const expiry = new Date(row.expiry);
    if (expiry < now) return res.status(403).json({ success: false, error: "License has expired. Please contact support@rythenox.com." });

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

app.get('/api/downloads/available', async (req, res) => {
  const sessionToken = req.headers['authorization'];
  const requestId = req.headers['x-request-id'];
  if (!requestId) return res.status(400).json({ success: false, error: "Missing X-Request-ID header" });
  if (!sessionToken || !sessionToken.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Missing or invalid session token" });
  }

  const fileId = 'documentation';
  const fileKey = 'documentation.pdf';

  try {
    const metadata = await s3.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
    }));

    const sizeInMB = (metadata.ContentLength / (1024 * 1024)).toFixed(1);
    const checksum = metadata.Metadata?.sha256 || "not-set";

    const files = [{
      id: fileId,
      name: "Technical Documentation",
      type: "PDF",
      size: `${sizeInMB} MB`,
      os: "All",
      icon: "📚",
      requiresLicense: true,
      version: "1.0",
      checksum,
    }];

    res.json({ success: true, files });
  } catch (err) {
    console.error("Failed to fetch file metadata:", err);
    res.status(500).json({ success: false, error: "Failed to load file metadata" });
  }
});

app.post('/api/downloads/request', downloadLimiter, async (req, res) => {
  const requestId = req.headers['x-request-id'];
  const authHeader = req.headers['authorization'];
  if (!requestId) return res.status(400).json({ success: false, error: "Missing X-Request-ID header" });
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ success: false, error: "Unauthorized" });

  const { fileId, clientId, timestamp, userAgent } = req.body;
  if (!fileId || !clientId || !timestamp) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }

  const now = Date.now();
  const difference = Math.abs(now - timestamp);
  if (difference > 5 * 60 * 1000) { // 5 minutes window
    return res.status(403).json({ success: false, error: "Timestamp is too old or invalid." });
  }

  const fileMap = {
    'documentation': 'documentation.pdf'
  };

  const fileKey = fileMap[fileId];

  if (!fileKey || !allowedFiles.includes(fileKey)) {
    return res.status(404).json({ success: false, error: "File not found" });
  }

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      ResponseContentDisposition: `attachment; filename="${fileKey}"`

    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

    const userIP = req.ip || 'unknown';
    db.run(
      `INSERT INTO downloads (file_id, client_id, ip_address, timestamp, user_agent) VALUES (?, ?, ?, ?, ?)`,
      [fileId, clientId, userIP, new Date().toISOString(), userAgent || 'unknown']
    );
const head = await s3.send(new HeadObjectCommand({
  Bucket: BUCKET_NAME,
  Key: fileKey,
}));

const checksum = head.Metadata?.sha256 || 'not-set';
    res.json({
      success: true,
      downloadUrl: signedUrl,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      checksum
    });
  } catch (err) {
    console.error('S3 Error:', err);
    res.status(500).json({ success: false, error: "Failed to generate download link" });
  }
});

app.get('/api/downloads/:fileId/checksum', async (req, res) => {
  const sessionToken = req.headers['authorization'];
  const requestId = req.headers['x-request-id'];
  if (!requestId) return res.status(400).json({ success: false, error: "Missing X-Request-ID header" });
  if (!sessionToken || !sessionToken.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Missing or invalid session token" });
  }

  const { fileId } = req.params;
  const fileMap = { 'documentation': 'documentation.pdf' };
  const fileKey = fileMap[fileId];

  if (!fileKey) return res.status(404).json({ success: false, error: "Checksum not available for this file" });

  try {
    const head = await s3.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey
    }));

    const checksum = head.Metadata?.sha256 || 'not-set';

    res.json({
      checksum,
      algorithm: 'sha256'
    });
  } catch (err) {
    console.error("Checksum fetch error:", err);
    res.status(500).json({ success: false, error: "Failed to retrieve checksum" });
  }
});

app.listen(5000, () => {
  console.log("✅ Marengo secure backend running on http://localhost:5000");
});
