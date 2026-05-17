# Custom Plugin/Addon Import — Design Spec
**Date:** 2026-05-17

## Problem
Users can only install plugins and addons from the launcher's preset catalogue. Power users and newcomers alike need a way to import third-party or personal plugins/addons that aren't listed, without manually navigating Ashita's folder structure.

## Goals
- Let users import a `.dll` plugin or addon folder from anywhere on disk
- Copy it into the correct Ashita subdirectory automatically
- Have it appear immediately in the existing unlisted card section, ready to toggle
- Warn on name conflicts and ask before overwriting
- No auto-enable — user controls the toggle

## Out of Scope
- Metadata entry (description, category) for imported items — they appear as unlisted cards, same as any unknown installed item today
- Uninstall tracking / manifests for custom imports — user manages their own files
- Drag-and-drop

---

## Architecture

### Security Note
`isAllowedPath()` in `main.js` restricts IPC file access to known install directories (Ashita, FFXI, etc.). A user's Downloads folder would fail this check. The solution: **both the file picker dialog and the copy run inside the IPC handler** in `main.js` — no source path is ever passed from the renderer. Only the destination (`ashitaPath/plugins/` or `ashitaPath/addons/`) is validated via `isAllowedPath`.

---

## Backend (`electron/main.js`)

### `ipcMain.handle('import-custom-plugin', async (_, ashitaPath))`

1. Validate `ashitaPath` via `isAllowedPath`.
2. Open `dialog.showOpenDialog` with `properties: ['openFile', 'openDirectory']` and filter `{ name: 'Plugin', extensions: ['dll'] }`.
3. If canceled → return `{ canceled: true }`.
4. Determine `.dll` files to copy:
   - File selected → single `.dll`
   - Folder selected → scan top-level for `.dll` files; if none found → return `{ error: 'No .dll file found in that folder.' }`
5. For each `.dll`:
   - Check if `ashitaPath/plugins/<name>.dll` already exists.
   - If exists → show `dialog.showMessageBox` (question, Yes/No): `"<name>.dll is already installed. Replace it?"`
   - If user picks No → skip that file (add to `skipped`)
   - Copy via `fs.copyFileSync` → add to `imported`
6. Return `{ imported: string[], skipped: string[] }`.

### `ipcMain.handle('import-custom-addon', async (_, ashitaPath))`

1. Validate `ashitaPath` via `isAllowedPath`.
2. Open `dialog.showOpenDialog` with `properties: ['openDirectory']`.
3. If canceled → return `{ canceled: true }`.
4. Derive `folderName` = `path.basename(selectedPath)`.
5. Validate entry point: check `<selectedPath>/<folderName>.lua` or `<selectedPath>/main.lua` exists. If neither → return `{ error: 'No .lua entry point found — expected <name>.lua or main.lua.' }`.
6. Check if `ashitaPath/addons/<folderName>` already exists.
   - If exists → `dialog.showMessageBox`: `"<folderName> is already installed. Replace it?"`
   - If user picks No → return `{ skipped: folderName }`.
7. Copy via existing `copyRecursive(selectedPath, path.join(ashitaPath, 'addons', folderName))`.
8. Return `{ imported: folderName }`.

---

## Preload (`electron/preload.js`)

Add two entries to the `xiAPI` contextBridge object:

```js
importCustomPlugin: (ashitaPath) => ipcRenderer.invoke('import-custom-plugin', ashitaPath),
importCustomAddon:  (ashitaPath) => ipcRenderer.invoke('import-custom-addon',  ashitaPath),
```

---

## UI (`src/tabs/PluginsTab.js` + `AddonsTab.js`)

### Button placement
"Import" button added to the existing toolbar, right of the filter pills.

### Click handler (same pattern for both tabs)
```
click → api.importCustomPlugin(config.ashitaPath)
      → on { canceled } → do nothing
      → on { error }    → show error status message
      → on { imported, skipped } → loadInstalled() refresh
                                  → show success status message if imported.length > 0
```

### Status messages
Reuse existing `plugin-status-msg` / addon equivalent CSS classes:
- **Success:** `"<name> imported. Toggle it on when ready."` — auto-clears after 4 seconds
- **Error:** `"No .dll file found in that folder."` / `"No .lua entry point found."` — stays until dismissed or next action

### No new modal
Conflict confirmation is handled by the native OS `showMessageBox` inside the IPC handler. The React `Modal` component is not touched.

---

## File Changelist

| File | Change |
|---|---|
| `electron/main.js` | Add `import-custom-plugin` + `import-custom-addon` IPC handlers |
| `electron/preload.js` | Expose `api.importCustomPlugin` + `api.importCustomAddon` |
| `src/tabs/PluginsTab.js` | Import button, status state, click handler |
| `src/tabs/AddonsTab.js` | Import button, status state, click handler |

No new CSS files. Button uses existing `.btn` classes. Status uses existing status message classes.
