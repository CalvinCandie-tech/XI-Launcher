// Ashita's Sandbox polplugin virtualises the PlayOnline/FFXI registry entries so the game
// runs from any folder without being installed. A boot profile turns it on with
// `sandbox = 1` under [ashita.polplugins] and says where the game is in [sandbox.paths]
// (see runtime/ashita/docs/sandbox/README.md). Pure ini logic, unit tested with
// `npm run test:electron`.
const path = require('path');

// A sandboxed copy is one folder per server holding "FINAL FANTASY XI" and "PlayOnlineViewer"
// — the layout the FFXI Files Updater installs into (see ffxiMirror.planClientLayout).
function copyPaths(folder) {
  return {
    ffxi: path.win32.join(folder, 'FINAL FANTASY XI'),
    pol: path.win32.join(folder, 'PlayOnlineViewer'),
  };
}

// The copy folder from whatever the player browsed to — it, or a game folder inside it.
function normalizeCopyFolder(picked) {
  if (typeof picked !== 'string' || !picked.trim()) return null;
  const folder = picked.trim().replace(/\//g, '\\').replace(/\\+$/, '');
  const base = path.win32.basename(folder);
  return /^(final fantasy xi|playonlineviewer)$/i.test(base) ? path.win32.dirname(folder) : folder;
}

// Which game files a profile plays from. A player who hasn't chosen yet keeps whatever the
// ini says, so a hand-enabled Sandbox (e.g. a server's setup guide) keeps working.
function resolveGameFiles({ settings, ini, installedFfxiPath }) {
  const installed = (chosen) => ({ mode: 'installed', chosen, ffxi: installedFfxiPath });
  if (settings?.gameFiles === 'sandbox' && settings.sandboxFolder) {
    return { mode: 'sandbox', chosen: true, folder: settings.sandboxFolder, ...copyPaths(settings.sandboxFolder) };
  }
  if (settings?.gameFiles) return installed(true);
  if (ini && isSandboxEnabled(ini)) {
    const current = readSandboxPaths(ini);
    if (current.ffxi) {
      const folder = path.win32.dirname(current.ffxi);
      return { mode: 'sandbox', chosen: false, folder, ffxi: current.ffxi, pol: current.pol || copyPaths(folder).pol };
    }
  }
  return installed(false);
}

// Before launch: the ini content that makes Sandbox match the profile's game files, or null
// if it already does (or the player never chose, so the ini is left as they wrote it).
function planGameFilesSync(ini, gameFiles) {
  let updated = null;
  if (gameFiles.mode === 'sandbox') updated = setSandbox(ini, true, { ffxi: gameFiles.ffxi, pol: gameFiles.pol });
  else if (gameFiles.chosen && isSandboxEnabled(ini)) updated = setSandbox(ini, false);
  return updated === null || updated === ini ? null : updated;
}

function splitIni(text) {
  const str = String(text);
  return { eol: str.includes('\r\n') ? '\r\n' : '\n', lines: str.split(/\r?\n/) };
}

const sectionHeader = (trimmed) => {
  const m = trimmed.match(/^\[(.+)\]$/);
  return m ? m[1].trim().toLowerCase() : null;
};
const keyOf = (trimmed) => {
  const m = trimmed.match(/^([^=;#]+?)\s*=/);
  return m ? m[1].toLowerCase() : null;
};

function getIniValue(text, section, key) {
  let current = '';
  let value = null;
  for (const raw of splitIni(text).lines) {
    const trimmed = raw.trim();
    const header = sectionHeader(trimmed);
    if (header !== null) { current = header; continue; }
    if (current === section && keyOf(trimmed) === key) value = trimmed.slice(trimmed.indexOf('=') + 1).trim();
  }
  return value;
}

// Set key = value in [section]: replaced in place if present, otherwise added after the
// section's last entry, or in a new section at the end of the file.
function setIniValue(text, section, key, value) {
  const { eol, lines } = splitIni(text);
  let current = '';
  let lastInSection = -1;
  let found = false;
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    const header = sectionHeader(trimmed);
    if (header !== null) {
      current = header;
      if (header === section && lastInSection < 0) lastInSection = i;
      return;
    }
    if (current !== section) return;
    if (trimmed) lastInSection = i;
    if (keyOf(trimmed) === key) {
      lines[i] = raw.replace(/=.*$/, () => `= ${value}`);
      found = true;
    }
  });
  if (found) return lines.join(eol);
  if (lastInSection >= 0) {
    lines.splice(lastInSection + 1, 0, `${key} = ${value}`);
    return lines.join(eol);
  }
  const endsWithEol = lines.length > 1 && lines[lines.length - 1] === '';
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length) lines.push('');
  lines.push(`[${section}]`, `${key} = ${value}`);
  if (endsWithEol) lines.push('');
  return lines.join(eol);
}

function isSandboxEnabled(text) {
  return getIniValue(text, 'ashita.polplugins', 'sandbox') === '1';
}

function readSandboxPaths(text) {
  return { ffxi: getIniValue(text, 'sandbox.paths', 'ffxi'), pol: getIniValue(text, 'sandbox.paths', 'pol') };
}

// Turn Sandbox on or off for a profile. Turning it on also points [sandbox.paths] at
// paths; turning it off leaves that section in place (Sandbox ignores it when unloaded).
function setSandbox(text, enabled, paths) {
  let out = setIniValue(text, 'ashita.polplugins', 'sandbox', enabled ? '1' : '0');
  if (enabled && paths) {
    out = setIniValue(out, 'sandbox.paths', 'pol', paths.pol);
    out = setIniValue(out, 'sandbox.paths', 'ffxi', paths.ffxi);
  }
  return out;
}

// The launcher is portable (e.g. on a thumb drive whose letter changes between PCs). Saved paths
// that pointed inside its old folder are moved to its new one; anything else is left alone.
function relocatePath(p, oldRoot, newRoot) {
  if (typeof p !== 'string' || !p || !oldRoot || !newRoot) return p;
  const trim = (s) => String(s).replace(/[\\/]+$/, '');
  const from = trim(oldRoot);
  const to = trim(newRoot);
  const lower = p.toLowerCase();
  const fromLower = from.toLowerCase();
  if (lower === fromLower) return to;
  if (!lower.startsWith(fromLower + '\\') && !lower.startsWith(fromLower + '/')) return p;
  return to + p.slice(from.length);
}

// A copy the launcher made in its own runtime\clients folder, found at the launcher's current
// location — for a profile ini written on another PC or drive letter. null if p isn't one.
function rebaseClientCopy(p, runtimeDir) {
  if (typeof p !== 'string' || !p) return null;
  const m = p.match(/[\\/]runtime[\\/](clients[\\/].+)$/i);
  return m ? path.win32.join(runtimeDir, m[1]) : null;
}

// A saved Ashita/xiloader folder of the form <launcher>\runtime\ashita (or \xiloader) is the
// launcher's own default location. If the launcher it belonged to no longer exists — the drive
// was lost, or settings outlived a reinstall that never recorded launcherRoot — it can only fail,
// so use this launcher's default instead. Folders the user chose elsewhere are never touched.
// `exists` is injected so this stays pure.
function staleRuntimePath(saved, defaultPath, exists) {
  if (typeof saved !== 'string' || !saved || isSameFolder(saved, defaultPath)) return saved;
  const m = saved.match(/^(.*[\\/]runtime)[\\/](?:ashita|xiloader)[\\/]*$/i);
  if (!m) return saved;
  return exists(m[1]) ? saved : defaultPath;
}

// The FFXI folder PlayOnline's installer registered (InstallFolder value 0001), from
// `reg query ...\PlayOnlineUS\InstallFolder` output, or null.
function parseRegFfxiFolder(regOutput) {
  const m = String(regOutput).match(/^\s*0001\s+REG_\w+\s+(.+?)\s*$/m);
  return m ? m[1] : null;
}

function isSameFolder(a, b) {
  if (!a || !b) return false;
  const norm = (p) => String(p).trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

module.exports = {
  copyPaths,
  normalizeCopyFolder,
  resolveGameFiles,
  planGameFilesSync,
  isSandboxEnabled,
  readSandboxPaths,
  setSandbox,
  parseRegFfxiFolder,
  isSameFolder,
  relocatePath,
  staleRuntimePath,
  rebaseClientCopy,
};
