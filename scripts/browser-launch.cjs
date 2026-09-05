const { chromium } = require('playwright');

async function launchBrowser() {
  return chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
}

module.exports = { launchBrowser };
