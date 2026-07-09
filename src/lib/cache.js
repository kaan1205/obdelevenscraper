const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'cache', 'customizations');
const TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24 * 7) * 60 * 60 * 1000;

fs.mkdirSync(CACHE_DIR, { recursive: true });

function cacheKey(make, model, year) {
  return `${make}--${model}--${year}`;
}

function cacheFile(make, model, year) {
  return path.join(CACHE_DIR, `${cacheKey(make, model, year)}.json`);
}

function readCache(make, model, year) {
  const file = cacheFile(make, model, year);
  if (!fs.existsSync(file)) return null;

  const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Date.now() - entry.cachedAt > TTL_MS) return null;
  return entry;
}

function writeCache(make, model, year, items) {
  const entry = { make, model, year, cachedAt: Date.now(), items };
  fs.writeFileSync(cacheFile(make, model, year), JSON.stringify(entry, null, 2));
  return entry;
}

module.exports = { readCache, writeCache };
