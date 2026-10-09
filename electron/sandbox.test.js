const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./sandbox');

const PROFILE = [
  '[ashita.boot]',
  'file         = C:\\XI\\xiloader.exe',
  '',
  '[ashita.polplugins]',
  'pivot = 1',
  'sandbox = 0',
  '',
  '[ashita.polplugins.args]',
  '',
  '[ffxi.registry]',
  '0042 = C:\\XI-Launcher\\Leveldown\\FINAL FANTASY XI',
  '',
].join('\r\n');

const LD_PATHS = { ffxi: 'C:\\XI-Launcher\\Leveldown\\FINAL FANTASY XI', pol: 'C:\\XI-Launcher\\Leveldown\\PlayOnlineViewer' };

test('copyPaths puts FINAL FANTASY XI and PlayOnlineViewer inside the copy folder', () => {
  assert.deepEqual(S.copyPaths('C:\\XI-Launcher\\Leveldown'), LD_PATHS);
});

test('normalizeCopyFolder accepts the copy folder or the FINAL FANTASY XI folder inside it', () => {
  assert.equal(S.normalizeCopyFolder('C:\\XI-Launcher\\Leveldown'), 'C:\\XI-Launcher\\Leveldown');
  assert.equal(S.normalizeCopyFolder('C:/XI-Launcher/Leveldown/'), 'C:\\XI-Launcher\\Leveldown');
  assert.equal(S.normalizeCopyFolder('C:\\XI-Launcher\\Leveldown\\Final Fantasy XI'), 'C:\\XI-Launcher\\Leveldown');
  assert.equal(S.normalizeCopyFolder('C:\\XI-Launcher\\Leveldown\\PlayOnlineViewer\\'), 'C:\\XI-Launcher\\Leveldown');
  assert.equal(S.normalizeCopyFolder(''), null);
});

test('isSandboxEnabled reads sandbox from [ashita.polplugins] only', () => {
  assert.equal(S.isSandboxEnabled(PROFILE), false);
  assert.equal(S.isSandboxEnabled(PROFILE.replace('sandbox = 0', 'sandbox = 1')), true);
  assert.equal(S.isSandboxEnabled('[ashita.addons]\nsandbox = 1\n'), false);
  assert.equal(S.isSandboxEnabled('[ashita.boot]\nfile = x\n'), false);
});

test('setSandbox on writes sandbox = 1 and the [sandbox.paths] section, keeping CRLF', () => {
  const out = S.setSandbox(PROFILE, true, LD_PATHS);
  assert.equal(S.isSandboxEnabled(out), true);
  assert.match(out, /\[ashita\.polplugins\]\r\npivot = 1\r\nsandbox = 1\r\n/);
  assert.match(out, /\[sandbox\.paths\]\r\npol = C:\\XI-Launcher\\Leveldown\\PlayOnlineViewer\r\nffxi = C:\\XI-Launcher\\Leveldown\\FINAL FANTASY XI/);
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF line endings');
  assert.match(out, /\[ffxi\.registry\]\r\n0042 = /, 'other sections untouched');
});

test('setSandbox off writes sandbox = 0 and leaves [sandbox.paths] alone', () => {
  const on = S.setSandbox(PROFILE, true, LD_PATHS);
  const off = S.setSandbox(on, false, LD_PATHS);
  assert.equal(S.isSandboxEnabled(off), false);
  assert.match(off, /\[sandbox\.paths\]/);
});

test('setSandbox updates existing paths in place and keeps extra keys', () => {
  const ini = '[ashita.polplugins]\nsandbox = 1\n\n[sandbox.paths]\ncommon = C:\\Common\npol    = D:\\old\\PlayOnlineViewer\nffxi   = D:\\old\\FINAL FANTASY XI\n';
  const out = S.setSandbox(ini, true, LD_PATHS);
  assert.equal(out, '[ashita.polplugins]\nsandbox = 1\n\n[sandbox.paths]\ncommon = C:\\Common\npol    = C:\\XI-Launcher\\Leveldown\\PlayOnlineViewer\nffxi   = C:\\XI-Launcher\\Leveldown\\FINAL FANTASY XI\n');
});

test('setSandbox adds a missing [ashita.polplugins] section', () => {
  const out = S.setSandbox('[ashita.boot]\nfile = x\n', true, LD_PATHS);
  assert.equal(S.isSandboxEnabled(out), true);
  assert.equal(S.readSandboxPaths(out).ffxi, LD_PATHS.ffxi);
});

