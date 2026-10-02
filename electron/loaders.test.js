const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./loaders');

const DIRS = { xiloaderDir: 'C:\\XI\\runtime\\xiloader', loadersDir: 'C:\\XI\\runtime\\loaders' };

const PRIVATE_INI = [
  '[ashita.launcher]',
  'autoclose    = 1',
  'name         = LD',
  '',
  '[ashita.boot]',
  'file         = C:\\XI\\runtime\\xiloader\\xiloader.exe',
  'command      = --server leveldownffxi.com --user bob',
  'gamemodule   = ffximain.dll',
].join('\n');

const RETAIL_INI = [
  '[ashita.boot]',
  'file         =',
  'command      = /game eAZcFcB',
].join('\n');

test('loaderExeNames lists every registry exe', () => {
  assert.deepEqual(L.loaderExeNames().sort(), ['ldloader.exe', 'xiloader.exe']);
});

test('isLoaderId only accepts own registry keys', () => {
  assert.equal(L.isLoaderId('ldloader'), true);
  assert.equal(L.isLoaderId('constructor'), false);
  assert.equal(L.isLoaderId('__proto__'), false);
  assert.equal(L.isLoaderId('LDLOADER'), false);
  assert.equal(L.isLoaderId(undefined), false);
});

test('loaderExePath: xiloader keeps its own dir, others go under loadersDir', () => {
  assert.equal(L.loaderExePath('xiloader', DIRS), 'C:\\XI\\runtime\\xiloader\\xiloader.exe');
  assert.equal(L.loaderExePath('ldloader', DIRS), 'C:\\XI\\runtime\\loaders\\ldloader\\ldloader.exe');
});

test('parseIniBoot reads file, command and --server host', () => {
  const boot = L.parseIniBoot(PRIVATE_INI);
  assert.equal(boot.file, 'C:\\XI\\runtime\\xiloader\\xiloader.exe');
  assert.equal(boot.command, '--server leveldownffxi.com --user bob');
  assert.equal(boot.host, 'leveldownffxi.com');
  assert.equal(boot.isRetail, false);
});

test('parseIniBoot handles extra spaces and CRLF', () => {
  const boot = L.parseIniBoot('[ashita.boot]\r\nfile = x.exe\r\ncommand =   --server   LevelDownFFXI.com  \r\n');
  assert.equal(boot.host, 'LevelDownFFXI.com');
});

test('parseIniBoot ignores file/command outside [ashita.boot]', () => {
  const boot = L.parseIniBoot('[other]\nfile = evil.exe\ncommand = --server evil\n[ashita.boot]\ncommand = --server good\n');
  assert.equal(boot.file, null);
  assert.equal(boot.host, 'good');
});

test('parseIniBoot detects retail profiles', () => {
  assert.equal(L.parseIniBoot(RETAIL_INI).isRetail, true);
  assert.equal(L.parseIniBoot('[ashita.boot]\nfile =\ncommand =\n').isRetail, true);
  assert.equal(L.parseIniBoot('').isRetail, true);
});

test('setIniBootFile replaces only the boot file line, keeping LF', () => {
  const out = L.setIniBootFile(PRIVATE_INI, 'C:\\XI\\runtime\\loaders\\ldloader\\ldloader.exe');
  const expected = PRIVATE_INI.replace(
    'file         = C:\\XI\\runtime\\xiloader\\xiloader.exe',
    'file         = C:\\XI\\runtime\\loaders\\ldloader\\ldloader.exe'
  );
  assert.equal(out, expected);
});

test('setIniBootFile preserves CRLF line endings', () => {
  const crlf = PRIVATE_INI.replace(/\n/g, '\r\n');
  const out = L.setIniBootFile(crlf, 'D:\\l.exe');
  assert.equal(out, crlf.replace('file         = C:\\XI\\runtime\\xiloader\\xiloader.exe', 'file         = D:\\l.exe'));
});

test('setIniBootFile inserts a file line when the boot section has none', () => {
  const out = L.setIniBootFile('[ashita.boot]\ncommand = --server x\n', 'D:\\l.exe');
  assert.equal(out, '[ashita.boot]\nfile         = D:\\l.exe\ncommand = --server x\n');
});

test('resolveLoader: the profile picks a registry loader', () => {
  const r = L.resolveLoader({ profileSettings: { loader: 'ldloader' }, ...DIRS });
  assert.deepEqual(r, { id: 'ldloader', name: 'ldloader (LevelDown)', exePath: 'C:\\XI\\runtime\\loaders\\ldloader\\ldloader.exe' });
});

test('resolveLoader: custom exe path', () => {
  const r = L.resolveLoader({ profileSettings: { loader: 'custom', loaderExePath: 'D:\\Loaders\\my.exe' }, ...DIRS });
  assert.deepEqual(r, { id: 'custom', name: 'my.exe', exePath: 'D:\\Loaders\\my.exe' });
});

