const { chromium } = require('playwright');
const selectors = require('./selectors');
const { launchOptions } = require('../lib/launchOptions');
const { dismissCookieBanner } = require('./cookieConsent');

// Delay between page loads while paginating, to be polite to the site.
const POLITE_DELAY_MS = Number(process.env.SCRAPE_DELAY_MS) || 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readTitlesOnCurrentPage(page) {
  let titles = await page.locator(selectors.results.titleSelector).allTextContents();
  titles = titles.map((t) => t.trim()).filter(Boolean);

  if (titles.length === 0) {
    // Primary selector found nothing (likely a Chakra class-name mismatch) —
    // fall back to any <p> inside the results container.
    titles = await page.locator(selectors.results.fallbackTitleSelector).allTextContents();
    titles = titles.map((t) => t.trim()).filter(Boolean);
  }

  return titles;
}

async function readTotalPages(page) {
  const buttonTexts = await page.locator(selectors.pagination.buttonSelector).allTextContents();
  const numbers = buttonTexts
    .map((t) => t.trim())
    .filter((t) => /^\d+$/.test(t))
    .map(Number);
  return numbers.length ? Math.max(...numbers) : 1;
}

async function goToPage(page, pageNumber, baseUrl) {
  // Primary strategy: the pager is client-rendered, so click the button
  // whose text is the target page number.
  const pageButton = page
    .locator(selectors.pagination.buttonSelector)
    .filter({ hasText: new RegExp(`^${pageNumber}$`) });

  if ((await pageButton.count()) > 0) {
    await pageButton.first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    return;
  }

  // Fallback: try a `?page=` query param in case pagination is URL-driven.
  const url = new URL(baseUrl);
  url.searchParams.set('page', String(pageNumber));
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
}

/**
 * Scrapes every customization title for a given make/model/year slug combo,
 * walking all pagination pages and de-duplicating titles that repeat across
 * pages.
 */
async function scrapeCustomizations({ make, model, year }) {
  const url = `${selectors.baseUrl}/${make}/${model}/${year}`;
  const browser = await chromium.launch(launchOptions());

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await dismissCookieBanner(page);

    const totalPages = await readTotalPages(page);
    const seen = new Set();

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      if (pageNumber > 1) {
        await goToPage(page, pageNumber, url);
        await sleep(POLITE_DELAY_MS);
      }

      const titles = await readTitlesOnCurrentPage(page);
      titles.forEach((title) => seen.add(title));
    }

    return { url, totalPages, titles: Array.from(seen) };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeCustomizations };
