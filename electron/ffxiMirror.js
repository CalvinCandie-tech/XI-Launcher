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

// Explorer writes these into folders it has shown; they aren't game data, and an existing
// one is usually hidden+system, which Windows refuses to overwrite (EPERM).
function isShellMetadata(entryName) {
  const base = String(entryName).split(/[\\/]/).filter(Boolean).pop() || '';
  return /^(desktop\.ini|thumbs\.db)$/i.test(base);
}

const FFXI_FOLDER = /^final fantasy xi$/i;
const POL_FOLDER = /^playonlineviewer$/i;
// Folders that live at the root of an FFXI install. A zip whose only top-level folder is one
// of these is a partial patch, not a wrapper, so it must not be stripped.
const FFXI_ROOT_FOLDER = /^(rom\d*|sound\d*|data|mov)$/i;

// Mirrors package the client differently: Vana Portal wraps the FFXI folder's contents in
// one folder named after the archive (ffxiFullClient-2026-08/ROM7/...); LevelDown ships
// "FINAL FANTASY XI/" and "PlayOnlineViewer/" side by side. Returns map(entryName) →
// { root: 'ffxi' | 'pol', rel } giving where each entry belongs, or null to skip it.
function planClientLayout(entryNames) {
  const split = (name) => String(name).split(/[\\/]/).filter(Boolean);
  // Files only — folder entries ("wrapper/") would otherwise look like files at that level.
  const files = entryNames.filter(n => !/[\\/]$/.test(n)).map(split).filter(parts => parts.length);

  let prefix = 0;
  let mode = 'flat';
  for (;;) {
    const tops = new Set(files.filter(parts => parts.length > prefix + 1).map(parts => parts[prefix]));
    if ([...tops].some(t => FFXI_FOLDER.test(t))) { mode = 'split'; break; }
    // Peel a lone wrapper folder — only when every file sits inside it.
    const [only] = tops;
    const allInside = files.length && files.every(parts => parts.length > prefix + 1);
    if (tops.size === 1 && allInside && !FFXI_ROOT_FOLDER.test(only)) { prefix++; continue; }
    break;
  }

  return (entryName) => {
    if (isShellMetadata(entryName)) return null;
    const parts = split(entryName);
    if (parts.length <= prefix) return null;
    const rest = parts.slice(prefix);
    if (mode === 'flat') return { root: 'ffxi', rel: rest.join('/') };
    if (rest.length < 2) return null;
    if (FFXI_FOLDER.test(rest[0])) return { root: 'ffxi', rel: rest.slice(1).join('/') };
    if (POL_FOLDER.test(rest[0])) return { root: 'pol', rel: rest.slice(1).join('/') };
    return null;
  };
}

// Bytes an extraction adds to the target drive: each file's size, less what the file it
// replaces already takes up. placements: [{ size, existingSize }].
function extractSpaceNeeded(placements) {
  return placements.reduce((total, p) => total + Math.max(0, p.size - (p.existingSize || 0)), 0);
}

function formatSize(bytes) {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

module.exports = {
  MIRROR_ORIGIN,
  MIRROR_LISTING_URL,
  pickFullClientUrl,
  planClientLayout,
  isShellMetadata,
  extractSpaceNeeded,
  formatSize,
};
