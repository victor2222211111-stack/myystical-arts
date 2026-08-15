/**
 * middleware/auth.js
 * JWT authentication middleware for protected admin routes.
 */

'use strict';

const jwt = require('jsonwebtoken');
const { isTokenRevoked } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';

/**
 * Verifies JWT from httpOnly cookie or Authorization header.
 * Attaches decoded payload to req.admin on success.
 */
function requireAuth(req, res, next) {
  let token = null;

  // 1. Try httpOnly cookie (preferred)
  if (req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  }

  // 2. Fallback: Authorization header (Bearer <token>)
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }

  // Check if token has been revoked (logout blacklist)
  if (decoded.jti && isTokenRevoked(decoded.jti)) {
    return res.status(401).json({ success: false, error: 'Token revoked. Please log in again.' });
  }

  req.admin = decoded;
  next();
}

/**
 * Generates a signed JWT token for the admin session.
 */
function generateToken(payload = {}) {
  const crypto = require('crypto');
  const jti = crypto.randomBytes(16).toString('hex');
  return jwt.sign(
    { ...payload, jti, role: 'admin' },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '2h' }
  );
}

/**
 * Cookie options for httpOnly admin token.
 */
function cookieOptions() {
  const httpsEnabled = process.env.HTTPS_ENABLED !== 'false';
  return {
    httpOnly: true,
    secure: httpsEnabled,      // false in HTTP dev mode, true in HTTPS prod
    sameSite: httpsEnabled ? 'strict' : 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    path: '/',
  };
}

module.exports = { requireAuth, generateToken, cookieOptions };
