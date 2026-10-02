const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./loaders');

const DIRS = { xiloaderDir: 'C:\\XI\\runtime\\xiloader', loadersDir: 'C:\\XI\\runtime\\loaders' };
const TABLE = {
  Eden: { host: 'play.edenxi.com' },
  LevelDown: { host: 'leveldownffxi.com', loader: 'ldloader' },
  Broken: { host: 'broken.example', loader: 'notaloader' },
};

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

test('serverLoaderFor matches host case-insensitively and trims', () => {
  assert.deepEqual(L.serverLoaderFor('  LevelDownFFXI.com ', TABLE), { loaderId: 'ldloader', serverName: 'LevelDown' });
});

test('serverLoaderFor returns null for unbound, unknown, empty and bad-loader hosts', () => {
  assert.equal(L.serverLoaderFor('play.edenxi.com', TABLE), null);
  assert.equal(L.serverLoaderFor('192.168.0.5', TABLE), null);
  assert.equal(L.serverLoaderFor(null, TABLE), null);
  assert.equal(L.serverLoaderFor('broken.example', TABLE), null);
});

test('resolveLoader: explicit profile loader wins over server binding', () => {
  const r = L.resolveLoader({ profileSettings: { loader: 'xiloader' }, host: 'leveldownffxi.com', serverTable: TABLE, ...DIRS });
  assert.equal(r.id, 'xiloader');
  assert.equal(r.source, 'profile');
});

test('resolveLoader: custom exe path', () => {
  const r = L.resolveLoader({ profileSettings: { loader: 'custom', loaderExePath: 'D:\\Loaders\\my.exe' }, host: 'play.edenxi.com', serverTable: TABLE, ...DIRS });
  assert.deepEqual(r, { id: 'custom', name: 'my.exe', exePath: 'D:\\Loaders\\my.exe', source: 'profile', serverName: null });
});

test('resolveLoader: auto follows server binding', () => {
  const r = L.resolveLoader({ profileSettings: { loader: 'auto' }, host: 'leveldownffxi.com', serverTable: TABLE, ...DIRS });
  assert.equal(r.id, 'ldloader');
  assert.equal(r.source, 'server');
  assert.equal(r.serverName, 'LevelDown');
  assert.equal(r.exePath, 'C:\\XI\\runtime\\loaders\\ldloader\\ldloader.exe');
});

test('resolveLoader: no settings / unbound host → default xiloader', () => {
  const r = L.resolveLoader({ profileSettings: undefined, host: 'play.edenxi.com', serverTable: TABLE, ...DIRS });
  assert.equal(r.id, 'xiloader');
  assert.equal(r.source, 'default');
});

test('resolveLoader: junk loader ids and custom-without-path behave as auto', () => {
  for (const loader of ['constructor', '__proto__', 'LDLOADER', 'custom']) {
    const r = L.resolveLoader({ profileSettings: { loader }, host: 'leveldownffxi.com', serverTable: TABLE, ...DIRS });
    assert.equal(r.id, 'ldloader', `loader=${loader}`);
    assert.equal(r.source, 'server');
  }
});

test('describeLoader names the source', () => {
  assert.equal(L.describeLoader({ name: 'ldloader (LevelDown)', source: 'server', serverName: 'LevelDown' }), 'Using ldloader (LevelDown) — from server LevelDown');
  assert.equal(L.describeLoader({ name: 'my.exe', source: 'profile', serverName: null }), 'Using my.exe — set on profile');
  assert.equal(L.describeLoader({ name: 'xiloader (LandSandBoat)', source: 'default', serverName: null }), 'Using xiloader (LandSandBoat) — default');
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
