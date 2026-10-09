const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const E = require('./elevate');
const P = require('./prereqInstall');

const WIN_ONLY = { skip: process.platform !== 'win32' && 'needs powershell.exe' };

// Runs a generated script (NOT elevated) and returns what it reported through the result file.
function runBody(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xi-elevate-test-'));
  try {
    const resultPath = path.join(dir, 'result.txt');
    const scriptPath = path.join(dir, 'run.ps1');
    fs.writeFileSync(scriptPath, '\uFEFF' + E.buildElevatedScript(body, resultPath), 'utf8');
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
    let text = '';
    try { text = fs.readFileSync(resultPath, 'utf8'); } catch { /* none written */ }
    return E.parseElevatedResult(text);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('powerShellExe returns a powershell.exe path', () => {
  assert.match(E.powerShellExe(), /powershell\.exe$/i);
});

test('buildElevationScript elevates the given full path, defaulting to the bare name', () => {
  const full = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  assert.ok(P.buildElevationScript('C:\\x.ps1', { psExe: full }).includes(`$psi.FileName = '${full}'`));
  assert.ok(P.buildElevationScript('C:\\x.ps1').includes("$psi.FileName = 'powershell.exe'"));
});

test('parseElevatedResult reads OK, ERR and a missing result', () => {
  assert.deepEqual(E.parseElevatedResult('OK\r\n'), { success: true });
  assert.deepEqual(E.parseElevatedResult('\uFEFFOK'), { success: true });
  assert.deepEqual(E.parseElevatedResult('ERR: Operation not permitted'), { success: false, error: 'Operation not permitted' });
  assert.equal(E.parseElevatedResult('').success, false);
  assert.equal(E.parseElevatedResult(undefined).success, false);
});

test('buildRegAddBody checks the exit code after every reg add', () => {
  const s = E.buildRegAddBody("HKLM\\SOFTWARE\\O'Brien", [{ key: 'A', value: 1 }, { key: 'B', value: 2 }]);
  assert.equal((s.match(/^\s+reg add /gm) || []).length, 2);
  assert.equal((s.match(/\$LASTEXITCODE -ne 0/g) || []).length, 2);
  assert.ok(s.includes("'HKLM\\SOFTWARE\\O''Brien' /v A /t REG_DWORD /d 1 /f"));
});

test('a body that works reports OK', WIN_ONLY, () => {
  assert.deepEqual(runBody("  $x = 1 + 1"), { success: true });
});

test('a body that throws reports ERR with the message, not OK', WIN_ONLY, () => {
  const r = runBody("  throw 'boom happened'");
  assert.equal(r.success, false);
  assert.match(r.error, /boom happened/);
});

test('reg add body: success writes the value; failure (bad hive) is reported', WIN_ONLY, () => {
  const key = 'HKCU\\Software\\XiLauncherElevateTest';
  try {
    assert.deepEqual(runBody(E.buildRegAddBody(key, [{ key: 'TestVal', value: 7 }])), { success: true });
    const q = spawnSync('reg', ['query', key, '/v', 'TestVal'], { encoding: 'utf8', windowsHide: true });
    assert.match(q.stdout, /0x7/);
  } finally {
    spawnSync('reg', ['delete', key, '/f'], { windowsHide: true });
  }
  const bad = runBody(E.buildRegAddBody('NOTAHIVE\\Software\\X', [{ key: 'TestVal', value: 7 }]));
  assert.equal(bad.success, false);
  assert.match(bad.error, /reg add TestVal failed/);
});
