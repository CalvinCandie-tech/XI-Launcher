# Custom Plugin/Addon Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Import" button to the Plugins and Addons tabs that lets users copy any `.dll` plugin or addon folder from disk into the correct Ashita directory, with conflict detection.

**Architecture:** Two new IPC handlers in `main.js` open native file dialogs internally (never passing user paths through IPC to avoid `isAllowedPath` restrictions on arbitrary disk locations), copy the files, and return results. The React tabs add an Import button to the toolbar and show a brief status banner. Imported items appear automatically in the existing "unlisted/detected" card sections via the existing directory scan.

**Tech Stack:** Electron (IPC, dialog, fs), React (useState, existing CSS classes)

---

## File Map

| File | Change |
|---|---|
| `electron/main.js` | Add `import-custom-plugin` + `import-custom-addon` handlers after line 661 (after `browse-folder`) |
| `electron/preload.js` | Add `importCustomPlugin` + `importCustomAddon` after line 16 (after `browseFolder`) |
| `src/tabs/PluginsTab.js` | Add `importMsg` state, `handleImportPlugin` fn, Import button in toolbar, status banner |
| `src/tabs/AddonsTab.js` | Add unlisted-addon section, `importMsg` state, `handleImportAddon` fn, Import button in toolbar, status banner |

---

## Task 1: `import-custom-plugin` IPC handler

**Files:**
- Modify: `electron/main.js` — insert after line 661 (end of `browse-folder` handler)

- [ ] **Step 1: Add the handler**

Insert this block immediately after the closing `});` of the `browse-folder` handler (after line 661):

```js
  ipcMain.handle('import-custom-plugin', async (_, ashitaPath) => {
    const pluginsDir = path.join(ashitaPath, 'plugins');
    if (!isAllowedPath(pluginsDir)) return { error: 'Invalid Ashita path.' };

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Plugin',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Ashita Plugin', extensions: ['dll'] }]
    });
    if (result.canceled) return { canceled: true };

    const selected = result.filePaths[0];
    const stat = fs.statSync(selected);

    let dlls;
    if (stat.isDirectory()) {
      dlls = fs.readdirSync(selected)
        .filter(f => f.toLowerCase().endsWith('.dll'))
        .map(f => path.join(selected, f));
      if (dlls.length === 0) return { error: 'No .dll file found in that folder.' };
    } else {
      dlls = [selected];
    }

    const imported = [];
    const skipped = [];
    for (const src of dlls) {
      const name = path.basename(src);
      const dest = path.join(pluginsDir, name);
      if (fs.existsSync(dest)) {
        const confirm = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Replace', 'Skip'],
          defaultId: 1,
          title: 'Plugin Already Installed',
          message: `${name} is already installed. Replace it?`
        });
        if (confirm.response !== 0) { skipped.push(name); continue; }
      }
      if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
      fs.copyFileSync(src, dest);
      imported.push(path.basename(name, '.dll'));
    }
    return { imported, skipped };
  });
```

- [ ] **Step 2: Verify no syntax error**

Open `electron/main.js` and confirm the block is well-formed (no unclosed braces). The file should still parse — run `node --check electron/main.js` from the `xi-launcher` directory.

Expected: no output (clean parse).

---

## Task 2: `import-custom-addon` IPC handler

**Files:**
- Modify: `electron/main.js` — insert immediately after the Task 1 handler

- [ ] **Step 1: Add the handler**

Insert this block immediately after the closing `});` of the `import-custom-plugin` handler:

```js
  ipcMain.handle('import-custom-addon', async (_, ashitaPath) => {
    const addonsDir = path.join(ashitaPath, 'addons');
    if (!isAllowedPath(addonsDir)) return { error: 'Invalid Ashita path.' };

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Addon',
      properties: ['openDirectory']
    });
    if (result.canceled) return { canceled: true };

    const selected = result.filePaths[0];
    const folderName = path.basename(selected);

    const hasEntry =
      fs.existsSync(path.join(selected, `${folderName}.lua`)) ||
      fs.existsSync(path.join(selected, 'main.lua'));
    if (!hasEntry) {
      return { error: `No .lua entry point found — expected ${folderName}.lua or main.lua.` };
    }

    const dest = path.join(addonsDir, folderName);
    if (fs.existsSync(dest)) {
      const confirm = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Replace', 'Skip'],
        defaultId: 1,
        title: 'Addon Already Installed',
        message: `${folderName} is already installed. Replace it?`
      });
      if (confirm.response !== 0) return { skipped: folderName };
    }

    copyRecursive(selected, dest);
    return { imported: folderName };
  });
```

