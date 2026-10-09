// Windows Defender exclusion support for the dgVoodoo setup: the elevated body that adds one,
// reading the current list back, and spotting a non-Defender antivirus. Pure string/parse code,
// unit tested with `npm run test:electron`; main.js does the process work.
const path = require('path');
const { psQuote } = require('./prereqInstall');

// Runs elevated (see elevate.js). Adds the folder, then reads the list back so 'OK' means the
// folder is really excluded; policy-managed or third-party-controlled setups accept the command
// and silently change nothing.
function buildExclusionBody(folder) {
  return [
    `  $folder = ${psQuote(folder)}`,
    '  Add-MpPreference -ExclusionPath $folder',
    "  $listed = @((Get-MpPreference).ExclusionPath | Where-Object { $_ -and $_.TrimEnd('\\') -ieq $folder.TrimEnd('\\') })",
    "  if ($listed.Count -eq 0) { throw 'Windows accepted the command but the folder is not in the exclusion list. It may be managed by policy or by another security product.' }",
  ].join('\r\n');
}

// Non-elevated query. Windows hides the exclusion list from non-admin readers (it returns a
// "Must be an administrator" placeholder), so the elevation state is printed first and the list is
// only read when it can be trusted.
const EXCLUSION_QUERY_COMMAND =
  '$a = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())' +
  '.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); "ADMIN=$a"; ' +
  'if ($a) { (Get-MpPreference).ExclusionPath }';

// -> { admin: boolean, paths: string[] } (paths is meaningless unless admin)
function parseExclusionQuery(output) {
  const lines = String(output || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines.shift() || '';
  const admin = /^ADMIN=True$/i.test(first);
  return { admin, paths: admin ? lines : [] };
}

// An exclusion covers the folder when it is the folder or one of its parents. Case-insensitive.
function isPathCovered(exclusions, folder) {
  const target = path.win32.resolve(folder).toLowerCase();
  return exclusions.some((ex) => {
    const e = String(ex).trim().replace(/[\\/]+$/, '').toLowerCase();
    return e !== '' && (target === e || target.startsWith(e + '\\'));
  });
}

// Combines a live query with the list of folders this launcher excluded itself.
// -> { excluded: true|false|null, source: 'defender'|'recorded'|'unverifiable' }
//    null = cannot tell: not admin, and the launcher has no record of adding it.
function resolveExclusionState({ query, recorded, folder }) {
  if (query && query.admin) {
    return { excluded: isPathCovered(query.paths, folder), source: 'defender' };
  }
  if (isPathCovered(recorded || [], folder)) return { excluded: true, source: 'recorded' };
  return { excluded: null, source: 'unverifiable' };
}

const AV_QUERY_COMMAND =
  'Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ' +
  'Select-Object displayName, productState | ConvertTo-Json -Compress';

// productState bit 0x1000 = the product's real-time protection is on.
// -> { known, products: [{ name, enabled, isDefender }], defenderActive, otherActive: string[] }
function parseAntivirusProducts(output) {
  const text = String(output || '').trim();
  if (!text) return { known: false, products: [], defenderActive: false, otherActive: [] };
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { known: false, products: [], defenderActive: false, otherActive: [] }; }
  const products = (Array.isArray(parsed) ? parsed : [parsed])
    .filter((p) => p && p.displayName)
    .map((p) => ({
      name: String(p.displayName),
      enabled: (Number(p.productState) & 0x1000) !== 0,
      isDefender: /^(windows|microsoft) defender/i.test(String(p.displayName)),
    }));
  return {
    known: true,
    products,
    defenderActive: products.some((p) => p.isDefender && p.enabled),
    otherActive: products.filter((p) => !p.isDefender && p.enabled).map((p) => p.name),
  };
}

module.exports = {
  buildExclusionBody,
  EXCLUSION_QUERY_COMMAND,
  parseExclusionQuery,
  isPathCovered,
  resolveExclusionState,
  AV_QUERY_COMMAND,
  parseAntivirusProducts,
};
