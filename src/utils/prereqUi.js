// Pure helpers for the Requirements section (Settings) and the Home banner. No React, no IPC.
// Written as CommonJS (webpack imports it fine) so electron/prereqUi.test.js can require it.
//
// A `status` entry is what get-prereqs-status returns:
//   { id, name, category: required|recommended|optional|superseded,
//     status: installed|missing|covered|unsupported|unknown, detail, sizeBytes }
// Spec: docs/superpowers/specs/2026-10-06-prereqs-design.md

const DOTNET_IDS = ['net40', 'net452', 'net48', 'net481'];
const NEEDS_ACTION = ['missing', 'unknown'];

const isDotnet = (id) => DOTNET_IDS.includes(id);
const needsAction = (entry) => NEEDS_ACTION.includes(entry.status);

// Required / Recommended / Optional keep the catalogue order; "covered" is the superseded group
// (.NET 4.0 / 4.5.2), shown greyed with no button.
function groupPrereqs(status) {
  const list = Array.isArray(status) ? status : [];
  return {
    required: list.filter((e) => e.category === 'required'),
    recommended: list.filter((e) => e.category === 'recommended'),
    optional: list.filter((e) => e.category === 'optional'),
    covered: list.filter((e) => e.category === 'superseded'),
  };
}

// An Install button is offered for anything missing or that could not be checked, never for a
// superseded package (the installer would not run it).
const canInstall = (entry) => entry.category !== 'superseded' && needsAction(entry);

// What "Install all missing" installs: required + recommended that are missing / unknown.
// Optional and superseded are never included.
function selectInstallAllIds(status) {
  return (Array.isArray(status) ? status : [])
    .filter((e) => (e.category === 'required' || e.category === 'recommended') && needsAction(e))
    .map((e) => e.id);
}

// Required packages that should raise the Home banner.
const bannerPackages = (status) => (Array.isArray(status) ? status : []).filter((e) => e.category === 'required' && needsAction(e));
const shouldShowBanner = (status, dismissed) => !dismissed && bannerPackages(status).length > 0;

// Banner wording. Deliberately does NOT say the game will not start: Phase 1 found the FFXI / Ashita
// binaries do not hard-import the June 2010-only DLLs.
function bannerText(status) {
  const pkgs = bannerPackages(status);
  const missing = pkgs.filter((e) => e.status === 'missing').map((e) => e.name);
  const unknown = pkgs.filter((e) => e.status === 'unknown').map((e) => e.name);
  const parts = [];
  if (missing.length) parts.push(`Ashita recommends installing: ${missing.join(', ')}`);
  if (unknown.length) parts.push(`Couldn't check: ${unknown.join(', ')}`);
  return parts.join('. ');
}

