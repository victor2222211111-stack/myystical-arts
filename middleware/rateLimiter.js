/**
 * middleware/rateLimiter.js
 * Rate limiting configurations for different endpoint groups.
 */

'use strict';

const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV === 'development';
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 min

/** Standard JSON error response for rate limit exceeded */
const handler = (req, res) => {
  res.status(429).json({
    success: false,
    error: 'Too many requests. Please slow down and try again later.',
    retryAfter: Math.ceil(WINDOW_MS / 1000),
  });
};

/** Public gallery endpoints: images, categories, actresses */
const publicLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: parseInt(process.env.RATE_LIMIT_PUBLIC || (isDev ? '1000' : '200'), 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  skip: req => req.method === 'OPTIONS',
});

/** Admin API endpoints (after login) */
const adminLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: parseInt(process.env.RATE_LIMIT_ADMIN || (isDev ? '1000' : '300'), 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/** Login endpoint — strict to prevent brute-force */
const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: parseInt(process.env.RATE_LIMIT_LOGIN || (isDev ? '100' : '30'), 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many login attempts. Please wait 15 minutes before trying again.',
      retryAfter: Math.ceil(WINDOW_MS / 1000),
    });
  },
  keyGenerator: req => req.ip,
});


/** Image upload endpoint */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 uploads per hour
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Upload limit reached. Maximum 50 uploads per hour.',
    });
  },
});

module.exports = { publicLimiter, adminLimiter, loginLimiter, uploadLimiter };
