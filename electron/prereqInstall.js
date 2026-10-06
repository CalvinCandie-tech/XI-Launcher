// One-click installer engine for the prerequisites in prereqs.js. Pure script builders and
// planning plus an orchestrator whose every side effect (download, PowerShell, disk, logging) is
// injected, so it is unit-testable off Windows. No `electron` import. Design and the Microsoft
// sources behind the package data: docs/superpowers/specs/2026-10-06-prereqs-design.md.
//
// Flow: evaluate -> plan -> disk check -> download -> Authenticode check (non-elevated) -> ONE
// elevated PowerShell script runs every installer -> classify exit codes -> re-evaluate.

const fs = require('fs');
const path = require('path');
const { PACKAGES, WIN10_20H2_BUILD } = require('./prereqs');

// DirectX first (the games link against it), VC++ oldest -> newest, .NET last (longest, and the
// only one that commonly asks for a restart).
const INSTALL_ORDER = [
  'directx-jun2010',
  'vc2005-x86',
  'vc2008-x86',
  'vc2010-x86',
  'vc2012-x86',
  'vc2013-x86',
  'vc2015-2022-x86',
  'net48',
  'net481',
];

// Every .NET id collapses into ONE install, chosen by OS (see dotnetChoice). 4.0 and 4.5.2 are
// never installed: 4.8 supersedes them in place.
const DOTNET_IDS = ['net40', 'net452', 'net48', 'net481'];

const DEFAULT_CATEGORIES = ['required', 'recommended'];
const SKIP_STATUSES = ['installed', 'covered', 'unsupported'];

const UAC_DECLINED = 1223; // ERROR_CANCELLED: the user clicked No on the UAC prompt

