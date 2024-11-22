const { chromium } = require("playwright");

async function initializeBrowser() {
  const browser = await chromium.launch({
    executablePath: "/app/browsers/chromium-1129/chrome-linux/chrome",
    ignoreHTTPSErrors: true,
    args: ["--ignore-certificate-errors"],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });

  return { browser, context };
}

module.exports = { initializeBrowser };
