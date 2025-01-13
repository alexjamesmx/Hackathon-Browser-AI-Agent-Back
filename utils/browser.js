const { chromium: playwright } = require("playwright-core");
const chromium = require("@sparticuz/chromium");
chromium.setHeadlessMode = true;

async function initializeBrowser() {
  const browser = await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  const context = await browser.newContext({
    executablePath: await chromium.executablePath(),
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });

  return { browser, context };
}
//
module.exports = { initializeBrowser };
