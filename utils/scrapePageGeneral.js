// utils/scrapePageGeneral.js
const { chromium } = require('playwright');

/**
 * Scrapes ALL visible text content from any web page (up to X characters).
 * @param {string} url - Any valid http/https URL
 * @returns {Promise<string>} Page text (or "" if error)
 */
async function scrapePageGeneral(url, charLimit = 7000) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Optionally, wait for networkidle or other events for complex pages
    const text = await page.evaluate(() => document.body.innerText);
    await browser.close();
    return text ? text.slice(0, charLimit) : "";
  } catch (e) {
    if (browser) await browser.close();
    return "";
  }
}
module.exports = { scrapePageGeneral };
