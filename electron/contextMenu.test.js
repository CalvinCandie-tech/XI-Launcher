const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContextMenuTemplate, attachContextMenu } = require('./contextMenu');

const ALL = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const roles = t => t.map(i => i.role || i.type);
const enabledOf = (t, role) => t.find(i => i.role === role).enabled;

test('editable field: full edit menu, every item enabled when all flags are true', () => {
  const t = buildContextMenuTemplate({ isEditable: true, editFlags: ALL, selectionText: '' });
  assert.deepEqual(roles(t), ['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'separator', 'selectAll']);
  assert.ok(t.filter(i => i.role).every(i => i.enabled === true));
});

test('editable field: Paste is disabled when the clipboard cannot paste', () => {
  const t = buildContextMenuTemplate({ isEditable: true, editFlags: { ...ALL, canPaste: false } });
  assert.equal(enabledOf(t, 'paste'), false);
  assert.equal(enabledOf(t, 'cut'), true);
});

test('password-like field: Cut and Copy are greyed out, the rest follow their flags', () => {
  const t = buildContextMenuTemplate({ isEditable: true, editFlags: { ...ALL, canCut: false, canCopy: false } });
  assert.equal(enabledOf(t, 'cut'), false);
  assert.equal(enabledOf(t, 'copy'), false);
  assert.equal(enabledOf(t, 'paste'), true);
});

test('non-editable text with a selection: Copy only', () => {
  const t = buildContextMenuTemplate({ isEditable: false, selectionText: 'play.example.com', editFlags: ALL });
  assert.deepEqual(roles(t), ['copy']);
});

test('non-editable with whitespace-only selection: no menu', () => {
  assert.deepEqual(buildContextMenuTemplate({ isEditable: false, selectionText: '  \n\t ' }), []);
});

test('non-editable with no selection: no menu', () => {
  assert.deepEqual(buildContextMenuTemplate({ isEditable: false, selectionText: '' }), []);
});

test('attachContextMenu pops up only when the template is non-empty', () => {
  let handler;
  const wc = { on: (ev, fn) => { assert.equal(ev, 'context-menu'); handler = fn; } };
  const popups = [];
  const Menu = { buildFromTemplate: t => ({ popup: () => popups.push(t) }) };
  attachContextMenu(wc, Menu);
  handler({}, { isEditable: false, selectionText: '' });
  assert.equal(popups.length, 0);
  handler({}, { isEditable: true, editFlags: ALL });
  assert.equal(popups.length, 1);
});
