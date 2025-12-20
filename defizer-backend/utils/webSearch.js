// webSearch.js

const fetch = require('node-fetch');
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const puppeteer = require('puppeteer');

const SERPAPI_KEY = process.env.SERPAPI_KEY;

// === Fetches a URL and extracts the main article/content (web reading) ===
async function extractReadableContent(url) {
  try {
    const response = await fetch(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return '';
    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return article && article.textContent ? article.textContent.slice(0, 6000) : ''; // Limit to 6000 chars
  } catch (e) {
    console.warn(`[extractReadableContent] Failed for ${url}:`, e.message);
    return '';
  }
}

// === Extract visible text from a web page using Puppeteer (JS-rendered, deep scraping) ===
/**
 * Uses Puppeteer to extract all visible text from a web page.
 * @param {string} url 
 * @param {object} options Optional: { timeout, maxLength }
 * @returns {Promise<string>}
 */
async function extractVisibleTextWithPuppeteer(url, options = {}) {
  const timeout = options.timeout || 20000; // ms
  const maxLength = options.maxLength || 30000; // chars
  let browser;
  try {
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout });

    // Remove scripts/styles/noscript for cleaner content
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('script, style, noscript')).forEach(el => el.remove());
    });

    // Get only visible text from the page
    const visibleText = await page.evaluate(() => {
      function getText(node) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
          const parent = node.parentElement;
          if (parent && window.getComputedStyle(parent).display !== 'none' && window.getComputedStyle(parent).visibility !== 'hidden') {
            return node.textContent.trim();
          }
        }
        let text = '';
        node.childNodes && node.childNodes.forEach(child => { text += getText(child) + ' '; });
        return text.trim();
      }
      return getText(document.body);
    });
    await browser.close();
    return (visibleText || '').slice(0, maxLength);
  } catch (e) {
    if (browser) await browser.close();
    console.warn('[Puppeteer Extractor] Failed:', e.message);
    return '';
  }
}

// === Check if URL is alive ===
async function urlIsAlive(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', timeout: 3500 });
    return res.ok;
  } catch { return false; }
}

/**
 * Perform a fresh Google search (SerpAPI) for the latest week (or change period).
 * @param {string} query - User's query to search.
 * @param {number} numResults - Number of top results to fetch.
 * @param {boolean} checkAlive - If true, filter out dead URLs.
 * @returns {Promise<Array<{title, link, snippet}>>}
 */
async function latestWebSearch(query, numResults = 8, checkAlive = true) {
  if (!SERPAPI_KEY) throw new Error('SERPAPI_KEY not set in environment');

  // Change tbs: 'qdr:w' for week, 'qdr:d' for day, 'qdr:m' for month, 'qdr:y' for year
  const params = {
    q: query,
    api_key: SERPAPI_KEY,
    num: numResults,
    hl: 'en',
    gl: 'us',
    tbs: 'qdr:w', // <---- Always fetch latest week
  };
  const url = 'https://serpapi.com/search?' + new URLSearchParams(params).toString();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('SerpAPI request failed');
  const data = await resp.json();

  let results = (data.organic_results || []).map(r => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet || ''
  }));

  if (checkAlive) {
    const aliveResults = [];
    for (let r of results) {
      if (await urlIsAlive(r.link)) aliveResults.push(r);
      if (aliveResults.length >= numResults) break;
    }
    results = aliveResults;
  }

  return results;
}

// Example usage (for testing, remove in production):
/*
(async () => {
  const res = await latestWebSearch('openai news', 5, true);
  console.log(res);

  if (res[0]) {
    const content = await extractReadableContent(res[0].link);
    console.log('[Extracted Content]:', content.slice(0, 500));
    const deepContent = await extractVisibleTextWithPuppeteer(res[0].link);
    console.log('[Puppeteer Deep Extract]:', deepContent.slice(0, 500));
  }
})();
*/

module.exports = {
  latestWebSearch,
  extractReadableContent,
  extractVisibleTextWithPuppeteer,
};
