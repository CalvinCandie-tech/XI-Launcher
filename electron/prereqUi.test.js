const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../src/utils/prereqUi');
const { expandStatus, loadFixture, createFakeBackend } = require('./prereqFake');

// A status list against the real catalogue, in the fixtures' short form.
const status = (overrides = {}) => expandStatus({ default: 'installed', overrides });
const ids = (list) => list.map((e) => e.id);
const FIXTURE_DIR = path.join(__dirname, '..', 'scripts', 'fixtures', 'prereqs');

// --- which ids "Install all missing" selects ------------------------------------------------

test('install all: required + recommended that are missing or unknown, in catalogue order', () => {
  const s = status({ 'directx-jun2010': 'missing', 'vc2008-x86': 'missing', 'vc2012-x86': ['unknown', 'x'] });
  assert.deepEqual(U.selectInstallAllIds(s), ['directx-jun2010', 'vc2012-x86', 'vc2008-x86']);
});

test('install all: never includes optional, superseded, covered, unsupported or installed', () => {
  const s = status({ net481: 'missing', net40: 'missing', net452: 'missing', 'vc2013-x86': ['unsupported', 'x'], 'vc2012-x86': ['covered', 'x'] });
  assert.deepEqual(U.selectInstallAllIds(s), []);
});

test('install all: empty / absent status selects nothing', () => {
  assert.deepEqual(U.selectInstallAllIds([]), []);
  assert.deepEqual(U.selectInstallAllIds(null), []);
});

test('per-row Install button: only for missing / unknown, never for a superseded package', () => {
  const s = status({ 'vc2008-x86': 'missing', 'vc2012-x86': ['unknown', 'x'], net40: 'missing', 'vc2013-x86': ['unsupported', 'x'] });
  const by = Object.fromEntries(s.map((e) => [e.id, e]));
  assert.equal(U.canInstall(by['vc2008-x86']), true);
  assert.equal(U.canInstall(by['vc2012-x86']), true);
  assert.equal(U.canInstall(by['vc2010-x86']), false, 'installed');
  assert.equal(U.canInstall(by['vc2013-x86']), false, 'unsupported');
  assert.equal(U.canInstall(by.net40), false, 'superseded');
});

// --- the Home banner rule -------------------------------------------------------------------

test('banner: shows when a REQUIRED package is missing or could not be checked', () => {
  assert.equal(U.shouldShowBanner(status({ 'directx-jun2010': 'missing' }), false), true);
  assert.equal(U.shouldShowBanner(status({ 'vc2015-2022-x86': ['unknown', 'x'] }), false), true);
});

test('banner: never for recommended / optional problems, all-OK, or an unknown status', () => {
  assert.equal(U.shouldShowBanner(status({ 'vc2008-x86': 'missing', net481: 'missing', 'vc2012-x86': ['unknown', 'x'] }), false), false);
  assert.equal(U.shouldShowBanner(status(), false), false);
  assert.equal(U.shouldShowBanner(null, false), false);
  assert.equal(U.shouldShowBanner(undefined, false), false);
});

test('banner: dismissed for the session hides it', () => {
  assert.equal(U.shouldShowBanner(status({ 'directx-jun2010': 'missing' }), true), false);
});

test('banner: required package that is unsupported or covered does not show it', () => {
  assert.equal(U.shouldShowBanner(status({ 'directx-jun2010': ['unsupported', 'x'] }), false), false);
});

