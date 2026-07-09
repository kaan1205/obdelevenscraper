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

/**
 * Finds a "next page" control. Pagers that show "1 2 3 … 13" only render
 * buttons for the first/last few page numbers, so a middle page like 7 has
 * no clickable number to target directly — but a Next arrow reliably steps
 * forward one page regardless of which numbers happen to be visible.
 */
async function findNextButton(page) {
  // Pagination items here are `.chakra-button` elements (sometimes rendered
  // as <span>, not a native <button> — confirmed from the live DOM), so text/
  // class-based matching is tried before role/aria-label-based matching.
  const candidates = [
    page.locator(selectors.pagination.buttonSelector).filter({ hasText: /^(>|»|›|next)$/i }),
    page.locator('[aria-label*="next" i]'),
    page.getByRole('button', { name: /^next$/i }),
    page.getByRole('button', { name: /next page/i }),
  ];

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if ((await candidate.count()) > 0) return candidate.first();
  }
  return null;
}

async function goToPage(page, pageNumber, baseUrl) {
  // The scrape loop always calls this to advance exactly one page at a
  // time (1 -> 2 -> 3 -> ...), so a Next button is always the right move
  // and works even when the target page number isn't rendered yet.
  const nextButton = await findNextButton(page);
  if (nextButton) {
    await nextButton.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    return;
  }

  // Fallback: no Next control found. The exact page-number button may
  // still be visible (a pager that doesn't truncate) ...
  let pageButton = page
    .locator(selectors.pagination.buttonSelector)
    .filter({ hasText: new RegExp(`^${pageNumber}$`) });

  if ((await pageButton.count()) === 0) {
    // ... or it's hidden behind an ellipsis ("1 2 3 … 13") — clicking that
    // often expands the hidden range of page-number buttons.
    const ellipsis = page.locator(selectors.pagination.buttonSelector).filter({ hasText: /^(\.\.\.|…)$/ });
    if ((await ellipsis.count()) > 0) {
      await ellipsis.first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
      pageButton = page
        .locator(selectors.pagination.buttonSelector)
        .filter({ hasText: new RegExp(`^${pageNumber}$`) });
    }
  }

  if ((await pageButton.count()) > 0) {
    await pageButton.first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    return;
  }

  // Last resort: try a `?page=` query param in case pagination is URL-driven.
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
      const isAllDuplicates = pageNumber > 1 && titles.length > 0 && titles.every((t) => seen.has(t));
      if (isAllDuplicates) {
        console.warn(
          `  page ${pageNumber}/${totalPages} for ${make}/${model}/${year} returned only titles ` +
            'already seen — pagination may not have advanced.'
        );
      }
      titles.forEach((title) => seen.add(title));
    }

    return { url, totalPages, titles: Array.from(seen) };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeCustomizations };
