const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/utils/profileNames');

// ---- validateProfileName: the rules Profiles → Create already enforced, now shared with Clone ----

test('validateProfileName accepts ordinary names, including spaces and parentheses', () => {
  assert.equal(N.validateProfileName('Clarey', []), '');
  assert.equal(N.validateProfileName('Test Wizard', ['Clarey']), '');
  assert.equal(N.validateProfileName('Clarey (Copy 2)', ['Clarey']), '');
});

test('validateProfileName keeps create\'s existing messages', () => {
  assert.equal(N.validateProfileName('a/b', []), 'Profile name cannot contain \\ / : * ? " < > | or ".."');
  assert.equal(N.validateProfileName('a..b', []), 'Profile name cannot contain \\ / : * ? " < > | or ".."');
  assert.equal(N.validateProfileName('.', []), 'Profile name cannot be "." or ".."');
  assert.equal(N.validateProfileName('x'.repeat(61), []), 'Profile name is too long (max 60 characters)');
  assert.equal(N.validateProfileName('x'.repeat(60), []), '');
});

test('validateProfileName rejects a name that differs only in case (Windows filenames are case-insensitive)', () => {
  assert.equal(N.validateProfileName('test', ['Test']), 'A profile named "test" already exists');
  assert.equal(N.validateProfileName('TEST', ['Test']), 'A profile named "TEST" already exists');
});

// ---- uniqueCloneName ----

test('uniqueCloneName appends (Copy) when the name is free', () => {
  assert.equal(N.uniqueCloneName('Clarey', ['Clarey']), 'Clarey (Copy)');
});

test('uniqueCloneName counts up: (Copy 2), (Copy 3)', () => {
  assert.equal(N.uniqueCloneName('Clarey', ['Clarey', 'Clarey (Copy)']), 'Clarey (Copy 2)');
  assert.equal(N.uniqueCloneName('Clarey', ['Clarey', 'Clarey (Copy)', 'Clarey (Copy 2)']), 'Clarey (Copy 3)');
});

test('uniqueCloneName treats names that differ only in case as taken (the overwrite bug)', () => {
  // "test" cloned while "Test (Copy)" exists: "test (Copy)" is the SAME file on Windows.
  assert.equal(N.uniqueCloneName('test', ['test', 'Test (Copy)']), 'test (Copy 2)');
  assert.equal(N.uniqueCloneName('Clarey', ['Clarey', 'CLAREY (COPY)', 'clarey (copy 2)']), 'Clarey (Copy 3)');
});

test('uniqueCloneName never exceeds 60 characters: the base name is truncated to make room', () => {
  const long = 'A'.repeat(60);
  const first = N.uniqueCloneName(long, [long]);
  assert.equal(first, 'A'.repeat(53) + ' (Copy)');
  assert.equal(first.length, 60);
  const second = N.uniqueCloneName(long, [long, first]);
  assert.equal(second, 'A'.repeat(51) + ' (Copy 2)');
  assert.ok(second.length <= 60);
});

test('uniqueCloneName results always pass the same validation Create applies', () => {
  const taken = ['Clarey', 'x'.repeat(60), 'My Profile (Copy)'];
  for (const base of taken) {
    const name = N.uniqueCloneName(base, taken);
    assert.equal(N.validateProfileName(name, taken), '', `valid clone name for ${base}`);
  }
});

test('uniqueCloneName does not leave trailing whitespace when truncation lands on a space', () => {
  const base = 'B'.repeat(52) + ' ' + 'C'.repeat(7); // char 53 (index 52) is a space
  const out = N.uniqueCloneName(base, [base]);
  assert.equal(out, 'B'.repeat(52) + ' (Copy)');
});
