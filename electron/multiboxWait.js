// Multi-box: launch the next profile only once the previous one has reached the game window.
// The loader (xiloader, ldloader or a custom exe) hosts FFXI in its own process — its console
// window comes first, then the game window — so "the loader's window title is no longer the
// loader's" means that client is past login. Older loaders bind fixed relay ports, so two logins
// at once can collide; launching 2 s apart wasn't enough. Pure, so multiboxWait.test.js covers it.

const path = require('path');

// The name Get-Process knows the loader by: "xiloader" for C:\...\xiloader.exe. null = no loader
// (retail boots PlayOnline), so there is nothing to wait for.
function loaderProcessName(exePath) {
  const cleaned = String(exePath || '').trim().replace(/^"|"$/g, '');
  if (!cleaned) return null;
  return path.win32.basename(cleaned).replace(/\.exe$/i, '') || null;
}

// With Windows Terminal hosting the console, the loader process owns no window until the game
// opens, so an empty title also means "not yet".
function isGameWindowTitle(title, processName) {
  const t = String(title || '').trim().toLowerCase();
  if (!t) return false;
  return ![processName, 'xiloader', 'ldloader']
    .filter(Boolean)
    .some((name) => t.includes(String(name).toLowerCase()));
}

// One poll. `baselinePids` were running before this launch (earlier clients); `pid` is the loader
// picked on an earlier poll. → { state: 'starting' | 'waiting' | 'ready' | 'exited', pid }
function assessLaunch({ baselinePids, pid }, processes, processName) {
  const list = Array.isArray(processes) ? processes : [];
  if (pid !== null && pid !== undefined) {
    const own = list.find((p) => p.pid === pid);
    if (!own) return { state: 'exited', pid };
    return { state: isGameWindowTitle(own.title, processName) ? 'ready' : 'waiting', pid };
  }
  const known = new Set(baselinePids || []);
  // Multi-box launches one profile at a time, so at most one loader is new
  const own = list.find((p) => !known.has(p.pid));
  if (!own) return { state: 'starting', pid: null };
  return { state: isGameWindowTitle(own.title, processName) ? 'ready' : 'waiting', pid: own.pid };
}

// ConvertTo-Json prints an object for one process and nothing for none.
function parseProcessJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  let data;
  try { data = JSON.parse(trimmed); } catch { return []; }
  const items = Array.isArray(data) ? data : [data];
  return items
    .filter((p) => p && Number.isInteger(p.pid))
    .map((p) => ({ pid: p.pid, title: typeof p.title === 'string' ? p.title : '' }));
}

// `exit 0`: with no such process, -ErrorAction SilentlyContinue still leaves $? false and
// powershell -Command would exit 1 — read as a failed snapshot, so nothing was ever tracked.
function buildSnapshotCommand(processName) {
  const name = String(processName).replace(/'/g, "''");
  return `Get-Process -Name '${name}' -ErrorAction SilentlyContinue`
    + ' | ForEach-Object { [pscustomobject]@{ pid = $_.Id; title = $_.MainWindowTitle } }'
    + ' | ConvertTo-Json -Compress; exit 0';
}

module.exports = { loaderProcessName, isGameWindowTitle, assessLaunch, parseProcessJson, buildSnapshotCommand };
