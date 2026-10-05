// Loader registry: the FFXI loaders the launcher knows about, and the pure logic for
// picking one per launch. Kept free of Electron and fs so it can be unit tested with
// `npm run test:electron`.
const path = require('path');

// ldloader is LevelDown's fork of xiloader 2.2.0 with the profile-server and IRC relay
// ports remapped (51221 / 51241) — jeffnavy14/xiloader commit 060a809b. Its release
// asset is named xiloader.exe; it's saved locally as ldloader.exe so the two never collide.
const LOADERS = {
  xiloader: { name: 'xiloader (LandSandBoat)', repo: 'LandSandBoat/xiloader', asset: 'xiloader.exe', exe: 'xiloader.exe' },
  ldloader: { name: 'ldloader (LevelDown)', repo: 'jeffnavy14/xiloader', asset: 'xiloader.exe', exe: 'ldloader.exe' },
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

// Read [ashita.boot] file/command, and the --server host (used to tell private-server
// profiles from retail ones).
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

// The loader the profile's owner picked; stock xiloader until they pick one.
function resolveLoader({ profileSettings, xiloaderDir, loadersDir }) {
  // Sanitise on read too: profileSettings can also arrive via profile import or store-set,
  // and a bad custom path would otherwise be launched elevated or injected into the ini.
  const settings = sanitizeLoaderSettings(profileSettings);
  const choice = settings?.loader;
  if (choice === 'custom') {
    const exePath = settings.loaderExePath;
    return { id: 'custom', name: path.win32.basename(exePath), exePath };
  }
  const id = isLoaderId(choice) ? choice : DEFAULT_LOADER;
  return { id, name: LOADERS[id].name, exePath: loaderExePath(id, { xiloaderDir, loadersDir }) };
}

function describeLoader(resolved) {
  return `Using ${resolved.name}`;
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

// Same shape rules store-set applies to install paths: a drive-letter absolute .exe,
// no quotes or newlines (they'd break the PowerShell launch script), no UNC shares.
function isValidExePath(p) {
  return typeof p === 'string'
    && /^[a-zA-Z]:[\\/]/.test(p)
    && /\.exe$/i.test(p)
    && !/["\r\n]/.test(p);
}

function sanitizeLoaderSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  if (out.loader !== undefined && out.loader !== 'custom' && !isLoaderId(out.loader)) delete out.loader;
  if (out.loaderExePath !== undefined && !isValidExePath(out.loaderExePath)) delete out.loaderExePath;
  if (out.loader === 'custom' && !out.loaderExePath) delete out.loader;
  // Game files (Home → Game files): installed FFXI, or a sandboxed copy in sandboxFolder.
  if (out.gameFiles !== undefined && out.gameFiles !== 'installed' && out.gameFiles !== 'sandbox') delete out.gameFiles;
  if (out.sandboxFolder !== undefined && !isValidFolderPath(out.sandboxFolder)) delete out.sandboxFolder;
  // FFXI Files Updater link for this profile's game files ('' = the default mirror).
  if (out.ffxiUpdaterUrl !== undefined && !isValidUpdaterUrl(out.ffxiUpdaterUrl)) delete out.ffxiUpdaterUrl;
  return out;
}

function isValidUpdaterUrl(u) {
  return typeof u === 'string' && (u === '' || (/^https:\/\//.test(u) && !/\s/.test(u) && u.length <= 2048));
}

function isValidFolderPath(p) {
  return typeof p === 'string' && /^[a-zA-Z]:[\\/]/.test(p) && !/["\r\n]/.test(p);
}

// Several screens save a partial snapshot (server, login, XIPivot) for the active profile.
// Keep the stored loader choice unless the save sets one itself, and the game-files choice
// and updater link unless the save sets them.
function mergeProfileSettings(existing, incoming) {
  if (!existing || typeof existing !== 'object' || !incoming || typeof incoming !== 'object') return incoming;
  const kept = {};
  const keys = ['gameFiles', 'sandboxFolder', 'ffxiUpdaterUrl'];
  if (incoming.loader === undefined) keys.push('loader', 'loaderExePath', 'xiloaderPath');
  for (const key of keys) {
    if (existing[key] !== undefined && incoming[key] === undefined) kept[key] = existing[key];
  }
  return { ...incoming, ...kept };
}

// Before the registry, an Ashita launch booted whatever the profile ini's file= named, and
// people hand-edited it (e.g. to point at ldloader). Keep that exe as a custom loader rather
// than letting the first launch rewrite it to stock xiloader. Relative paths are relative to
// the Ashita folder; a missing exe or the stock path means stock xiloader.
function seedLoaderFromBoot(boot, { ashitaPath, stockExePath, exists }) {
  const file = String(boot?.file || '').trim().replace(/\//g, '\\');
  if (!file || boot?.isRetail) return { loader: DEFAULT_LOADER };
  const abs = path.win32.isAbsolute(file) ? path.win32.normalize(file) : path.win32.resolve(ashitaPath || '', file);
  if (stockExePath && abs.toLowerCase() === path.win32.normalize(stockExePath).toLowerCase()) return { loader: DEFAULT_LOADER };
  if (!isValidExePath(abs) || !exists(abs)) return { loader: DEFAULT_LOADER };
  return { loader: 'custom', loaderExePath: abs };
}

// Give every profile a loader setting on upgrade. Order of evidence: an explicit pick stays;
// a pre-registry per-profile xiloaderPath folder becomes custom <folder>\xiloader.exe (the old
// key stays so a rollback to v1.6.x still works); otherwise whatever the profile ini boots.
// `boots` maps profile name -> parseIniBoot() result; profiles that only exist as an ini get
// an entry too. A stored 'auto' (retired "follow the server" mode) is re-seeded from the ini.
function migrateProfileSettings(all, { boots = {}, ashitaPath = '', stockExePath = '', exists = () => false } = {}) {
  const result = {};
  let changed = false;
  const names = new Set([...Object.keys(all || {}), ...Object.keys(boots)]);
  for (const name of names) {
    const ps = (all || {})[name];
    if (ps !== undefined && (!ps || typeof ps !== 'object')) {
      result[name] = ps;
      continue;
    }
    const current = ps || {};
    if (current.loader !== undefined && current.loader !== 'auto') {
      result[name] = ps;
      continue;
    }
    const legacyDir = typeof current.xiloaderPath === 'string' ? current.xiloaderPath.trim() : '';
    const legacyExe = legacyDir ? path.win32.join(legacyDir.replace(/\//g, '\\'), 'xiloader.exe') : '';
    const { loader: _retired, ...rest } = current;
    result[name] = isValidExePath(legacyExe)
      ? { ...rest, loader: 'custom', loaderExePath: legacyExe }
      : { ...rest, ...seedLoaderFromBoot(boots[name], { ashitaPath, stockExePath, exists }) };
    changed = true;
  }
  return { changed, result };
}

// Point the [ashita.boot] command's --server at host (adding it if missing). Retail profiles
// are returned unchanged.
function setIniServer(text, host) {
  if (parseIniBoot(text).isRetail) return text;
  let section = '';
  return String(text).replace(/^([^\r\n]*)$/gm, (line) => {
    const trimmed = line.trim();
    const sec = trimmed.match(/^\[(.+)\]$/);
    if (sec) { section = sec[1].trim().toLowerCase(); return line; }
    if (section !== 'ashita.boot') return line;
    const m = line.match(/^(\s*command\s*=\s*)(.*)$/i);
    if (!m) return line;
    const args = m[2];
    const replaced = /(^|\s)--server\s+\S+/.test(args)
      ? args.replace(/(^|\s)--server\s+\S+/, `$1--server ${host}`)
      : `--server ${host}${args.trim() ? ' ' + args.trim() : ''}`;
    return m[1] + replaced;
  });
}

function pickReleaseAsset(release, assetName) {
  const wanted = assetName.toLowerCase();
  const asset = (release?.assets || []).find(a => String(a.name).toLowerCase() === wanted);
  if (!asset) return null;
  return { tag: release.tag_name, downloadUrl: asset.browser_download_url, assetId: asset.id, assetUpdatedAt: asset.updated_at };
}

// True if dotted version string `a` is numerically older than `b` (e.g. "2.1.2.0" < "2.1.2" is false — equal).
function isOlderVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na !== nb) return na < nb;
  }
  return false;
}

// ldloader reports the same FileVersion as stock xiloader, so versions can't tell builds
// apart — compare the GitHub asset id we recorded at install time. Installs from before
// the registry have no record; stock xiloader falls back to its FileVersion. A record
// only counts for the exe it was made for — the user can point xiloader at another folder.
function needsLoaderUpdate({ installed, record, latest, localVersion, exePath }) {
  if (!installed) return true;
  const recordApplies = record && record.assetId != null && record.exePath && exePath
    && record.exePath.toLowerCase() === exePath.toLowerCase();
  if (recordApplies) return record.assetId !== latest.assetId;
  if (localVersion) return isOlderVersion(localVersion, String(latest.tag || '').replace(/^v/i, ''));
  return true;
}

module.exports = {
  LOADERS,
  DEFAULT_LOADER,
  isLoaderId,
  loaderExeNames,
  loaderExePath,
  parseIniBoot,
  setIniBootFile,
  resolveLoader,
  describeLoader,
  missingLoaderMessage,
  planProfileLoaderSync,
  isValidExePath,
  sanitizeLoaderSettings,
  mergeProfileSettings,
  seedLoaderFromBoot,
  migrateProfileSettings,
  setIniServer,
  pickReleaseAsset,
  isOlderVersion,
  needsLoaderUpdate,
};
