const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');

const VEHICLES_PATH = path.join(__dirname, '..', '..', 'data', 'vehicles.json');

function loadVehicles() {
  return JSON.parse(fs.readFileSync(VEHICLES_PATH, 'utf8'));
}

/**
 * Resolves raw <option value> selections (as sent by the frontend, which are
 * exactly the values discovered into vehicles.json) into the URL path
 * segments obdeleven.com actually expects.
 *
 * Make/model/generation option values are already valid slugs, used as-is.
 * Year's option value is an opaque site-generated code (e.g. "qQA5NY8gCd"),
 * so its *label* has to be slugified instead — and because two years can
 * share the same label (confirmed on BMW: two distinct "2008 - 2014"
 * entries with different values), matching is done by value, never by label.
 */
function resolveVehicle({ make, model, year, generation }) {
  const vehicles = loadVehicles();

  const makeEntry = (vehicles.makes || []).find((m) => m.value === make);
  if (!makeEntry) return { error: `Unknown make "${make}"` };

  const models = (vehicles.models && vehicles.models[make]) || [];
  const modelEntry = models.find((m) => m.value === model);
  if (!modelEntry) return { error: `Unknown model "${model}" for make "${make}"` };

  const years = (vehicles.years && vehicles.years[make] && vehicles.years[make][model]) || [];
  const yearEntry = years.find((y) => y.value === year);
  if (!yearEntry) return { error: `Unknown year "${year}" for ${make}/${model}` };

  const result = {
    makeSlug: make,
    modelSlug: model,
    yearSlug: slugify(yearEntry.label),
    generationSlug: null,
  };

  const generationsForYear =
    vehicles.generations &&
    vehicles.generations[make] &&
    vehicles.generations[make][model] &&
    vehicles.generations[make][model][year];

  if (generationsForYear && generationsForYear.length > 0) {
    if (!generation) return { error: `A generation is required for ${make}/${model}/${year}` };
    const generationEntry = generationsForYear.find((g) => g.value === generation);
    if (!generationEntry) return { error: `Unknown generation "${generation}" for ${make}/${model}/${year}` };
    result.generationSlug = generationEntry.value;
  }

  return result;
}

module.exports = { resolveVehicle };
