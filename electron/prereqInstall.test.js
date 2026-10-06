const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PACKAGES } = require('./prereqs');
const P = require('./prereqInstall');

const WIN11 = { build: 26200 };
const WIN10_2004 = { build: 19041 };
const WIN10_20H2 = { build: 19042 };
const pkg = (id) => PACKAGES.find((p) => p.id === id);

// Every package 'installed' except the ids in `missing` (and `overrides`: { id: status }).
function statuses(missing = [], overrides = {}) {
  return PACKAGES.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    status: overrides[p.id] || (missing.includes(p.id) ? 'missing' : 'installed'),
    detail: '',
  }));
}
const ids = (plan) => plan.map((p) => p.id);

// --- planInstall ----------------------------------------------------------------------------

test('plan: only missing packages, in DirectX -> VC++ oldest..newest -> .NET order', () => {
  const all = PACKAGES.filter((p) => p.installer).map((p) => p.id);
  const plan = P.planInstall(statuses(all), all, WIN10_2004);
  assert.deepEqual(ids(plan), [
    'directx-jun2010', 'vc2005-x86', 'vc2008-x86', 'vc2010-x86', 'vc2012-x86', 'vc2013-x86', 'vc2015-2022-x86', 'net48',
  ]);
});

test('plan: INSTALL_ORDER lists every installable package exactly once', () => {
  const installable = PACKAGES.filter((p) => p.installer).map((p) => p.id).sort();
  assert.deepEqual([...P.INSTALL_ORDER].sort(), installable);
});

test('plan: installed, covered and unsupported are skipped; unknown is installed', () => {
  const plan = P.planInstall(
    statuses([], { 'vc2005-x86': 'covered', 'vc2008-x86': 'unsupported', 'vc2010-x86': 'unknown', 'vc2012-x86': 'missing' }),
    ['vc2005-x86', 'vc2008-x86', 'vc2010-x86', 'vc2012-x86', 'vc2013-x86'],
    WIN11,
  );
  assert.deepEqual(ids(plan), ['vc2010-x86', 'vc2012-x86']);
});

test('plan: this machine (only VC++ 2008 missing) plans exactly vc2008-x86', () => {
  assert.deepEqual(ids(P.planInstall(statuses(['vc2008-x86']), P.defaultRequestedIds(), WIN11)), ['vc2008-x86']);
});

test('plan: default request is required + recommended, never optional or superseded', () => {
  const d = P.defaultRequestedIds();
  assert.ok(d.includes('directx-jun2010') && d.includes('net48') && d.includes('vc2005-x86'));
  assert.ok(!d.includes('net481') && !d.includes('net40') && !d.includes('net452'));
});

test('plan: missing .NET picks 4.8.1 from build 19042, 4.8 below it or when the build is unknown', () => {
  const want = (osInfo) => ids(P.planInstall(statuses(['net48']), ['net48'], osInfo));
  assert.deepEqual(want(WIN11), ['net481']);
  assert.deepEqual(want(WIN10_20H2), ['net481']);
  assert.deepEqual(want(WIN10_2004), ['net48']);
  assert.deepEqual(want({ build: NaN }), ['net48']);
});

test('plan: 4.0 / 4.5.2 requests install the one chosen .NET, once; they are never installed themselves', () => {
  const st = statuses(['net40', 'net452', 'net48', 'net481']);
  assert.deepEqual(ids(P.planInstall(st, ['net40', 'net452', 'net48', 'net481'], WIN11)), ['net481']);
  assert.deepEqual(ids(P.planInstall(st, ['net40', 'net452'], WIN10_2004)), ['net48']);
});

test('plan: an explicit 4.8.1 request on an OS that cannot take it plans nothing', () => {
  const st = statuses([], { net481: 'unsupported' });
  assert.deepEqual(P.planInstall(st, ['net481'], WIN10_2004), []);
});

test('plan: duplicate ids collapse', () => {
  assert.deepEqual(ids(P.planInstall(statuses(['vc2008-x86']), ['vc2008-x86', 'vc2008-x86'], WIN11)), ['vc2008-x86']);
});

test('plan: an unknown id is an error, and so is an id with no detection result', () => {
  assert.throws(() => P.planInstall(statuses(), ['not-a-package'], WIN11), /Unknown prerequisite id: not-a-package/);
  assert.throws(() => P.planInstall(statuses().filter((s) => s.id !== 'vc2008-x86'), ['vc2008-x86'], WIN11), /No detection result/);
});