// PowerShell treats the Unicode curly single quotes as quote characters too, so an ordinary
// '' double-up is not enough for a path like "C:\Users\O’Brien".
const psQuote = (s) => "'" + String(s).replace(/['\u2018\u2019\u201A\u201B]/g, (c) => c + c) + "'";

// Command-line fragment for CreateProcess: quote only when it contains whitespace.
const argQuote = (s) => (/\s/.test(s) ? `"${s}"` : s);

const UTF8_NO_BOM_WRITE = (target, expr) =>
  `[System.IO.File]::WriteAllText(${target}, (${expr}), (New-Object System.Text.UTF8Encoding($false)))`;

function defaultRequestedIds() {
  return PACKAGES.filter((p) => DEFAULT_CATEGORIES.includes(p.category)).map((p) => p.id);
}

// 4.8.1 where Windows can take it (Windows 10 20H2 / build 19042 and newer), otherwise 4.8. An
// unknown build never guesses upward.
function dotnetChoice(osInfo) {
  const build = osInfo && osInfo.build;
  return Number.isFinite(build) && build >= WIN10_20H2_BUILD ? 'net481' : 'net48';
}

// statusResults: evaluatePrereqs() output. Returns the catalogue packages to install, in install
// order. installed / covered / unsupported are skipped; `unknown` (a failed read) is installed,
// because every installer here is a harmless upgrade when the package is already present.
function planInstall(statusResults, requestedIds, osInfo) {
  const statusById = new Map(statusResults.map((r) => [r.id, r]));
  const pkgById = new Map(PACKAGES.map((p) => [p.id, p]));
  const wanted = new Set();
  let wantDotnet = false;

  for (const id of requestedIds) {
    if (!pkgById.has(id)) throw new Error(`Unknown prerequisite id: ${id}`);
    const status = statusById.get(id);
    if (!status) throw new Error(`No detection result for prerequisite: ${id}`);
    if (SKIP_STATUSES.includes(status.status)) continue;
    if (DOTNET_IDS.includes(id)) wantDotnet = true;
    else wanted.add(id);
  }
  if (wantDotnet) wanted.add(dotnetChoice(osInfo));

  return INSTALL_ORDER.filter((id) => wanted.has(id)).map((id) => pkgById.get(id));
}

// The script that runs ELEVATED. paths = { files: {id: installerPath}, extractDir, progressLogPath,
// resultsPath }. Runs every package in order, never stops on a failure, and rewrites resultsPath
// after each package as [{id, exitCode, startedAt, endedAt, error}] so a crash still leaves a
// record. progressLogPath gets STARTED|id / DONE|id|code lines for live UI progress.
function buildInstallScript(plan, paths) {
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    '$results = New-Object System.Collections.ArrayList',
    `$progressLog = ${psQuote(paths.progressLogPath)}`,
    `$resultsPath = ${psQuote(paths.resultsPath)}`,
    'function Add-ProgressLine([string]$line) { try { Add-Content -LiteralPath $progressLog -Value $line } catch {} }',
    'function Save-Results {',
    `  ${UTF8_NO_BOM_WRITE('$resultsPath', 'ConvertTo-Json -InputObject @($results) -Depth 3')}`,
    '}',
    'function Invoke-Installer([string]$file, [string]$arguments) {',
    '  if ($arguments) { $p = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru }',
    '  else { $p = Start-Process -FilePath $file -Wait -PassThru }',
    '  return $p.ExitCode',
    '}',
  ];

  for (const pkg of plan) {
    const file = paths.files[pkg.id];
    if (!file) throw new Error(`No downloaded file for ${pkg.id}`);
    const inst = pkg.installer;

    lines.push('', `# ${pkg.id}`, `$id = ${psQuote(pkg.id)}`, "Add-ProgressLine ('STARTED|' + $id)");
    lines.push('$startedAt = (Get-Date).ToString(\'o\')', '$exitCode = -1', '$errorText = $null', 'try {');
    if (inst.kind === 'dx-sfx') {
      // Win32 cabinet self-extractor, then DXSETUP from the extracted folder. The extraction
      // exit code wins when non-zero; DXSETUP never runs from a failed extraction.
      const extractArgs = inst.extractArgs.map((a) => a.replace('{dir}', argQuote(paths.extractDir))).join(' ');
      lines.push(
        `  New-Item -ItemType Directory -Force -Path ${psQuote(paths.extractDir)} | Out-Null`,
        `  $exitCode = Invoke-Installer ${psQuote(file)} ${psQuote(extractArgs)}`,
        '  if ($exitCode -eq 0) {',
        `    $setup = Join-Path ${psQuote(paths.extractDir)} ${psQuote(inst.setupExe)}`,
        "    if (-not (Test-Path -LiteralPath $setup)) { throw 'DXSETUP.exe was not extracted' }",
        `    $exitCode = Invoke-Installer $setup ${psQuote(inst.args.join(' '))}`,
        '  }',
      );
    } else {
      lines.push(`  $exitCode = Invoke-Installer ${psQuote(file)} ${psQuote(inst.args.join(' '))}`);
    }
    lines.push('} catch {', '  $errorText = $_.Exception.Message', '}');
    if (inst.kind === 'dx-sfx') {
      lines.push(`Remove-Item -LiteralPath ${psQuote(paths.extractDir)} -Recurse -Force -ErrorAction SilentlyContinue`);
    }
    lines.push(
      '[void]$results.Add([ordered]@{ id = $id; exitCode = $exitCode; startedAt = $startedAt; endedAt = (Get-Date).ToString(\'o\'); error = $errorText })',
      "Add-ProgressLine ('DONE|' + $id + '|' + $exitCode)",
      'Save-Results',
    );
  }
  lines.push('', 'Save-Results');
  return lines.join('\r\n');
}

// The NON-elevated wrapper that raises the single UAC prompt and waits. A declined prompt exits
// 1223 so the caller can tell it from a real failure.
function buildElevationScript(scriptPath) {
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ${psQuote(`"${scriptPath}"`)}) -Verb RunAs -Wait -WindowStyle Hidden`,
    '} catch {',
    '  $native = $null',
    '  if ($_.Exception -is [System.ComponentModel.Win32Exception]) { $native = $_.Exception.NativeErrorCode }',
    `  if ($native -eq ${UAC_DECLINED}) { exit ${UAC_DECLINED} }`,
    '  throw',
    '}',
  ].join('\r\n');
}

function isUacDeclined(err) {
  return !!err && (err.exitCode === UAC_DECLINED || /canceled by the user|cancelled by the user/i.test(err.message || ''));
}

// files: [{id, path}]. Writes [{id, status, subject, message}] to outPath. Runs non-elevated,
// before anything is executed.
function buildSignatureScript(files, outPath) {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$out = New-Object System.Collections.ArrayList',
    '$items = @(',
    ...files.map((f) => `  @{ id = ${psQuote(f.id)}; path = ${psQuote(f.path)} }`),
    ')',
    'foreach ($item in $items) {',
    "  $status = 'Error'; $subject = $null; $message = $null",
    '  try {',
    '    $sig = Get-AuthenticodeSignature -LiteralPath $item.path',
    '    $status = [string]$sig.Status',
    '    $message = $sig.StatusMessage',
    '    if ($sig.SignerCertificate) { $subject = $sig.SignerCertificate.Subject }',
    '  } catch { $message = $_.Exception.Message }',
    '  [void]$out.Add([ordered]@{ id = $item.id; status = $status; subject = $subject; message = $message })',
    '}',
    UTF8_NO_BOM_WRITE(psQuote(outPath), 'ConvertTo-Json -InputObject @($out) -Depth 3'),
  ].join('\r\n');
}

// The CN of an X.500 subject such as `CN=Microsoft Corporation, O=Microsoft Corporation, C=US`.
// Handles a quoted value (`CN="Foo, Inc."`).
function parseSubjectCN(subject) {
  const m = String(subject || '').match(/(?:^|,\s*)CN=("(?:[^"]|"")*"|[^,]*)/);
  if (!m) return null;
  const v = m[1].trim();
  return v.startsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v;
}

// The integrity gate: a Valid Authenticode signature whose signer CN is exactly Microsoft
// Corporation. Deliberately NOT issuer, certificate expiry or file hash (many valid Microsoft
// certificates have expired and the 2015-2022 URL is versionless; see the spec).
function evaluateSignature(sig) {
  if (!sig || sig.status !== 'Valid') {
    return { ok: false, reason: `signature ${sig && sig.status ? sig.status : 'missing'}${sig && sig.message ? ` (${sig.message})` : ''}` };
  }
  const cn = parseSubjectCN(sig.subject);
  if (cn !== 'Microsoft Corporation') return { ok: false, reason: `signed by "${cn || sig.subject || 'unknown'}", not Microsoft Corporation` };
  return { ok: true, reason: 'Valid, CN=Microsoft Corporation' };
}

// -> { state: 'installed' | 'restart' | 'failed', message }. The accepted codes are the
// per-package lists in the catalogue (1638 "newer already installed" counts only for VC++).
function classifyExitCode(id, code) {
  const pkg = PACKAGES.find((p) => p.id === id);
  if (!pkg || !pkg.exitCodes) throw new Error(`No exit codes for prerequisite: ${id}`);
  if (typeof code !== 'number' || !Number.isInteger(code)) return { state: 'failed', message: 'No exit code was recorded' };
  if (pkg.exitCodes.reboot.includes(code)) return { state: 'restart', message: `Installed — restart recommended (code ${code})` };
  if (pkg.exitCodes.ok.includes(code)) {
    return { state: 'installed', message: code === 1638 ? 'A newer version is already installed (1638)' : 'Installed' };
  }
  const known = {
    1602: 'Setup was cancelled (1602)',
    1603: 'Setup reported a fatal error (1603)',
    1618: 'Another installation is already in progress (1618)',
    5100: 'This PC does not meet the requirements for this package (5100)',
  };
  return { state: 'failed', message: known[code] || `Setup failed with exit code ${code}` };
}

const stripBom = (s) => String(s).replace(/^\uFEFF/, '');

const DOWNLOAD_END = 60;
const SIGNATURE_END = 65;
const INSTALL_END = 95;

// deps (all injected; see main.js for the real ones):
//   evaluate() -> Promise<status[]>          osInfo { build }
//   freeBytes(dir)       marginBytes         makeTempDir() -> dir       removeDir(dir)
//   extractRoot          where the DirectX self-extractor unpacks (a path without spaces)
//   download(url, dest, onProgress(received, total)) -> Promise
//   runPowerShell(scriptBody, timeoutMs) -> Promise; rejects with err.exitCode when it knows it
//   onProgress(percent, detail)   log(line)
// Returns install(requestedIds?) -> Promise<{ results, restartRecommended, cancelled, error, status }>.
// It never rejects: a failure of the whole run is reported in `error`.
function createPrereqInstaller(deps) {
  let running = false;

  return async function install(requestedIds) {
    const emptyResult = (error) => ({ results: [], restartRecommended: false, cancelled: false, error, status: null });
    if (running) return emptyResult('An installation is already running. Wait for it to finish.');
    running = true;

    const log = (line) => { try { deps.log(line); } catch { /* logging must never break an install */ } };
    let lastEmit = 0;
    const emit = (percent, detail, force) => {
      const now = Date.now();
      if (!force && now - lastEmit < 250) return;
      lastEmit = now;
      try { deps.onProgress(Math.round(percent), detail); } catch { /* renderer may be gone */ }
    };

    const results = [];
    let cancelled = false;
    let error = null;
    let tmpDir = null;
    let pollTimer = null;
    try {
      try {
        const before = await deps.evaluate();
        const ids = Array.isArray(requestedIds) && requestedIds.length ? requestedIds : defaultRequestedIds();
        const plan = planInstall(before, ids, deps.osInfo);
        log(`START requested=[${ids.join(', ')}] plan=[${plan.map((p) => p.id).join(', ')}] build=${deps.osInfo.build}`);

        if (plan.length > 0) {
          const needed = plan.reduce((sum, p) => sum + p.installer.sizeBytes * (p.installer.kind === 'dx-sfx' ? 2 : 1), 0) + deps.marginBytes;
          tmpDir = deps.makeTempDir();
          const free = deps.freeBytes(tmpDir);
          if (free < needed) {
            const mb = (n) => Math.ceil(n / 1048576);
            throw new Error(`Not enough free disk space to download the installers: need about ${mb(needed)} MB, only ${mb(free)} MB free.`);
          }

          // 1. Download every package. A failed download fails only that package.
          const downloaded = [];
          for (let i = 0; i < plan.length; i++) {
            const pkg = plan[i];
            const dest = path.join(tmpDir, `${pkg.id}.exe`);
            const base = (DOWNLOAD_END * i) / plan.length;
            const span = DOWNLOAD_END / plan.length;
            emit(base, `Downloading ${pkg.name}...`, true);
            try {
              await deps.download(pkg.installer.url, dest, (received, total) => {
                if (total > 0) {
                  emit(base + (received / total) * span,
                    `Downloading ${pkg.name}... ${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
                }
              });
              log(`DOWNLOAD ${pkg.id} ${pkg.installer.url} -> ok`);
              downloaded.push({ pkg, path: dest });
            } catch (e) {
              log(`DOWNLOAD ${pkg.id} ${pkg.installer.url} -> FAILED ${e.message}`);
              results.push({ id: pkg.id, name: pkg.name, state: 'failed', exitCode: null, message: `Download failed: ${e.message}` });
            }
          }

          // 2. Authenticode, still non-elevated. Anything that does not pass is never run.
          const runnable = [];
          if (downloaded.length > 0) {
            emit(DOWNLOAD_END, 'Verifying Microsoft signatures...', true);
            const sigPath = path.join(tmpDir, 'signatures.json');
            let sigs = null;
            try {
              await deps.runPowerShell(buildSignatureScript(downloaded.map((d) => ({ id: d.pkg.id, path: d.path })), sigPath), 180000);
              sigs = JSON.parse(stripBom(fs.readFileSync(sigPath, 'utf8')));
            } catch (e) {
              log(`SIGNATURE check could not run: ${e.message}`);
              for (const d of downloaded) {
                results.push({ id: d.pkg.id, name: d.pkg.name, state: 'failed', exitCode: null, message: `Signature check could not run: ${e.message}` });
              }
            }
            if (sigs) {
              for (const d of downloaded) {
                const sig = sigs.find((s) => s.id === d.pkg.id);
                const verdict = evaluateSignature(sig);
                log(`SIGNATURE ${d.pkg.id} status=${sig ? sig.status : 'none'} subject=${sig && sig.subject ? sig.subject : '-'} -> ${verdict.ok ? 'accepted' : 'REJECTED ' + verdict.reason}`);
                if (verdict.ok) runnable.push(d);
                else results.push({ id: d.pkg.id, name: d.pkg.name, state: 'failed', exitCode: null, message: `Not run — failed signature check: ${verdict.reason}` });
              }
            }
          }

          // 3. One elevated script for the whole batch (one UAC prompt).
          if (runnable.length > 0) {
            emit(SIGNATURE_END, 'Requesting administrator permission...', true);
            const progressLogPath = path.join(tmpDir, 'progress.log');
            const resultsPath = path.join(tmpDir, 'results.json');
            const scriptPath = path.join(tmpDir, 'install.ps1');
            fs.writeFileSync(progressLogPath, '');
            const files = Object.fromEntries(runnable.map((d) => [d.pkg.id, d.path]));
            const extractDir = path.join(deps.extractRoot, `xi-launcher-dx-${path.basename(tmpDir)}`);
            // UTF-8 BOM so PowerShell reads non-ASCII profile names correctly.
            fs.writeFileSync(scriptPath, '\uFEFF' + buildInstallScript(runnable.map((d) => d.pkg), { files, extractDir, progressLogPath, resultsPath }), 'utf8');

            let consumed = 0;
            let finished = 0;
            pollTimer = setInterval(() => {
              try {
                const content = fs.readFileSync(progressLogPath, 'utf8');
                // Add-Content is not atomic against this read: drop a trailing fragment.
                let lines = content.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
                if (!content.endsWith('\n') && lines.length > 0) lines = lines.slice(0, -1);
                for (let i = consumed; i < lines.length; i++) {
                  const [marker, id] = lines[i].split('|');
                  const pkg = runnable.find((d) => d.pkg.id === id);
                  if (!pkg) continue;
                  if (marker === 'DONE') finished++;
                  const pct = SIGNATURE_END + ((INSTALL_END - SIGNATURE_END) * finished) / runnable.length;
                  emit(pct, marker === 'STARTED'
                    ? `Installing ${pkg.pkg.name} (${finished + 1} of ${runnable.length})... please wait`
                    : `${pkg.pkg.name} finished`, true);
                }
                consumed = lines.length;
              } catch { /* log not there yet */ }
            }, 500);

            let runError = null;
            try {
              await deps.runPowerShell(buildElevationScript(scriptPath), 30 * 60 * 1000);
            } catch (e) {
              runError = e;
            }
            clearInterval(pollTimer);
            pollTimer = null;

            if (isUacDeclined(runError)) {
              cancelled = true;
              log('ELEVATION declined by the user (UAC) — nothing was installed');
              for (const d of runnable) {
                results.push({ id: d.pkg.id, name: d.pkg.name, state: 'cancelled', exitCode: null, message: 'Not installed — administrator permission was declined' });
              }
            } else {
              let entries = [];
              try { entries = JSON.parse(stripBom(fs.readFileSync(resultsPath, 'utf8'))); } catch { /* none recorded */ }
              if (runError) log(`ELEVATED run error: ${runError.message}`);
              for (const d of runnable) {
                const entry = Array.isArray(entries) ? entries.find((e) => e.id === d.pkg.id) : null;
                if (!entry) {
                  const why = runError ? runError.message : 'the install script did not record a result';
                  results.push({ id: d.pkg.id, name: d.pkg.name, state: 'failed', exitCode: null, message: `Not installed — ${why}` });
                  continue;
                }
                const verdict = classifyExitCode(d.pkg.id, entry.exitCode);
                const message = entry.error ? `${verdict.message}: ${entry.error}` : verdict.message;
                log(`EXIT ${d.pkg.id} code=${entry.exitCode} -> ${verdict.state}${entry.error ? ' error=' + entry.error : ''}`);
                results.push({ id: d.pkg.id, name: d.pkg.name, state: verdict.state, exitCode: entry.exitCode, message });
              }
            }
          }
        }
      } catch (e) {
        error = e.message || String(e);
        log(`ERROR ${e.stack || error}`);
      }
    } finally {
      if (pollTimer) clearInterval(pollTimer);
      if (tmpDir) { try { deps.removeDir(tmpDir); } catch (e) { log(`cleanup failed: ${e.message}`); } }
    }

    // Detection, not exit codes, is the source of truth: always hand back a fresh status.
    emit(INSTALL_END, 'Checking what is installed...', true);
    let status = null;
    try {
      status = await deps.evaluate();
      log('STATUS ' + status.map((s) => `${s.id}=${s.status}`).join(' '));
    } catch (e) {
      log(`STATUS re-check failed: ${e.message}`);
    }
    const restartRecommended = results.some((r) => r.state === 'restart');
    log(`END cancelled=${cancelled} restartRecommended=${restartRecommended} error=${error || '-'}`);
    emit(100, cancelled ? 'Cancelled' : 'Done', true);
    running = false;
    return { results, restartRecommended, cancelled, error, status };
  };
}

module.exports = {
  INSTALL_ORDER,
  UAC_DECLINED,
  defaultRequestedIds,
  planInstall,
  buildInstallScript,
  buildElevationScript,
  buildSignatureScript,
  parseSubjectCN,
  evaluateSignature,
  classifyExitCode,
  isUacDeclined,
  createPrereqInstaller,
};
