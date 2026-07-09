const fs = require('fs');
const path = require('path');

const DICT_PATH = path.join(__dirname, '..', '..', 'data', 'translations.json');

function loadDictionary() {
  if (!fs.existsSync(DICT_PATH)) return {};
  return JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
}

// TODO: once a DeepL/Google Translate API key is available, look it up here
// (e.g. process.env.DEEPL_API_KEY), call the API for cache misses, and persist
// the result back into translations.json. Until then, untranslated titles are
// shown in English as-is.
function translate(originalTitle) {
  const dictionary = loadDictionary();
  return dictionary[originalTitle] || originalTitle;
}

function translateAll(originalTitles) {
  const dictionary = loadDictionary();
  return originalTitles.map((original) => ({
    original,
    translated: dictionary[original] || original,
  }));
}

module.exports = { translate, translateAll };
