const fs = require('fs');
const path = require('path');

const DICT_PATH = path.join(__dirname, '..', '..', 'data', 'translations.json');
// Delay between live Google Translate calls (only paid for cache misses), to
// avoid hammering the free/unofficial endpoint.
const TRANSLATE_DELAY_MS = Number(process.env.TRANSLATE_DELAY_MS) || 300;

function loadDictionary() {
  if (!fs.existsSync(DICT_PATH)) return {};
  return JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
}

function saveDictionary(dictionary) {
  fs.writeFileSync(DICT_PATH, JSON.stringify(dictionary, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Google's free, unofficial translate endpoint — no API key needed. It's
// undocumented and unsupported by Google, so it can be rate-limited or
// change without notice; swap this function for a DeepL/Google Cloud
// Translation call if that happens (same input/output shape).
async function translateViaGoogle(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(
    text
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Translate request failed: ${res.status}`);

  const data = await res.json();
  return data[0].map((chunk) => chunk[0]).join('');
}

function translate(originalTitle) {
  const dictionary = loadDictionary();
  return dictionary[originalTitle] || originalTitle;
}

/**
 * Translates a batch of English titles to Turkish, using translations.json
 * as a persistent cache so the same title (these repeat heavily across
 * makes/models) is only ever sent to the translate API once.
 */
async function translateAll(originalTitles) {
  const dictionary = loadDictionary();
  let dictionaryChanged = false;
  const results = [];

  for (const original of originalTitles) {
    if (dictionary[original]) {
      results.push({ original, translated: dictionary[original] });
      // eslint-disable-next-line no-continue
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const translated = await translateViaGoogle(original);
      dictionary[original] = translated;
      dictionaryChanged = true;
      results.push({ original, translated });
    } catch (err) {
      console.error(`Translation failed for "${original}":`, err.message);
      results.push({ original, translated: original });
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(TRANSLATE_DELAY_MS);
  }

  if (dictionaryChanged) saveDictionary(dictionary);

  return results;
}

module.exports = { translate, translateAll };
