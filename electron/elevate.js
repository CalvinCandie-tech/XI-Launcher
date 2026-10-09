// Running one command elevated (a single UAC prompt) and finding out whether it worked.
//
// Several features used `powershell -Command "Start-Process powershell ... -Verb RunAs"` through
// cmd.exe. That nested form failed on one player's PC with "No application is associated with the
// specified file for this operation", and it also reported success whether or not the elevated
// command did anything. These pieces replace it: main.js wraps buildElevatedScript in the same
// Process.Start elevation wrapper prereqInstall uses (prereqInstall.buildElevationScript) and reads
// the outcome back from a result file, because the elevated process's exit code never reaches us.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { psQuote, buildElevationScript, isUacDeclined } = require('./prereqInstall');

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

// Builds runElevated(body, timeoutMs) around main.js's runPowerShellFile (which runs a script from
// a temp .ps1 and rejects with err.exitCode on a non-zero exit).
// -> { success } | { success: false, error, declined? }
function createRunElevated(runPowerShellFile) {
  return async function runElevated(body, timeoutMs = 120000) {
    let workDir;
    try {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xi-elevated-'));
      const scriptPath = path.join(workDir, 'run.ps1');
      const resultPath = path.join(workDir, 'result.txt');
      // UTF-8 BOM so PowerShell reads non-ASCII paths correctly.
      fs.writeFileSync(scriptPath, '﻿' + buildElevatedScript(body, resultPath), 'utf8');
      await runPowerShellFile(buildElevationScript(scriptPath, { psExe: powerShellExe() }), timeoutMs);
      let resultText = '';
      try { resultText = fs.readFileSync(resultPath, 'utf8'); } catch { /* script never finished */ }
      return parseElevatedResult(resultText);
    } catch (e) {
      if (isUacDeclined(e)) return { success: false, declined: true, error: 'UAC prompt was cancelled' };
      return { success: false, error: e.message || String(e) };
    } finally {
      if (workDir) { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} }
    }
  };
}

module.exports = { powerShellExe, buildElevatedScript, parseElevatedResult, buildRegAddBody, createRunElevated };