// --- classifyExitCode -----------------------------------------------------------------------

test('classify: table', () => {
  const c = (id, code) => P.classifyExitCode(id, code);
  assert.equal(c('vc2008-x86', 0).state, 'installed');
  assert.equal(c('vc2015-2022-x86', 1638).state, 'installed');
  assert.match(c('vc2015-2022-x86', 1638).message, /newer version is already installed/);
  assert.equal(c('vc2008-x86', 3010).state, 'restart');
  assert.equal(c('net481', 1641).state, 'restart');
  assert.match(c('net481', 3010).message, /restart recommended/);
  assert.equal(c('net48', 1602).state, 'failed');
  assert.match(c('net48', 1602).message, /1602/);
  assert.equal(c('net48', 5100).state, 'failed');
  assert.match(c('net48', 5100).message, /requirements/);
  assert.equal(c('vc2010-x86', 1603).state, 'failed');
  const unknown = c('vc2010-x86', 4242);
  assert.equal(unknown.state, 'failed');
  assert.match(unknown.message, /4242/);
});

test('classify: 1638 is only success where the catalogue says so (VC++), no exit code is a failure', () => {
  assert.equal(P.classifyExitCode('net48', 1638).state, 'failed');
  assert.equal(P.classifyExitCode('directx-jun2010', 1638).state, 'failed');
  assert.equal(P.classifyExitCode('vc2008-x86', null).state, 'failed');
  assert.equal(P.classifyExitCode('vc2008-x86', undefined).state, 'failed');
  assert.throws(() => P.classifyExitCode('nope', 0), /No exit codes/);
});

// --- signature gate -------------------------------------------------------------------------

test('signature: Valid + CN=Microsoft Corporation passes; nothing else does', () => {
  const ms = 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US';
  assert.equal(P.evaluateSignature({ status: 'Valid', subject: ms }).ok, true);
  assert.equal(P.evaluateSignature({ status: 'Valid', subject: 'O=Microsoft Corporation, CN=Microsoft Corporation, C=US' }).ok, true);
  assert.equal(P.evaluateSignature({ status: 'NotSigned', subject: null }).ok, false);
  assert.equal(P.evaluateSignature({ status: 'HashMismatch', subject: ms }).ok, false);
  assert.equal(P.evaluateSignature({ status: 'Valid', subject: 'CN=Microsoft Corporation Evil, O=x' }).ok, false);
  assert.equal(P.evaluateSignature({ status: 'Valid', subject: 'CN=Not Microsoft, O=Microsoft Corporation' }).ok, false);
  assert.equal(P.evaluateSignature({ status: 'Valid', subject: null }).ok, false);
  assert.equal(P.evaluateSignature(undefined).ok, false);
});

test('signature: subject parsing handles quoted values', () => {
  assert.equal(P.parseSubjectCN('CN="Foo, Inc.", O=Foo'), 'Foo, Inc.');
  assert.equal(P.parseSubjectCN('O=Foo'), null);
});

// --- script builders ------------------------------------------------------------------------

const NASTY_DIR = "C:\\Users\\O'Brien \u2019s Temp\\xi-launcher-prereqs-abc";
const nastyPaths = (plan) => ({
  files: Object.fromEntries(plan.map((p) => [p.id, `${NASTY_DIR}\\${p.id}.exe`])),
  extractDir: 'C:\\Windows\\Temp\\xi-launcher-dx-abc',
  progressLogPath: `${NASTY_DIR}\\progress.log`,
  resultsPath: `${NASTY_DIR}\\results.json`,
});

test('install script: apostrophes (straight and curly) and spaces in paths are quoted', () => {
  const plan = [pkg('vc2008-x86')];
  const script = P.buildInstallScript(plan, nastyPaths(plan));
  assert.ok(script.includes("'C:\\Users\\O''Brien \u2019\u2019s Temp\\xi-launcher-prereqs-abc\\vc2008-x86.exe'"), 'file path quoted and doubled');
  assert.ok(script.includes("$resultsPath = 'C:\\Users\\O''Brien \u2019\u2019s Temp\\xi-launcher-prereqs-abc\\results.json'"));
  assert.ok(script.includes("-ArgumentList $arguments"), 'arguments are passed as one string');
  assert.ok(script.includes("'/q /norestart'"));
});