// Approximate download size of the given ids. Every .NET id is ONE install (the engine picks 4.8 or
// 4.8.1), so only the largest selected .NET package is counted.
function totalDownloadBytes(status, ids) {
  const byId = new Map((Array.isArray(status) ? status : []).map((e) => [e.id, e]));
  let total = 0;
  let dotnet = 0;
  ids.forEach((id) => {
    const size = (byId.get(id) && byId.get(id).sizeBytes) || 0;
    if (isDotnet(id)) dotnet = Math.max(dotnet, size);
    else total += size;
  });
  return total + dotnet;
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  const mb = n / 1048576;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

// Status pill: label + tone ('green' | 'red' | 'gold' | 'dim'). A missing REQUIRED package is red;
// a missing recommended / optional one is gold (worth doing, not alarming).
function pillFor(entry) {
  switch (entry.status) {
    case 'installed': return { label: 'Installed', tone: 'green' };
    case 'covered': return { label: 'Covered', tone: 'dim' };
    case 'unsupported': return { label: 'Not supported on this Windows', tone: 'dim' };
    case 'unknown': return { label: "Couldn't check", tone: 'gold' };
    case 'missing': return { label: 'Missing', tone: entry.category === 'required' ? 'red' : 'gold' };
    default: return { label: String(entry.status), tone: 'dim' };
  }
}

// --- live progress -------------------------------------------------------------------------
//
// The engine emits `prerequisites-progress (percent, detail, info)` with
// info = { phase: download|signature|elevation|install|recheck|done, id?, state?, fraction? }.
// The reducer folds those into one state per ROW the user asked for. The engine collapses every
// .NET id into one install (4.8 or 4.8.1), so an event naming a .NET package that was not requested
// is shown on the .NET row that was.

const rowIdFor = (id, requestedIds) => {
  if (!isDotnet(id) || requestedIds.includes(id)) return id;
  return requestedIds.find(isDotnet) || id;
};

function initialProgress(requestedIds) {
  return {
    requestedIds: requestedIds.slice(),
    percent: 0,
    detail: 'Starting...',
    phase: 'starting',
    rows: Object.fromEntries(requestedIds.map((id) => [id, 'queued'])),
    fractions: {},
  };
}

function reduceProgress(state, percent, detail, info) {
  // Object.assign / forEach rather than spread / for-of: those make Babel inject ESM helper imports in the
  // production build, which flips this CommonJS file to ESM and breaks its named imports.
  const next = Object.assign({}, state, {
    percent,
    detail: detail || state.detail,
    rows: Object.assign({}, state.rows),
    fractions: Object.assign({}, state.fractions),
  });
  if (!info) return next;
  next.phase = info.phase;
  const each = (from, to) => { Object.keys(next.rows).forEach((id) => { if (from.includes(next.rows[id])) next.rows[id] = to; }); };

  switch (info.phase) {
    case 'download': {
      const id = rowIdFor(info.id, state.requestedIds);
      each(['downloading'], 'downloaded'); // the previous package is finished once the next one starts
      if (id in next.rows) { next.rows[id] = 'downloading'; next.fractions[id] = info.fraction || 0; }
      break;
    }
    case 'signature': each(['downloading', 'downloaded'], 'signature'); break;
    case 'elevation': each(['signature'], 'elevation'); break;
    case 'install': {
      const id = rowIdFor(info.id, state.requestedIds);
      each(['elevation'], 'waiting');
      if (id in next.rows) next.rows[id] = info.state === 'done' ? 'done' : 'installing';
      break;
    }
    default: break;
  }
  return next;
}

const ROW_LABELS = {
  queued: 'Queued',
  downloaded: 'Downloaded',
  signature: 'Checking signature…',
  elevation: 'Waiting for the admin prompt…',
  waiting: 'Waiting to install',
  installing: 'Installing…',
  done: 'Done',
};

// What a row shows while a run is going: { label, fraction } (fraction null = no bar value, 0..1 = bar).
function rowRunning(progress, rowId) {
  const state = progress && progress.rows[rowId];
  if (!state) return null;
  if (state === 'downloading') {
    const f = Math.max(0, Math.min(1, progress.fractions[rowId] || 0));
    return { label: `Downloading ${Math.round(f * 100)}%`, fraction: f };
  }
  // Only phases that are actively working (signature check, admin prompt, installing) animate an
  // unfilled bar; a package that is merely waiting its turn shows an empty one.
  const fraction = { queued: 0, waiting: 0, downloaded: 1, done: 1 }[state];
  return { label: ROW_LABELS[state] || state, fraction: fraction === undefined ? null : fraction };
}

// The result entry for a row (the .NET collapse again: net48 requested, net481 installed).
function resultForRow(result, rowId) {
  const results = (result && result.results) || [];
  return results.find((r) => r.id === rowId) || (isDotnet(rowId) ? results.find((r) => isDotnet(r.id)) : null) || null;
}

// Row label after a run: { label, tone: 'green' | 'red' | 'dim' }.
function describeRowResult(entry) {
  switch (entry.state) {
    case 'installed': return { label: '✓ Just installed', tone: 'green' };
    case 'restart': return { label: '✓ Installed — restart recommended', tone: 'green' };
    case 'cancelled': return { label: 'Not installed', tone: 'dim' };
    case 'failed': return { label: entry.exitCode == null ? 'Failed' : `Failed (exit code ${entry.exitCode})`, tone: 'red' };
    default: return { label: entry.state, tone: 'dim' };
  }
}

// One calm line for the whole run: { tone: 'success' | 'error' | 'info', text } or null. Restart is
// reported separately (result.restartRecommended) so it can be its own notice.
function describeRun(result) {
  if (!result) return null;
  if (result.error) return { tone: 'error', text: result.error };
  if (result.cancelled) return { tone: 'info', text: 'Admin prompt was declined. Nothing was installed.' };
  const results = result.results || [];
  const failed = results.filter((r) => r.state === 'failed');
  const ok = results.filter((r) => r.state === 'installed' || r.state === 'restart');
  if (failed.length) {
    return { tone: 'error', text: `${ok.length ? `Installed ${ok.length}. ` : ''}${failed.length} could not be installed — see below.` };
  }
  if (ok.length) return { tone: 'success', text: `Installed ${ok.length} item${ok.length === 1 ? '' : 's'}.` };
  return { tone: 'success', text: 'Nothing to install — everything is already present.' };
}

module.exports = {
  DOTNET_IDS,
  groupPrereqs,
  canInstall,
  selectInstallAllIds,
  bannerPackages,
  shouldShowBanner,
  bannerText,
  totalDownloadBytes,
  formatBytes,
  pillFor,
  rowIdFor,
  initialProgress,
  reduceProgress,
  rowRunning,
  resultForRow,
  describeRowResult,
  describeRun,
};
