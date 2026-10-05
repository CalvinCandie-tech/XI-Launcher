const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('./updateScript');

const OPTS = {
  exePath: 'D:\\Games\\XI Launcher\\XI Launcher.exe',
  sourceDir: 'C:\\Temp\\xi-launcher-update-1\\extracted',
  appRoot: 'D:\\Games\\XI Launcher',
  tmpDir: 'C:\\Temp\\xi-launcher-update-1',
  errorMarker: 'D:\\Games\\XI Launcher\\runtime\\update-error.log',
  taskName: 'XILauncherUpdate_1',
};

const robocopyLine = (script) => script.split('\r\n').find(l => /robocopy/i.test(l));

test('self-update never deletes files in the launcher folder', () => {
  // /MIR (and /PURGE) delete everything in the launcher folder that is not in the
  // release — that wiped a player's sandboxed FFXI copy kept next to the launcher.
  const line = robocopyLine(U.buildUpdateScript(OPTS));
  assert.ok(line, 'script runs robocopy');
  assert.doesNotMatch(line, /\/MIR\b/i);
  assert.doesNotMatch(line, /\/PURGE\b/i);
  assert.match(line, /\/E\b/);
});

test('copies the extracted release over the launcher folder, keeping runtime and config', () => {
  const line = robocopyLine(U.buildUpdateScript(OPTS));
  assert.ok(line.includes("'C:\\Temp\\xi-launcher-update-1\\extracted' 'D:\\Games\\XI Launcher'"));
  assert.match(line, /\/XD runtime node_modules/);
  assert.match(line, /\/XF \*\.json \*\.log/);
});

test('waits for the launcher, relaunches it and removes its scheduled task', () => {
  const script = U.buildUpdateScript(OPTS);
  assert.ok(script.includes("Get-Process -Name 'XI Launcher'"));
  assert.ok(script.includes("Start-Process -FilePath 'D:\\Games\\XI Launcher\\XI Launcher.exe'"));
  assert.ok(script.includes("schtasks /delete /tn 'XILauncherUpdate_1' /f"));
});

test('single quotes in paths are escaped for PowerShell', () => {
  const script = U.buildUpdateScript({ ...OPTS, appRoot: "D:\\Bob's Games\\XI" });
  assert.ok(script.includes("'D:\\Bob''s Games\\XI'"));
});
