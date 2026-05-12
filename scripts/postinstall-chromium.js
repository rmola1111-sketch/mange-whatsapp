// scripts/postinstall-chromium.js
// Ensures Chromium is installed during build (Render, CI, etc.)

const { execSync } = require('child_process');

try {
  console.log('[postinstall] Chromium install started: running `npx puppeteer browsers install chrome`');
  execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
  console.log('[postinstall] Chromium install completed');
} catch (err) {
  console.error('[postinstall] Chromium install failed (non-fatal):', err && err.message);
  // Do not fail the whole install process
  process.exit(0);
}
