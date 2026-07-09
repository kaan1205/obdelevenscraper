const fs = require('fs');

// Some sandboxed environments ship a pre-installed Chromium outside of
// Playwright's normal cache dir (and block `playwright install` downloads).
// If present, use it explicitly instead of letting Playwright resolve its
// own managed browser. On a normal machine (after `npx playwright install
// chromium`) this path won't exist and Playwright's default resolution is used.
const SANDBOX_CHROMIUM_PATH = '/opt/pw-browsers/chromium';

function launchOptions(overrides = {}) {
  const options = { headless: process.env.HEADLESS !== 'false', ...overrides };
  if (fs.existsSync(SANDBOX_CHROMIUM_PATH)) {
    options.executablePath = SANDBOX_CHROMIUM_PATH;
  }
  return options;
}

module.exports = { launchOptions };
