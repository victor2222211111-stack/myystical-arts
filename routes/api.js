/**
 * routes/api.js
 * Public-facing API routes: categories, actresses, images, settings.
 * All endpoints are read-only and rate-limited.
 */

'use strict';

const express = require('express');
const { query, validationResult } = require('express-validator');
const router = express.Router();
const db = require('../database');

/** Validate and respond with errors if any */
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, errors: errors.array() });
    return true;
  }
  return false;
}

// ─── GET /api/settings ────────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  try {
    const settings = db.getAllSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('GET /api/settings error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

// ─── GET /api/categories ──────────────────────────────────────────────────────
router.get('/categories', (req, res) => {
  try {
    const categories = db.getCategories();
    res.json({ success: true, data: categories });
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

// ─── GET /api/actresses ───────────────────────────────────────────────────────
router.get('/actresses', (req, res) => {
  try {
    const actresses = db.getActresses();
    // Map face filename to URL
    const data = actresses.map(a => ({
      ...a,
      face_url: a.face_filename ? `/uploads/${a.face_filename}` : null,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/actresses error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch actresses' });
  }
});

// ─── GET /api/images ──────────────────────────────────────────────────────────
router.get(
  '/images',
  [
    query('actress_id').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
    query('category_id').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
    query('page').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt().default(1),
    query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 60 }).toInt().default(30),
  ],
  (req, res) => {
    if (validate(req, res)) return;

    try {
      const actress_id  = req.query.actress_id  ? parseInt(req.query.actress_id,  10) : undefined;
      const category_id = req.query.category_id ? parseInt(req.query.category_id, 10) : undefined;
      const page        = parseInt(req.query.page  || '1',  10);
      const limit       = parseInt(req.query.limit || '30', 10);

      const images = db.getImages({ actress_id, category_id, page, limit });
      const total  = db.getImageCount({ actress_id, category_id });

      const data = images.map(img => ({
        id: img.id,
        url: `/uploads/${img.filename}`,
        caption: img.caption,
        actress: {
          id: img.actress_id,
          name: img.actress_name,
          slug: img.actress_slug,
        },
        category: {
          id: img.category_id,
          name: img.category_name,
          slug: img.category_slug,
        },
        sort_order: img.sort_order,
        created_at: img.created_at,
      }));

      res.json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          pages:    Math.ceil(total / limit),
          has_next: page * limit < total,
        },
      });
    } catch (err) {
      console.error('GET /api/images error:', err);
      res.status(500).json({ success: false, error: 'Failed to fetch images' });
    }
  }
);

module.exports = router;
