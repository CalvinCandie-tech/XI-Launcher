// The PowerShell script the launcher's self-update hands to a scheduled task: wait for the
// launcher to exit, copy the extracted release over its folder, relaunch. Pure string
// building, unit tested with `npm run test:electron`.

// PowerShell single-quoted strings literal-escape '$' and backticks,
// so we only need to double-up embedded single quotes for safety.
const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function buildUpdateScript({ exePath, sourceDir, appRoot, tmpDir, errorMarker, taskName }) {
  const exeBaseName = require('path').win32.basename(exePath).replace(/\.exe$/i, '');
  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    // Wait up to 30s for the launcher to exit. Get-Process by base name
    // (no .exe). If multiple instances are running (rare), wait for all.
    `$procs = Get-Process -Name ${psQuote(exeBaseName)}`,
    'if ($procs) {',
    '  try { $procs | Wait-Process -Timeout 30 } catch {}',
    '}',
    // Copy sourceDir over appRoot. /E, never /MIR: players keep their own folders next to
    // the launcher (a sandboxed FFXI copy was wiped by /MIR), so the update only adds and
    // overwrites — files a release dropped stay behind, harmlessly. /XD protects runtime/
    // (music, user xiloader, ashita), /XF protects loose config files at appRoot.
    `$rc = & robocopy ${psQuote(sourceDir)} ${psQuote(appRoot)} /E /R:3 /W:1 /XD runtime node_modules /XF *.json *.log /NFL /NDL /NJH /NJS`,
    'if ($LASTEXITCODE -ge 8) {',
    `  $errLines = @(`,
    `    "Robocopy failed with exit code $LASTEXITCODE while copying update files.",`,
    `    "Source: ${sourceDir.replace(/\\/g, '\\\\')}",`,
    `    "Dest: ${appRoot.replace(/\\/g, '\\\\')}"`,
    '  )',
    `  $errLines | Out-File -FilePath ${psQuote(errorMarker)} -Encoding utf8`,
    '}',
    // Relaunch before cleanup so the tmpdir delete can't race the script.
    `Start-Process -FilePath ${psQuote(exePath)}`,
    `Remove-Item -Recurse -Force ${psQuote(tmpDir)} -ErrorAction SilentlyContinue`,
    // Self-delete the scheduled task that ran this script.
    `schtasks /delete /tn ${psQuote(taskName)} /f | Out-Null`,
  ].join('\r\n');
}

module.exports = { buildUpdateScript };
