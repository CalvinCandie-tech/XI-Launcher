# Addon Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check for community addon updates on launcher startup (once per 24h) and prompt the user with a checklist modal to confirm which addons to update.

**Architecture:** The main process gets a new `check-addon-updates` IPC handler that compares stored commit SHAs against GitHub's latest. The renderer triggers this on mount and displays an `UpdateModal` component when updates are found. The existing `install-addon` handler is extended to return the latest commit SHA so it can be stored after each install.

**Tech Stack:** Electron IPC, GitHub REST API, React, electron-store

---

### Task 1: Store commit SHA after addon install (main process)

**Files:**
- Modify: `electron/main.js:1814-1928` (install-addon handler)

After a successful install, fetch the latest commit SHA from the GitHub API and return it alongside the success message. Also store it in electron-store.

- [ ] **Step 1: Add SHA fetch after successful install**

In `electron/main.js`, find the return statement at line 1924:
```javascript
      return { success: true, message: `${addonName} installed - ${fileCount} files` };
```

Replace it with:
```javascript
      // Fetch latest commit SHA for version tracking
      let latestSha = null;
      try {
        latestSha = await new Promise((resolve, reject) => {
          https.get({
            hostname: 'api.github.com',
            path: `/repos/${repo}/commits?per_page=1`,
            headers: { 'User-Agent': 'XI-Launcher' }
          }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
              try {
                const commits = JSON.parse(data);
                resolve(Array.isArray(commits) && commits.length > 0 ? commits[0].sha : null);
              } catch { resolve(null); }
            });
          }).on('error', () => resolve(null));
        });
      } catch { /* SHA fetch is best-effort */ }

      if (latestSha && store) {
        const shas = store.get('addonUpdateSHAs', {});
        shas[addonName] = { sha: latestSha, repo, subdir: subdir || null };
        store.set('addonUpdateSHAs', shas);
      }

      return { success: true, message: `${addonName} installed - ${fileCount} files` };
```

Note: `https` is already imported at the top of main.js. `store` is the electron-store instance already available in this scope.

- [ ] **Step 2: Verify the change doesn't break the build**

Run: `cd "C:/Users/Calvin Candie/xi-launcher" && npx react-scripts build`
Expected: Build succeeds (this is main process code so react-scripts won't catch syntax errors, but it validates the project still builds).

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Calvin Candie/xi-launcher"
git add electron/main.js
git commit -m "feat: store commit SHA after addon install for update tracking"
```

---

### Task 2: Add check-addon-updates IPC handler (main process)

**Files:**
- Modify: `electron/main.js:1928-1929` (after install-addon handler, before closing brace of `registerIpcHandlers`)

Add a new IPC handler that accepts a list of addon catalogue entries, checks stored SHAs against GitHub, and returns a list of addons with available updates.

- [ ] **Step 1: Add the handler**

Insert the following before the closing `}` of `registerIpcHandlers()` (after the `install-addon` handler block, around line 1929):

```javascript
  // Check for addon updates by comparing stored SHAs against GitHub
  ipcMain.handle('check-addon-updates', async (_, addonList) => {
    try {
      if (!store) return { updates: [] };

      // Enforce 24-hour cooldown
      const lastCheck = store.get('addonUpdateLastCheck', 0);
      const now = Date.now();
      if (now - lastCheck < 24 * 60 * 60 * 1000) {
        return { updates: [], skipped: true };
      }

      const shas = store.get('addonUpdateSHAs', {});
      const updates = [];

      for (const addon of addonList) {
        const stored = shas[addon.name];
        if (!stored || !stored.sha) continue;

        try {
          const remoteSha = await new Promise((resolve, reject) => {
            https.get({
              hostname: 'api.github.com',
              path: `/repos/${addon.repo}/commits?per_page=1`,
              headers: { 'User-Agent': 'XI-Launcher' }
            }, (res) => {
              let data = '';
              res.on('data', (chunk) => data += chunk);
              res.on('end', () => {
                try {
                  const commits = JSON.parse(data);
                  resolve(Array.isArray(commits) && commits.length > 0 ? commits[0].sha : null);
                } catch { resolve(null); }
              });
            }).on('error', () => resolve(null));
          });

          if (remoteSha && remoteSha !== stored.sha) {
            updates.push({ name: addon.name, repo: addon.repo, subdir: addon.subdir || null });
          }
        } catch {
          // Skip addons that fail to check
        }
      }

      store.set('addonUpdateLastCheck', now);
      return { updates };
    } catch (e) {
      console.error('[check-addon-updates]', e.message);
      return { updates: [], error: e.message };
    }
  });