test('setSandbox does not touch a sandbox key outside [ashita.polplugins]', () => {
  const ini = '[ashita.addons]\nsandbox = 0\n\n[ashita.polplugins]\npivot = 1\n';
  const out = S.setSandbox(ini, true, LD_PATHS);
  assert.match(out, /^\[ashita\.addons\]\nsandbox = 0\n/);
  assert.match(out, /\[ashita\.polplugins\]\npivot = 1\nsandbox = 1\n/);
});

// `reg query HKLM\SOFTWARE\WOW6432Node\PlayOnlineUS\InstallFolder` on a retail install (2026-10-05).
const REG_OUTPUT = [
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\PlayOnlineUS\\InstallFolder',
  '    1000    REG_SZ    C:\\Program Files (x86)\\PlayOnline\\SquareEnix\\PlayOnlineViewer',
  '    0001    REG_SZ    C:\\Program Files (x86)\\PlayOnline\\SquareEnix\\FINAL FANTASY XI\\',
  '',
].join('\r\n');

test('parseRegFfxiFolder reads the FFXI install folder (value 0001)', () => {
  assert.equal(S.parseRegFfxiFolder(REG_OUTPUT), 'C:\\Program Files (x86)\\PlayOnline\\SquareEnix\\FINAL FANTASY XI\\');
  assert.equal(S.parseRegFfxiFolder(''), null);
});

test('isSameFolder ignores case, slash direction and trailing slashes', () => {
  assert.equal(S.isSameFolder('C:\\Program Files (x86)\\PlayOnline\\SquareEnix\\FINAL FANTASY XI\\', 'c:/program files (x86)/playonline/squareenix/final fantasy xi'), true);
  assert.equal(S.isSameFolder('C:\\XI-Launcher\\Leveldown\\FINAL FANTASY XI', 'C:\\Program Files (x86)\\PlayOnline\\SquareEnix\\FINAL FANTASY XI'), false);
  assert.equal(S.isSameFolder(null, 'C:\\x'), false);
});

test('relocatePath moves a path from the old launcher folder to the new one', () => {
  assert.equal(S.relocatePath('E:\\XI-Launcher\\runtime\\ashita', 'E:\\XI-Launcher', 'F:\\XI-Launcher'), 'F:\\XI-Launcher\\runtime\\ashita');
  assert.equal(S.relocatePath('e:\\xi-launcher\\runtime\\clients\\LD', 'E:\\XI-Launcher\\', 'F:\\Games\\XI'), 'F:\\Games\\XI\\runtime\\clients\\LD');
  assert.equal(S.relocatePath('E:\\XI-Launcher', 'E:\\XI-Launcher', 'F:\\XI-Launcher'), 'F:\\XI-Launcher');
});

test('relocatePath leaves paths outside the old launcher folder alone', () => {
  assert.equal(S.relocatePath('C:\\Program Files (x86)\\PlayOnline', 'E:\\XI-Launcher', 'F:\\XI-Launcher'), 'C:\\Program Files (x86)\\PlayOnline');
  assert.equal(S.relocatePath('E:\\XI-Launcher2\\x', 'E:\\XI-Launcher', 'F:\\XI-Launcher'), 'E:\\XI-Launcher2\\x', 'a sibling with the same prefix is not inside');
  assert.equal(S.relocatePath(undefined, 'E:\\a', 'F:\\a'), undefined);
  assert.equal(S.relocatePath('', 'E:\\a', 'F:\\a'), '');
});

test('rebaseClientCopy finds a launcher-managed copy under the current runtime folder', () => {
  assert.equal(
    S.rebaseClientCopy('E:\\XI-Launcher\\runtime\\clients\\LevelDown\\FINAL FANTASY XI', 'F:\\XI\\runtime'),
    'F:\\XI\\runtime\\clients\\LevelDown\\FINAL FANTASY XI'
  );
  assert.equal(S.rebaseClientCopy('D:\\Games\\LevelDown\\FINAL FANTASY XI', 'F:\\XI\\runtime'), null, 'not a launcher-managed copy');
  assert.equal(S.rebaseClientCopy(null, 'F:\\XI\\runtime'), null);
});

const DEFAULT_ASHITA = 'C:\\XI-Launcher\\runtime\\ashita';
const gone = () => false;
const present = () => true;

test('staleRuntimePath resets a saved launcher folder whose old launcher is gone', () => {
  assert.equal(
    S.staleRuntimePath('D:\\Games\\FFXI\\Xi Launcher\\runtime\\ashita', DEFAULT_ASHITA, gone),
    DEFAULT_ASHITA
  );
  assert.equal(
    S.staleRuntimePath('d:/games/ffxi/xi launcher/runtime/xiloader/', 'C:\\XI-Launcher\\runtime\\xiloader', gone),
    'C:\\XI-Launcher\\runtime\\xiloader'
  );
});

