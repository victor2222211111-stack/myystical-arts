/**
 * database.js
 * Dual Database Adapter:
 * 1. Supabase PostgreSQL (Production / Netlify Serverless when SUPABASE_URL is set)
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
      const { createClient } = require('@supabase/supabase-js');
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false },
      });
      console.log('⚡ Initialised Supabase Client');
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
      console.log('📦 Loaded existing database from', DB_PATH);
    } else {
      db = new SQL.Database();
      console.log('📦 Created new SQLite database');
    }

    db.run('PRAGMA foreign_keys = ON;');
    db.run('PRAGMA journal_mode = DELETE;');
    initSqliteSchema();
    console.log('✅ SQLite ready');
  } catch (err) {
    console.error('SQLite init error:', err.message);
  }
}

function getSupabase() {
  if (!supabase && IS_SUPABASE) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  }
  return supabase;
}

// ─── SQLite Local Schema & Helpers ─────────────────────────────────────────────
function initSqliteSchema() {
  if (!db) return;
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
}

function sqliteAll(sql, params = []) {
  if (!db) return [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function sqliteGet(sql, params = []) {
  if (!db) return null;
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

function sqliteRun(sql, params = []) {
  if (!db) return { lastInsertRowid: 0, changes: 0 };
  db.run(sql, params);
  const meta = sqliteGet('SELECT last_insert_rowid() as id, changes() as changes');
  save();
  return { lastInsertRowid: meta?.id ?? 0, changes: meta?.changes ?? 0 };
}

// ─── Unified Database API (Async Promises for Supabase & SQLite) ───────────────

async function getCategories() {
  if (IS_SUPABASE) {
    const { data, error } = await getSupabase().from('categories').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }
  return sqliteAll('SELECT * FROM categories ORDER BY sort_order, name');
}

async function getActresses() {
  if (IS_SUPABASE) {
    const { data, error } = await getSupabase().from('actresses').select('*').eq('is_active', 1).order('sort_order', { ascending: true }).order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }
  return sqliteAll('SELECT * FROM actresses WHERE is_active = 1 ORDER BY sort_order, name');
}

async function getActressesAll() {
  if (IS_SUPABASE) {
    const { data, error } = await getSupabase().from('actresses').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }
  return sqliteAll('SELECT * FROM actresses ORDER BY sort_order, name');
}

async function getImages({ actress_id, category_id, page = 1, limit = 30 } = {}) {
  const offset = (page - 1) * limit;

  if (IS_SUPABASE) {
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

    if (error) throw new Error(error.message);

    return (data || []).map(img => ({
      ...img,
      actress_name:  img.actresses?.name  || null,
      actress_slug:  img.actresses?.slug  || null,
      category_name: img.categories?.name || null,
      category_slug: img.categories?.slug || null,
    }));
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
  if (IS_SUPABASE) {
    let query = getSupabase().from('images').select('*', { count: 'exact', head: true }).eq('is_active', 1);
    if (actress_id)  query = query.eq('actress_id',  actress_id);
    if (category_id) query = query.eq('category_id', category_id);
    const { count, error } = await query;
    if (error) return 0;
    return count || 0;
  }
  let query = 'SELECT COUNT(*) AS n FROM images WHERE is_active = 1';
  const params = [];
  if (actress_id)  { query += ' AND actress_id = ?';  params.push(actress_id);  }
  if (category_id) { query += ' AND category_id = ?'; params.push(category_id); }
  return sqliteGet(query, params)?.n || 0;
}

async function getImageById(id) {
  if (IS_SUPABASE) {
    const { data } = await getSupabase().from('images').select('*').eq('id', id).single();
    return data || null;
  }
  return sqliteGet('SELECT * FROM images WHERE id = ?', [id]);
}

async function getActressById(id) {
  if (IS_SUPABASE) {
    const { data } = await getSupabase().from('actresses').select('*').eq('id', id).single();
    return data || null;
  }
  return sqliteGet('SELECT * FROM actresses WHERE id = ?', [id]);
}

async function getCategoryById(id) {
  if (IS_SUPABASE) {
    const { data } = await getSupabase().from('categories').select('*').eq('id', id).single();
    return data || null;
  }
  return sqliteGet('SELECT * FROM categories WHERE id = ?', [id]);
}

async function insertImage(data) {
  if (IS_SUPABASE) {
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
    if (error) throw new Error(error.message);
    return { lastInsertRowid: res.id };
  }
  return sqliteRun(
    `INSERT INTO images (actress_id,category_id,filename,original_filename,caption,width,height,file_size,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
    [data.actress_id||null, data.category_id||null, data.filename, data.original_filename, data.caption||'', data.width||0, data.height||0, data.file_size||0, data.sort_order||0]
  );
}

async function updateImage(id, data) {
  if (IS_SUPABASE) {
    const { error } = await getSupabase().from('images').update({
      actress_id:  data.actress_id  || null,
      category_id: data.category_id || null,
      caption:     data.caption || '',
      sort_order:  data.sort_order || 0,
    }).eq('id', id);
    if (error) throw new Error(error.message);
    return { changes: 1 };
  }
  return sqliteRun('UPDATE images SET actress_id=?,category_id=?,caption=?,sort_order=? WHERE id=?', [data.actress_id||null, data.category_id||null, data.caption||'', data.sort_order||0, id]);
}

async function deleteImage(id) {
  if (IS_SUPABASE) {
    const { error } = await getSupabase().from('images').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { changes: 1 };
  }
  return sqliteRun('DELETE FROM images WHERE id=?', [id]);
}

async function insertActress(data) {
  if (IS_SUPABASE) {
    const { data: res, error } = await getSupabase().from('actresses').insert([{
      name:          data.name,
      slug:          data.slug,
      face_filename: data.face_filename || null,
      bio:           data.bio || '',
      instagram_url: data.instagram_url || '',
      sort_order:    data.sort_order || 0,
    }]).select('id').single();
    if (error) throw new Error(error.message);
    return { lastInsertRowid: res.id };
  }
  return sqliteRun(
    'INSERT INTO actresses (name,slug,face_filename,bio,instagram_url,sort_order) VALUES (?,?,?,?,?,?)',
    [data.name, data.slug, data.face_filename||null, data.bio||'', data.instagram_url||'', data.sort_order||0]
  );
}

async function updateActress(id, data) {
  if (IS_SUPABASE) {
    const { error } = await getSupabase().from('actresses').update({
      name:          data.name,
      slug:          data.slug,
      face_filename: data.face_filename || null,
      bio:           data.bio || '',
      instagram_url: data.instagram_url || '',
      sort_order:    data.sort_order || 0,
      is_active:     data.is_active !== undefined ? data.is_active : 1,
    }).eq('id', id);
    if (error) throw new Error(error.message);
    return { changes: 1 };
  }
  return sqliteRun(
    'UPDATE actresses SET name=?,slug=?,face_filename=?,bio=?,instagram_url=?,sort_order=?,is_active=? WHERE id=?',
    [data.name, data.slug, data.face_filename||null, data.bio||'', data.instagram_url||'', data.sort_order||0, data.is_active!==undefined ? data.is_active : 1, id]
  );
}

async function deleteActress(id) {
  if (IS_SUPABASE) {
    const { error } = await getSupabase().from('actresses').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { changes: 1 };
  }
  return sqliteRun('DELETE FROM actresses WHERE id=?', [id]);
}

async function insertCategory(data) {
  if (IS_SUPABASE) {
    const { data: res, error } = await getSupabase().from('categories').insert([{
      name:        data.name,
      slug:        data.slug,
      description: data.description || '',
      sort_order:  data.sort_order || 0,
    }]).select('id').single();
    if (error) throw new Error(error.message);
    return { lastInsertRowid: res.id };
  }
  return sqliteRun('INSERT INTO categories (name,slug,description,sort_order) VALUES (?,?,?,?)', [data.name, data.slug, data.description||'', data.sort_order||0]);
}

async function updateCategory(id, data) {
  if (IS_SUPABASE) {
    const { error } = await getSupabase().from('categories').update({
      name:        data.name,
      slug:        data.slug,
      description: data.description || '',
      sort_order:  data.sort_order || 0,
    }).eq('id', id);
    if (error) throw new Error(error.message);
    return { changes: 1 };
  }
  return sqliteRun('UPDATE categories SET name=?,slug=?,description=?,sort_order=? WHERE id=?', [data.name, data.slug, data.description||'', data.sort_order||0, id]);
}

async function deleteCategory(id) {
  if (IS_SUPABASE) {
    const { error } = await getSupabase().from('categories').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { changes: 1 };
  }
  return sqliteRun('DELETE FROM categories WHERE id=?', [id]);
}

async function getSetting(key) {
  if (IS_SUPABASE) {
    const { data } = await getSupabase().from('settings').select('value').eq('key', key).single();
    return data?.value || null;
  }
  return sqliteGet('SELECT value FROM settings WHERE key=?', [key])?.value || null;
}

async function setSetting(key, value) {
  if (IS_SUPABASE) {
    const { error } = await getSupabase().from('settings').upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return;
  }
  sqliteRun("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))", [key, value]);
}

async function getAllSettings() {
  const defaults = {
    site_name:        process.env.SITE_NAME     || 'Myystical_arts',
    site_tagline:     process.env.SITE_TAGLINE  || 'Curated Indian Celebrity Gallery',
    instagram_url:    process.env.INSTAGRAM_URL || 'https://www.instagram.com/myystical__arts?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==',
    instagram_handle: process.env.INSTAGRAM_HANDLE || '@myystical__arts',
  };

  if (IS_SUPABASE) {
    const { data, error } = await getSupabase().from('settings').select('key, value');
    if (error || !data) return defaults;
    const dbSettings = Object.fromEntries(data.map(r => [r.key, r.value]));
    return { ...defaults, ...dbSettings };
  }

  const rows = sqliteAll('SELECT key, value FROM settings');
  const dbSettings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { ...defaults, ...dbSettings };
}

async function revokeToken(jti, expiresAt) {
  if (IS_SUPABASE) {
    await getSupabase().from('revoked_tokens').insert([{ jti, expires_at: expiresAt }]);
    return;
  }
  try { sqliteRun('INSERT OR IGNORE INTO revoked_tokens (jti,expires_at) VALUES (?,?)', [jti, expiresAt]); } catch(_) {}
}

async function isTokenRevoked(jti) {
  if (IS_SUPABASE) {
    const { data } = await getSupabase().from('revoked_tokens').select('id').eq('jti', jti).single();
    return Boolean(data);
  }
  return Boolean(sqliteGet('SELECT id FROM revoked_tokens WHERE jti=?', [jti]));
}

async function getStats() {
  if (IS_SUPABASE) {
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
  }

  return {
    images:     sqliteGet('SELECT COUNT(*) AS n FROM images WHERE is_active=1')?.n || 0,
    actresses:  sqliteGet('SELECT COUNT(*) AS n FROM actresses WHERE is_active=1')?.n || 0,
    categories: sqliteGet('SELECT COUNT(*) AS n FROM categories')?.n || 0,
  };
}

// ─── Storage Helper (Upload file buffer to Supabase Storage or local /uploads) ─
async function uploadFileToStorage(fileBuffer, originalFilename, mimeType) {
  const crypto = require('crypto');
  const ext = path.extname(originalFilename).toLowerCase() || '.jpg';
  const filename = `${crypto.randomUUID()}${ext}`;

  if (IS_SUPABASE) {
    const { error } = await getSupabase()
      .storage
      .from('gallery-uploads')
      .upload(filename, fileBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  } else {
    const UPLOADS_DIR = path.join(__dirname, 'uploads');
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), fileBuffer);
  }

  return filename;
}

// ─── Storage Public URL / Stream Helper ────────────────────────────────────────
async function getFileFromStorage(filename) {
  if (IS_SUPABASE) {
    const { data } = getSupabase().storage.from('gallery-uploads').getPublicUrl(filename);
    return data?.publicUrl || null;
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