```

- [ ] **Step 2: Commit**

```bash
cd "C:/Users/Calvin Candie/xi-launcher"
git add electron/main.js
git commit -m "feat: add check-addon-updates IPC handler with 24h cooldown"
```

---

### Task 3: Expose new IPC methods in preload

**Files:**
- Modify: `electron/preload.js:118-124` (addon section)

Add `checkAddonUpdates` alongside the existing addon methods.

- [ ] **Step 1: Add the new API method**

In `electron/preload.js`, find the addon section (line 118-119):
```javascript
  // Community addon install
  installAddon: (ashitaPath, addonName, repo, subdir) => ipcRenderer.invoke('install-addon', ashitaPath, addonName, repo, subdir),
```

Add `checkAddonUpdates` right before that block:
```javascript
  // Addon update check
  checkAddonUpdates: (addonList) => ipcRenderer.invoke('check-addon-updates', addonList),

  // Community addon install
  installAddon: (ashitaPath, addonName, repo, subdir) => ipcRenderer.invoke('install-addon', ashitaPath, addonName, repo, subdir),
```

- [ ] **Step 2: Commit**

```bash
cd "C:/Users/Calvin Candie/xi-launcher"
git add electron/preload.js
git commit -m "feat: expose checkAddonUpdates in preload API"
```

---

### Task 4: Create UpdateModal component

**Files:**
- Create: `src/components/UpdateModal.js`
- Create: `src/components/UpdateModal.css`

A modal overlay with a checklist of outdated addons and Update/Skip buttons. Follows the same overlay pattern used by `SetupWizard`.

- [ ] **Step 1: Create UpdateModal.css**

Create `src/components/UpdateModal.css`:

```css
.update-overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 7, 9, 0.92);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.update-dialog {
  width: 440px;
  max-height: 70vh;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.update-header {
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--border);
}

.update-header h3 {
  font-family: 'Cinzel', serif;
  color: var(--gold);
  font-size: 16px;
  margin: 0 0 4px;
}

.update-header p {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0;
}

.update-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 24px;
}

.update-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.update-item:last-child {
  border-bottom: none;
}

.update-item input[type="checkbox"] {
  accent-color: var(--gold);
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.update-item-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: var(--text-primary);
}

.update-footer {
  padding: 14px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.update-progress {
  padding: 14px 24px;
  border-top: 1px solid var(--border);
}

.update-progress-text {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.update-progress-bar {
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.update-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--teal), var(--gold));
  transition: width 0.3s ease;
}
```

- [ ] **Step 2: Create UpdateModal.js**

Create `src/components/UpdateModal.js`:

```javascript
import React, { useState } from 'react';
import './UpdateModal.css';

const api = window.xiAPI;

