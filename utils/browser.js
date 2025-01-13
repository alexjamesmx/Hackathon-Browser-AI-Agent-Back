const { chromium } = require("playwright-core");
const { getChromiumPath } = require("playwright-aws-lambda");

async function initializeBrowser() {
  const browser = await chromium.launch({
    args: require("playwright-aws-lambda").defaultArgs,
    executablePath: await getChromiumPath(),
    headless: true,
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    bypassCSP: true,
  });

  return { browser, context };
}
//
module.exports = { initializeBrowser };
