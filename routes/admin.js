/**
 * routes/admin.js
 * Protected admin API routes: login, logout, CRUD for images/actresses/categories/settings.
 * All state-changing routes require JWT auth. Supports both Supabase Cloud Storage & Local Storage.
 */

'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { body, param, validationResult } = require('express-validator');
const multer = require('multer');

const { requireAuth, generateToken, cookieOptions } = require('../middleware/auth');
const { verifyCaptcha } = require('../middleware/captcha');
const { loginLimiter, uploadLimiter } = require('../middleware/rateLimiter');
const db = require('../database');

const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10)) * 1024 * 1024;
const ALLOWED_MIMES = (process.env.ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/webp').split(',');
const MAX_BATCH = 10;

// Use memoryStorage for compatibility with serverless & cloud storage
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_BATCH },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${ALLOWED_MIMES.join(', ')}`));
    }
    cb(null, true);
  },
});

const faceUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type for face image'));
    }
    cb(null, true);
  },
});

/** Validate request and return errors */
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.warn('Validation errors:', JSON.stringify(errors.array()));
    res.status(400).json({ success: false, errors: errors.array() });
    return true;
  }
  return false;
}

/** Sanitize string — strip HTML tags */
function sanitize(str = '') {
  return String(str)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

function optionalInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) throw new Error('Must be a positive integer');
  return n;
}

// ─── POST /api/admin/login ───────────────────────────────────────────────────
router.post(
  '/login',
  loginLimiter,
  [
    body('username').trim().notEmpty().withMessage('Username is required').isLength({ max: 64 }),
    body('password').notEmpty().withMessage('Password is required').isLength({ max: 256 }),
  ],
  verifyCaptcha,
  async (req, res) => {
    if (validate(req, res)) return;

    const { username, password } = req.body;
    const expectedUsername = process.env.ADMIN_USERNAME || 'myystical_admin';
    const passwordHash = process.env.ADMIN_PASSWORD_HASH || '';

    const usernameMatch = username === expectedUsername;
    let passwordMatch = false;
    if (passwordHash) {
      try { passwordMatch = await bcrypt.compare(password, passwordHash); } catch (_) {}
    }

    if (!usernameMatch || !passwordMatch) {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = generateToken({ username });
    res.cookie('admin_token', token, cookieOptions());
    res.json({ success: true, message: 'Logged in successfully' });
  }
);

// ─── POST /api/admin/logout ──────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  if (req.admin && req.admin.jti) {
    const exp = new Date(req.admin.exp * 1000).toISOString();
    await db.revokeToken(req.admin.jti, exp);
  }
  const httpsEnabled = process.env.HTTPS_ENABLED !== 'false';
  res.clearCookie('admin_token', { path: '/', httpOnly: true, secure: httpsEnabled, sameSite: httpsEnabled ? 'strict' : 'lax' });
  res.json({ success: true, message: 'Logged out' });
});

// ─── GET /api/admin/verify ───────────────────────────────────────────────────
router.get('/verify', requireAuth, (req, res) => {
  res.json({ success: true, admin: req.admin.username, exp: req.admin.exp });
});

// ─── GET /api/admin/stats ────────────────────────────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// ─── GET /api/admin/settings ─────────────────────────────────────────────────
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const settings = await db.getAllSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

// ─── PUT /api/admin/settings ─────────────────────────────────────────────────
router.put(
  '/settings',
  requireAuth,
  [
    body('site_name').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('site_tagline').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    body('instagram_url').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('instagram_handle').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
  ],
  async (req, res) => {
    if (validate(req, res)) return;
    const allowed = ['site_name', 'site_tagline', 'instagram_url', 'instagram_handle'];
    try {
      for (const key of allowed) {
        if (req.body[key] !== undefined && req.body[key] !== null) {
          await db.setSetting(key, sanitize(req.body[key]));
        }
      }
      res.json({ success: true, message: 'Settings updated' });
    } catch (err) {
      console.error('Update settings error:', err);
      res.status(500).json({ success: false, error: 'Failed to update settings' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
//  IMAGE ROUTES
// ═══════════════════════════════════════════════════════════════

// POST /api/admin/images — Batch upload up to 10 images
router.post(
  '/images',
  requireAuth,
  uploadLimiter,
  upload.array('images', MAX_BATCH),
  [
    body('actress_id').customSanitizer(optionalInt),
    body('category_id').customSanitizer(optionalInt),
    body('captions_json').optional({ values: 'falsy' }).isLength({ max: 5000 }),
  ],
  async (req, res) => {
    if (validate(req, res)) return;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No image files provided' });
    }

    let captions = [];
    try {
      captions = req.body.captions_json ? JSON.parse(req.body.captions_json) : [];
    } catch (_) {}

    const created = [];
    const failed  = [];

    for (let i = 0; i < req.files.length; i++) {
      const file    = req.files[i];
      const caption = sanitize(captions[i] || '');
      try {
        const storedFilename = await db.uploadFileToStorage(file.buffer, file.originalname, file.mimetype);
        const result = await db.insertImage({
          actress_id:        req.body.actress_id  || null,
          category_id:       req.body.category_id || null,
          filename:          storedFilename,
          original_filename: sanitize(file.originalname),
          caption,
          width:     0,
          height:    0,
          file_size: file.size,
          sort_order: i,
        });
        created.push({ id: result.lastInsertRowid, url: `/uploads/${storedFilename}`, caption });
      } catch (err) {
        console.error(`Upload failed for file ${file.originalname}:`, err.message);
        failed.push(file.originalname);
      }
    }

    const status = failed.length === req.files.length ? 500
                 : failed.length > 0                  ? 207
                 : 201;
    res.status(status).json({
      success: created.length > 0,
      message: `${created.length} image(s) uploaded${failed.length ? `, ${failed.length} failed` : ''}`,
      data: created,
      failed,
    });
  }
);

// GET /api/admin/images
router.get('/images', requireAuth, async (req, res) => {
  try {
    const page  = parseInt(req.query.page  || '1',  10);
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const [images, total] = await Promise.all([
      db.getImages({ page, limit }),
      db.getImageCount(),
    ]);
    res.json({
      success: true,
      data: images.map(img => ({
        ...img,
        url: img.filename?.startsWith('data:') ? img.filename : `/uploads/${img.filename}`
      })),
      total
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch images' });
  }
});


// PUT /api/admin/images/:id
router.put(
  '/images/:id',
  requireAuth,
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('actress_id').customSanitizer(optionalInt),
    body('category_id').customSanitizer(optionalInt),
    body('caption').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('sort_order').optional({ values: 'falsy' }).isInt({ min: 0 }).toInt(),
  ],
  async (req, res) => {
    if (validate(req, res)) return;
    const { id } = req.params;
    const img = await db.getImageById(id);
    if (!img) return res.status(404).json({ success: false, error: 'Image not found' });
    try {
      await db.updateImage(id, {
        actress_id:  req.body.actress_id  ?? img.actress_id,
        category_id: req.body.category_id ?? img.category_id,
        caption:     sanitize(req.body.caption ?? img.caption),
        sort_order:  req.body.sort_order  ?? img.sort_order,
      });
      res.json({ success: true, message: 'Image updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update image' });
    }
  }
);

// DELETE /api/admin/images/:id
router.delete('/images/:id', requireAuth, [param('id').isInt({ min: 1 }).toInt()], async (req, res) => {
  if (validate(req, res)) return;
  const img = await db.getImageById(req.params.id);
  if (!img) return res.status(404).json({ success: false, error: 'Image not found' });
  try {
    await db.deleteImage(req.params.id);
    res.json({ success: true, message: 'Image deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete image' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ACTRESS ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/admin/actresses
router.get('/actresses', requireAuth, async (req, res) => {
  try {
    const actresses = await db.getActressesAll();
    res.json({
      success: true,
      data: actresses.map(a => ({
        ...a,
        face_url: (a.face_filename?.startsWith('http') || a.face_filename?.startsWith('data:')) ? a.face_filename : (a.face_filename ? `/uploads/${a.face_filename}` : null)
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch actresses' });
  }
});


// POST /api/admin/actresses
router.post(
  '/actresses',
  requireAuth,
  faceUpload.single('face'),
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
    body('bio').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
    body('instagram_url').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('sort_order').optional({ values: 'falsy' }).isInt({ min: 0 }).toInt(),
  ],
  async (req, res) => {
    if (validate(req, res)) return;
    try {
      const name = sanitize(req.body.name);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      let faceFilename = null;

      if (req.file) {
        faceFilename = await db.uploadFileToStorage(req.file.buffer, req.file.originalname, req.file.mimetype);
      }

      const result = await db.insertActress({
        name,
        slug,
        face_filename: faceFilename,
        bio:           sanitize(req.body.bio || ''),
        instagram_url: (req.body.instagram_url || '').trim(),
        sort_order:    parseInt(req.body.sort_order || '0', 10),
      });
      res.status(201).json({ success: true, message: 'Actress added', data: { id: result.lastInsertRowid } });
    } catch (err) {
      console.error('Insert actress error:', err);
      if (err.message && err.message.includes('UNIQUE')) {
        return res.status(409).json({ success: false, error: 'An actress with this name already exists' });
      }
      res.status(500).json({ success: false, error: 'Failed to add actress' });
    }
  }
);

// PUT /api/admin/actresses/:id
router.put(
  '/actresses/:id',
  requireAuth,
  faceUpload.single('face'),
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('name').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('bio').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
    body('instagram_url').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('sort_order').optional({ values: 'falsy' }).isInt({ min: 0 }).toInt(),
    body('is_active').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  ],
  async (req, res) => {
    if (validate(req, res)) return;
    const { id } = req.params;
    const actress = await db.getActressById(id);
    if (!actress) return res.status(404).json({ success: false, error: 'Actress not found' });
    try {
      const name = req.body.name ? sanitize(req.body.name) : actress.name;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      let faceFilename = actress.face_filename;
      if (req.file) {
        faceFilename = await db.uploadFileToStorage(req.file.buffer, req.file.originalname, req.file.mimetype);
      }

      await db.updateActress(id, {
        name,
        slug,
        face_filename: faceFilename,
        bio:           sanitize(req.body.bio ?? actress.bio),
        instagram_url: ((req.body.instagram_url ?? actress.instagram_url) || '').trim(),
        sort_order:    req.body.sort_order !== undefined ? req.body.sort_order : actress.sort_order,
        is_active:     req.body.is_active  !== undefined ? (req.body.is_active ? 1 : 0) : actress.is_active,
      });
      res.json({ success: true, message: 'Actress updated' });
    } catch (err) {
      console.error('Update actress error:', err);
      res.status(500).json({ success: false, error: 'Failed to update actress' });
    }
  }
);

// DELETE /api/admin/actresses/:id
router.delete('/actresses/:id', requireAuth, [param('id').isInt({ min: 1 }).toInt()], async (req, res) => {
  if (validate(req, res)) return;
  const actress = await db.getActressById(req.params.id);
  if (!actress) return res.status(404).json({ success: false, error: 'Actress not found' });
  try {
    await db.deleteActress(req.params.id);
    res.json({ success: true, message: 'Actress deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete actress' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  CATEGORY ROUTES
// ═══════════════════════════════════════════════════════════════

// POST /api/admin/categories
router.post(
  '/categories',
  requireAuth,
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('sort_order').optional({ values: 'falsy' }).isInt({ min: 0 }).toInt(),
  ],
  async (req, res) => {
    if (validate(req, res)) return;
    try {
      const name = sanitize(req.body.name);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const result = await db.insertCategory({
        name,
        slug,
        description: sanitize(req.body.description || ''),
        sort_order:  parseInt(req.body.sort_order || '0', 10),
      });
      res.status(201).json({ success: true, message: 'Category added', data: { id: result.lastInsertRowid } });
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE')) {
        return res.status(409).json({ success: false, error: 'Category already exists' });
      }
      res.status(500).json({ success: false, error: 'Failed to add category' });
    }
  }
);

// PUT /api/admin/categories/:id
router.put(
  '/categories/:id',
  requireAuth,
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('name').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('sort_order').optional({ values: 'falsy' }).isInt({ min: 0 }).toInt(),
  ],
  async (req, res) => {
    if (validate(req, res)) return;
    const { id } = req.params;
    const cat = await db.getCategoryById(id);
    if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });
    try {
      const name = req.body.name ? sanitize(req.body.name) : cat.name;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      await db.updateCategory(id, {
        name,
        slug,
        description: sanitize(req.body.description ?? cat.description),
        sort_order:  req.body.sort_order !== undefined ? req.body.sort_order : cat.sort_order,
      });
      res.json({ success: true, message: 'Category updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update category' });
    }
  }
);

// DELETE /api/admin/categories/:id
router.delete('/categories/:id', requireAuth, [param('id').isInt({ min: 1 }).toInt()], async (req, res) => {
  if (validate(req, res)) return;
  const cat = await db.getCategoryById(req.params.id);
  if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });
  try {
    await db.deleteCategory(req.params.id);
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete category' });
  }
});

// ─── Multer error handler ─────────────────────────────────────────────────────
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: `File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB || 10}MB`,
    });
  }
  if (err.message && (err.message.startsWith('Invalid file type') || err.message.startsWith('Unexpected field'))) {
    return res.status(415).json({ success: false, error: err.message });
  }
  next(err);
});

module.exports = router;
