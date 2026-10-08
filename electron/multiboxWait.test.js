const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./multiboxWait');

// ---- loaderProcessName: the name Get-Process knows the profile's loader by ----

test('loaderProcessName strips the folder and .exe', () => {
  assert.equal(W.loaderProcessName('Z:\\The Vault\\xi-launcher\\runtime\\xiloader\\xiloader.exe'), 'xiloader');
  assert.equal(W.loaderProcessName('C:\\x\\runtime\\loaders\\ldloader\\LDLoader.EXE'), 'LDLoader');
  assert.equal(W.loaderProcessName('"C:\\Program Files\\My Loader\\my loader.exe"'), 'my loader');
});

test('loaderProcessName gives null when there is no loader (retail boots PlayOnline)', () => {
  assert.equal(W.loaderProcessName(''), null);
  assert.equal(W.loaderProcessName(null), null);
  assert.equal(W.loaderProcessName(undefined), null);
});

// ---- isGameWindowTitle: the player's rule — ready once the title is no longer the loader's ----

test('isGameWindowTitle: the loader console title is not the game', () => {
  assert.equal(W.isGameWindowTitle('xiloader', 'xiloader'), false);
  assert.equal(W.isGameWindowTitle('C:\\x\\runtime\\xiloader\\xiloader.exe', 'xiloader'), false);
  assert.equal(W.isGameWindowTitle('Administrator: C:\\x\\ldloader.exe', 'ldloader'), false);
  assert.equal(W.isGameWindowTitle('XILOADER', 'xiloader'), false);
});

test('isGameWindowTitle: no window yet (Windows Terminal hosts the console) is not the game', () => {
  assert.equal(W.isGameWindowTitle('', 'xiloader'), false);
  assert.equal(W.isGameWindowTitle('   ', 'xiloader'), false);
  assert.equal(W.isGameWindowTitle(null, 'xiloader'), false);
});

test('isGameWindowTitle: the FFXI window (or a character-name title) is the game', () => {
  assert.equal(W.isGameWindowTitle('FINAL FANTASY XI', 'xiloader'), true);
  assert.equal(W.isGameWindowTitle('Clarey', 'xiloader'), true);
  assert.equal(W.isGameWindowTitle('FINAL FANTASY XI', 'my loader'), true);
});

test('isGameWindowTitle: a custom loader is matched by its own name', () => {
  assert.equal(W.isGameWindowTitle('C:\\tools\\boot.exe', 'boot'), false);
});

// ---- assessLaunch: one poll of the loader processes for the profile just launched ----

test('assessLaunch: nothing new yet → starting', () => {
  const r = W.assessLaunch({ baselinePids: [100], pid: null }, [{ pid: 100, title: 'FINAL FANTASY XI' }], 'xiloader');
  assert.deepEqual(r, { state: 'starting', pid: null });
});

test('assessLaunch: an earlier client already in game does not count as this one being ready', () => {
  const procs = [{ pid: 100, title: 'FINAL FANTASY XI' }, { pid: 200, title: 'xiloader' }];
  assert.deepEqual(W.assessLaunch({ baselinePids: [100], pid: null }, procs, 'xiloader'), { state: 'waiting', pid: 200 });
});

test('assessLaunch: the new loader showing the game window → ready', () => {
  const procs = [{ pid: 100, title: 'FINAL FANTASY XI' }, { pid: 200, title: 'FINAL FANTASY XI' }];
  assert.deepEqual(W.assessLaunch({ baselinePids: [100], pid: 200 }, procs, 'xiloader'), { state: 'ready', pid: 200 });
});

test('assessLaunch: ready on the very poll that first sees the new loader', () => {
  assert.deepEqual(W.assessLaunch({ baselinePids: [], pid: null }, [{ pid: 7, title: 'FINAL FANTASY XI' }], 'xiloader'),
    { state: 'ready', pid: 7 });
});

test('assessLaunch: the tracked loader is gone → exited (login failed / window closed)', () => {
  const procs = [{ pid: 100, title: 'FINAL FANTASY XI' }];
  assert.deepEqual(W.assessLaunch({ baselinePids: [100], pid: 200 }, procs, 'xiloader'), { state: 'exited', pid: 200 });
});

test('assessLaunch: tolerates a missing process list', () => {
  assert.deepEqual(W.assessLaunch({ baselinePids: [], pid: null }, null, 'xiloader'), { state: 'starting', pid: null });
  assert.deepEqual(W.assessLaunch({ baselinePids: [], pid: 5 }, undefined, 'xiloader'), { state: 'exited', pid: 5 });
});

// ---- parseProcessJson: Get-Process | ConvertTo-Json output ----

test('parseProcessJson handles none, one and many processes', () => {
  assert.deepEqual(W.parseProcessJson(''), []);
  assert.deepEqual(W.parseProcessJson('  \r\n'), []);
  assert.deepEqual(W.parseProcessJson('{"pid":12,"title":"xiloader"}'), [{ pid: 12, title: 'xiloader' }]);
  assert.deepEqual(W.parseProcessJson('[{"pid":1,"title":""},{"pid":2,"title":"FINAL FANTASY XI"}]'),
    [{ pid: 1, title: '' }, { pid: 2, title: 'FINAL FANTASY XI' }]);
});

test('parseProcessJson drops malformed entries and bad JSON', () => {
  assert.deepEqual(W.parseProcessJson('not json'), []);
  assert.deepEqual(W.parseProcessJson('[{"title":"x"},{"pid":3,"title":null}]'), [{ pid: 3, title: '' }]);
});

// ---- buildSnapshotCommand: the PowerShell that lists the loader's processes ----

test('buildSnapshotCommand quotes the process name for PowerShell', () => {
  const cmd = W.buildSnapshotCommand("o'brien loader");
  assert.ok(cmd.includes("-Name 'o''brien loader'"));
  assert.ok(cmd.includes('MainWindowTitle'));
  assert.ok(cmd.includes('ConvertTo-Json'));
});

test('buildSnapshotCommand exits 0 when no loader is running (the usual case for the first client)', () => {
  // -ErrorAction SilentlyContinue still leaves $? false, and powershell -Command then exits 1
  assert.match(W.buildSnapshotCommand('xiloader'), /; exit 0$/);
});