test('install script: DirectX is a two-step extract then DXSETUP, extract dir quoted only when it has spaces', () => {
  const plan = [pkg('directx-jun2010')];
  const clean = P.buildInstallScript(plan, nastyPaths(plan));
  assert.ok(clean.includes("'/Q /T:C:\\Windows\\Temp\\xi-launcher-dx-abc /C'"));
  assert.ok(clean.includes("'DXSETUP.exe'") && clean.includes("'/silent'"));
  assert.ok(clean.indexOf('/Q /T:') < clean.indexOf("'/silent'"), 'extract before setup');
  const spaced = P.buildInstallScript(plan, { ...nastyPaths(plan), extractDir: 'C:\\a b\\dx' });
  assert.ok(spaced.includes('\'/Q /T:"C:\\a b\\dx" /C\''));
});

test('install script: every package is isolated in try/catch so a failure never stops the batch', () => {
  const plan = [pkg('vc2008-x86'), pkg('vc2010-x86'), pkg('vc2012-x86')];
  const script = P.buildInstallScript(plan, nastyPaths(plan));
  assert.equal((script.match(/^try \{/gm) || []).length, 3);
  assert.equal((script.match(/^\} catch \{/gm) || []).length, 3);
  assert.ok(script.indexOf('# vc2008-x86') < script.indexOf('# vc2010-x86') && script.indexOf('# vc2010-x86') < script.indexOf('# vc2012-x86'));
  assert.throws(() => P.buildInstallScript(plan, { ...nastyPaths(plan), files: {} }), /No downloaded file/);
});

test('install script: every installer is re-verified inside the elevated script, right before it runs', () => {
  const plan = [pkg('vc2008-x86'), pkg('directx-jun2010')];
  const script = P.buildInstallScript(plan, nastyPaths(plan));
  assert.ok(script.includes('Get-AuthenticodeSignature -LiteralPath $file'));
  assert.ok(script.includes("-ne 'Valid'"), 'Status must be Valid');
  assert.ok(script.includes("$requiredSigner = 'Microsoft Corporation'"), 'default signer');
  assert.ok(script.includes('-cne $requiredSigner'), 'exact, case-sensitive CN comparison');
  assert.ok(script.includes("throw ('signature changed: ' + $bad)"));
  // The gate lives inside Invoke-Installer, ahead of Start-Process, so DXSETUP.exe goes through it too.
  const fn = script.slice(script.indexOf('function Invoke-Installer'));
  assert.ok(fn.indexOf('Test-InstallerSignature $file') < fn.indexOf('Start-Process'));
  assert.equal((script.match(/Invoke-Installer /g) || []).length, 3, 'vc2008 + DirectX extract + DXSETUP all go through it');
  assert.ok(script.includes('} catch {\r\n  $exitCode = -1'), 'any exception resets the exit code (a DXSETUP skip must not keep the extraction 0)');
  assert.ok(P.buildInstallScript(plan, { ...nastyPaths(plan), signerCN: 'Test CN' }).includes("$requiredSigner = 'Test CN'"));
});

test('elevation script: one RunAs, quoted -File path, exits 1223 when the UAC prompt is declined', () => {
  const s = P.buildElevationScript("C:\\Users\\O'Brien s\\install.ps1");
  assert.equal((s.match(/-Verb RunAs/g) || []).length, 1);
  assert.ok(s.includes('\'"C:\\Users\\O\'\'Brien s\\install.ps1"\''), 'path wrapped in double quotes and apostrophe doubled');
  assert.match(s, /NativeErrorCode/);
  assert.match(s, /exit 1223/);
});

test('uac: decline detection', () => {
  assert.equal(P.isUacDeclined({ exitCode: 1223, message: 'PowerShell exited with code 1223' }), true);
  assert.equal(P.isUacDeclined({ message: 'The operation was canceled by the user.' }), true);
  assert.equal(P.isUacDeclined({ exitCode: 1, message: 'boom' }), false);
  assert.equal(P.isUacDeclined(null), false);
});

// --- harness: the generated script against FAKE installers (Windows only, not elevated) ------

const WIN_ONLY = { skip: process.platform !== 'win32' && 'needs powershell.exe' };

function runPs(scriptText, dir) {
  const file = path.join(dir, 'run.ps1');
  fs.writeFileSync(file, '\uFEFF' + scriptText, 'utf8');
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8', windowsHide: true });
}

// A temp folder whose name has a space, an apostrophe and a curly quote, like a nasty profile path.
function nastyTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xi prereq O'Brien\u2019s "));
  return dir;
}
const writeCmd = (file, body) => fs.writeFileSync(file, `@echo off\r\n${body}\r\n`);

