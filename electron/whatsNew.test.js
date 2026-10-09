const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { summarizeReleaseNotes, planWhatsNew } = require('./whatsNew');

const REAL = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fixtures', 'whats-new', 'release-1.8.4.md'), 'utf8');

test('summarizeReleaseNotes reads the real v1.8.4 release body', () => {
  const items = summarizeReleaseNotes(REAL);
  assert.deepEqual(items.map(i => i.category), ['Fix', 'Fix', 'Servers', '']);
  assert.equal(items[0].heading, '"Install Ashita v4" failing with EINVAL: invalid argument, mkdir');
  assert.equal(items[2].heading, 'LevelDown is also listed under 99');
  assert.deepEqual(items[3], { category: '', heading: 'Cleanup', detail: 'Removed an unused component.' });
});

test('summarizeReleaseNotes takes the first sentence as detail, without markdown', () => {
  const [first, second] = summarizeReleaseNotes(REAL);
  assert.ok(first.detail.startsWith('Settings are saved in %APPDATA%\\xi-launcher'));
  assert.ok(!first.detail.includes('`'));
  assert.ok(first.detail.length <= 140);
  assert.equal(second.detail, 'The built-in default server address was a raw IP that no longer answers.');
});

test('summarizeReleaseNotes stops at the Download block and ignores what follows', () => {
  const items = summarizeReleaseNotes('### Fix: One\nDid a thing.\n\n**Download:** XI-Launcher.zip\n### Fix: Never\nx');
  assert.deepEqual(items.map(i => i.heading), ['One']);
  assert.equal(summarizeReleaseNotes('### Feature: A\nx\n---\n### Feature: B\ny').length, 1);
});

test('summarizeReleaseNotes handles headings without a category, empty and missing bodies', () => {
  assert.deepEqual(summarizeReleaseNotes('### Cleanup\nRemoved dead code.'), [{ category: '', heading: 'Cleanup', detail: 'Removed dead code.' }]);
  assert.deepEqual(summarizeReleaseNotes(''), []);
  assert.deepEqual(summarizeReleaseNotes(undefined), []);
  assert.deepEqual(summarizeReleaseNotes('just some prose\nno headings'), []);
});

test('summarizeReleaseNotes caps the list', () => {
  const body = Array.from({ length: 9 }, (_, i) => `### Fix: Item ${i}\nDetail ${i}.`).join('\n');
  assert.equal(summarizeReleaseNotes(body).length, 5);
  assert.equal(summarizeReleaseNotes(body, 3).length, 3);
});

test('summarizeReleaseNotes copes with CRLF bodies and long details', () => {
  const body = `### Fix: Long\r\n${'word '.repeat(80)}end.\r\n`;
  const [item] = summarizeReleaseNotes(body);
  assert.equal(item.heading, 'Long');
  assert.ok(item.detail.length <= 140 && item.detail.endsWith('…'));
});

test('planWhatsNew shows after an update, records on first run, ignores seen versions and downgrades', () => {
  assert.equal(planWhatsNew({ lastSeen: '1.8.3', current: '1.8.4', freshInstall: false }), 'show');
  assert.equal(planWhatsNew({ lastSeen: '1.9.0', current: '1.10.0', freshInstall: false }), 'show', 'numeric, not string, compare');
  assert.equal(planWhatsNew({ lastSeen: '1.8.4', current: '1.8.4', freshInstall: false }), 'none');
  assert.equal(planWhatsNew({ lastSeen: '1.8.4', current: '1.8.3', freshInstall: false }), 'none');
  assert.equal(planWhatsNew({ lastSeen: undefined, current: '1.8.4', freshInstall: true }), 'record');
  assert.equal(planWhatsNew({ lastSeen: undefined, current: '1.8.5', freshInstall: false }), 'show', 'existing player on the first version that has this feature');
});
