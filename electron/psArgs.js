// Building Start-Process -ArgumentList values for Windows PowerShell 5.1. Pure string building,
// unit tested with `npm run test:electron`.
//
// 5.1 joins -ArgumentList elements with single spaces and does NOT quote them, so an element
// holding a space reaches the child as several arguments (Ashita-cli got `Clarey` and
// `(Copy).ini` for the profile "Clarey (Copy)"). Each element that can contain a space needs
// literal double quotes inside it.

// Escape a value for a PowerShell SINGLE-quoted string: only the single quote is special.
const escapePSString = (str) => String(str).replace(/'/g, "''");

// A double quote would end our quoting early, and a newline would end the argument. Profile
// names (sanitizeName) and temp paths can't contain either, but this runs elevated.
function assertQuotable(value) {
  if (/["\r\n]/.test(String(value))) {
    throw new Error('Cannot quote a value containing a double quote or newline for Start-Process');
  }
}

// The PowerShell single-quoted literal for one -ArgumentList element, with literal double
// quotes inside: C:\a b\x.ps1  ->  '"C:\a b\x.ps1"'
function quoteForStartProcess(value) {
  assertQuotable(value);
  return `'${escapePSString(`"${value}"`)}'`;
}

// Same, for a command line that is itself wrapped in "..." (execSync(`powershell -Command "..."`)):
// the inner double quotes are backslash-escaped so the outer quoting survives.
function quoteForStartProcessInCmd(value) {
  return quoteForStartProcess(value).replace(/"/g, '\\"');
}

// The -ArgumentList value that hands Ashita-cli its profile ini: @('"<name>.ini"')
function buildAshitaArgList(iniName) {
  return `@(${quoteForStartProcess(iniName)})`;
}

module.exports = { quoteForStartProcess, quoteForStartProcessInCmd, buildAshitaArgList };