// Stand-ins for installers. The in-script signature gate runs before every installer, and a signed
// fake is not practical, so the accept path uses REAL Microsoft-signed Windows binaries (cmd.exe,
// whoami.exe: Valid, CN=Microsoft Windows) with signerCN pointed at that CN, and arguments that make
// them exit immediately with a chosen code. The reject path uses an unsigned file under the real
// default CN. Production never sets signerCN.
const SYS32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const SIGNED_CMD = path.join(SYS32, 'cmd.exe');
const WINDOWS_SIGNER = 'Microsoft Windows';
const exitsWith = (id, code) => ({ ...pkg(id), installer: { ...pkg(id).installer, args: ['/c', 'exit', String(code)] } });
const harnessPaths = (dir, plan, files, extra = {}) => ({
  files,
  extractDir: path.join(dir, 'dx-extract'),
  progressLogPath: path.join(dir, 'progress.log'),
  resultsPath: path.join(dir, 'results.json'),
  signerCN: WINDOWS_SIGNER,
  ...extra,
});
const readResults = (paths) => JSON.parse(fs.readFileSync(paths.resultsPath, 'utf8')); // no BOM, valid JSON

test('harness: signed stand-ins exiting 0 / 1603 / 3010 are accepted and run; the batch carries on past a failure', WIN_ONLY, () => {
  const dir = nastyTemp();
  try {
    const plan = [exitsWith('vc2008-x86', 1603), exitsWith('vc2010-x86', 3010), exitsWith('vc2012-x86', 0)];
    const paths = harnessPaths(dir, plan, Object.fromEntries(plan.map((p) => [p.id, SIGNED_CMD])));
    const r = runPs(P.buildInstallScript(plan, paths), dir);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const results = readResults(paths);
    assert.deepEqual(results.map((x) => [x.id, x.exitCode, x.error]), [['vc2008-x86', 1603, null], ['vc2010-x86', 3010, null], ['vc2012-x86', 0, null]]);
    for (const x of results) {
      assert.match(x.startedAt, /^\d{4}-\d\d-\d\dT/);
      assert.ok(Date.parse(x.endedAt) >= Date.parse(x.startedAt));
    }
    const progress = fs.readFileSync(paths.progressLogPath, 'utf8').split(/\r?\n/).filter(Boolean);
    assert.deepEqual(progress.slice(0, 4), ['STARTED|vc2008-x86', 'DONE|vc2008-x86|1603', 'STARTED|vc2010-x86', 'DONE|vc2010-x86|3010']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: an UNSIGNED installer is skipped (signature changed), a missing file too, and the batch carries on', WIN_ONLY, () => {
  const dir = nastyTemp();
  try {
    const unsigned = path.join(dir, 'vc2010-x86.cmd');
    writeCmd(unsigned, `echo ran> "${path.join(dir, 'unsigned-ran.txt')}"\r\nexit /b 0`);
    const plan = [exitsWith('vc2008-x86', 0), pkg('vc2010-x86'), pkg('vc2013-x86'), exitsWith('vc2012-x86', 0)];
    const paths = harnessPaths(dir, plan, {
      'vc2008-x86': SIGNED_CMD,
      'vc2010-x86': unsigned,
      'vc2013-x86': path.join(dir, 'does-not-exist.exe'),
      'vc2012-x86': SIGNED_CMD,
    });
    const r = runPs(P.buildInstallScript(plan, paths), dir);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const results = readResults(paths);
    assert.deepEqual(results.map((x) => x.exitCode), [0, -1, -1, 0]);
    assert.match(results[1].error, /^signature changed: signature (?!Valid)\w+/);
    assert.match(results[2].error, /^signature changed:/);
    assert.equal(fs.existsSync(path.join(dir, 'unsigned-ran.txt')), false, 'the unsigned file was never executed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: the default signer CN rejects a validly signed file from another signer', WIN_ONLY, () => {
  const dir = nastyTemp();
  try {
    const plan = [exitsWith('vc2008-x86', 0)];
    const paths = harnessPaths(dir, plan, { 'vc2008-x86': SIGNED_CMD }, { signerCN: undefined }); // cmd.exe is CN=Microsoft Windows
    assert.equal(runPs(P.buildInstallScript(plan, paths), dir).status, 0);
    const [res] = readResults(paths);
    assert.equal(res.exitCode, -1);
    assert.match(res.error, /^signature changed: signed by \[Microsoft Windows\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: DirectX extracts then runs a signed DXSETUP; a swapped (unsigned) DXSETUP is skipped, not reported as installed', WIN_ONLY, () => {
  const dir = nastyTemp();
  try {
    const dx = pkg('directx-jun2010');
    const files = { 'directx-jun2010': SIGNED_CMD }; // `cmd /Q /T:<dir> /C` exits 0, standing in for a successful extraction
    const run = (setupSource, name) => {
      const sub = path.join(dir, name);
      fs.mkdirSync(path.join(sub, 'dx-extract'), { recursive: true });
      setupSource(path.join(sub, 'dx-extract', 'DXSETUP.exe'));
      const paths = harnessPaths(sub, [dx], files);
      assert.equal(runPs(P.buildInstallScript([dx], paths), sub).status, 0);
      assert.equal(fs.existsSync(paths.extractDir), false, 'extract dir is removed afterwards');
      return readResults(paths)[0];
    };
    // Accept: whoami.exe (signed) is run with /silent and ends on its own; it is not -1 and has no error.
    const ok = run((dest) => fs.copyFileSync(path.join(SYS32, 'whoami.exe'), dest), 'ok');
    assert.equal(ok.error, null);
    assert.notEqual(ok.exitCode, -1);
    // Reject: the extraction succeeded (0) but DXSETUP is unsigned. Must be -1 + error, never 0.
    const swapped = run((dest) => fs.writeFileSync(dest, 'MZ not a real exe'), 'swapped');
    assert.equal(swapped.exitCode, -1);
    assert.match(swapped.error, /^signature changed:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: a failed extraction never runs DXSETUP', WIN_ONLY, () => {
  const dir = nastyTemp();
  try {
    const dx = { ...pkg('directx-jun2010'), installer: { ...pkg('directx-jun2010').installer, extractArgs: ['/c', 'exit', '7'] } };
    const paths = harnessPaths(dir, [dx], { 'directx-jun2010': SIGNED_CMD });
    fs.mkdirSync(paths.extractDir, { recursive: true });
    fs.copyFileSync(path.join(SYS32, 'whoami.exe'), path.join(paths.extractDir, 'DXSETUP.exe')); // present, but must not run
    assert.equal(runPs(P.buildInstallScript([dx], paths), dir).status, 0);
    const results = readResults(paths);
    assert.equal(results.length, 1, 'a single result is still a JSON array');
    assert.equal(results[0].exitCode, 7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('harness: signature script reports Valid for a Microsoft-signed file and NotSigned for a text file', WIN_ONLY, () => {
  const dir = nastyTemp();
  try {
    const unsigned = path.join(dir, 'plain.exe');
    fs.writeFileSync(unsigned, 'not an executable');
    const signed = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');
    const out = path.join(dir, 'signatures.json');
    const r = runPs(P.buildSignatureScript([{ id: 'signed', path: signed }, { id: 'unsigned', path: unsigned }, { id: 'gone', path: path.join(dir, 'nope.exe') }], out), dir);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const sigs = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(sigs.find((s) => s.id === 'signed').status, 'Valid');
    assert.match(sigs.find((s) => s.id === 'signed').subject, /^CN=/);
    assert.notEqual(sigs.find((s) => s.id === 'unsigned').status, 'Valid');
    assert.equal(P.evaluateSignature(sigs.find((s) => s.id === 'unsigned')).ok, false);
    assert.equal(P.evaluateSignature(sigs.find((s) => s.id === 'gone')).ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- orchestrator (all side effects faked) --------------------------------------------------

const GOOD_SIG = { status: 'Valid', subject: 'CN=Microsoft Corporation, O=Microsoft Corporation, C=US', message: 'ok' };

// A scripted environment. `elevated` decides what the (fake) elevated run does.
function makeEnv({ missing = ['vc2008-x86'], osInfo = WIN11, sigs = {}, elevated, downloadFails = [], free = Infinity } = {}) {
  const env = {
    tmpDir: null,
    logLines: [],
    progress: [],
    downloads: [],
    elevatedScripts: [],
    evaluateCalls: 0,
    sigScriptRuns: 0,
  };
  const runPowerShell = async (body) => {
    if (body.includes('Get-AuthenticodeSignature')) {
      env.sigScriptRuns++;
      const out = [...body.matchAll(/id = '([^']+)'; path/g)].map((m) => ({ id: m[1], ...(sigs[m[1]] || GOOD_SIG) }));
      fs.writeFileSync(path.join(env.tmpDir, 'signatures.json'), JSON.stringify(out));
      return;
    }
    env.elevatedScripts.push(fs.readFileSync(path.join(env.tmpDir, 'install.ps1'), 'utf8'));
    if (elevated) await elevated(env);
  };
  env.deps = {
    evaluate: async () => {
      env.evaluateCalls++;
      return env.evaluateCalls === 1 ? statuses(missing) : statuses([]); // fresh = all installed
    },
    osInfo,
    freeBytes: () => free,
    marginBytes: 0,
    makeTempDir: () => { env.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xi-prereq-test-')); return env.tmpDir; },
    removeDir: (d) => fs.rmSync(d, { recursive: true, force: true }),
    extractRoot: 'C:\\Windows\\Temp',
    download: async (url, dest, onProgress) => {
      env.downloads.push(url);
      if (downloadFails.some((id) => url === pkg(id).installer.url)) throw new Error('HTTP 503');
      onProgress(5, 10);
      fs.writeFileSync(dest, 'x');
    },
    runPowerShell,
    onProgress: (percent, detail) => env.progress.push([percent, detail]),
    log: (line) => env.logLines.push(line),
  };
  return env;
}
const writeResults = (env, entries) => fs.writeFileSync(path.join(env.tmpDir, 'results.json'), '\uFEFF' + JSON.stringify(entries));
const entry = (id, exitCode, error = null) => ({ id, exitCode, startedAt: 'a', endedAt: 'b', error });

test('installer: happy path downloads, verifies, runs once elevated, classifies, re-checks, cleans up', async () => {
  const env = makeEnv({
    missing: ['vc2008-x86', 'vc2010-x86'],
    elevated: (e) => writeResults(e, [entry('vc2008-x86', 0), entry('vc2010-x86', 3010)]),
  });
  const out = await P.createPrereqInstaller(env.deps)();
  assert.equal(out.error, null);
  assert.equal(out.cancelled, false);
  assert.equal(out.restartRecommended, true);
  assert.deepEqual(out.results.map((r) => [r.id, r.state, r.exitCode]), [['vc2008-x86', 'installed', 0], ['vc2010-x86', 'restart', 3010]]);
  assert.equal(env.elevatedScripts.length, 1, 'one elevated run for the whole batch');
  assert.equal(env.evaluateCalls, 2, 'evaluated before and after');
  assert.ok(out.status.every((s) => s.status === 'installed'), 'returns the fresh status');
  assert.equal(fs.existsSync(env.tmpDir), false, 'temp folder removed');
  assert.deepEqual(env.progress[env.progress.length - 1], [100, 'Done']);
  assert.ok(env.logLines.some((l) => /^SIGNATURE vc2008-x86 .*accepted/.test(l)));
  assert.ok(env.logLines.some((l) => /^DOWNLOAD vc2008-x86 https:\/\/download\.microsoft\.com/.test(l)));
  assert.ok(env.logLines.some((l) => /^EXIT vc2010-x86 code=3010 -> restart/.test(l)));
});

test('installer: nothing to do returns an empty result and a fresh status, creating no temp folder', async () => {
  const env = makeEnv({ missing: [] });
  const out = await P.createPrereqInstaller(env.deps)();
  assert.deepEqual(out.results, []);
  assert.equal(out.error, null);
  assert.ok(out.status);
  assert.equal(env.tmpDir, null);
  assert.equal(env.downloads.length, 0);
});

test('installer: a file that fails the signature check is never put in the elevated script', async () => {
  const env = makeEnv({
    missing: ['vc2008-x86', 'vc2010-x86'],
    sigs: { 'vc2008-x86': { status: 'NotSigned', subject: null, message: 'no signature' } },
    elevated: (e) => writeResults(e, [entry('vc2010-x86', 0)]),
  });
  const out = await P.createPrereqInstaller(env.deps)();
  const bad = out.results.find((r) => r.id === 'vc2008-x86');
  assert.equal(bad.state, 'failed');
  assert.match(bad.message, /Not run — failed signature check/);
  assert.equal(out.results.find((r) => r.id === 'vc2010-x86').state, 'installed');
  assert.ok(!env.elevatedScripts[0].includes('vc2008-x86'));
  assert.ok(env.elevatedScripts[0].includes('vc2010-x86'));
});

test('installer: when every signature fails there is no elevation prompt at all', async () => {
  const env = makeEnv({ sigs: { 'vc2008-x86': { status: 'HashMismatch', subject: GOOD_SIG.subject, message: 'tampered' } } });
  const out = await P.createPrereqInstaller(env.deps)();
  assert.equal(out.results[0].state, 'failed');
  assert.equal(env.elevatedScripts.length, 0);
});

test('installer: if the signature check itself cannot run, nothing is run unverified', async () => {
  const env = makeEnv();
  env.deps.runPowerShell = async () => { throw new Error('powershell blocked'); };
  const out = await P.createPrereqInstaller(env.deps)();
  assert.equal(out.results[0].state, 'failed');
  assert.match(out.results[0].message, /Signature check could not run: powershell blocked/);
});

test('installer: UAC declined is a calm "cancelled" with no error, temp cleaned, fresh status returned', async () => {
  const env = makeEnv({
    elevated: () => { const e = new Error('PowerShell exited with code 1223'); e.exitCode = 1223; throw e; },
  });
  const out = await P.createPrereqInstaller(env.deps)();
  assert.equal(out.cancelled, true);
  assert.equal(out.error, null);
  assert.deepEqual(out.results.map((r) => r.state), ['cancelled']);
  assert.equal(out.restartRecommended, false);
  assert.equal(fs.existsSync(env.tmpDir), false);
  assert.ok(out.status);
  assert.equal(env.progress[env.progress.length - 1][1], 'Cancelled');
});

test('installer: a retry after a decline works (single-flight flag released)', async () => {
  let declines = 1;
  const env = makeEnv({
    elevated: (e) => {
      if (declines-- > 0) { const err = new Error('declined'); err.exitCode = 1223; throw err; }
      writeResults(e, [entry('vc2008-x86', 0)]);
    },
  });
  const install = P.createPrereqInstaller(env.deps);
  assert.equal((await install()).cancelled, true);
  env.evaluateCalls = 0;
  const second = await install();
  assert.equal(second.cancelled, false);
  assert.equal(second.results[0].state, 'installed');
});

test('installer: a second call while one is running is rejected with a clear message', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const env = makeEnv({ elevated: async (e) => { await gate; writeResults(e, [entry('vc2008-x86', 0)]); } });
  const install = P.createPrereqInstaller(env.deps);
  const first = install();
  await new Promise((r) => setTimeout(r, 50));
  const second = await install();
  assert.match(second.error, /already running/);
  assert.deepEqual(second.results, []);
  release();
  const done = await first;
  assert.equal(done.results[0].state, 'installed');
  assert.equal((await install()).error, null, 'allowed again afterwards');
});

test('installer: not enough disk space stops before downloading anything', async () => {
  const env = makeEnv({ free: 1024 });
  const out = await P.createPrereqInstaller(env.deps)();
  assert.match(out.error, /Not enough free disk space/);
  assert.equal(env.downloads.length, 0);
  assert.equal(fs.existsSync(env.tmpDir), false);
  assert.ok(out.status, 'still returns a fresh status');
});

test('installer: a failed download fails only that package', async () => {
  const env = makeEnv({
    missing: ['vc2008-x86', 'vc2010-x86'],
    downloadFails: ['vc2008-x86'],
    elevated: (e) => writeResults(e, [entry('vc2010-x86', 0)]),
  });
  const out = await P.createPrereqInstaller(env.deps)();
  assert.equal(out.results.find((r) => r.id === 'vc2008-x86').state, 'failed');
  assert.match(out.results.find((r) => r.id === 'vc2008-x86').message, /Download failed: HTTP 503/);
  assert.equal(out.results.find((r) => r.id === 'vc2010-x86').state, 'installed');
});

test('installer: failed exit codes carry the code and the script error text', async () => {
  const env = makeEnv({
    missing: ['vc2008-x86', 'net48'],
    elevated: (e) => writeResults(e, [entry('vc2008-x86', 1603), entry('net481', -1, 'The system cannot find the file specified')]),
  });
  const out = await P.createPrereqInstaller(env.deps)();
  const vc = out.results.find((r) => r.id === 'vc2008-x86');
  assert.deepEqual([vc.state, vc.exitCode], ['failed', 1603]);
  assert.match(vc.message, /1603/);
  const net = out.results.find((r) => r.id === 'net481');
  assert.equal(net.state, 'failed');
  assert.match(net.message, /cannot find the file/);
});

test('installer: elevation crashes without a result file -> failed, not installed', async () => {
  const env = makeEnv({ elevated: () => { throw new Error('PowerShell exited with code 1'); } });
  const out = await P.createPrereqInstaller(env.deps)();
  assert.equal(out.cancelled, false);
  assert.equal(out.results[0].state, 'failed');
  assert.match(out.results[0].message, /PowerShell exited with code 1/);
});

test('installer: unknown requested id is reported as an error, not thrown, and logged as ONE line (no stack)', async () => {
  const env = makeEnv();
  const out = await P.createPrereqInstaller(env.deps)(['bogus']);
  assert.match(out.error, /Unknown prerequisite id: bogus/);
  assert.ok(out.status);
  assert.deepEqual(env.logLines.filter((l) => l.startsWith('ERROR')), ['ERROR Unknown prerequisite id: bogus']);
  assert.ok(!env.logLines.some((l) => /\n\s+at /.test(l)), 'no stack trace anywhere in the log');
});

test('installer: not enough disk space is also a one-line ERROR', async () => {
  const env = makeEnv({ free: 1000 });
  await P.createPrereqInstaller(env.deps)();
  const errLines = env.logLines.filter((l) => l.startsWith('ERROR'));
  assert.equal(errLines.length, 1);
  assert.ok(!errLines[0].includes('\n'), 'one line');
  assert.match(errLines[0], /^ERROR Not enough free disk space/);
});

test('installer: a real exception (not a user-level error) keeps its stack in the log', async () => {
  const env = makeEnv();
  env.deps.makeTempDir = () => { throw new Error('EPERM: cannot create temp'); };
  const out = await P.createPrereqInstaller(env.deps)();
  assert.match(out.error, /EPERM/);
  assert.match(env.logLines.find((l) => l.startsWith('ERROR')), /EPERM[\s\S]*\n\s+at /);
});

test('installer: an installer the elevated script refused (signature changed) is failed with no exit code, never installed', async () => {
  const env = makeEnv({
    missing: ['vc2008-x86', 'vc2010-x86'],
    elevated: (e) => writeResults(e, [entry('vc2008-x86', -1, 'signature changed: signature NotSigned'), entry('vc2010-x86', 0)]),
  });
  const out = await P.createPrereqInstaller(env.deps)();
  const bad = out.results.find((r) => r.id === 'vc2008-x86');
  assert.deepEqual([bad.state, bad.exitCode], ['failed', null]);
  assert.match(bad.message, /^Not run — signature changed/);
  assert.equal(out.results.find((r) => r.id === 'vc2010-x86').state, 'installed');
  assert.ok(env.logLines.some((l) => l.startsWith('EXIT vc2008-x86 NOT RUN')));
});

test('installer: progress events are throttled but always include the final 100', async () => {
  const env = makeEnv({ elevated: (e) => writeResults(e, [entry('vc2008-x86', 0)]) });
  env.deps.download = async (url, dest, onProgress) => {
    for (let i = 1; i <= 1000; i++) onProgress(i, 1000); // a burst of chunk callbacks
    fs.writeFileSync(dest, 'x');
  };
  await P.createPrereqInstaller(env.deps)();
  assert.ok(env.progress.length < 40, `got ${env.progress.length} events`);
  assert.equal(env.progress[env.progress.length - 1][0], 100);
  assert.ok(env.progress.every(([p]) => p >= 0 && p <= 100));
});
