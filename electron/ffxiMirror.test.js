const test = require('node:test');
const assert = require('node:assert/strict');
const { MIRROR_ORIGIN, pickFullClientUrl, planClientLayout, isShellMetadata, extractSpaceNeeded, formatSize } = require('./ffxiMirror');

const listing = (files) => ({ ok: true, data: { files } });
const full = (filename, extra = {}) => ({ filename, kind: 'full', available: true, downloadPath: `/api/v1/downloads/${filename}`, ...extra });

test('default mirror is Vana Portal (Vana-Time moved there; its old links 404)', () => {
  assert.equal(MIRROR_ORIGIN, 'https://vana-portal.com');
});

test('pickFullClientUrl returns the full client from the listing', () => {
  const json = listing([
    { filename: 'ffxiUpdate-2026-08.zip', kind: 'monthly', available: true, downloadPath: '/api/v1/downloads/ffxiUpdate-2026-08.zip' },
    full('ffxiFullClient-2026-08.zip'),
  ]);
  assert.equal(pickFullClientUrl(json), 'https://vana-portal.com/api/v1/downloads/ffxiFullClient-2026-08.zip');
});

test('pickFullClientUrl picks the newest full client when several are listed', () => {
  const json = listing([full('ffxiFullClient-2026-07.zip'), full('ffxiFullClient-2026-09.zip'), full('ffxiFullClient-2026-08.zip')]);
  assert.equal(pickFullClientUrl(json), 'https://vana-portal.com/api/v1/downloads/ffxiFullClient-2026-09.zip');
});

test('pickFullClientUrl skips unavailable entries', () => {
  const json = listing([full('ffxiFullClient-2026-09.zip', { available: false }), full('ffxiFullClient-2026-08.zip')]);
  assert.equal(pickFullClientUrl(json), 'https://vana-portal.com/api/v1/downloads/ffxiFullClient-2026-08.zip');
});

test('pickFullClientUrl never leaves the mirror host', () => {
  const json = listing([full('ffxiFullClient-2026-09.zip', { downloadPath: 'https://evil.example/x.zip' })]);
  assert.equal(pickFullClientUrl(json), null);
});

test('pickFullClientUrl returns null for a listing with no full client or a bad shape', () => {
  assert.equal(pickFullClientUrl(listing([])), null);
  assert.equal(pickFullClientUrl({}), null);
  assert.equal(pickFullClientUrl(null), null);
});

// Entry names below are from the real archives (central directories read 2026-10-05).
test('planClientLayout strips the Vana Portal wrapper folder into the FFXI folder', () => {
  const map = planClientLayout([
    'ffxiFullClient-2026-08/',
    'ffxiFullClient-2026-08/ROM7/',
    'ffxiFullClient-2026-08/ROM7/FTABLE7.DAT',
    'ffxiFullClient-2026-08/FFXiMain.dll',
  ]);
  assert.deepEqual(map('ffxiFullClient-2026-08/ROM7/FTABLE7.DAT'), { root: 'ffxi', rel: 'ROM7/FTABLE7.DAT' });
  assert.deepEqual(map('ffxiFullClient-2026-08/FFXiMain.dll'), { root: 'ffxi', rel: 'FFXiMain.dll' });
  assert.equal(map('ffxiFullClient-2026-08/'), null);
});

test('planClientLayout splits a LevelDown-style zip into the FFXI and PlayOnline folders', () => {
  const map = planClientLayout([
    'FINAL FANTASY XI/ROM/1/104.DAT',
    'FINAL FANTASY XI/data/db/desktop.ini',
    'PlayOnlineViewer/pol.exe',
  ]);
  assert.deepEqual(map('FINAL FANTASY XI/ROM/1/104.DAT'), { root: 'ffxi', rel: 'ROM/1/104.DAT' });
  assert.deepEqual(map('PlayOnlineViewer/pol.exe'), { root: 'pol', rel: 'pol.exe' });
});

test('planClientLayout matches the game folder names case-insensitively and through a wrapper', () => {
  const map = planClientLayout(['LD/Final Fantasy XI/ROM/0/0.DAT', 'LD/PLAYONLINEVIEWER/pol.exe']);
  assert.deepEqual(map('LD/Final Fantasy XI/ROM/0/0.DAT'), { root: 'ffxi', rel: 'ROM/0/0.DAT' });
  assert.deepEqual(map('LD/PLAYONLINEVIEWER/pol.exe'), { root: 'pol', rel: 'pol.exe' });
});

test('planClientLayout skips anything beside the game folders in a split zip', () => {
  const map = planClientLayout(['FINAL FANTASY XI/ROM/0/0.DAT', 'readme.txt']);
  assert.equal(map('readme.txt'), null);
});

test('planClientLayout keeps a zip whose files are already at the FFXI root', () => {
  const map = planClientLayout(['ROM/1/104.DAT', 'FFXiMain.dll']);
  assert.deepEqual(map('ROM/1/104.DAT'), { root: 'ffxi', rel: 'ROM/1/104.DAT' });
});

test('planClientLayout never strips a real game folder that happens to be the only top level', () => {
  const map = planClientLayout(['ROM/1/104.DAT', 'ROM/1/105.DAT']);
  assert.deepEqual(map('ROM/1/104.DAT'), { root: 'ffxi', rel: 'ROM/1/104.DAT' });
  const sound = planClientLayout(['sound2/win/se/se001/se001001.spw']);
  assert.deepEqual(sound('sound2/win/se/se001/se001001.spw'), { root: 'ffxi', rel: 'sound2/win/se/se001/se001001.spw' });
});

test('planClientLayout drops Explorer metadata files', () => {
  const map = planClientLayout(['FINAL FANTASY XI/data/db/desktop.ini', 'FINAL FANTASY XI/ROM/Thumbs.db', 'FINAL FANTASY XI/ROM/0/0.DAT']);
  assert.equal(map('FINAL FANTASY XI/data/db/desktop.ini'), null);
  assert.equal(map('FINAL FANTASY XI/ROM/Thumbs.db'), null);
  assert.equal(isShellMetadata('a/DESKTOP.INI'), true);
  assert.equal(isShellMetadata('a/desktop.ini.bak'), false);
});

test('extractSpaceNeeded counts new files in full and replaced files by how much they grow', () => {
  assert.equal(extractSpaceNeeded([{ size: 1000 }, { size: 500, existingSize: 0 }]), 1500);
  assert.equal(extractSpaceNeeded([{ size: 1000, existingSize: 900 }]), 100);
  assert.equal(extractSpaceNeeded([{ size: 1000, existingSize: 4000 }]), 0, 'a smaller replacement frees space, never needs negative');
  assert.equal(extractSpaceNeeded([]), 0);
});

test('formatSize prints GB for big sizes and MB below 1 GB', () => {
  assert.equal(formatSize(8944016862), '8.3 GB');
  assert.equal(formatSize(514357753), '491 MB');
  assert.equal(formatSize(0), '0 MB');
});

test('planClientLayout accepts backslash-separated entry names', () => {
  const map = planClientLayout(['FINAL FANTASY XI\\ROM\\0\\0.DAT']);
  assert.deepEqual(map('FINAL FANTASY XI\\ROM\\0\\0.DAT'), { root: 'ffxi', rel: 'ROM/0/0.DAT' });
});
