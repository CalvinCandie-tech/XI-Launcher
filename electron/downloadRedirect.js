// Resolve and vet the Location header of a download redirect. Pure, unit tested with
// `npm run test:electron`. downloadFile() (main.js) hands this the redirect target and the URL it
// came from, and rejects the download on an error instead of letting https.get throw in a callback.

// Returns { url } for an https target (absolute, or relative to currentUrl), or { error } for
// anything else. The error text names the protocol only, never the URL (it can carry tokens).
function resolveRedirect(location, currentUrl) {
  if (typeof location !== 'string' || !location.trim()) return { error: 'Download redirected to an invalid address.' };
  let next;
  try {
    next = new URL(String(location), currentUrl);
  } catch {
    return { error: 'Download redirected to an invalid address.' };
  }
  if (next.protocol !== 'https:') {
    return { error: `Download redirected to a non-https address (${next.protocol}) and was refused.` };
  }
  return { url: next.href };
}

module.exports = { resolveRedirect };
