# Myystical_arts — Setup Guide

Complete instructions to get your gallery running.

---

## Quick Start

### 1. Install Node.js
Download from [nodejs.org](https://nodejs.org) — use the **LTS** version.

### 2. Navigate to the project
```
A:\ai workplace\webapp.cc
```

### 3. Copy and configure environment
```
copy .env.example .env
```
Open `.env` in Notepad and update any values you want.

### 4. Install dependencies
```
npm install
```

### 5. Generate SSL certificate (for HTTPS)
```
node generate-cert.js
```

### 6. Set admin password
```
node setup-admin.js
```
Follow the prompts to set your admin username and password.

### 7. Start the server
```
npm start
```

---

## Accessing the Site

| URL | Purpose |
|-----|---------|
| `https://localhost:3443` | 🌐 Public gallery |
| `https://localhost:3443/admin` | 🛠 Admin panel |

> **Browser warning**: You'll see an SSL warning because the certificate is self-signed.  
> Click **"Advanced"** → **"Proceed to localhost"** to continue.

---

## Admin Panel Usage

### Login
- Go to `https://localhost:3443/admin`
- Enter your username & password (set in step 6)

### Upload Images
1. Go to **Images** section
2. Click **+ Upload Image**
3. Drag and drop or click to select a file (JPEG, PNG, WebP — max 10MB)
4. Assign actress, category, caption, and sort order
5. Click **Upload**

### Add Actresses
1. Go to **Actresses** section
2. Click **+ Add Actress**
3. Upload a face/profile photo
4. Enter name, Instagram URL, bio
5. Click **Save**

### Manage Categories
1. Go to **Categories** section
2. Add, edit, or delete categories

### Edit Site Settings
1. Go to **Settings** section
2. Update site name, tagline, Instagram handle and URL
3. Click **Save Settings**

---

## Security Features

| Feature | Detail |
|---------|--------|
| HTTPS/TLS | Self-signed cert (dev) / real cert (prod) |
| CSP | Strict Content Security Policy via Helmet |
| Rate Limiting | 100 req/15min public · 30 req/15min admin · 10 logins/15min |
| JWT Auth | httpOnly, SameSite=Strict cookies, 2-hour expiry |
| Password Hashing | bcrypt cost 12 |
| No-Download | Inline serving, right-click blocked, drag blocked, print CSS |
| Input Validation | express-validator on all routes |
| CAPTCHA | Google reCAPTCHA v3 (enable in .env) |
| SQL Injection | Parameterized queries only |
| Token Blacklist | Revoked JWTs tracked in DB |

---

## Enabling CAPTCHA

1. Go to [google.com/recaptcha/admin](https://www.google.com/recaptcha/admin)
2. Create a new site (reCAPTCHA v3)
3. Add `localhost` as allowed domain
4. Copy your **Site Key** and **Secret Key**
5. In `.env`:
   ```
   CAPTCHA_ENABLED=true
   RECAPTCHA_SITE_KEY=your_site_key
   RECAPTCHA_SECRET_KEY=your_secret_key
   ```
6. In `public/index.html` and `public/admin.html`, add the script tag:
   ```html
   <script src="https://www.google.com/recaptcha/api.js?render=YOUR_SITE_KEY"></script>
   ```

---

## Production Deployment

### SSL Certificate
Replace self-signed cert with a real one from [Let's Encrypt](https://letsencrypt.org/):
```
ssl/cert.pem  ← Your certificate chain
ssl/key.pem   ← Your private key
```

### Environment
Set in `.env`:
```
NODE_ENV=production
PORT=80
HTTPS_PORT=443
```

### Run as Service (Windows)
Install PM2:
```
npm install -g pm2
pm2 start server.js --name myystical-arts
pm2 startup
pm2 save
```

---

## File Structure

```
webapp.cc/
├── server.js           ← Main HTTPS Express server
├── database.js         ← SQLite DB (gallery.db auto-created)
├── package.json
├── .env                ← Your secrets (never commit this)
├── .env.example        ← Template
├── generate-cert.js    ← Run once to create SSL cert
├── setup-admin.js      ← Run once to set admin password
├── gallery.db          ← SQLite database (auto-created)
├── middleware/
│   ├── auth.js         ← JWT authentication
│   ├── rateLimiter.js  ← Rate limiting
│   ├── security.js     ← Helmet + CSP + anti-download headers
│   └── captcha.js      ← reCAPTCHA v3 verification
├── routes/
│   ├── api.js          ← Public API
│   └── admin.js        ← Admin API (protected)
├── uploads/            ← Uploaded images (auto-created)
├── ssl/                ← SSL certificates (auto-created)
└── public/
    ├── index.html      ← Gallery
    ├── admin.html      ← Admin panel
    ├── css/
    │   ├── main.css    ← Gallery styles
    │   └── admin.css   ← Admin styles
    └── js/
        ├── app.js      ← Gallery logic
        ├── lightbox.js ← Image viewer
        └── admin.js    ← Admin logic
```

---

## Troubleshooting

**`Cannot find module 'better-sqlite3'`**
```
npm install
```
If it still fails on Windows, install build tools:
```
npm install -g windows-build-tools
npm install
```

**Port already in use**
Change `PORT` and `HTTPS_PORT` in `.env`.

**Images not showing**
Make sure the file exists in `uploads/` and you uploaded it through the Admin panel.

**Admin login fails**
Re-run `node setup-admin.js` to reset your password.
