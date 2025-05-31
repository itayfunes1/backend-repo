const express = require('express');
const AWS = require('aws-sdk');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose(); // note: `.verbose()` for logging
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const app = express();
const BUCKET_NAME = 'rythenox-downloads';
const REGION = 'eu-central-1';

AWS.config.update({ region: REGION });
const s3 = new AWS.S3({ signatureVersion: 'v4' });

const db = new sqlite3.Database(path.join(__dirname, 'marengo.db'));

const licenseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many attempts. Try again later.' },
});

app.use(cors({ origin: 'https://dashboard.rythenox.com' }));
app.use(express.json());
app.set('trust proxy', true);

// ✅ License Verification Route
app.post('/api/auth/verify-license', licenseLimiter, (req, res) => {
  const { licenseKey } = req.body;
  if (!licenseKey) return res.status(400).json({ success: false, error: 'No license key provided.' });

  db.get('SELECT * FROM licenses WHERE key = ?', [licenseKey.trim()], (err, row) => {
    if (err) {
      console.error('DB Error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error.' });
    }
    if (!row) return res.status(403).json({ success: false, error: 'Invalid license key.' });

    const now = new Date();
    const expiry = new Date(row.expiry);

    if (expiry < now) {
      return res.status(403).json({ success: false, error: 'License has expired.' });
    }

    const sessionId = 'sess-' + uuidv4();
    return res.json({
      success: true,
      sessionId,
      data: {
        organization: row.organization,
        licenseType: row.license_type,
        products: row.products.split(','),
        expiryDate: row.expiry,
        supportContact: row.support_email,
        sessionId,
      },
    });
  });
});

// ✅ List Available Files from S3
app.get('/api/downloads/available', async (req, res) => {
  try {
    const listParams = { Bucket: BUCKET_NAME, Prefix: '' };
    const data = await s3.listObjectsV2(listParams).promise();

    const files = await Promise.all(
      data.Contents.map(async (file) => {
        const head = await s3.headObject({ Bucket: BUCKET_NAME, Key: file.Key }).promise();
        const id = path.basename(file.Key).replace(/\.[^/.]+$/, '').toLowerCase();
        const ext = path.extname(file.Key).toLowerCase();
        const type = ext === '.pdf' ? 'PDF' : 'Binary';
        const os = file.Key.toLowerCase().includes('linux')
          ? 'Linux'
          : file.Key.toLowerCase().includes('win')
          ? 'Windows'
          : 'All';

        return {
          id,
          name: path.basename(file.Key),
          type,
          size: `${(head.ContentLength / (1024 * 1024)).toFixed(1)} MB`,
          os,
          icon: type === 'PDF' ? '📚' : os === 'Windows' ? '🪟' : os === 'Linux' ? '🐧' : '💾',
          requiresLicense: true,
        };
      })
    );

    res.json(files);
  } catch (err) {
    console.error('Error fetching file list from S3:', err);
    res.status(500).json({ error: 'Failed to fetch available downloads.' });
  }
});

// ✅ Generate Signed URL for S3 File
app.post('/api/downloads/request', async (req, res) => {
  const { fileId, clientId, timestamp } = req.body;
  if (!fileId || !clientId || !timestamp) {
    return res.status(400).json({ success: false, error: 'Missing parameters' });
  }

  try {
    const allFiles = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();
    const file = allFiles.Contents.find((obj) =>
      path.basename(obj.Key).replace(/\.[^/.]+$/, '').toLowerCase() === fileId
    );

    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const signedUrl = await s3.getSignedUrlPromise('getObject', {
      Bucket: BUCKET_NAME,
      Key: file.Key,
      Expires: 60,
      ResponseContentDisposition: 'attachment',
    });

    res.json({
      success: true,
      downloadUrl: signedUrl,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
  } catch (err) {
    console.error('S3 signing error:', err);
    res.status(500).json({ success: false, error: 'Failed to generate download link' });
  }
});

// ✅ Start Server
app.listen(5000, () => console.log('✅ Marengo secure backend running on port 5000'));
