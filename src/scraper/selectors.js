/**
 * Central, easily-tunable place for every selector this project depends on.
 *
 * IMPORTANT: these were derived from the project workflow doc, not verified
 * against the live obdeleven.com DOM (this environment has no network access
 * to the site). Run `npm run discover` from a machine that *can* reach the
 * site, watch it with HEADLESS=false, and adjust the values below if it logs
 * warnings or comes back empty.
 */
module.exports = {
  baseUrl: 'https://obdeleven.com/customizations',

  // The three <select> controls on the /customizations landing page.
  // labelKeywords are used to identify which physical <select> is which by
  // reading its associated label/aria-label text (case-insensitive substring
  // match). If no select matches, discovery falls back to DOM order
  // (1st = make, 2nd = model, 3rd = year).
  select: {
    make: { labelKeywords: ['make', 'marka', 'brand'] },
    model: { labelKeywords: ['model'] },
    year: { labelKeywords: ['year', 'yıl', 'yil'] },
  },

  pagination: {
    // Pager buttons; the largest numeric button text is treated as the
    // total page count. Chakra UI auto-generates class names like
    // "css-1cuhfda" that change between builds, so prefer matching by role/
    // structure over exact class names when you inspect the live page.
    buttonSelector: '.chakra-button',
  },

  results: {
    // Primary selector for a single customization title.
    titleSelector: '.chakra-text.css-1cuhfda',
    // Fallback used when titleSelector finds nothing: any <p> tag inside
    // this container.
    containerSelector: 'main',
    fallbackTitleSelector: 'main p',
  },
};