test('staleRuntimePath checks the runtime folder, not the ashita folder', () => {
  const seen = [];
  S.staleRuntimePath('D:\\Old\\runtime\\ashita', DEFAULT_ASHITA, (p) => { seen.push(p); return false; });
  assert.deepEqual(seen, ['D:\\Old\\runtime']);
});

test('staleRuntimePath keeps a saved path whose launcher folder still exists', () => {
  assert.equal(S.staleRuntimePath('D:\\Old\\runtime\\ashita', DEFAULT_ASHITA, present), 'D:\\Old\\runtime\\ashita');
});

test('staleRuntimePath never touches a path the user chose elsewhere', () => {
  assert.equal(S.staleRuntimePath('E:\\Tools\\Ashita', DEFAULT_ASHITA, gone), 'E:\\Tools\\Ashita');
  assert.equal(S.staleRuntimePath('E:\\runtime\\ashita-backup', DEFAULT_ASHITA, gone), 'E:\\runtime\\ashita-backup');
  assert.equal(S.staleRuntimePath('E:\\runtime\\clients\\ashita', DEFAULT_ASHITA, gone), 'E:\\runtime\\clients\\ashita');
});

test('staleRuntimePath leaves the current default and empty values alone', () => {
  assert.equal(S.staleRuntimePath('c:\\xi-launcher\\runtime\\ashita\\', DEFAULT_ASHITA, gone), 'c:\\xi-launcher\\runtime\\ashita\\');
  assert.equal(S.staleRuntimePath(undefined, DEFAULT_ASHITA, gone), undefined);
  assert.equal(S.staleRuntimePath('', DEFAULT_ASHITA, gone), '');
});

const INSTALLED = 'C:\\Program Files (x86)\\PlayOnline\\SquareEnix\\FINAL FANTASY XI';

test('resolveGameFiles uses the sandboxed copy the profile chose', () => {
  const gf = S.resolveGameFiles({ settings: { gameFiles: 'sandbox', sandboxFolder: 'C:\\XI-Launcher\\Leveldown' }, ini: PROFILE, installedFfxiPath: INSTALLED });
  assert.deepEqual(gf, { mode: 'sandbox', chosen: true, folder: 'C:\\XI-Launcher\\Leveldown', ...LD_PATHS });
});

test('resolveGameFiles uses the installed game when chosen, even if the ini had Sandbox on', () => {
  const ini = S.setSandbox(PROFILE, true, LD_PATHS);
  const gf = S.resolveGameFiles({ settings: { gameFiles: 'installed', sandboxFolder: 'C:\\XI-Launcher\\Leveldown' }, ini, installedFfxiPath: INSTALLED });
  assert.deepEqual(gf, { mode: 'installed', chosen: true, ffxi: INSTALLED });
});

test('resolveGameFiles falls back to installed when sandbox has no folder', () => {
  const gf = S.resolveGameFiles({ settings: { gameFiles: 'sandbox' }, ini: PROFILE, installedFfxiPath: INSTALLED });
  assert.equal(gf.mode, 'installed');
});

test('resolveGameFiles keeps a hand-enabled Sandbox ini working until the player chooses', () => {
  const ini = S.setSandbox(PROFILE, true, LD_PATHS);
  const gf = S.resolveGameFiles({ settings: {}, ini, installedFfxiPath: INSTALLED });
  assert.deepEqual(gf, { mode: 'sandbox', chosen: false, folder: 'C:\\XI-Launcher\\Leveldown', ...LD_PATHS });
  assert.deepEqual(S.resolveGameFiles({ settings: null, ini: PROFILE, installedFfxiPath: INSTALLED }), { mode: 'installed', chosen: false, ffxi: INSTALLED });
});

test('planGameFilesSync writes Sandbox to match the choice, or returns null when already right', () => {
  const sandboxed = S.planGameFilesSync(PROFILE, { mode: 'sandbox', chosen: true, ...LD_PATHS });
  assert.equal(S.isSandboxEnabled(sandboxed), true);
  assert.deepEqual(S.readSandboxPaths(sandboxed), LD_PATHS);
  assert.equal(S.planGameFilesSync(sandboxed, { mode: 'sandbox', chosen: true, ...LD_PATHS }), null);

  const off = S.planGameFilesSync(sandboxed, { mode: 'installed', chosen: true, ffxi: INSTALLED });
  assert.equal(S.isSandboxEnabled(off), false);
  assert.equal(S.planGameFilesSync(PROFILE, { mode: 'installed', chosen: true, ffxi: INSTALLED }), null);
  // Never chosen: leave the ini as the player wrote it.
  assert.equal(S.planGameFilesSync(PROFILE, { mode: 'installed', chosen: false, ffxi: INSTALLED }), null);
});
