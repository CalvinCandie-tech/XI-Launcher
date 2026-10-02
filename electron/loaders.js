// Loader registry: the FFXI loaders the launcher knows about, and the pure logic for
// picking one per launch. Kept free of Electron and fs so it can be unit tested with
// `npm run test:electron`.
const path = require('path');

// ldloader is LevelDown's fork of xiloader 2.2.0 with the profile-server and IRC relay
// ports remapped (51221 / 51241) — jeffnavy14/xiloader commit 060a809b.
const LOADERS = {
  xiloader: { name: 'xiloader (LandSandBoat)', repo: 'LandSandBoat/xiloader', asset: 'xiloader.exe', exe: 'xiloader.exe' },
  ldloader: { name: 'ldloader (LevelDown)', repo: 'jeffnavy14/xiloader', asset: 'ldloader.exe', exe: 'ldloader.exe' },
};

const DEFAULT_LOADER = 'xiloader';

// Own keys only — a stored loader of 'constructor' must not resolve to Object.prototype.
function isLoaderId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(LOADERS, id);
}

function loaderExeNames() {
  return Object.values(LOADERS).map(l => l.exe);
}

// Stock xiloader keeps the install the user already has; every other loader gets
// its own folder so installing one never overwrites another.
function loaderExePath(id, { xiloaderDir, loadersDir }) {
  const dir = id === 'xiloader' ? xiloaderDir : path.win32.join(loadersDir, id);
  return path.win32.join(dir, LOADERS[id].exe);
}

// Walk an ini, calling onLine(raw, trimmed, section, isHeader) for every line.
function forEachIniLine(text, onLine) {
  let section = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const trimmed = raw.trim();
    const sec = trimmed.match(/^\[(.+)\]$/);
    if (sec) section = sec[1].trim().toLowerCase();
    onLine(raw, trimmed, section, !!sec);
  }
}

// Read [ashita.boot] file/command. The --server value is the host the game will really
// connect to in Ashita mode (config.serverHost is not kept in sync with the ini).
function parseIniBoot(text) {
  let file = null;
  let command = null;
  forEachIniLine(text, (raw, trimmed, section, isHeader) => {
    if (isHeader || section !== 'ashita.boot') return;
    const kv = trimmed.match(/^(\w+)\s*=\s*(.*)$/);
    if (!kv) return;
    const key = kv[1].toLowerCase();
    if (key === 'file') file = kv[2].trim();
    if (key === 'command') command = kv[2].trim();
  });
  const serverMatch = (command || '').match(/(?:^|\s)--server\s+(\S+)/);
  const host = serverMatch ? serverMatch[1].replace(/^"|"$/g, '') : null;
  // Same rule ProfileTab's Apply uses: retail boots PlayOnline via /game, or has no loader and no server.
  const isRetail = (command || '').startsWith('/game') || (!file && !host);
  return { file, command, host, isRetail };
}

// Point [ashita.boot] file= at exePath, preserving the file's line endings. Inserts the
// line after the section header if it's missing.
function setIniBootFile(text, exePath) {
  const eol = String(text).includes('\r\n') ? '\r\n' : '\n';
  const newLine = `file         = ${exePath}`;
  const out = [];
  let replaced = false;
  let headerIndex = -1;
  forEachIniLine(text, (raw, trimmed, section, isHeader) => {
    if (isHeader && section === 'ashita.boot') headerIndex = out.length;
    if (!isHeader && section === 'ashita.boot' && /^file\s*=/i.test(trimmed)) {
      out.push(newLine);
      replaced = true;
      return;
    }
    out.push(raw);
  });
  if (!replaced && headerIndex >= 0) out.splice(headerIndex + 1, 0, newLine);
  return out.join(eol);
}

function serverLoaderFor(host, serverTable) {
  if (!host) return null;
  const wanted = String(host).trim().toLowerCase();
  for (const [serverName, entry] of Object.entries(serverTable || {})) {
    if (entry?.host && isLoaderId(entry.loader) && entry.host.toLowerCase() === wanted) {
      return { loaderId: entry.loader, serverName };
    }
  }
  return null;
}

// Profile setting > server binding > stock xiloader.
function resolveLoader({ profileSettings, host, serverTable, xiloaderDir, loadersDir }) {
  const choice = profileSettings?.loader;
  const fromRegistry = (id, source, serverName) => ({
    id,
    name: LOADERS[id].name,
    exePath: loaderExePath(id, { xiloaderDir, loadersDir }),
    source,
    serverName,
  });
  if (choice === 'custom' && profileSettings.loaderExePath) {
    const exePath = profileSettings.loaderExePath;
    return { id: 'custom', name: path.win32.basename(exePath), exePath, source: 'profile', serverName: null };
  }
  if (isLoaderId(choice)) return fromRegistry(choice, 'profile', null);
  const bound = serverLoaderFor(host, serverTable);
  if (bound) return fromRegistry(bound.loaderId, 'server', bound.serverName);
  return fromRegistry(DEFAULT_LOADER, 'default', null);
}

function describeLoader(resolved) {
  const why = resolved.source === 'server' ? `from server ${resolved.serverName}`
    : resolved.source === 'profile' ? 'set on profile'
    : 'default';
  return `Using ${resolved.name} — ${why}`;
}

function missingLoaderMessage(resolved) {
  if (resolved.id === 'custom') return `Custom loader not found at ${resolved.exePath}. Pick it again in Profiles → Loader.`;
  return `${LOADERS[resolved.id].exe} is not installed. Install it from Profiles → Loader.`;
}

// Decide what (if anything) to write to a profile ini so it boots exePath.
function planProfileLoaderSync(content, exePath) {
  const boot = parseIniBoot(content);
  if (boot.isRetail) return { retail: true };
  if (boot.file && boot.file.toLowerCase() === exePath.toLowerCase()) return { newContent: null };
  return { newContent: setIniBootFile(content, exePath) };
}

module.exports = {
  LOADERS,
  DEFAULT_LOADER,
  isLoaderId,
  loaderExeNames,
  loaderExePath,
  parseIniBoot,
  setIniBootFile,
  serverLoaderFor,
  resolveLoader,
  describeLoader,
  missingLoaderMessage,
  planProfileLoaderSync,
};
