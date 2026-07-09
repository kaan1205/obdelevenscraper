/**
 * One-time (re-runnable) discovery script.
 *
 * Crawls obdeleven.com/customizations, selecting every Make and then every
 * Model to read whatever Year options React/Chakra renders for that
 * combination, and writes the whole tree to data/vehicles.json so the app's
 * cascading form never has to hit the live site just to populate dropdowns.
 *
 * Usage:
 *   node scripts/discover-vehicles.js                # full crawl
 *   HEADLESS=false node scripts/discover-vehicles.js  # watch it run
 *   ONLY=volkswagen,audi node scripts/discover-vehicles.js  # re-crawl just these makes
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const selectors = require('../src/scraper/selectors');
const { slugify } = require('../src/lib/slugify');
const { launchOptions } = require('../src/lib/launchOptions');

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'vehicles.json');
// Extra pause after a select's options have settled, purely for politeness.
const DELAY_MS = Number(process.env.DISCOVER_DELAY_MS) || 400;
// How long to wait for a dependent select (model/year) to repopulate after
// its parent changes. These sites fetch the new option list from an API, so
// a fixed sleep isn't reliable — poll until the option values actually change.
const OPTIONS_WAIT_TIMEOUT_MS = Number(process.env.OPTIONS_WAIT_TIMEOUT_MS) || 20000;
const ONLY = (process.env.ONLY || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Selects an option and verifies the DOM value actually stuck. Some React
 * apps only pick up a select's new value through the native browser value
 * setter (bypassing React's own descriptor override), which Playwright's
 * selectOption() should already trigger — but as a belt-and-braces fallback,
 * re-dispatch input/change through that native setter if the first attempt
 * didn't take.
 */
async function robustSelectOption(selectLocator, value) {
  await selectLocator.selectOption(value);
  const applied = await selectLocator.evaluate((el) => el.value);
  if (applied === value) return true;

  await selectLocator.evaluate((el, val) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    nativeSetter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);

  const appliedAfterFallback = await selectLocator.evaluate((el) => el.value);
  return appliedAfterFallback === value;
}

async function snapshotOptions(selectLocator) {
  return selectLocator.evaluate((el) => ({
    disabled: el.disabled,
    values: Array.from(el.options)
      .map((o) => o.value)
      .filter(Boolean)
      .join('|'),
  }));
}

/**
 * Waits until `selectLocator`'s options are non-empty, enabled, and (if a
 * previous snapshot is given) different from that snapshot — i.e. the
 * dependent select has actually repopulated for the newly chosen parent
 * value, rather than still showing stale/empty options.
 * Returns the new snapshot string so the caller can pass it in next time.
 */
async function waitForOptionsToSettle(page, selectLocator, previousSnapshot, label) {
  const start = Date.now();
  let last = null;
  let lastDisabled = null;

  while (Date.now() - start < OPTIONS_WAIT_TIMEOUT_MS) {
    // eslint-disable-next-line no-await-in-loop
    const { disabled, values } = await snapshotOptions(selectLocator);
    last = values;
    lastDisabled = disabled;
    const isReady = !disabled && values.length > 0 && values !== previousSnapshot;
    if (isReady) return values;
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }

  const outerHTML = await selectLocator.evaluate((el) => el.outerHTML).catch(() => '(could not read)');
  const allSelects = await page
    .locator('select')
    .evaluateAll((els) => els.map((el) => ({ id: el.id, name: el.name, value: el.value, optionCount: el.options.length })))
    .catch(() => '(could not read)');
  throw new Error(
    `Timed out waiting for ${label} options to update ` +
      `(still "${last}", disabled=${lastDisabled}, url=${page.url()}, after ${OPTIONS_WAIT_TIMEOUT_MS}ms).\n` +
      `Increase OPTIONS_WAIT_TIMEOUT_MS or re-check the selector.\n` +
      `${label} select outerHTML: ${outerHTML}\n` +
      `All <select> elements on page now: ${JSON.stringify(allSelects)}`
  );
}

function loadExisting() {
  if (ONLY.length && fs.existsSync(OUTPUT_PATH)) {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  }
  return { makes: [], models: {}, years: {} };
}

function save(vehicles) {
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(vehicles, null, 2));
}

async function readOptions(selectLocator) {
  return selectLocator.evaluate((el) =>
    Array.from(el.options)
      .filter((o) => o.value)
      .map((o) => ({ value: o.value, label: o.textContent.trim() }))
  );
}

