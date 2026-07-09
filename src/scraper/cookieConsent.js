// obdeleven.com runs OneTrust's cookie consent banner, which leaves an
// invisible overlay (#onetrust-consent-sdk) on top of the page until
// dismissed — Playwright clicks on anything underneath it (e.g. pagination
// buttons) time out because the overlay "intercepts pointer events".
async function dismissCookieBanner(page) {
  const acceptButton = page.locator('#onetrust-accept-btn-handler');
  try {
    await acceptButton.waitFor({ state: 'visible', timeout: 5000 });
    await acceptButton.click();
    await page.locator('#onetrust-consent-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  } catch {
    // Banner never showed up (e.g. consent already stored) — nothing to do.
  }
}

module.exports = { dismissCookieBanner };
