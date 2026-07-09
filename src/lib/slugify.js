/**
 * Converts a select-option label into the slug OBDeleven uses in its URLs.
 * e.g. "Volkswagen" -> "volkswagen", "2020 - 2024" -> "2020-2024",
 * "SEAT | CUPRA" -> "seat-cupra".
 */
function slugify(label) {
  return String(label)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[|/]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

module.exports = { slugify };
