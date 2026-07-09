const { chromium } = require('playwright');
const selectors = require('./selectors');
const { launchOptions } = require('../lib/launchOptions');
const { dismissCookieBanner } = require('./cookieConsent');

// Delay between page loads while paginating, to be polite to the site.
const POLITE_DELAY_MS = Number(process.env.SCRAPE_DELAY_MS) || 1500;
// How long to wait for the pagination bar's digit buttons to (re)appear
// before giving up. The pager can briefly disappear (a loading state) right
// after clicking Next, so checking once immediately is unreliable.
const PAGINATION_READY_TIMEOUT_MS = Number(process.env.PAGINATION_READY_TIMEOUT_MS) || 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countDigitButtons(page) {
  return page.evaluate(
    (sel) => Array.from(document.querySelectorAll(sel)).filter((el) => /^\d+$/.test(el.textContent.trim())).length,
    selectors.pagination.buttonSelector
  );
}

/** Waits for at least one digit page-number button to be present in the DOM. */
async function waitForPaginationReady(page, timeoutMs = PAGINATION_READY_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    if ((await countDigitButtons(page)) > 0) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(150);
  }
  return false;
}

async function readTitlesOnCurrentPage(page, pageNumber) {
  let titles = await page.locator(selectors.results.titleSelector).allTextContents();
  titles = titles.map((t) => t.trim()).filter(Boolean);

  if (titles.length === 0) {
    // Primary selector found nothing (likely a Chakra class-name mismatch) —
    // fall back to any <p> inside the results container.
    titles = await page.locator(selectors.results.fallbackTitleSelector).allTextContents();
    titles = titles.map((t) => t.trim()).filter(Boolean);
  }

  if (titles.length === 0 && pageNumber === 1) {
    // Both selectors missed — dump a chunk of the results container so the
    // real markup can be inspected from the server log without needing
    // DevTools, and selectors.js can be corrected against it directly.
    const containerHTML = await page
      .locator(selectors.results.containerSelector)
      .first()
      .evaluate((el) => el.outerHTML.slice(0, 4000))
      .catch(() => '(could not read container)');
    console.warn(
      `  No titles matched "${selectors.results.titleSelector}" or fallback "${selectors.results.fallbackTitleSelector}". ` +
        `"${selectors.results.containerSelector}" contents (first 4000 chars):\n${containerHTML}`
    );
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
 *
 * Confirmed from the live DOM: the Next control is an icon-only
 * `.chakra-button` (an SVG chevron, no text and no aria-label) using the
 * exact same generated class as the numbered page buttons — so it can't be
 * matched by text or class. Instead, find the pagination bar (the shared
 * parent of the digit buttons) and take the button that comes right after
 * the last digit/ellipsis button in DOM order.
 */
async function findNextButton(page) {
  const handle = await page.evaluateHandle((sel) => {
    const all = Array.from(document.querySelectorAll(sel));
    const digitButtons = all.filter((el) => /^\d+$/.test(el.textContent.trim()));
    if (digitButtons.length === 0) return null;

    let container = digitButtons[0].parentElement;
    while (container && !digitButtons.every((b) => container.contains(b))) {
      container = container.parentElement;
    }
    if (!container) return null;

    const siblings = Array.from(container.querySelectorAll(sel));
    const lastPagerIndex = siblings.reduce((last, el, i) => {
      const t = el.textContent.trim();
      return /^\d+$/.test(t) || t === '...' || t === '…' ? i : last;
    }, -1);

    return lastPagerIndex >= 0 && lastPagerIndex + 1 < siblings.length ? siblings[lastPagerIndex + 1] : null;
  }, selectors.pagination.buttonSelector);

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }
  return element;
}

/** Returns which navigation strategy it used, for diagnostics. */
async function goToPage(page, pageNumber, baseUrl) {
  // The pager can briefly vanish (a loading placeholder) right after the
  // previous page transition — give it a moment to come back before
  // concluding there's nothing to click.
  await waitForPaginationReady(page);

  // The scrape loop always calls this to advance exactly one page at a
  // time (1 -> 2 -> 3 -> ...), so a Next button is always the right move
  // and works even when the target page number isn't rendered yet.
  const nextButton = await findNextButton(page);
  if (nextButton) {
    await nextButton.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    return 'next-button';
  }

  // Fallback: no Next control found. The exact page-number button may
  // still be visible (a pager that doesn't truncate) ...
  let pageButton = page
    .locator(selectors.pagination.buttonSelector)
    .filter({ hasText: new RegExp(`^${pageNumber}$`) });
  let strategy = 'number-button';

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
      strategy = 'ellipsis-then-number';
    }
  }

  if ((await pageButton.count()) > 0) {
    await pageButton.first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    return strategy;
  }

  // Every click-based strategy failed to find anything to interact with.
  // Dump the pagination bar's real markup so selectors can be fixed against
  // it directly instead of guessing blind.
  const paginationHTML = await page
    .evaluate((sel) => {
      // Only digit/ellipsis buttons unambiguously identify the pager — a
      // broader "short text" filter previously swept in unrelated buttons
      // (e.g. a 3-letter "All" filter tab) and dumped the whole page.
      const digitButtons = Array.from(document.querySelectorAll(sel)).filter((el) =>
        /^\d+$/.test(el.textContent.trim())
      );
      if (digitButtons.length === 0) return '(no digit pagination buttons found on page)';
      let container = digitButtons[0].parentElement;
      while (container && !digitButtons.every((b) => container.contains(b))) {
        container = container.parentElement;
      }
      return container ? container.outerHTML.slice(0, 3000) : '(no common container found)';
    }, selectors.pagination.buttonSelector)
    .catch(() => '(could not read pagination container)');
  console.warn(`  Could not find a way to reach page ${pageNumber}. Pagination container HTML:\n${paginationHTML}`);

  // Last resort: try a `?page=` query param in case pagination is URL-driven.
  // This is known unreliable for client-routed SPAs — it's only here in case
  // some deployments do read it.
  const url = new URL(baseUrl);
  url.searchParams.set('page', String(pageNumber));
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  return 'query-param-fallback';
}

