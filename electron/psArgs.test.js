const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./psArgs');

// Windows PowerShell 5.1 joins Start-Process -ArgumentList elements with spaces and does NOT
// quote them, so Ashita-cli received `Clarey` and `(Copy).ini` for the profile "Clarey (Copy)"
// ("Invalid configuration file given"). The fix is a literal " pair inside each element.

test('buildAshitaArgList wraps a plain ini name in literal double quotes', () => {
  assert.equal(P.buildAshitaArgList('Clarey.ini'), `@('"Clarey.ini"')`);
});

test('buildAshitaArgList keeps a name with a space as ONE quoted argument', () => {
  assert.equal(P.buildAshitaArgList('Test Wizard.ini'), `@('"Test Wizard.ini"')`);
});

test('buildAshitaArgList handles the names Clone generates', () => {
  assert.equal(P.buildAshitaArgList('Clarey (Copy).ini'), `@('"Clarey (Copy).ini"')`);
  assert.equal(P.buildAshitaArgList('Clarey (Copy 2).ini'), `@('"Clarey (Copy 2).ini"')`);
});

test('buildAshitaArgList doubles an apostrophe so it cannot end the PowerShell string', () => {
  assert.equal(P.buildAshitaArgList(`O'Brien Test.ini`), `@('"O''Brien Test.ini"')`);
});

test('buildAshitaArgList leaves $ and backtick literal (single-quoted PowerShell string)', () => {
  assert.equal(P.buildAshitaArgList('Cash$Money.ini'), `@('"Cash$Money.ini"')`);
  assert.equal(P.buildAshitaArgList('Tick`Tock.ini'), `@('"Tick\`Tock.ini"')`);
});

test('regression: the unquoted element is never produced for any name', () => {
  for (const name of ['Clarey.ini', 'Clarey (Copy).ini', `O'Brien Test.ini`, 'a b c.ini']) {
    const out = P.buildAshitaArgList(name);
    assert.doesNotMatch(out, /^@\('[^"]*'\)$/, `unquoted element for ${name}`);
    assert.match(out, /^@\('"/, `opens with ' then "  for ${name}`);
    assert.match(out, /"'\)$/, `closes with " then ' for ${name}`);
  }
});

test('quoteForStartProcess quotes a script path that contains a space (temp dir of a user with a space in their name)', () => {
  assert.equal(
    P.quoteForStartProcess('C:\\Users\\Calvin Candie\\AppData\\Local\\Temp\\xi-launcher-reg.ps1'),
    `'"C:\\Users\\Calvin Candie\\AppData\\Local\\Temp\\xi-launcher-reg.ps1"'`
  );
});

test('quoteForStartProcessInCmd escapes the quotes for a command line that is itself inside "..."', () => {
  // execSync(`powershell -Command "Start-Process ... -ArgumentList ...,'\"C:\\a b\\x.ps1\"' ..."`)
  assert.equal(P.quoteForStartProcessInCmd('C:\\a b\\x.ps1'), `'\\"C:\\a b\\x.ps1\\"'`);
});

test('a value containing a double quote or newline is rejected (it would break out of the quoting)', () => {
  assert.throws(() => P.quoteForStartProcess('evil" -Verb RunAs'), /double quote|newline/i);
  assert.throws(() => P.buildAshitaArgList('a\nb.ini'), /double quote|newline/i);
});
