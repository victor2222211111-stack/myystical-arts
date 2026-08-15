/**
 * server.js
 * Main entry point — HTTPS Express server with all security middleware.
 */

'use strict';

require('dotenv').config();
const db = require('./database');

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');

const { security, antiDownloadHeaders } = require('./middleware/security');
const { publicLimiter, adminLimiter }   = require('./middleware/rateLimiter');
const apiRouter   = require('./routes/api');
const adminRouter = require('./routes/admin');

const PORT       = parseInt(process.env.PORT || '3000', 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '3443', 10);
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR  = path.join(__dirname, 'public');
const SSL_CERT    = process.env.SSL_CERT_PATH || './ssl/cert.pem';
const SSL_KEY     = process.env.SSL_KEY_PATH  || './ssl/key.pem';

// ─── App ──────────────────────────────────────────────────────────────────────
const app = express();

// Trust proxy (for rate limiting behind nginx / load balancer)
app.set('trust proxy', 1);

const HTTPS_ENABLED = process.env.HTTPS_ENABLED !== 'false';

// ─── Security headers (Helmet + CSP) ─────────────────────────────────────────
app.use(security(HTTPS_ENABLED));

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin, direct requests, or server-to-server requests without Origin header
    if (!origin) return callback(null, true);

    const allowedList = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (process.env.URL) allowedList.push(process.env.URL);
    if (process.env.DEPLOY_PRIME_URL) allowedList.push(process.env.DEPLOY_PRIME_URL);

    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const isNetlify   = /\.netlify\.app$/.test(origin);
    const isAllowed   = allowedList.includes(origin);

    if (isLocalhost || isNetlify || isAllowed) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ─── Uploads: serve images inline with anti-download headers ─────────────────
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use('/uploads', antiDownloadHeaders, (req, res, next) => {
  // Validate filename — allow only safe characters
  const filename = path.basename(req.path);
  if (!/^[\w\-\.]+$/.test(filename)) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'File not found' });
  }
  res.sendFile(filePath);
});

// ─── API Routes ───────────────────────────────────────────────────────────────
// IMPORTANT: /api/admin must be mounted BEFORE /api — express matches
// routes in registration order, and /api catches everything under it.
app.use('/api/admin', adminLimiter, adminRouter);
app.use('/api',       publicLimiter, apiRouter);

// ─── Static files (public/) ───────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  lastModified: true,
  maxAge: '1h',
  // Prevent directory listing
  dotfiles: 'deny',
}));

// ─── Admin page (redirect to admin.html) ─────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

// ─── SPA fallback (serve index.html for unknown routes) ──────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  if (res.headersSent) return next(err);
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ success: false, error: 'CORS policy violation' });
  }
  res.status(500).json({ success: false, error: 'Internal server error' });
});

async function start() {
  // ── Init database (async WASM load) ────────────────────────────────────────
  await db.init();

  if (HTTPS_ENABLED) {
    const certExists = fs.existsSync(SSL_CERT) && fs.existsSync(SSL_KEY);

    if (certExists) {
      const sslOptions = {
        cert: fs.readFileSync(SSL_CERT),
        key:  fs.readFileSync(SSL_KEY),
        minVersion: 'TLSv1.2',
      };
      https.createServer(sslOptions, app).listen(HTTPS_PORT, () => {
        console.log(`\n🔐 Myystical_arts — HTTPS mode`);
        console.log(`   🌐 Gallery : https://localhost:${HTTPS_PORT}`);
        console.log(`   🛠  Admin   : https://localhost:${HTTPS_PORT}/admin\n`);
      });
      // HTTP → HTTPS redirect
      http.createServer((req, res) => {
        const host = (req.headers.host || 'localhost').replace(/:\d+$/, '');
        res.writeHead(301, { Location: `https://${host}:${HTTPS_PORT}${req.url}` });
        res.end();
      }).listen(PORT);
    } else {
      console.warn('\n⚠️  SSL cert not found — set HTTPS_ENABLED=false in .env for HTTP mode.');
      process.exit(1);
    }
  } else {
    // ── Plain HTTP (development default) ───────────────────────────────────────
    app.listen(PORT, () => {
      console.log(`\n🌐 Myystical_arts — HTTP mode (development)`);
      console.log(`   🌐 Gallery : http://localhost:${PORT}`);
      console.log(`   🛠  Admin   : http://localhost:${PORT}/admin`);
      console.log(`   ℹ  Set HTTPS_ENABLED=true in .env for production HTTPS\n`);
    });
  }
}

if (require.main === module) {
  start();
}

module.exports = app;


