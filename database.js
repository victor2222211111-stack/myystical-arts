/**
 * database.js
 * SQLite database via sql.js (pure WASM — no native compilation required).
 * Provides a synchronous-style API that mirrors better-sqlite3 for easy use.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const DB_PATH  = path.join(__dirname, 'gallery.db');
const WASM_DIR = path.join(__dirname, 'node_modules', 'sql.js', 'dist');

let SQL = null; // sql.js constructor (set after init)
let db  = null; // active Database instance

// ─── Persistence helpers ─────────────────────────────────────────────────────

/** Persist the in-memory database to disk */
function save() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('DB save error:', err.message);
  }
}

// Save every 30 seconds in the background + on process exit
setInterval(save, 30_000).unref();
process.on('exit',    save);
process.on('SIGINT',  () => { save(); process.exit(0); });
process.on('SIGTERM', () => { save(); process.exit(0); });

// ─── Init (async — call once before starting the server) ─────────────────────

async function init() {
  if (db) return; // Already initialised

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
    console.log('📦 Created new database at', DB_PATH);
  }

  // Apply pragmas
  db.run('PRAGMA foreign_keys = ON;');
  db.run('PRAGMA journal_mode = DELETE;'); // WAL not supported in sql.js

  initSchema();
  console.log('✅ Database ready');
}

// ─── Low-level sql.js helpers ─────────────────────────────────────────────────

/**
 * Execute a query returning an array of row objects.
 * Supports both positional (array) and named (object) params.
 */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(normaliseParams(params));
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/**
 * Execute a query returning at most one row object (or null).
 */
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(normaliseParams(params));
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

/**
 * Execute a DML statement (INSERT / UPDATE / DELETE).
 * Returns { lastInsertRowid, changes }.
 */
function run(sql, params = []) {
  db.run(sql, normaliseParams(params));
  const meta = get('SELECT last_insert_rowid() as id, changes() as changes');
  save();
  return { lastInsertRowid: meta?.id ?? 0, changes: meta?.changes ?? 0 };
}

/** Convert @named object params to $named (sql.js uses $ prefix). */
function normaliseParams(params) {
  if (!params || Array.isArray(params)) return params;
  // Object: convert @key → $key
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    const key = k.startsWith('@') || k.startsWith(':') || k.startsWith('$')
      ? k
      : `$${k}`;
    out[key] = v;
  }
  return out;
}

/** Execute raw multi-statement SQL (schema creation etc.) */
function exec(sql) {
  db.run(sql);
}

// ─── Schema ───────────────────────────────────────────────────────────────────

