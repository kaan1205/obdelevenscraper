const express = require('express');
const { resolveVehicle } = require('../lib/resolveVehicle');
const { readCache, writeCache } = require('../lib/cache');
const { translateAll } = require('../lib/translate');
const { scrapeCustomizations } = require('../scraper/scrapeCustomizations');

const router = express.Router();

router.get('/', async (req, res) => {
  const { make, model, year, generation } = req.query;

  if (!make || !model || !year) {
    return res.status(400).json({ error: 'make, model and year query params are required' });
  }

  const resolved = resolveVehicle({ make, model, year, generation });
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }
  const { makeSlug, modelSlug, yearSlug, generationSlug } = resolved;

  // ?force=true bypasses the cache — useful while selectors are still being
  // tuned against the live site, so a stale/empty cached result doesn't mask
  // a scraper fix.
  const force = req.query.force === 'true';

  const cached = force ? null : readCache(makeSlug, modelSlug, yearSlug, generationSlug);
  if (cached) {
    return res.json({
      make: makeSlug,
      model: modelSlug,
      year: yearSlug,
      generation: generationSlug,
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
      generation: generationSlug,
    });

    // Don't cache an empty result — with selectors still being verified
    // against the live DOM, 0 titles is far more likely a selector miss
    // than a genuinely empty vehicle, and caching it would hide a fix for
    // a week.
    if (titles.length > 0) {
      writeCache(makeSlug, modelSlug, yearSlug, generationSlug, titles);
    }

    res.json({
      make: makeSlug,
      model: modelSlug,
      year: yearSlug,
      generation: generationSlug,
      cached: false,
      totalPages,
      items: translateAll(titles),
    });
  } catch (err) {
    console.error(`Scrape failed for ${makeSlug}/${modelSlug}/${yearSlug}${generationSlug ? `/${generationSlug}` : ''}:`, err);
    res.status(502).json({ error: 'Failed to scrape customizations', detail: err.message });
  }
});

module.exports = router;