- [ ] **Step 2: Verify no syntax error**

```
node --check electron/main.js
```

Expected: no output.

---

## Task 3: Expose API in preload.js

**Files:**
- Modify: `electron/preload.js` — add two entries after line 16 (`browseFolder` entry)

- [ ] **Step 1: Add entries**

After this line in `preload.js`:
```js
  browseFolder: (defaultPath) => ipcRenderer.invoke('browse-folder', defaultPath),
```

Add:
```js
  importCustomPlugin: (ashitaPath) => ipcRenderer.invoke('import-custom-plugin', ashitaPath),
  importCustomAddon:  (ashitaPath) => ipcRenderer.invoke('import-custom-addon',  ashitaPath),
```

- [ ] **Step 2: Verify**

```
node --check electron/preload.js
```

Expected: no output.

---

## Task 4: PluginsTab — Import button and status banner

**Files:**
- Modify: `src/tabs/PluginsTab.js`

The toolbar in PluginsTab is the `panel plugins-status-bar` div. The refresh button is currently at the far right of `plugins-search-wrapper`. We'll add the Import button next to it, and a status banner immediately below the toolbar.

- [ ] **Step 1: Add `importMsg` state and handler**

After the existing `const [categoryFilter, setCategoryFilter] = useState('All');` line (around line 175), add:

```js
  const [importMsg, setImportMsg] = useState(null); // { success: bool, text: string }

  const handleImportPlugin = async () => {
    if (!config?.ashitaPath) return;
    const result = await api.importCustomPlugin(config.ashitaPath);
    if (!result || result.canceled) return;
    if (result.error) {
      setImportMsg({ success: false, text: result.error });
      return;
    }
    await loadInstalled();
    if (result.imported?.length > 0) {
      const names = result.imported.join(', ');
      setImportMsg({ success: true, text: `${names} imported. Toggle it on when ready.` });
      setTimeout(() => setImportMsg(null), 4000);
    }
  };
```

- [ ] **Step 2: Add Import button to toolbar**

Find this line in the JSX (around line 230):
```jsx
          <button className="btn btn-ghost btn-sm" onClick={() => { loadInstalled(); loadEnabled(); }}>&#8635; Refresh</button>
```

Add the Import button immediately before it:
```jsx
          <button className="btn btn-ghost btn-sm" onClick={handleImportPlugin}>+ Import</button>
```

- [ ] **Step 3: Add status banner**

Find the closing `</div>` of the `panel plugins-status-bar` div (the one that wraps the whole toolbar). Add the banner immediately after it:

```jsx
      {importMsg && (
        <div className={`plugin-status-msg ${importMsg.success ? 'success' : 'error'}`} style={{ margin: '0 0 8px' }}>
          {importMsg.text}
        </div>
      )}
```

- [ ] **Step 4: Manual smoke test**

Start the launcher (`npm start`), go to Plugins tab. Confirm:
- "Import" button appears next to Refresh
- Clicking Import opens a file picker that accepts `.dll` files and folders
- Picking a valid `.dll` copies it and shows a green success banner that fades after 4s
- The imported plugin appears in the "Detected" unlisted section
- Picking a folder with no `.dll` shows a red error banner
- Canceling the dialog does nothing

---

## Task 5: AddonsTab — Unlisted section + Import button and status banner

**Files:**
- Modify: `src/tabs/AddonsTab.js`

AddonsTab currently has no section for addons installed on disk but not in the catalogue. Imported custom addons need somewhere to appear, so we add a "Custom / Detected" unlisted section. The Import button goes in the existing `addons-toolbar-right`.

- [ ] **Step 1: Add `importMsg` state and handler**

After the existing `const [checkMsg, setCheckMsg] = useState('');` line (around line 206), add:

```js
  const [importMsg, setImportMsg] = useState(null); // { success: bool, text: string }

  const handleImportAddon = async () => {
    if (!config?.ashitaPath) return;
    const result = await api.importCustomAddon(config.ashitaPath);
    if (!result || result.canceled) return;
    if (result.error) {
      setImportMsg({ success: false, text: result.error });
      return;
    }
    await loadAddons();
    if (result.imported) {
      setImportMsg({ success: true, text: `${result.imported} imported. Toggle it on when ready.` });
      setTimeout(() => setImportMsg(null), 4000);
    }
  };
```

