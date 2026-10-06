// Right-click menu for text boxes and selected text. Electron shows no context menu on its
// own, so right-clicking an input did nothing. Kept free of any `electron` import so the
// template logic is unit-testable; main.js passes `Menu` in.

function buildContextMenuTemplate(params) {
  if (params.isEditable) {
    const flags = params.editFlags || {};
    return [
      { role: 'undo', enabled: !!flags.canUndo },
      { role: 'redo', enabled: !!flags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: !!flags.canCut },
      { role: 'copy', enabled: !!flags.canCopy },
      { role: 'paste', enabled: !!flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: !!flags.canSelectAll }
    ];
  }
  if (params.selectionText && params.selectionText.trim()) {
    return [{ role: 'copy' }];
  }
  return [];
}

function attachContextMenu(webContents, Menu) {
  webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params);
    if (template.length > 0) Menu.buildFromTemplate(template).popup();
  });
}

module.exports = { buildContextMenuTemplate, attachContextMenu };
