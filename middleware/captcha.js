/**
 * middleware/captcha.js
 * Google reCAPTCHA v3 verification middleware.
 *
 * Set CAPTCHA_ENABLED=false in .env to skip in development.
 * Register your domain at: https://www.google.com/recaptcha/admin
 */

'use strict';

const axios = require('axios');

const CAPTCHA_ENABLED = process.env.CAPTCHA_ENABLED !== 'false';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY || '';
const MIN_SCORE = parseFloat(process.env.RECAPTCHA_MIN_SCORE || '0.5');

/**
 * Middleware: verifies the reCAPTCHA token from the request body.
 * Expects: req.body.captchaToken (string)
 */
async function verifyCaptcha(req, res, next) {
  if (!CAPTCHA_ENABLED) {
    // Development bypass
    return next();
  }

  const token = req.body.captchaToken;

  if (!token || typeof token !== 'string' || token.length > 2048) {
    return res.status(400).json({
      success: false,
      error: 'CAPTCHA verification required.',
    });
  }

  try {
    const response = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      null,
      {
        params: {
          secret: RECAPTCHA_SECRET,
          response: token,
          remoteip: req.ip,
        },
        timeout: 5000,
      }
    );

    const data = response.data;

    if (!data.success) {
      console.warn('reCAPTCHA failed:', data['error-codes']);
      return res.status(403).json({
        success: false,
        error: 'CAPTCHA verification failed. Please try again.',
      });
    }

    if (data.score !== undefined && data.score < MIN_SCORE) {
      console.warn(`reCAPTCHA score too low: ${data.score} (min: ${MIN_SCORE})`);
      return res.status(403).json({
        success: false,
        error: 'Suspicious activity detected. Access denied.',
      });
    }

    next();
  } catch (err) {
    console.error('reCAPTCHA verification error:', err.message);
    // Fail open in development, fail closed in production
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        success: false,
        error: 'CAPTCHA service unavailable. Please try again.',
      });
    }
    next();
  }
}

module.exports = { verifyCaptcha };