test('resolveLoader: a profile with no loader chosen uses stock xiloader', () => {
  const r = L.resolveLoader({ profileSettings: undefined, ...DIRS });
  assert.deepEqual(r, { id: 'xiloader', name: 'xiloader (LandSandBoat)', exePath: 'C:\\XI\\runtime\\xiloader\\xiloader.exe' });
});

test('resolveLoader: old auto, junk ids and custom-without-path fall back to stock xiloader', () => {
  for (const loader of ['auto', 'constructor', '__proto__', 'LDLOADER', 'custom']) {
    const r = L.resolveLoader({ profileSettings: { loader }, ...DIRS });
    assert.equal(r.id, 'xiloader', `loader=${loader}`);
  }
});

test('describeLoader names the loader', () => {
  assert.equal(L.describeLoader({ name: 'ldloader (LevelDown)' }), 'Using ldloader (LevelDown)');
});

test('missingLoaderMessage points at Profiles → Loader', () => {
  assert.equal(L.missingLoaderMessage({ id: 'ldloader' }), 'ldloader.exe is not installed. Install it from Profiles → Loader.');
  assert.equal(L.missingLoaderMessage({ id: 'custom', exePath: 'D:\\x.exe' }), 'Custom loader not found at D:\\x.exe. Pick it again in Profiles → Loader.');
});

test('planProfileLoaderSync leaves retail profiles alone', () => {
  assert.deepEqual(L.planProfileLoaderSync(RETAIL_INI, 'D:\\l.exe'), { retail: true });
});

test('planProfileLoaderSync: no rewrite when already pointing at the exe (case-insensitive)', () => {
  assert.deepEqual(L.planProfileLoaderSync(PRIVATE_INI, 'c:\\xi\\runtime\\xiloader\\XILOADER.exe'), { newContent: null });
});

test('planProfileLoaderSync returns rewritten content when the exe differs', () => {
  const plan = L.planProfileLoaderSync(PRIVATE_INI, 'D:\\l.exe');
  assert.match(plan.newContent, /^file {9}= D:\\l\.exe$/m);
});

test('isValidExePath', () => {
  assert.equal(L.isValidExePath('C:\\Loaders\\ld.exe'), true);
  assert.equal(L.isValidExePath('d:/x/LD.EXE'), true);
  assert.equal(L.isValidExePath('relative\\ld.exe'), false);
  assert.equal(L.isValidExePath('\\\\server\\share\\ld.exe'), false);
  assert.equal(L.isValidExePath('C:\\x\\ld.bat'), false);
  assert.equal(L.isValidExePath('C:\\x\\"ld.exe'), false);
  assert.equal(L.isValidExePath('C:\\x\\ld.exe\n'), false);
  assert.equal(L.isValidExePath(42), false);
});

test('sanitizeLoaderSettings keeps valid values and other keys', () => {
  const s = { serverHost: 'x', loader: 'custom', loaderExePath: 'C:\\l\\ld.exe' };
  assert.deepEqual(L.sanitizeLoaderSettings(s), s);
  assert.deepEqual(L.sanitizeLoaderSettings({ loader: 'ldloader' }), { loader: 'ldloader' });
});

test('sanitizeLoaderSettings drops junk, the retired auto, and custom without a usable path', () => {
  assert.deepEqual(L.sanitizeLoaderSettings({ loader: '__proto__', a: 1 }), { a: 1 });
  assert.deepEqual(L.sanitizeLoaderSettings({ loader: 'auto', a: 1 }), { a: 1 });
  assert.deepEqual(L.sanitizeLoaderSettings({ loader: 'custom', loaderExePath: 'rel.exe' }), {});
  assert.deepEqual(L.sanitizeLoaderSettings({ loader: 'custom' }), {});
  assert.equal(L.sanitizeLoaderSettings(null), null);
});

test('migrateProfileSettings converts legacy xiloaderPath and keeps the old key', () => {
  const { changed, result } = L.migrateProfileSettings({
    A: { xiloaderPath: 'C:/Old/xi' },
    B: { serverHost: 'h' },
    C: { loader: 'ldloader', xiloaderPath: 'C:\\ignored' },
  });
  assert.equal(changed, true);
  assert.deepEqual(result.A, { xiloaderPath: 'C:/Old/xi', loader: 'custom', loaderExePath: 'C:\\Old\\xi\\xiloader.exe' });
  assert.deepEqual(result.B, { serverHost: 'h', loader: 'xiloader' });
  assert.deepEqual(result.C, { loader: 'ldloader', xiloaderPath: 'C:\\ignored' });
});

test('migrateProfileSettings: unusable legacy path becomes stock xiloader', () => {
  const { result } = L.migrateProfileSettings({ A: { xiloaderPath: 'relative\\dir' } });
  assert.equal(result.A.loader, 'xiloader');
});

