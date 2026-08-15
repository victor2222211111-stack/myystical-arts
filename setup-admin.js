/**
 * setup-admin.js
 * First-time setup: hashes the admin password and writes it to .env.
 * Run once: node setup-admin.js
 */

'use strict';

const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '.env');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  console.log('\n🔧 Myystical_arts — Admin Setup\n');

  // Load existing .env or create from example
  if (!fs.existsSync(ENV_PATH)) {
    const example = path.join(__dirname, '.env.example');
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, ENV_PATH);
      console.log('📋 Created .env from .env.example');
    } else {
      fs.writeFileSync(ENV_PATH, '');
      console.log('📋 Created empty .env');
    }
  }

  let envContent = fs.readFileSync(ENV_PATH, 'utf8');

  // Admin username
  const currentUser = (envContent.match(/^ADMIN_USERNAME=(.+)$/m) || [])[1] || 'myystical_admin';
  const username = await question(`Admin username [${currentUser}]: `);
  const finalUser = username.trim() || currentUser;

  // Admin password
  const password = await question('New admin password (min 8 chars): ');
  if (!password || password.trim().length < 8) {
    console.error('❌ Password must be at least 8 characters.');
    rl.close();
    process.exit(1);
  }

  // JWT secret
  const crypto = require('crypto');
  let jwtSecret = (envContent.match(/^JWT_SECRET=(.+)$/m) || [])[1] || '';
  if (!jwtSecret || jwtSecret.includes('REPLACE')) {
    jwtSecret = crypto.randomBytes(64).toString('hex');
    console.log('🔑 Generated new JWT secret');
  }

  console.log('\n⏳ Hashing password (bcrypt, cost 12)...');
  const hash = await bcrypt.hash(password.trim(), 12);

  // Update env file
  const updates = {
    ADMIN_USERNAME: finalUser,
    ADMIN_PASSWORD_HASH: hash,
    JWT_SECRET: jwtSecret,
    ADMIN_PLAIN_PASSWORD: '', // clear plain text password
  };

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(ENV_PATH, envContent);

  console.log('\n✅ Admin setup complete!');
  console.log(`   Username : ${finalUser}`);
  console.log(`   Password : (hashed & stored in .env)`);
  console.log('\n🚀 Start the server: npm start');
  console.log('🌐 Admin panel: https://localhost:3443/admin\n');

  rl.close();
}

main().catch(err => {
  console.error('❌ Setup failed:', err.message);
  process.exit(1);
});
