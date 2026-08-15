/**
 * middleware/security.js
 * Security headers via Helmet + custom Content Security Policy.
 */

'use strict';

const helmet = require('helmet');

/**
 * Returns a configured Helmet middleware with a strict CSP.
 * Pass httpsEnabled=false in dev to skip HSTS and upgrade-insecure-requests.
 * Call this as: app.use(security(httpsEnabled))
 */
function security(httpsEnabled = true) {
  return helmet({
    // Content Security Policy
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],

        // Scripts: only self + Google reCAPTCHA
        'script-src': [
          "'self'",
          'https://www.google.com',
          'https://www.gstatic.com',
        ],

        // Styles: self + Google Fonts
        'style-src': [
          "'self'",
          "'unsafe-inline'", // needed for dynamic styles
          'https://fonts.googleapis.com',
        ],

        // Fonts: Google Fonts CDN
        'font-src': ["'self'", 'https://fonts.gstatic.com'],

        // Images: self + data URIs (for base64 placeholders)
        'img-src': ["'self'", 'data:', 'blob:'],

        // Fetch / XHR: self only
        'connect-src': ["'self'"],

        // Frames: Google reCAPTCHA iframe
        'frame-src': ['https://www.google.com'],

        // Block all plugins/embeds
        'object-src': ["'none'"],
        'embed-src':  ["'none'"],

        // Restrict form submissions to self
        'form-action': ["'self'"],

        // Restrict base tag
        'base-uri': ["'self'"],

        // Only add upgrade-insecure-requests in HTTPS mode — in HTTP mode
        // this directive causes browsers to block all mixed/http sub-requests.
        ...(httpsEnabled ? { 'upgrade-insecure-requests': [] } : {}),

        // Prevent loading in iframes on other sites
        'frame-ancestors': ["'none'"],
      },
    },

    // X-Frame-Options: deny embedding in iframes
    frameguard: { action: 'deny' },

    // X-Content-Type-Options: nosniff
    noSniff: true,

    // Referrer-Policy: strict
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

    // HSTS: only in HTTPS mode. In HTTP mode this header causes browsers to
    // permanently refuse HTTP connections for up to 1 year.
    hsts: httpsEnabled
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,

    // X-XSS-Protection: legacy header
    xssFilter: true,

    // X-Permitted-Cross-Domain-Policies
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },

    // Remove X-Powered-By header
    hidePoweredBy: true,

    // DNS Prefetch Control
    dnsPrefetchControl: { allow: false },

    // Cross-Origin Resource Policy
    crossOriginResourcePolicy: { policy: 'same-origin' },

    // Cross-Origin Opener Policy
    crossOriginOpenerPolicy: { policy: 'same-origin' },

    // Cross-Origin Embedder Policy
    crossOriginEmbedderPolicy: false, // Disabled to allow Google reCAPTCHA
  });
}

/**
 * Middleware to add anti-download headers to image responses.
 * Applied to the /uploads/ route.
 */
function antiDownloadHeaders(req, res, next) {
  // Serve inline, not as attachment
  res.setHeader('Content-Disposition', 'inline');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent caching of sensitive images
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  // Disable cross-origin resource sharing for images
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // Prevent embedding images in other sites
  res.setHeader('X-Frame-Options', 'DENY');

  next();
}

module.exports = { security, antiDownloadHeaders };
