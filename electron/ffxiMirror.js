// Default source for the FFXI Files Updater. Vana-Time moved to Vana Portal in 2026 and its
// old /api/v1/downloads/*.zip links now return 404; the full-client file name also changes
// every month, so the current one is looked up from the mirror's listing at download time.
const MIRROR_ORIGIN = 'https://vana-portal.com';
const MIRROR_LISTING_URL = `${MIRROR_ORIGIN}/api/v1/downloads`;

// Download URL of the newest available full-client archive in a /api/v1/downloads listing,
// or null if there isn't one. Only ever returns a URL on the mirror's own host.
function pickFullClientUrl(listing) {
  const files = listing?.data?.files;
  if (!Array.isArray(files)) return null;
  const candidates = files
    .filter(f => f && f.kind === 'full' && f.available !== false && typeof f.downloadPath === 'string')
    .sort((a, b) => String(b.filename || '').localeCompare(String(a.filename || '')));
  for (const f of candidates) {
    try {
      const url = new URL(f.downloadPath, MIRROR_ORIGIN);
      if (url.origin === MIRROR_ORIGIN) return url.href;
    } catch {}
  }
  return null;
}

module.exports = { MIRROR_ORIGIN, MIRROR_LISTING_URL, pickFullClientUrl };