function UpdateModal({ updates, ashitaPath, onClose }) {
  const [checked, setChecked] = useState(() =>
    updates.reduce((acc, u) => ({ ...acc, [u.name]: true }), {})
  );
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState(null); // { current, total, name }

  const selectedCount = Object.values(checked).filter(Boolean).length;

  const toggleItem = (name) => {
    if (updating) return;
    setChecked(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const handleUpdate = async () => {
    const selected = updates.filter(u => checked[u.name]);
    if (selected.length === 0) return;
    setUpdating(true);

    for (let i = 0; i < selected.length; i++) {
      const addon = selected[i];
      setProgress({ current: i + 1, total: selected.length, name: addon.name });
      await api.installAddon(ashitaPath, addon.name, addon.repo, addon.subdir);
    }

    setUpdating(false);
    onClose();
  };

  return (
    <div className="update-overlay">
      <div className="update-dialog">
        <div className="update-header">
          <h3>Addon Updates Available</h3>
          <p>{updates.length} addon{updates.length !== 1 ? 's' : ''} can be updated</p>
        </div>
        <div className="update-list">
          {updates.map(u => (
            <label key={u.name} className="update-item" style={{ cursor: updating ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                checked={checked[u.name]}
                onChange={() => toggleItem(u.name)}
                disabled={updating}
              />
              <span className="update-item-name">{u.name}</span>
            </label>
          ))}
        </div>
        {updating && progress ? (
          <div className="update-progress">
            <div className="update-progress-text">
              Updating {progress.name} ({progress.current}/{progress.total})
            </div>
            <div className="update-progress-bar">
              <div
                className="update-progress-fill"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="update-footer">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              Skip
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleUpdate}
              disabled={selectedCount === 0}
            >
              Update {selectedCount > 0 ? `(${selectedCount})` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default UpdateModal;
```

- [ ] **Step 3: Verify the build**

Run: `cd "C:/Users/Calvin Candie/xi-launcher" && npx react-scripts build`
Expected: Build succeeds (component isn't rendered yet, but must compile).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/Calvin Candie/xi-launcher"
git add src/components/UpdateModal.js src/components/UpdateModal.css
git commit -m "feat: add UpdateModal component for addon update prompt"
```

---

### Task 5: Trigger update check from App.js and render modal

**Files:**
- Modify: `src/App.js:1-11` (imports)
- Modify: `src/App.js:140-146` (after the existing update check useEffect)
- Modify: `src/App.js:407-448` (render, add modal)
- Modify: `src/tabs/AddonsTab.js:6-62` (export catalogue for reuse)

The catalogue of community addons needs to be accessible from App.js. The simplest approach: export `ADDON_CATALOGUE` from AddonsTab.js so App.js can import and filter it.

- [ ] **Step 1: Export ADDON_CATALOGUE from AddonsTab.js**

In `src/tabs/AddonsTab.js`, change line 6 from:
```javascript
const ADDON_CATALOGUE = [
```
to:
```javascript
export const ADDON_CATALOGUE = [
```

- [ ] **Step 2: Add imports and state to App.js**

In `src/App.js`, add `UpdateModal` import and the catalogue import after line 11:

```javascript
import UpdateModal from './components/UpdateModal';
import { ADDON_CATALOGUE } from './tabs/AddonsTab';
```

Add state for addon updates. After line 21 (`const [updateInfo, setUpdateInfo] = useState(null);`):

```javascript
  const [addonUpdates, setAddonUpdates] = useState([]);
```

- [ ] **Step 3: Add update check useEffect**

After the existing "Check for updates on startup" useEffect (line 146), add:

```javascript
  // Check for addon updates on startup
  useEffect(() => {
    if (!api?.checkAddonUpdates || !config?.ashitaPath) return;
    const communityAddons = ADDON_CATALOGUE.filter(a => a.category === 'Community' && a.repo);
    api.checkAddonUpdates(communityAddons).then(result => {
      if (result?.updates?.length > 0) {
        setAddonUpdates(result.updates);
      }
    });
  }, [config?.ashitaPath]);
```

- [ ] **Step 4: Render UpdateModal in the JSX**

In `src/App.js`, find line 419-425:

```javascript
      {showWizard && (
        <SetupWizard
          config={config}
          updateConfig={updateConfig}
          onComplete={() => setShowWizard(false)}
        />
      )}
```

Add the UpdateModal right after:

```javascript
      {addonUpdates.length > 0 && !showWizard && (
        <UpdateModal
          updates={addonUpdates}
          ashitaPath={config.ashitaPath}
          onClose={() => setAddonUpdates([])}
        />
      )}
```

- [ ] **Step 5: Verify the build**

Run: `cd "C:/Users/Calvin Candie/xi-launcher" && npx react-scripts build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/Calvin Candie/xi-launcher"
git add src/App.js src/tabs/AddonsTab.js src/components/UpdateModal.js
git commit -m "feat: trigger addon update check on startup and show update modal"
```

---

### Task 6: Manual test and verify end-to-end

- [ ] **Step 1: Start the app in dev mode**

Run: `cd "C:/Users/Calvin Candie/xi-launcher" && npm start`

Verify:
1. App launches without errors in the console.
2. If community addons have been installed before (they won't have SHAs stored yet, so no modal should appear on first run after this change).
3. Go to Addons tab, install or reinstall a community addon. Check the console for any errors.
4. To test the modal, you can temporarily set `addonUpdateLastCheck` to 0 and manually add a fake SHA entry in the store, then restart.

- [ ] **Step 2: Commit any fixes if needed**

```bash
cd "C:/Users/Calvin Candie/xi-launcher"
git add -A
git commit -m "fix: address issues found during manual testing"
```