test('migrateProfileSettings turns a stored auto into stock xiloader', () => {
  const { changed, result } = L.migrateProfileSettings({ A: { loader: 'auto', serverHost: 'h' } });
  assert.equal(changed, true);
  assert.deepEqual(result.A, { loader: 'xiloader', serverHost: 'h' });
});

test('migrateProfileSettings is idempotent', () => {
  const first = L.migrateProfileSettings({ A: { xiloaderPath: 'C:\\Old' }, B: {} }).result;
  const second = L.migrateProfileSettings(first);
  assert.equal(second.changed, false);
  assert.deepEqual(second.result, first);
});

const RELEASE = {
  tag_name: 'v2.2.0',
  assets: [
    { id: 1, name: 'xiloader-src.zip', browser_download_url: 'https://x/src.zip', updated_at: 't0' },
    { id: 606443986, name: 'LDLoader.exe', browser_download_url: 'https://x/ldloader.exe', updated_at: '2026-10-02T20:37:18Z' },
  ],
};

test('pickReleaseAsset matches the exact asset name case-insensitively', () => {
  assert.deepEqual(L.pickReleaseAsset(RELEASE, 'ldloader.exe'), {
    tag: 'v2.2.0', downloadUrl: 'https://x/ldloader.exe', assetId: 606443986, assetUpdatedAt: '2026-10-02T20:37:18Z',
  });
  assert.equal(L.pickReleaseAsset(RELEASE, 'xiloader.exe'), null);
  assert.equal(L.pickReleaseAsset({}, 'xiloader.exe'), null);
});

test('needsLoaderUpdate', () => {
  const latest = { tag: 'v2.2.0', assetId: 5 };
  assert.equal(L.needsLoaderUpdate({ installed: false, latest }), true);
  const exePath = 'C:\\A\\ldloader.exe';
  assert.equal(L.needsLoaderUpdate({ installed: true, record: { assetId: 5, exePath }, latest, exePath }), false);
  assert.equal(L.needsLoaderUpdate({ installed: true, record: { assetId: 4, exePath }, latest, exePath }), true);
  // No record: FileVersion fallback (only ever passed for stock xiloader)
  assert.equal(L.needsLoaderUpdate({ installed: true, localVersion: '2.2.0.0', latest }), false);
  assert.equal(L.needsLoaderUpdate({ installed: true, localVersion: '2.1.2.0', latest }), true);
  // No record and no version: can't tell what it is, so replace it
  assert.equal(L.needsLoaderUpdate({ installed: true, latest }), true);
});

test('mergeProfileSettings keeps the loader choice when a save omits it', () => {
  const existing = { serverHost: 'old', loader: 'custom', loaderExePath: 'C:\\l\\ld.exe' };
  assert.deepEqual(
    L.mergeProfileSettings(existing, { serverHost: 'new', loginUser: 'bob' }),
    { serverHost: 'new', loginUser: 'bob', loader: 'custom', loaderExePath: 'C:\\l\\ld.exe' }
  );
});

test('mergeProfileSettings lets an explicit loader save replace the old choice', () => {
  const existing = { loader: 'custom', loaderExePath: 'C:\\l\\ld.exe', serverHost: 'h' };
  assert.deepEqual(L.mergeProfileSettings(existing, { serverHost: 'h', loader: 'ldloader' }), { serverHost: 'h', loader: 'ldloader' });
});

test('mergeProfileSettings with no existing entry returns the incoming settings', () => {
  assert.deepEqual(L.mergeProfileSettings(undefined, { serverHost: 'h' }), { serverHost: 'h' });
});

test('resolveLoader ignores unsafe stored custom paths instead of using or throwing on them', () => {
  for (const loaderExePath of ['C:\\a.exe\ncommand = --server evil', 42, '\\\\nas\\x.exe', 'rel.exe']) {
    const r = L.resolveLoader({ profileSettings: { loader: 'custom', loaderExePath }, ...DIRS });
    assert.equal(r.id, 'xiloader', `loaderExePath=${JSON.stringify(loaderExePath)}`);
  }
});

test('needsLoaderUpdate only trusts a record made for the same exe path', () => {
  const latest = { tag: 'v2.2.0', assetId: 5 };
  const record = { assetId: 5, exePath: 'C:\\A\\xiloader.exe' };
  assert.equal(L.needsLoaderUpdate({ installed: true, record, latest, exePath: 'c:\\a\\XILOADER.exe' }), false);
  // Same asset id but a different install folder → record doesn't apply; fall back to FileVersion
  assert.equal(L.needsLoaderUpdate({ installed: true, record, latest, exePath: 'C:\\B\\xiloader.exe', localVersion: '2.1.2.0' }), true);
  assert.equal(L.needsLoaderUpdate({ installed: true, record, latest, exePath: 'C:\\B\\xiloader.exe', localVersion: '2.2.0.0' }), false);
  // Record without an exePath can't be matched to an install
  assert.equal(L.needsLoaderUpdate({ installed: true, record: { assetId: 5 }, latest, exePath: 'C:\\A\\xiloader.exe' }), true);
});