/**
 * Scrapes every customization title for a given make/model/year slug combo,
 * walking all pagination pages and de-duplicating titles that repeat across
 * pages.
 */
async function scrapeCustomizations({ make, model, year, generation }) {
  const url = `${selectors.baseUrl}/${make}/${model}/${year}${generation ? `/${generation}` : ''}`;
  const browser = await chromium.launch(launchOptions());

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await dismissCookieBanner(page);

    const totalPages = await readTotalPages(page);
    const seen = new Set();
    const MAX_PAGE_ATTEMPTS = 3;

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      let strategy = 'initial-load';
      let titles = [];

      for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt += 1) {
        if (pageNumber > 1) {
          strategy = await goToPage(page, pageNumber, url);
          await sleep(POLITE_DELAY_MS);
        }

        titles = await readTitlesOnCurrentPage(page, pageNumber);
        const isAllDuplicates = pageNumber > 1 && titles.length > 0 && titles.every((t) => seen.has(t));

        if (!isAllDuplicates) break;

        if (attempt === MAX_PAGE_ATTEMPTS) {
          console.warn(
            `  page ${pageNumber}/${totalPages} for ${make}/${model}/${year} returned only titles ` +
              `already seen after ${attempt} attempt(s) — pagination did not advance (strategy: ${strategy}).`
          );
        } else {
          console.warn(
            `  page ${pageNumber}/${totalPages}: only already-seen titles on attempt ${attempt}/${MAX_PAGE_ATTEMPTS}, retrying...`
          );
        }
      }

      console.log(`  page ${pageNumber}/${totalPages} (via ${strategy}): ${titles.length} titles`);
      titles.forEach((title) => seen.add(title));
    }

    return { url, totalPages, titles: Array.from(seen) };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeCustomizations };
