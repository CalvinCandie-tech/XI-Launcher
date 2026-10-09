// Running one command elevated (a single UAC prompt) and finding out whether it worked.
//
// Several features used `powershell -Command "Start-Process powershell ... -Verb RunAs"` through
// cmd.exe. That nested form failed on one player's PC with "No application is associated with the
// specified file for this operation", and it also reported success whether or not the elevated
// command did anything. These pieces replace it: main.js wraps buildElevatedScript in the same
// Process.Start elevation wrapper prereqInstall uses (prereqInstall.buildElevationScript) and reads
// the outcome back from a result file, because the elevated process's exit code never reaches us.
const fs = require('fs');
const path = require('path');
const { psQuote } = require('./prereqInstall');

// Full path to Windows PowerShell 5.1; the bare name only if that file is missing.
function powerShellExe() {
  const full = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(full) ? full : 'powershell.exe';
}

// The script that runs elevated: `body` inside try/catch, reporting 'OK' or 'ERR: <message>' to
// resultPath. A native command (reg.exe) does not throw on failure, so a body that runs one must
// check $LASTEXITCODE itself.
function buildElevatedScript(body, resultPath) {
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    body,
    `  Set-Content -LiteralPath ${psQuote(resultPath)} -Value 'OK' -Encoding ASCII`,
    '} catch {',
    `  Set-Content -LiteralPath ${psQuote(resultPath)} -Value ('ERR: ' + $_.Exception.Message) -Encoding UTF8`,
    '}',
  ].join('\r\n');
}

// Reads what buildElevatedScript wrote. Missing/empty = the elevated script never ran to the end.
function parseElevatedResult(text) {
  const t = String(text || '').replace(/^\uFEFF/, '').trim();
  if (t === 'OK') return { success: true };
  if (t.startsWith('ERR:')) return { success: false, error: t.slice(4).trim() };
  return { success: false, error: 'The elevated step did not report a result' };
}

// `reg add` lines for DWORD values, each followed by an exit-code check (reg.exe does not throw).
// entries: [{ key, value }] already validated by the caller (VALID_REG_KEY, integer values).
function buildRegAddBody(regPath, entries) {
  return entries.map(({ key, value }) => [
    `  reg add ${psQuote(regPath)} /v ${key} /t REG_DWORD /d ${value} /f | Out-Null`,
    `  if ($LASTEXITCODE -ne 0) { throw 'reg add ${key} failed with exit code ' + $LASTEXITCODE }`,
  ].join('\r\n')).join('\r\n');
}

module.exports = { powerShellExe, buildElevatedScript, parseElevatedResult, buildRegAddBody };
