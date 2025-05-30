// server.js
const express = require('express');
const cors = require('cors');
const AWS = require('aws-sdk');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'us-east-1',
});

const BUCKET_NAME = 'rythenox-downloads';

// Route: List available files
app.get('/api/downloads/available', async (req, res) => {
  try {
    const list = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();

    const files = list.Contents.map((obj) => {
      const key = obj.Key;
      const name = key.split('/').pop();

      const isPDF = name.endsWith('.pdf');
      const isWindows = name.toLowerCase().includes('win');
      const isLinux = name.toLowerCase().includes('linux');
      const isGUI = name.toLowerCase().includes('gui');

      return {
        id: key.replace(/[^a-zA-Z0-9]/g, '-'),
        name,
        type: isPDF ? 'PDF' : 'Binary',
        size: `${(obj.Size / (1024 * 1024)).toFixed(1)} MB`,
        os: isPDF ? 'All' : isWindows ? 'Windows' : isLinux ? 'Linux' : 'Unknown',
        icon: isPDF ? '📚' : isGUI ? '🎨' : isWindows ? '🪟' : isLinux ? '🐧' : '📦',
        requiresLicense: true,
      };
    });

    res.json(files);
  } catch (err) {
    console.error('[!] Error listing S3 objects:', err);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Route: Get signed download URL
app.post('/api/downloads/request', async (req, res) => {
  const { fileId, clientId, timestamp } = req.body;
  const sessionId = req.headers.authorization?.split(' ')[1];

  if (!fileId || !clientId || !sessionId) {
    return res.status(400).json({ success: false, error: 'Invalid request' });
  }

  try {
    const guessedKey = fileId.replace(/-/g, '.');

    const params = {
      Bucket: BUCKET_NAME,
      Key: guessedKey,
      Expires: 300, // 5 minutes
    };

    const url = s3.getSignedUrl('getObject', params);

    res.json({
      success: true,
      downloadUrl: url,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    console.error('[!] Download request error:', err);
    res.status(500).json({ success: false, error: 'Download failed' });
  }
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend listening on port ${PORT}`);
});