- [ ] **Step 2: Add Import button to toolbar**

In the `addons-toolbar-right` div, find the refresh button:
```jsx
          <button className="btn btn-ghost btn-sm" onClick={loadAddons}>↻</button>
```

Add the Import button immediately before it:
```jsx
          <button className="btn btn-ghost btn-sm" onClick={handleImportAddon}>+ Import</button>
```

- [ ] **Step 3: Add status banner below toolbar**

Find the closing `</div>` of the `panel addons-toolbar` div (around line 722). Add the banner immediately after it:

```jsx
      {importMsg && (
        <div className={`addon-install-msg ${importMsg.success ? 'success' : 'error'}`} style={{ margin: '0 0 8px' }}>
          {importMsg.text}
        </div>
      )}
```

- [ ] **Step 4: Add unlisted addon section**

Build the set of catalogue names to compare against. Add this derived variable in the render body, before the `return (` statement. Find a good place near the other derived values (around line 680, before the JSX return):

```js
  const catalogueNames = new Set(
    ADDON_CATALOGUE.map(a => (a.installAs || a.name).toLowerCase())
  );
  const unlistedInstalled = installedAddons.filter(n => !catalogueNames.has(n));
```

- [ ] **Step 5: Render the unlisted section**

Find the closing `</div>` before `<div className="addons-credit">` (around line 1017). Insert this block immediately before it:

```jsx
      {unlistedInstalled.length > 0 && (
        <div>
          <div className="section-header">Custom / Detected</div>
          <div className="addons-grid">
            {unlistedInstalled.map(name => {
              const isEnabled = enabledAddons.includes(name);
              return (
                <div key={name} className={`addon-card ${isEnabled ? 'enabled' : ''}`}>
                  <div className="addon-card-header">
                    <span className="addon-name mono">{name}</span>
                    <span className="addon-installed-tag">Detected</span>
                  </div>
                  <p className="addon-desc">Addon found in your addons folder.</p>
                  <div className="addon-card-footer">
                    <div className="addon-card-footer-left">
                      <div className="toggle" onClick={() => toggleAddon(name)}>
                        <input type="checkbox" checked={isEnabled} readOnly />
                        <span className="toggle-slider" />
                      </div>
                      <span className="addon-status-label">{isEnabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
```

- [ ] **Step 6: Manual smoke test**

Start the launcher, go to Addons tab. Confirm:
- "Import" button appears in the toolbar
- Clicking Import opens a folder picker
- Picking a valid addon folder (with `<name>.lua` or `main.lua`) copies it and shows a green banner
- The imported addon appears in the "Custom / Detected" section at the bottom
- The toggle works — enables/disables the addon in the boot script
- Picking a folder with no `.lua` entry shows a red error banner
- Picking a folder that already exists as an addon shows the native OS confirm dialog
- Canceling does nothing

---

## Task 6: End-to-end verify and commit

- [ ] **Step 1: Full flow test — plugins**
  1. Download any Ashita plugin `.dll` to your Downloads folder
  2. Import via button — confirm it appears as "Detected" in Plugins tab
  3. Enable it — restart launcher, confirm it's still enabled
  4. Import it again — confirm the "already installed" native dialog appears
  5. Choose Skip — confirm nothing changes

- [ ] **Step 2: Full flow test — addons**
  1. Copy any Ashita addon folder to your Desktop
  2. Import via button — confirm it appears in "Custom / Detected" section
  3. Enable it — confirm `/addon load <name>` is written to boot script
  4. Import it again — confirm native conflict dialog appears

- [ ] **Step 3: Error flow test**
  - Import a folder with no `.dll` (plugins) → red banner "No .dll file found in that folder."
  - Import a folder with no `.lua` (addons) → red banner "No .lua entry point found..."
  - Cancel both dialogs → nothing happens, no error

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload.js src/tabs/PluginsTab.js src/tabs/AddonsTab.js
git commit -m "feat: add custom plugin/addon import from disk

Import button in Plugins and Addons tabs lets users browse for any
.dll plugin or addon folder and copy it into the correct Ashita
directory. Conflict detection uses native OS dialog. Imported items
appear immediately in the unlisted/detected card sections."
```
