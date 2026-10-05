const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./windowState');

const FHD = { x: 0, y: 0, width: 1920, height: 1040 };       // 1080p minus taskbar
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1400 };  // second monitor to the right

test('first launch (nothing saved) opens at the default size, centred', () => {
  assert.deepEqual(W.restoreWindowState(undefined, [FHD]), { width: 1200, height: 800, maximized: false });
});

test('a saved size and position on a connected screen are restored', () => {
  const saved = { x: 100, y: 50, width: 1400, height: 900, maximized: false };
  assert.deepEqual(W.restoreWindowState(saved, [FHD]), saved);
});

test('a position on a second monitor is kept while that monitor is connected', () => {
  const saved = { x: 2200, y: 100, width: 1300, height: 850, maximized: true };
  assert.deepEqual(W.restoreWindowState(saved, [FHD, RIGHT]), saved);
});

test('a position on an unplugged monitor is dropped so the window opens centred', () => {
  const saved = { x: 2200, y: 100, width: 1300, height: 850, maximized: false };
  assert.deepEqual(W.restoreWindowState(saved, [FHD]), { width: 1300, height: 850, maximized: false });
});

test('a title bar pushed above the screen is not restored there', () => {
  const saved = { x: 100, y: -300, width: 1200, height: 800 };
  assert.deepEqual(W.restoreWindowState(saved, [FHD]), { width: 1200, height: 800, maximized: false });
});

test('a size bigger than the screen is shrunk to fit it', () => {
  const saved = { x: 0, y: 0, width: 2400, height: 1500 };
  assert.deepEqual(W.restoreWindowState(saved, [FHD]), { x: 0, y: 0, width: 1920, height: 1040, maximized: false });
});

test('a saved size below the minimum is raised to it, and junk values are ignored', () => {
  assert.deepEqual(W.restoreWindowState({ width: 400, height: 300 }, [FHD]), { width: 760, height: 560, maximized: false });
  assert.deepEqual(W.restoreWindowState({ width: 'big', height: NaN, x: null, maximized: 'yes' }, [FHD]), { width: 1200, height: 800, maximized: false });
});
