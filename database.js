/**
 * database.js
 * Dual Database Adapter:
 * 1. Supabase PostgreSQL (Production / Vercel Serverless when SUPABASE_URL is set)
 * 2. SQLite via sql.js (Local development fallback)
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
const IS_SUPABASE  = Boolean(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;
let SQL      = null;
let db       = null;

const DB_PATH  = path.join(__dirname, 'gallery.db');
const WASM_DIR = path.join(__dirname, 'node_modules', 'sql.js', 'dist');

// In-memory fallback cache for settings
const memorySettings = {
  site_name:        process.env.SITE_NAME     || 'Myystical_arts',
  site_tagline:     process.env.SITE_TAGLINE  || 'Curated Indian Celebrity Gallery',
  instagram_url:    process.env.INSTAGRAM_URL || 'https://www.instagram.com/myystical__arts?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==',
  instagram_handle: process.env.INSTAGRAM_HANDLE || '@myystical__arts',
};

// ─── Persistence (SQLite local fallback only) ──────────────────────────────────
function save() {
  if (!db || IS_SUPABASE) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    // Ignore read-only filesystem errors in serverless environments
  }
}

if (!IS_SUPABASE) {
  setInterval(save, 30_000).unref();
  process.on('exit', save);
}

// ─── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  if (IS_SUPABASE) {
    if (!supabase) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: false },
        });
        console.log('⚡ Initialised Supabase Client');
      } catch (err) {
        console.warn('Supabase client init warning:', err.message);
      }
    }
    return;
  }

  if (db) return;

  try {
    const initSqlJs = require('sql.js');
    SQL = await initSqlJs({
      locateFile: filename => path.join(WASM_DIR, filename),
    });

    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    db.run('PRAGMA foreign_keys = ON;');
    db.run('PRAGMA journal_mode = DELETE;');
    initSqliteSchema();
  } catch (err) {
    console.warn('SQLite init warning:', err.message);
    if (!db && SQL) db = new SQL.Database();
  }
}

function getSupabase() {
  if (!supabase && IS_SUPABASE) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    } catch (_) {}
  }
  return supabase;
}

async function ensureReady() {
  try {
    if (IS_SUPABASE) {
      getSupabase();
    } else if (!db) {
      await init();
    }
  } catch (_) {}
}

// ─── SQLite Local Schema & Helpers ─────────────────────────────────────────────
function initSqliteSchema() {
  if (!db) return;
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE, description TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS actresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, face_filename TEXT DEFAULT NULL, bio TEXT DEFAULT '', instagram_url TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actress_id INTEGER, category_id INTEGER, filename TEXT NOT NULL UNIQUE, original_filename TEXT NOT NULL, caption TEXT DEFAULT '', width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, file_size INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT, jti TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    save();
  } catch (_) {}
}

function sqliteAll(sql, params = []) {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (_) {
    return [];
  }
}

function sqliteGet(sql, params = []) {
  if (!db) return null;
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    let row = null;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row;
  } catch (_) {
    return null;
  }
}

function sqliteRun(sql, params = []) {
  if (!db) return { lastInsertRowid: Date.now(), changes: 1 };
  try {
    db.run(sql, params);
    const meta = sqliteGet('SELECT last_insert_rowid() as id, changes() as changes');
    save();
    return { lastInsertRowid: meta?.id ?? Date.now(), changes: meta?.changes ?? 1 };
  } catch (_) {
    return { lastInsertRowid: Date.now(), changes: 1 };
  }
}

// ─── Unified Database API ──────────────────────────────────────────────────────

async function getCategories() {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data, error } = await getSupabase().from('categories').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true });
      if (!error && data) return data;
    } catch (_) {}
  }
  return sqliteAll('SELECT * FROM categories ORDER BY sort_order, name');
}

async function getActresses() {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data, error } = await getSupabase().from('actresses').select('*').eq('is_active', 1).order('sort_order', { ascending: true }).order('name', { ascending: true });
      if (!error && data) return data;
    } catch (_) {}
  }
  return sqliteAll('SELECT * FROM actresses WHERE is_active = 1 ORDER BY sort_order, name');
}

async function getActressesAll() {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data, error } = await getSupabase().from('actresses').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true });
      if (!error && data) return data;
    } catch (_) {}
  }
  return sqliteAll('SELECT * FROM actresses ORDER BY sort_order, name');
}

async function getImages({ actress_id, category_id, page = 1, limit = 30 } = {}) {
  await ensureReady();
  const offset = (page - 1) * limit;

  if (IS_SUPABASE && getSupabase()) {
    try {
      let query = getSupabase()
        .from('images')
        .select('*, actresses(name, slug), categories(name, slug)')
        .eq('is_active', 1);

      if (actress_id)  query = query.eq('actress_id',  actress_id);
      if (category_id) query = query.eq('category_id', category_id);

      const { data, error } = await query
        .order('sort_order', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (!error && data) {
        return data.map(img => ({
          ...img,
          actress_name:  img.actresses?.name  || null,
          actress_slug:  img.actresses?.slug  || null,
          category_name: img.categories?.name || null,
          category_slug: img.categories?.slug || null,
        }));
      }
    } catch (_) {}
  }

  let query = `
    SELECT i.*, a.name AS actress_name, a.slug AS actress_slug,
           c.name AS category_name, c.slug AS category_slug
    FROM images i
    LEFT JOIN actresses a ON i.actress_id = a.id
    LEFT JOIN categories c ON i.category_id = c.id
    WHERE i.is_active = 1
  `;
  const params = [];
  if (actress_id)  { query += ' AND i.actress_id = ?';  params.push(actress_id);  }
  if (category_id) { query += ' AND i.category_id = ?'; params.push(category_id); }
  query += ' ORDER BY i.sort_order DESC, i.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return sqliteAll(query, params);
}

async function getImageCount({ actress_id, category_id } = {}) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      let query = getSupabase().from('images').select('*', { count: 'exact', head: true }).eq('is_active', 1);
      if (actress_id)  query = query.eq('actress_id',  actress_id);
      if (category_id) query = query.eq('category_id', category_id);
      const { count, error } = await query;
      if (!error && count !== null) return count;
    } catch (_) {}
  }
  let query = 'SELECT COUNT(*) AS n FROM images WHERE is_active = 1';
  const params = [];
  if (actress_id)  { query += ' AND actress_id = ?';  params.push(actress_id);  }
  if (category_id) { query += ' AND category_id = ?'; params.push(category_id); }
  return sqliteGet(query, params)?.n || 0;
}

async function getImageById(id) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data } = await getSupabase().from('images').select('*').eq('id', id).single();
      if (data) return data;
    } catch (_) {}
  }
  return sqliteGet('SELECT * FROM images WHERE id = ?', [id]);
}

async function getActressById(id) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data } = await getSupabase().from('actresses').select('*').eq('id', id).single();
      if (data) return data;
    } catch (_) {}
  }
  return sqliteGet('SELECT * FROM actresses WHERE id = ?', [id]);
}

async function getCategoryById(id) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data } = await getSupabase().from('categories').select('*').eq('id', id).single();
      if (data) return data;
    } catch (_) {}
  }
  return sqliteGet('SELECT * FROM categories WHERE id = ?', [id]);
}

async function insertImage(data) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data: res, error } = await getSupabase().from('images').insert([{
        actress_id:        data.actress_id  || null,
        category_id:       data.category_id || null,
        filename:          data.filename,
        original_filename: data.original_filename,
        caption:           data.caption || '',
        width:             data.width || 0,
        height:            data.height || 0,
        file_size:         data.file_size || 0,
        sort_order:        data.sort_order || 0,
      }]).select('id').single();
      if (!error && res) return { lastInsertRowid: res.id };
    } catch (_) {}
  }
  return sqliteRun(
    `INSERT INTO images (actress_id,category_id,filename,original_filename,caption,width,height,file_size,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
    [data.actress_id||null, data.category_id||null, data.filename, data.original_filename, data.caption||'', data.width||0, data.height||0, data.file_size||0, data.sort_order||0]
  );
}

async function updateImage(id, data) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      await getSupabase().from('images').update({
        actress_id:  data.actress_id  || null,
        category_id: data.category_id || null,
        caption:     data.caption || '',
        sort_order:  data.sort_order || 0,
      }).eq('id', id);
    } catch (_) {}
  }
  return sqliteRun('UPDATE images SET actress_id=?,category_id=?,caption=?,sort_order=? WHERE id=?', [data.actress_id||null, data.category_id||null, data.caption||'', data.sort_order||0, id]);
}

async function deleteImage(id) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      await getSupabase().from('images').delete().eq('id', id);
    } catch (_) {}
  }
  return sqliteRun('DELETE FROM images WHERE id=?', [id]);
}

async function insertActress(data) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data: res, error } = await getSupabase().from('actresses').insert([{
        name:          data.name,
        slug:          data.slug,
        face_filename: data.face_filename || null,
        bio:           data.bio || '',
        instagram_url: data.instagram_url || '',
        sort_order:    data.sort_order || 0,
      }]).select('id').single();
      if (!error && res) return { lastInsertRowid: res.id };
    } catch (_) {}
  }
  return sqliteRun(
    'INSERT INTO actresses (name,slug,face_filename,bio,instagram_url,sort_order) VALUES (?,?,?,?,?,?)',
    [data.name, data.slug, data.face_filename||null, data.bio||'', data.instagram_url||'', data.sort_order||0]
  );
}

async function updateActress(id, data) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      await getSupabase().from('actresses').update({
        name:          data.name,
        slug:          data.slug,
        face_filename: data.face_filename || null,
        bio:           data.bio || '',
        instagram_url: data.instagram_url || '',
        sort_order:    data.sort_order || 0,
        is_active:     data.is_active !== undefined ? data.is_active : 1,
      }).eq('id', id);
    } catch (_) {}
  }
  return sqliteRun(
    'UPDATE actresses SET name=?,slug=?,face_filename=?,bio=?,instagram_url=?,sort_order=?,is_active=? WHERE id=?',
    [data.name, data.slug, data.face_filename||null, data.bio||'', data.instagram_url||'', data.sort_order||0, data.is_active!==undefined ? data.is_active : 1, id]
  );
}

async function deleteActress(id) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      await getSupabase().from('actresses').delete().eq('id', id);
    } catch (_) {}
  }
  return sqliteRun('DELETE FROM actresses WHERE id=?', [id]);
}

async function insertCategory(data) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data: res, error } = await getSupabase().from('categories').insert([{
        name:        data.name,
        slug:        data.slug,
        description: data.description || '',
        sort_order:  data.sort_order || 0,
      }]).select('id').single();
      if (!error && res) return { lastInsertRowid: res.id };
    } catch (_) {}
  }
  return sqliteRun('INSERT INTO categories (name,slug,description,sort_order) VALUES (?,?,?,?)', [data.name, data.slug, data.description||'', data.sort_order||0]);
}

async function updateCategory(id, data) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      await getSupabase().from('categories').update({
        name:        data.name,
        slug:        data.slug,
        description: data.description || '',
        sort_order:  data.sort_order || 0,
      }).eq('id', id);
    } catch (_) {}
  }
  return sqliteRun('UPDATE categories SET name=?,slug=?,description=?,sort_order=? WHERE id=?', [data.name, data.slug, data.description||'', data.sort_order||0, id]);
}

async function deleteCategory(id) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      await getSupabase().from('categories').delete().eq('id', id);
    } catch (_) {}
  }
  return sqliteRun('DELETE FROM categories WHERE id=?', [id]);
}

async function getSetting(key) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data } = await getSupabase().from('settings').select('value').eq('key', key).maybeSingle();
      if (data?.value) return data.value;
    } catch (_) {}
  }
  const val = sqliteGet('SELECT value FROM settings WHERE key=?', [key])?.value;
  return val || memorySettings[key] || null;
}

async function setSetting(key, value) {
  memorySettings[key] = value;
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      await getSupabase().from('settings').upsert({ key, value, updated_at: new Date().toISOString() });
    } catch (_) {}
  }
  sqliteRun("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))", [key, value]);
}

async function getAllSettings() {
  await ensureReady();
  let dbSettings = {};

  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data, error } = await getSupabase().from('settings').select('key, value');
      if (!error && data) {
        dbSettings = Object.fromEntries(data.map(r => [r.key, r.value]));
      }
    } catch (_) {}
  } else {
    try {
      const rows = sqliteAll('SELECT key, value FROM settings');
      dbSettings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    } catch (_) {}
  }

  return { ...memorySettings, ...dbSettings };
}

async function revokeToken(jti, expiresAt) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      await getSupabase().from('revoked_tokens').insert([{ jti, expires_at: expiresAt }]);
    } catch (_) {}
    return;
  }
  try { sqliteRun('INSERT OR IGNORE INTO revoked_tokens (jti,expires_at) VALUES (?,?)', [jti, expiresAt]); } catch(_) {}
}

async function isTokenRevoked(jti) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data } = await getSupabase().from('revoked_tokens').select('id').eq('jti', jti).maybeSingle();
      return Boolean(data);
    } catch (_) {
      return false;
    }
  }
  return Boolean(sqliteGet('SELECT id FROM revoked_tokens WHERE jti=?', [jti]));
}

async function getStats() {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const [img, act, cat] = await Promise.all([
        getSupabase().from('images').select('*', { count: 'exact', head: true }).eq('is_active', 1),
        getSupabase().from('actresses').select('*', { count: 'exact', head: true }).eq('is_active', 1),
        getSupabase().from('categories').select('*', { count: 'exact', head: true }),
      ]);
      return {
        images:     img.count || 0,
        actresses:  act.count || 0,
        categories: cat.count || 0,
      };
    } catch (_) {
      return { images: 0, actresses: 0, categories: 0 };
    }
  }

  return {
    images:     sqliteGet('SELECT COUNT(*) AS n FROM images WHERE is_active=1')?.n || 0,
    actresses:  sqliteGet('SELECT COUNT(*) AS n FROM actresses WHERE is_active=1')?.n || 0,
    categories: sqliteGet('SELECT COUNT(*) AS n FROM categories')?.n || 0,
  };
}

// ─── Storage Helper ────────────────────────────────────────────────────────────
async function uploadFileToStorage(fileBuffer, originalFilename, mimeType) {
  await ensureReady();
  const crypto = require('crypto');
  const ext = path.extname(originalFilename).toLowerCase() || '.jpg';
  const filename = `${crypto.randomUUID()}${ext}`;

  if (IS_SUPABASE && getSupabase()) {
    try {
      const { error } = await getSupabase()
        .storage
        .from('gallery-uploads')
        .upload(filename, fileBuffer, {
          contentType: mimeType || 'image/jpeg',
          upsert: true,
        });

      if (error) {
        console.warn('Supabase Storage upload warning:', error.message);
        if (error.message && error.message.includes('not found')) {
          try {
            await getSupabase().storage.createBucket('gallery-uploads', { public: true });
            await getSupabase().storage.from('gallery-uploads').upload(filename, fileBuffer, { contentType: mimeType || 'image/jpeg', upsert: true });
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('Storage upload error:', err.message);
    }
  } else {
    try {
      const UPLOADS_DIR = path.join(__dirname, 'uploads');
      if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), fileBuffer);
    } catch (err) {
      console.warn('Local storage write warning (read-only filesystem):', err.message);
    }
  }

  return filename;
}

async function getFileFromStorage(filename) {
  await ensureReady();
  if (IS_SUPABASE && getSupabase()) {
    try {
      const { data } = getSupabase().storage.from('gallery-uploads').getPublicUrl(filename);
      if (data?.publicUrl) return data.publicUrl;
    } catch (_) {}
  }
  const UPLOADS_DIR = path.join(__dirname, 'uploads');
  const filePath = path.join(UPLOADS_DIR, filename);
  if (fs.existsSync(filePath)) return filePath;
  return null;
}

module.exports = {
  init, save, getSupabase, IS_SUPABASE,
  getCategories, getActresses, getActressesAll, getImages, getImageCount,
  getImageById, insertImage, updateImage, deleteImage,
  getActressById, insertActress, updateActress, deleteActress,
  getCategoryById, insertCategory, updateCategory, deleteCategory,
  getSetting, setSetting, getAllSettings,
  revokeToken, isTokenRevoked, getStats,
  uploadFileToStorage, getFileFromStorage,
};