function initSchema() {
  exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      slug        TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      sort_order  INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS actresses (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      slug          TEXT NOT NULL UNIQUE,
      face_filename TEXT DEFAULT NULL,
      bio           TEXT DEFAULT '',
      instagram_url TEXT DEFAULT '',
      sort_order    INTEGER DEFAULT 0,
      is_active     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS images (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      actress_id        INTEGER,
      category_id       INTEGER,
      filename          TEXT NOT NULL UNIQUE,
      original_filename TEXT NOT NULL,
      caption           TEXT DEFAULT '',
      width             INTEGER DEFAULT 0,
      height            INTEGER DEFAULT 0,
      file_size         INTEGER DEFAULT 0,
      sort_order        INTEGER DEFAULT 0,
      is_active         INTEGER DEFAULT 1,
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      jti        TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed default categories if empty
  const catCount = get('SELECT COUNT(*) AS n FROM categories')?.n || 0;
  if (catCount === 0) {
    const seedCats = [
      ['Glamour',   'glamour',   'Red carpet & high fashion',         0],
      ['Candid',    'candid',    'Natural, behind-the-scenes moments', 1],
      ['Ethnic',    'ethnic',    'Traditional & ethnic wear',          2],
      ['Editorial', 'editorial', 'Magazine & editorial shoots',        3],
      ['Events',    'events',    'Award shows & public events',        4],
    ];
    for (const [name, slug, description, sort_order] of seedCats) {
      db.run(
        'INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES (?,?,?,?)',
        [name, slug, description, sort_order]
      );
    }
    console.log('📂 Seeded default categories');
  }

  // Seed default settings
  const defaults = {
    site_name:        process.env.SITE_NAME     || 'Myystical_arts',
    site_tagline:     process.env.SITE_TAGLINE  || 'Curated Indian Celebrity Gallery',
    instagram_url:    process.env.INSTAGRAM_URL ||
      'https://www.instagram.com/myystical__arts?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==',
    instagram_handle: process.env.INSTAGRAM_HANDLE || '@myystical__arts',
  };
  for (const [key, value] of Object.entries(defaults)) {
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)', [key, value]);
  }

  // Clean expired revoked tokens
  db.run("DELETE FROM revoked_tokens WHERE expires_at < datetime('now')");

  save();
}

// ─── Query helpers (public API mirrors better-sqlite3 style) ──────────────────

function getCategories() {
  return all('SELECT * FROM categories ORDER BY sort_order, name');
}

function getActresses() {
  return all('SELECT * FROM actresses WHERE is_active = 1 ORDER BY sort_order, name');
}

/** Admin view: returns ALL actresses including hidden ones */
function getActressesAll() {
  return all('SELECT * FROM actresses ORDER BY sort_order, name');
}

function getImages({ actress_id, category_id, page = 1, limit = 30 } = {}) {
  const offset = (page - 1) * limit;
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
  return all(query, params);
}

function getImageCount({ actress_id, category_id } = {}) {
  let query = 'SELECT COUNT(*) AS n FROM images WHERE is_active = 1';
  const params = [];
  if (actress_id)  { query += ' AND actress_id = ?';  params.push(actress_id);  }
  if (category_id) { query += ' AND category_id = ?'; params.push(category_id); }
  return get(query, params)?.n || 0;
}

function getImageById(id)   { return get('SELECT * FROM images WHERE id = ?', [id]); }
function getActressById(id) { return get('SELECT * FROM actresses WHERE id = ?', [id]); }
function getCategoryById(id){ return get('SELECT * FROM categories WHERE id = ?', [id]); }

function insertImage(data) {
  return run(
    `INSERT INTO images
     (actress_id,category_id,filename,original_filename,caption,width,height,file_size,sort_order)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [data.actress_id||null, data.category_id||null, data.filename,
     data.original_filename, data.caption||'', data.width||0, data.height||0,
     data.file_size||0, data.sort_order||0]
  );
}

function updateImage(id, data) {
  return run(
    'UPDATE images SET actress_id=?,category_id=?,caption=?,sort_order=? WHERE id=?',
    [data.actress_id||null, data.category_id||null, data.caption||'', data.sort_order||0, id]
  );
}

function deleteImage(id) { return run('DELETE FROM images WHERE id=?', [id]); }

function insertActress(data) {
  return run(
    'INSERT INTO actresses (name,slug,face_filename,bio,instagram_url,sort_order) VALUES (?,?,?,?,?,?)',
    [data.name, data.slug, data.face_filename||null, data.bio||'', data.instagram_url||'', data.sort_order||0]
  );
}

function updateActress(id, data) {
  return run(
    `UPDATE actresses SET name=?,slug=?,face_filename=?,bio=?,instagram_url=?,sort_order=?,is_active=?
     WHERE id=?`,
    [data.name, data.slug, data.face_filename||null, data.bio||'', data.instagram_url||'',
     data.sort_order||0, data.is_active!==undefined ? data.is_active : 1, id]
  );
}

function deleteActress(id) { return run('DELETE FROM actresses WHERE id=?', [id]); }

function insertCategory(data) {
  return run(
    'INSERT INTO categories (name,slug,description,sort_order) VALUES (?,?,?,?)',
    [data.name, data.slug, data.description||'', data.sort_order||0]
  );
}

function updateCategory(id, data) {
  return run(
    'UPDATE categories SET name=?,slug=?,description=?,sort_order=? WHERE id=?',
    [data.name, data.slug, data.description||'', data.sort_order||0, id]
  );
}

function deleteCategory(id) { return run('DELETE FROM categories WHERE id=?', [id]); }

function getSetting(key) {
  return get('SELECT value FROM settings WHERE key=?', [key])?.value || null;
}

function setSetting(key, value) {
  run("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))", [key, value]);
}

function getAllSettings() {
  const rows = all('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function revokeToken(jti, expiresAt) {
  try { run('INSERT OR IGNORE INTO revoked_tokens (jti,expires_at) VALUES (?,?)', [jti, expiresAt]); }
  catch(_) {}
}

function isTokenRevoked(jti) {
  return !!get('SELECT id FROM revoked_tokens WHERE jti=?', [jti]);
}

function getStats() {
  return {
    images:     get('SELECT COUNT(*) AS n FROM images WHERE is_active=1')?.n || 0,
    actresses:  get('SELECT COUNT(*) AS n FROM actresses WHERE is_active=1')?.n || 0,
    categories: get('SELECT COUNT(*) AS n FROM categories')?.n || 0,
  };
}

module.exports = {
  init, save,
  getCategories, getActresses, getActressesAll, getImages, getImageCount,
  getImageById, insertImage, updateImage, deleteImage,
  getActressById, insertActress, updateActress, deleteActress,
  getCategoryById, insertCategory, updateCategory, deleteCategory,
  getSetting, setSetting, getAllSettings,
  revokeToken, isTokenRevoked, getStats,
};
