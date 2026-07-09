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
const DELAY_MS = Number(process.env.DISCOVER_DELAY_MS) || 1200;
const ONLY = (process.env.ONLY || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  return {
    makeSelect: page.locator('select').nth(makeInfo.index),
    modelSelect: page.locator('select').nth(modelInfo.index),
    yearSelect: page.locator('select').nth(yearInfo.index),
  };
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

    for (const make of makes) {
      const makeSlug = slugify(make.label);
      if (ONLY.length && !ONLY.includes(makeSlug)) continue;

      console.log(`\n== Make: ${make.label} (${makeSlug}) ==`);
      await makeSelect.selectOption(make.value);
      await sleep(DELAY_MS);

      const models = await readOptions(modelSelect);
      vehicles.models[makeSlug] = models;
      vehicles.years[makeSlug] = vehicles.years[makeSlug] || {};
      console.log(`  ${models.length} models`);

      for (const model of models) {
        const modelSlug = slugify(model.label);
        await modelSelect.selectOption(model.value);
        await sleep(DELAY_MS);

        const years = await readOptions(yearSelect);
        vehicles.years[makeSlug][modelSlug] = years;
        console.log(`  -- ${model.label} (${modelSlug}): ${years.length} year ranges`);

        await sleep(DELAY_MS);
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
