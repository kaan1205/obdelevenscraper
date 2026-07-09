const express = require('express');
const { slugify } = require('../lib/slugify');
const { readCache, writeCache } = require('../lib/cache');
const { translateAll } = require('../lib/translate');
const { scrapeCustomizations } = require('../scraper/scrapeCustomizations');

const router = express.Router();

router.get('/', async (req, res) => {
  const { make, model, year } = req.query;

  if (!make || !model || !year) {
    return res.status(400).json({ error: 'make, model and year query params are required' });
  }

  // Normalize in case the frontend sent a raw label instead of a slug.
  const makeSlug = slugify(make);
  const modelSlug = slugify(model);
  const yearSlug = slugify(year);

  const cached = readCache(makeSlug, modelSlug, yearSlug);
  if (cached) {
    return res.json({
      make: makeSlug,
      model: modelSlug,
      year: yearSlug,
      cached: true,
      cachedAt: cached.cachedAt,
      items: translateAll(cached.items),
    });
  }

  try {
    const { totalPages, titles } = await scrapeCustomizations({
      make: makeSlug,
      model: modelSlug,
      year: yearSlug,
    });

    writeCache(makeSlug, modelSlug, yearSlug, titles);

    res.json({
      make: makeSlug,
      model: modelSlug,
      year: yearSlug,
      cached: false,
      totalPages,
      items: translateAll(titles),
    });
  } catch (err) {
    console.error(`Scrape failed for ${makeSlug}/${modelSlug}/${yearSlug}:`, err);
    res.status(502).json({ error: 'Failed to scrape customizations', detail: err.message });
  }
});

module.exports = router;