test('banner text: names the missing packages and never claims the game will not start', () => {
  const t = U.bannerText(status({ 'directx-jun2010': 'missing', 'vc2015-2022-x86': 'missing' }));
  assert.match(t, /^Ashita recommends installing: DirectX End-User Runtime \(June 2010\), Visual C\+\+ 2015-2022/);
  for (const bad of [/won'?t (start|run|launch)/i, /cannot (start|run|launch)/i, /will not/i, /crash/i, /required to/i]) assert.doesNotMatch(t, bad);
  assert.match(U.bannerText(status({ 'vc2015-2022-x86': ['unknown', 'x'] })), /^Couldn't check: Visual C\+\+ 2015-2022/);
  assert.equal(U.bannerText(status()), '');
});

// --- sizes and pills ------------------------------------------------------------------------

test('download size: sums the selected packages; every .NET id counts once (the largest)', () => {
  const s = status();
  const size = (id) => s.find((e) => e.id === id).sizeBytes;
  assert.equal(U.totalDownloadBytes(s, ['directx-jun2010', 'vc2008-x86']), size('directx-jun2010') + size('vc2008-x86'));
  assert.equal(U.totalDownloadBytes(s, ['net48', 'net481']), Math.max(size('net48'), size('net481')));
  assert.equal(U.totalDownloadBytes(s, []), 0);
  assert.equal(U.totalDownloadBytes(s, ['no-such-id']), 0);
});

test('formatBytes', () => {
  assert.equal(U.formatBytes(0), '0 MB');
  assert.equal(U.formatBytes(2710520), '2.6 MB');
  assert.equal(U.formatBytes(100275120), '96 MB');
  assert.equal(U.formatBytes(NaN), '0 MB');
});

test('pills: label and tone per status; a missing required item is red, a missing recommended one is gold', () => {
  const s = status({ 'directx-jun2010': 'missing', 'vc2008-x86': 'missing', 'vc2012-x86': ['unknown', 'x'], net481: ['unsupported', 'x'], net48: ['covered', 'x'] });
  const pill = (id) => U.pillFor(s.find((e) => e.id === id));
  assert.deepEqual(pill('directx-jun2010'), { label: 'Missing', tone: 'red' });
  assert.deepEqual(pill('vc2008-x86'), { label: 'Missing', tone: 'gold' });
  assert.deepEqual(pill('vc2012-x86'), { label: "Couldn't check", tone: 'gold' });
  assert.deepEqual(pill('net481'), { label: 'Not supported on this Windows', tone: 'dim' });
  assert.deepEqual(pill('net48'), { label: 'Covered', tone: 'dim' });
  assert.deepEqual(pill('vc2010-x86'), { label: 'Installed', tone: 'green' });
});

test('grouping: required / recommended / optional by category, superseded under "covered"', () => {
  const g = U.groupPrereqs(status());
  assert.deepEqual(ids(g.required), ['directx-jun2010', 'vc2015-2022-x86']);
  assert.deepEqual(ids(g.optional), ['net481']);
  assert.deepEqual(ids(g.covered), ['net40', 'net452']);
  assert.equal(g.recommended.length, 6);
  assert.deepEqual(U.groupPrereqs(null), { required: [], recommended: [], optional: [], covered: [] });
});

// --- progress reducer -----------------------------------------------------------------------

test('progress: rows move queued -> downloading -> signature -> elevation -> waiting -> installing -> done', () => {
  const requested = ['directx-jun2010', 'vc2015-2022-x86'];
  const rows = (s) => [s.rows['directx-jun2010'], s.rows['vc2015-2022-x86']];
  let s = U.initialProgress(requested);
  assert.deepEqual(rows(s), ['queued', 'queued']);
  s = U.reduceProgress(s, 15, 'd', { phase: 'download', id: 'directx-jun2010', fraction: 0.5 });
  assert.deepEqual(rows(s), ['downloading', 'queued']);
  assert.equal(U.rowRunning(s, 'directx-jun2010').label, 'Downloading 50%');
  assert.equal(U.rowRunning(s, 'directx-jun2010').fraction, 0.5);
  s = U.reduceProgress(s, 30, 'd', { phase: 'download', id: 'vc2015-2022-x86', fraction: 0.1 });
  assert.deepEqual(rows(s), ['downloaded', 'downloading']);
  s = U.reduceProgress(s, 60, 'v', { phase: 'signature' });
  assert.deepEqual(rows(s), ['signature', 'signature']);
  assert.equal(U.rowRunning(s, 'directx-jun2010').label, 'Checking signature…');
  s = U.reduceProgress(s, 65, 'a', { phase: 'elevation' });
  assert.equal(U.rowRunning(s, 'vc2015-2022-x86').label, 'Waiting for the admin prompt…');
  s = U.reduceProgress(s, 65, 'i', { phase: 'install', id: 'directx-jun2010', state: 'started' });
  assert.deepEqual(rows(s), ['installing', 'waiting']);
  s = U.reduceProgress(s, 80, 'i', { phase: 'install', id: 'directx-jun2010', state: 'done' });
  s = U.reduceProgress(s, 80, 'i', { phase: 'install', id: 'vc2015-2022-x86', state: 'started' });
  assert.deepEqual(rows(s), ['done', 'installing']);
  assert.equal(U.rowRunning(s, 'directx-jun2010').fraction, 1);
  assert.equal(s.percent, 80);
  // Only active phases are indeterminate (null); a package waiting its turn shows an empty bar.
  assert.equal(U.rowRunning(s, 'vc2015-2022-x86').fraction, null); // installing
  assert.equal(U.rowRunning(U.initialProgress(['a']), 'a').fraction, 0); // queued
  const waiting = U.reduceProgress(U.reduceProgress(U.reduceProgress(U.initialProgress(requested), 1, '', { phase: 'download', id: 'directx-jun2010', fraction: 1 }), 1, '', { phase: 'elevation' }), 1, '', { phase: 'install', id: 'directx-jun2010', state: 'started' });
  assert.equal(U.rowRunning(waiting, 'vc2015-2022-x86').fraction, 0); // queued behind the active one
});

test('progress: an event without info only moves the overall bar; unknown rows are ignored', () => {
  let s = U.initialProgress(['vc2008-x86']);
  s = U.reduceProgress(s, 42, 'Downloading...', undefined);
  assert.equal(s.percent, 42);
  assert.equal(s.rows['vc2008-x86'], 'queued');
  s = U.reduceProgress(s, 50, 'x', { phase: 'download', id: 'vc2012-x86', fraction: 1 });
  assert.deepEqual(Object.keys(s.rows), ['vc2008-x86']);
  assert.equal(U.rowRunning(s, 'not-a-row'), null);
});

test('progress: the engine collapses .NET ids, so net481 events land on the requested net48 row', () => {
  assert.equal(U.rowIdFor('net481', ['net48']), 'net48');
  assert.equal(U.rowIdFor('net481', ['net481']), 'net481');
  assert.equal(U.rowIdFor('vc2008-x86', ['net48']), 'vc2008-x86');
  let s = U.initialProgress(['net48']);
  s = U.reduceProgress(s, 70, 'i', { phase: 'install', id: 'net481', state: 'started' });
  assert.equal(s.rows.net48, 'installing');
  assert.equal(U.resultForRow({ results: [{ id: 'net481', state: 'installed' }] }, 'net48').state, 'installed');
  assert.equal(U.resultForRow({ results: [{ id: 'vc2008-x86', state: 'installed' }] }, 'net48'), null);
});

// --- result wording -------------------------------------------------------------------------

test('result wording: cancelled is calm and exact; errors pass through; failures count', () => {
  assert.deepEqual(U.describeRun({ cancelled: true, results: [], error: null }), { tone: 'info', text: 'Admin prompt was declined. Nothing was installed.' });
  assert.deepEqual(U.describeRun({ error: 'No disk space', results: [] }), { tone: 'error', text: 'No disk space' });
  assert.equal(U.describeRun({ results: [{ state: 'installed' }, { state: 'failed' }], error: null }).tone, 'error');
  assert.match(U.describeRun({ results: [{ state: 'installed' }, { state: 'failed' }], error: null }).text, /^Installed 1\. 1 could not be installed/);
  assert.deepEqual(U.describeRun({ results: [{ state: 'restart' }], error: null }), { tone: 'success', text: 'Installed 1 item.' });
  assert.match(U.describeRun({ results: [], error: null }).text, /^Nothing to install/);
  assert.equal(U.describeRun(null), null);
});

test('row results: exit code shown for a failure, restart noted, cancel is not a failure', () => {
  assert.deepEqual(U.describeRowResult({ state: 'failed', exitCode: 1603 }), { label: 'Failed (exit code 1603)', tone: 'red' });
  assert.deepEqual(U.describeRowResult({ state: 'failed', exitCode: null }), { label: 'Failed', tone: 'red' });
  assert.equal(U.describeRowResult({ state: 'restart', exitCode: 3010 }).label, '✓ Installed — restart recommended');
  assert.deepEqual(U.describeRowResult({ state: 'cancelled' }), { label: 'Not installed', tone: 'dim' });
});

// --- dev-only fake backend ------------------------------------------------------------------

test('fake: a PACKAGED app never loads the fixture, whatever the variable says', () => {
  const read = () => { throw new Error('must not read a file when packaged'); };
  assert.equal(loadFixture(path.join(FIXTURE_DIR, 'required-missing.json'), true, read), null);
  assert.equal(loadFixture('anything', true, read), null);
});

test('fake: unset variable is inert; a set one loads and expands the status', () => {
  assert.equal(loadFixture(undefined, false), null);
  assert.equal(loadFixture('', false), null);
  const fx = loadFixture(path.join(FIXTURE_DIR, 'required-missing.json'), false);
  assert.deepEqual(ids(fx.status.filter((e) => e.status === 'missing')), ['directx-jun2010', 'vc2015-2022-x86']);
  assert.ok(fx.status.every((e) => e.name && e.category), 'names and categories come from the real catalogue');
});

test('fake: an unknown package id in a fixture is rejected, not silently ignored', () => {
  assert.throws(() => expandStatus({ default: 'installed', overrides: { 'typo-id': 'missing' } }), /unknown package id: typo-id/);
});

test('fake backend: plays the scripted events in order, returns the scripted result, and updates status', async () => {
  const fx = loadFixture(path.join(FIXTURE_DIR, 'required-missing.json'), false);
  const sent = [];
  const slept = [];
  const backend = createFakeBackend(fx, { sendProgress: (...a) => sent.push(a), sleep: async (ms) => { slept.push(ms); } });
  assert.equal((await backend.getStatus()).filter((e) => e.status === 'missing').length, 2);
  const out = await backend.install();
  assert.equal(sent.length, fx.install.events.length);
  assert.deepEqual(sent[0].slice(0, 2), [0, fx.install.events[0].detail]);
  assert.equal(sent[sent.length - 1][2].phase, 'done');
  assert.ok(slept.length > 0 && slept.every((n) => n > 0));
  assert.equal(out.error, null);
  assert.equal(out.results.length, 2);
  assert.equal(out.status.filter((e) => e.status === 'missing').length, 0);
  assert.equal((await backend.getStatus()).filter((e) => e.status === 'missing').length, 0, 'a later re-check sees the new state');
});

test('fake backend: no scripted install -> error object; a second call while running -> already-running', async () => {
  const noInstall = createFakeBackend(loadFixture(path.join(FIXTURE_DIR, 'all-ok.json'), false), { sendProgress() {}, sleep: async () => {} });
  assert.match((await noInstall.install()).error, /no scripted install/);

  let release;
  const gate = new Promise((r) => { release = r; });
  const backend = createFakeBackend(loadFixture(path.join(FIXTURE_DIR, 'cancelled.json'), false), { sendProgress() {}, sleep: () => gate });
  const first = backend.install();
  assert.match((await backend.install()).error, /already running/);
  release();
  assert.equal((await first).cancelled, true);
});

test('fixtures: every committed fixture parses and its scripted result is self-consistent', () => {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  assert.deepEqual(files.sort(), ['all-ok.json', 'cancelled.json', 'mixed.json', 'partial-failure.json', 'required-missing.json', 'restart-recommended.json']);
  for (const f of files) {
    const fx = loadFixture(path.join(FIXTURE_DIR, f), false);
    if (!fx.install) continue;
    const phases = fx.install.events.map((e) => e.info && e.info.phase);
    assert.equal(phases[phases.length - 1], 'done', `${f} ends with the done phase`);
    assert.equal(fx.install.events[fx.install.events.length - 1].percent, 100);
    const r = fx.install.result;
    assert.equal(!!r.restartRecommended, (r.results || []).some((x) => x.state === 'restart'), `${f}: restartRecommended matches the results`);
    for (const x of r.results || []) assert.ok(fx.status.some((s) => s.id === x.id), `${f}: result id ${x.id} exists in the catalogue`);
  }
});
