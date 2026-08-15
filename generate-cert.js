/**
 * generate-cert.js
 * Generates a self-signed SSL certificate for local HTTPS development.
 * For production, replace ssl/cert.pem and ssl/key.pem with a real certificate
 * from Let's Encrypt (https://letsencrypt.org/) or your CA.
 */

'use strict';

const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');

const SSL_DIR = path.join(__dirname, 'ssl');

if (!fs.existsSync(SSL_DIR)) {
  fs.mkdirSync(SSL_DIR, { recursive: true });
}

console.log('🔐 Generating self-signed SSL certificate...');

const attrs = [
  { name: 'commonName', value: 'localhost' },
  { name: 'countryName', value: 'IN' },
  { name: 'organizationName', value: 'Myystical_arts' },
  { name: 'organizationalUnitName', value: 'Web' },
];

const pems = selfsigned.generate(attrs, {
  days: 365,
  algorithm: 'sha256',
  keySize: 2048,
  extensions: [
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
      ],
    },
  ],
});

fs.writeFileSync(path.join(SSL_DIR, 'cert.pem'), pems.cert);
fs.writeFileSync(path.join(SSL_DIR, 'key.pem'), pems.private);

console.log('✅ SSL certificate generated:');
console.log('   cert → ssl/cert.pem');
console.log('   key  → ssl/key.pem');
console.log('');
console.log('⚠️  This is a self-signed certificate for development only.');
console.log('   Your browser will show a security warning — click "Advanced" → "Proceed".');
console.log('   For production, replace these files with a real certificate.');
