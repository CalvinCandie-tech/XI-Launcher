const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./defenderExclusion');

// Coborn: "Start-Process : This command cannot be run due to the error: No application is associated
// with the specified file for this operation" from the nested `Start-Process powershell -Verb RunAs`.
// Also: a non-admin launcher cannot read the exclusion list, so the old check said "Not excluded"
// for everyone, even straight after a successful add.

test('buildExclusionBody quotes the folder as a single-quoted literal and verifies the list', () => {
  const s = D.buildExclusionBody("C:\\FFXI\\Square Enix\\O'Brien");
  assert.ok(s.includes("$folder = 'C:\\FFXI\\Square Enix\\O''Brien'"));
  assert.ok(s.includes('Add-MpPreference -ExclusionPath $folder'));
  assert.ok(s.includes('Get-MpPreference'));
  assert.ok(s.includes('throw'));
});

test('buildExclusionBody does not expand $ or backticks in the folder', () => {
  assert.ok(D.buildExclusionBody('C:\\a$b`c').includes("$folder = 'C:\\a$b`c'"));
});

test('parseExclusionQuery: non-admin output carries no usable list', () => {
  assert.deepEqual(D.parseExclusionQuery('ADMIN=False\r\n'), { admin: false, paths: [] });
  // A localized "must be an administrator" placeholder is never mistaken for a path.
  assert.deepEqual(D.parseExclusionQuery('ADMIN=False\r\nN/A: Must be an administrator to view exclusions'), { admin: false, paths: [] });
});

test('parseExclusionQuery: admin output lists the paths (an empty list is still admin)', () => {
  assert.deepEqual(D.parseExclusionQuery('ADMIN=True\r\nC:\\FFXI\r\nD:\\Games\r\n'), { admin: true, paths: ['C:\\FFXI', 'D:\\Games'] });
  assert.deepEqual(D.parseExclusionQuery('ADMIN=True\r\n'), { admin: true, paths: [] });
  assert.deepEqual(D.parseExclusionQuery(''), { admin: false, paths: [] });
});

test('isPathCovered: exact, parent, trailing slash, case; not siblings or prefixes', () => {
  const f = 'C:\\FFXI\\SquareEnix\\FINAL FANTASY XI';
  assert.equal(D.isPathCovered(['c:\\ffxi\\squareenix\\final fantasy xi'], f), true);
  assert.equal(D.isPathCovered(['C:\\FFXI'], f), true);
  assert.equal(D.isPathCovered(['C:\\FFXI\\'], f), true);
  assert.equal(D.isPathCovered(['C:\\FF'], f), false);
  assert.equal(D.isPathCovered(['C:\\FFXI\\SquareEnix\\FINAL FANTASY XI\\Extra'], f), false);
  assert.equal(D.isPathCovered([], f), false);
  assert.equal(D.isPathCovered([''], f), false);
});

test('resolveExclusionState: an admin read is authoritative', () => {
  const f = 'C:\\FFXI';
  assert.deepEqual(D.resolveExclusionState({ query: { admin: true, paths: ['C:\\FFXI'] }, recorded: [], folder: f }), { excluded: true, source: 'defender' });
  assert.deepEqual(D.resolveExclusionState({ query: { admin: true, paths: [] }, recorded: ['C:\\FFXI'], folder: f }), { excluded: false, source: 'defender' });
});

test('resolveExclusionState: non-admin falls back to what the launcher recorded, else unknown (never "no")', () => {
  const q = { admin: false, paths: [] };
  assert.deepEqual(D.resolveExclusionState({ query: q, recorded: ['C:\\FFXI'], folder: 'C:\\FFXI' }), { excluded: true, source: 'recorded' });
  assert.deepEqual(D.resolveExclusionState({ query: q, recorded: [], folder: 'C:\\FFXI' }), { excluded: null, source: 'unverifiable' });
  assert.deepEqual(D.resolveExclusionState({ query: q, recorded: undefined, folder: 'C:\\FFXI' }), { excluded: null, source: 'unverifiable' });
});

test('parseAntivirusProducts: Defender on (the real productState 397568)', () => {
  const r = D.parseAntivirusProducts('{"displayName":"Windows Defender","productState":397568}');
  assert.equal(r.known, true);
  assert.equal(r.defenderActive, true);
  assert.deepEqual(r.otherActive, []);
});

test('parseAntivirusProducts: a third-party product took over, Defender is off', () => {
  const r = D.parseAntivirusProducts(JSON.stringify([
    { displayName: 'Windows Defender', productState: 393472 },
    { displayName: 'Norton 360', productState: 266240 },
  ]));
  assert.equal(r.defenderActive, false);
  assert.deepEqual(r.otherActive, ['Norton 360']);
});

test('parseAntivirusProducts: nothing / garbage is "unknown", not "no antivirus"', () => {
  assert.equal(D.parseAntivirusProducts('').known, false);
  assert.equal(D.parseAntivirusProducts('not json').known, false);
  assert.equal(D.parseAntivirusProducts(undefined).known, false);
});