/** Figures out which native <select> on the page is Make / Model / Year. */
async function classifySelects(page) {
  const count = await page.locator('select').count();
  if (count === 0) {
    throw new Error(
      'No <select> elements found on the page. The Make/Model/Year controls ' +
        'may be custom (non-native) dropdowns — inspect the live DOM and ' +
        'update src/scraper/selectors.js + this script accordingly.'
    );
  }

  const infos = [];
  for (let index = 0; index < count; index += 1) {
    const handle = await page.locator('select').nth(index).elementHandle();
    // eslint-disable-next-line no-await-in-loop
    const label = await handle.evaluate((el) => {
      const byFor = el.id && document.querySelector(`label[for="${el.id}"]`);
      if (byFor) return byFor.textContent.trim();

      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;

      const ariaLabelledby = el.getAttribute('aria-labelledby');
      if (ariaLabelledby) {
        const referenced = document.getElementById(ariaLabelledby);
        if (referenced) return referenced.textContent.trim();
      }

      const wrappingLabel = el.closest('label');
      if (wrappingLabel) return wrappingLabel.textContent.trim();

      const group = el.closest('div, fieldset');
      return group ? group.textContent.trim().slice(0, 60) : '';
    });
    infos.push({ index, label: (label || '').toLowerCase() });
  }

  const findByKeywords = (keywords) =>
    infos.find((info) => keywords.some((kw) => info.label.includes(kw)));

  const makeInfo = findByKeywords(selectors.select.make.labelKeywords) || infos[0];
  const modelInfo = findByKeywords(selectors.select.model.labelKeywords) || infos[1];
  const yearInfo = findByKeywords(selectors.select.year.labelKeywords) || infos[2];

  if (!makeInfo || !modelInfo || !yearInfo) {
    throw new Error(
      `Expected 3 <select> elements (make/model/year) but found ${count}. ` +
        'Inspect the live page and update scripts/discover-vehicles.js.'
    );
  }

  console.log('Classified selects ->', {
    make: makeInfo.label || `[select #${makeInfo.index}]`,
    model: modelInfo.label || `[select #${modelInfo.index}]`,
    year: yearInfo.label || `[select #${yearInfo.index}]`,
  });

  const makeSelect = page.locator('select').nth(makeInfo.index);
  const modelSelect = page.locator('select').nth(modelInfo.index);
  const yearSelect = page.locator('select').nth(yearInfo.index);

  for (const [name, loc] of [
    ['make', makeSelect],
    ['model', modelSelect],
    ['year', yearSelect],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const attrs = await loc.evaluate((el) => ({ id: el.id, name: el.name, className: el.className }));
    console.log(`  ${name} select attrs ->`, attrs);
  }

  return { makeSelect, modelSelect, yearSelect };
}

async function main() {
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage();

  try {
    console.log(`Navigating to ${selectors.baseUrl}`);
    await page.goto(selectors.baseUrl, { waitUntil: 'networkidle' });

    const { makeSelect, modelSelect, yearSelect } = await classifySelects(page);

    const makes = await readOptions(makeSelect);
    console.log(`Found ${makes.length} makes`);

    const vehicles = loadExisting();
    vehicles.makes = makes;
    vehicles.models = vehicles.models || {};
    vehicles.years = vehicles.years || {};

    let modelSnapshot = await snapshotOptions(modelSelect).then((s) => s.values);

    for (const make of makes) {
      const makeSlug = slugify(make.label);
      if (ONLY.length && !ONLY.includes(makeSlug)) continue;

      console.log(`\n== Make: ${make.label} (${makeSlug}) ==`);
      const makeApplied = await robustSelectOption(makeSelect, make.value);
      if (!makeApplied) console.warn(`  WARNING: make select value did not stick for ${make.label}`);
      modelSnapshot = await waitForOptionsToSettle(page, modelSelect, modelSnapshot, 'model');
      console.log(`  url after make select: ${page.url()}`);
      await sleep(DELAY_MS);

      const models = await readOptions(modelSelect);
      vehicles.models[makeSlug] = models;
      vehicles.years[makeSlug] = vehicles.years[makeSlug] || {};
      console.log(`  ${models.length} models`);

      let yearSnapshot = await snapshotOptions(yearSelect).then((s) => s.values);

      for (const model of models) {
        const modelSlug = slugify(model.label);
        const modelApplied = await robustSelectOption(modelSelect, model.value);
        console.log(
          `  url after model select (${model.label}): ${page.url()} | value applied: ${modelApplied}`
        );
        if (!modelApplied) console.warn(`  WARNING: model select value did not stick for ${model.label}`);
        yearSnapshot = await waitForOptionsToSettle(page, yearSelect, yearSnapshot, 'year');
        await sleep(DELAY_MS);

        const years = await readOptions(yearSelect);
        vehicles.years[makeSlug][modelSlug] = years;
        console.log(`  -- ${model.label} (${modelSlug}): ${years.length} year ranges`);
      }

      // Persist after every make so a crash mid-crawl doesn't lose progress.
      save(vehicles);
    }

    save(vehicles);
    console.log(`\nSaved ${OUTPUT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
