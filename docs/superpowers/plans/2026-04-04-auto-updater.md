# Auto-Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app auto-update that checks GitHub Releases, shows a Home tab banner, and downloads/installs updates without leaving the app.

**Architecture:** Upgrade the existing `check-for-updates` IPC handler to also return the zip download URL and release notes. Add two new handlers: `download-and-install-update` (downloads zip, extracts with yauzl, copies files to app dir skipping `runtime/`, relaunches) and `skip-update-version` (persists skip to `runtime/launcher-prefs.json`). The HomeTab banner evolves from a click-to-open-browser link into a full download/install/skip UI with progress bar.

**Tech Stack:** Electron IPC, Node.js `https`, `yauzl` (existing), `fs`, `os.tmpdir()`, `app.relaunch()`

---

### Task 1: Add `skip-update-version` IPC handler and prefs file

**Files:**
- Modify: `electron/main.js:396-431` (update section)

- [ ] **Step 1: Add the `skip-update-version` handler after the existing `check-for-updates` handler**

Insert after line 431 (closing `});` of `check-for-updates`):

```javascript
  ipcMain.handle('skip-update-version', async (_, version) => {
    const prefsPath = path.join(runtimeDir, 'launcher-prefs.json');
    let prefs = {};
    try {
      if (fs.existsSync(prefsPath)) {
        prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      }
    } catch {}
    if (!Array.isArray(prefs.skippedVersions)) prefs.skippedVersions = [];
    if (!prefs.skippedVersions.includes(version)) {
      prefs.skippedVersions.push(version);
    }
    fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf8');
    return { success: true };
  });
```

- [ ] **Step 2: Update `check-for-updates` to read skip list and return download URL**

Replace the existing `check-for-updates` handler (lines 401-431) with:

```javascript
  ipcMain.handle('check-for-updates', async () => {
    try {
      // Read skip list
      const prefsPath = path.join(runtimeDir, 'launcher-prefs.json');
      let skippedVersions = [];
      try {
        if (fs.existsSync(prefsPath)) {
          const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
          skippedVersions = Array.isArray(prefs.skippedVersions) ? prefs.skippedVersions : [];
        }
      } catch {}

      const data = await new Promise((resolve, reject) => {
        https.get(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
          headers: { 'User-Agent': 'XI-Launcher', Accept: 'application/json' }
        }, (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
          });
          res.on('error', reject);
        }).on('error', reject);
      });

      if (!data.tag_name) return { upToDate: true, current: APP_VERSION };

      const latest = data.tag_name.replace(/^v/, '');
      const isNewer = latest.localeCompare(APP_VERSION, undefined, { numeric: true }) > 0;
      const isSkipped = skippedVersions.includes(latest);

      // Find the zip asset for download
      const zipAsset = data.assets?.find(a => a.name.endsWith('.zip'));
      const downloadUrl = zipAsset?.browser_download_url || '';

      return {
        upToDate: !isNewer,
        skipped: isSkipped,
        current: APP_VERSION,
        latest,
        downloadUrl,
        releaseUrl: data.html_url || '',
        releaseNotes: (data.body || '').slice(0, 500)
      };
    } catch {
      return { upToDate: true, current: APP_VERSION, error: 'Could not check for updates' };
    }
  });
```

- [ ] **Step 3: Verify the app launches without errors**

Run: `npm start` — confirm the app opens and the Home tab loads. No console errors related to update checking.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat(updater): add skip-version handler and return download URL from check-for-updates"
```

---

### Task 2: Add `download-and-install-update` IPC handler

**Files:**
- Modify: `electron/main.js` (after the `skip-update-version` handler added in Task 1)

- [ ] **Step 1: Add the download-and-install handler**

Insert after the `skip-update-version` handler:

```javascript
  ipcMain.handle('download-and-install-update', async (_, downloadUrl) => {
    const sendProgress = (percent, detail) => {
      try { mainWindow?.webContents?.send('update-download-progress', percent, detail); } catch {}
    };

    try {
      if (!downloadUrl) return { success: false, error: 'No download URL provided' };

      sendProgress(0, 'Starting download...');

      const tmpDir = path.join(os.tmpdir(), 'xi-launcher-update');
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });

      const tmpFile = path.join(tmpDir, 'update.zip');

      // Download the zip
      await new Promise((resolve, reject) => {
        const download = (url) => {
          https.get(url, { headers: { 'User-Agent': 'XI-Launcher' } }, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
              return download(res.headers.location);
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`Download failed with status ${res.statusCode}`));
            }
            const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
            let receivedBytes = 0;
            const file = fs.createWriteStream(tmpFile);
            res.on('data', (chunk) => {
              receivedBytes += chunk.length;
              file.write(chunk);
              const mb = (receivedBytes / 1048576).toFixed(1);
              if (totalBytes > 0) {
                const pct = Math.round((receivedBytes / totalBytes) * 70);
                const totalMb = (totalBytes / 1048576).toFixed(1);
                sendProgress(pct, `Downloading... ${mb} / ${totalMb} MB`);
              } else {
                sendProgress(Math.min(70, Math.round(receivedBytes / 50000)), `Downloading... ${mb} MB`);
              }
            });
            res.on('end', () => { file.end(); file.on('finish', resolve); });
            res.on('error', reject);
          }).on('error', reject);
        };
        download(downloadUrl);
      });

      sendProgress(75, 'Extracting update...');

      const extractDir = path.join(tmpDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      await extractZip(tmpFile, extractDir);

      sendProgress(85, 'Installing update...');

      // Find the root of the extracted content — may be nested in a folder
      let sourceDir = extractDir;
      const entries = fs.readdirSync(extractDir);
      if (entries.length === 1) {
        const single = path.join(extractDir, entries[0]);
        if (fs.statSync(single).isDirectory()) {
          sourceDir = single;
        }
      }

      // Copy files to app directory, skipping runtime/ and node_modules/
      const copyRecursive = (src, dest) => {
        const items = fs.readdirSync(src);
        for (const item of items) {
          if (item === 'runtime' || item === 'node_modules') continue;
          const srcPath = path.join(src, item);
          const destPath = path.join(dest, item);
          const stat = fs.statSync(srcPath);
          if (stat.isDirectory()) {
            if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
            copyRecursive(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      };

      copyRecursive(sourceDir, appRoot);

      sendProgress(95, 'Cleaning up...');
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

      sendProgress(100, 'Restarting...');

      // Small delay so the renderer sees "Restarting..."
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 1000);

      return { success: true };
    } catch (e) {
      sendProgress(0, '');
      return { success: false, error: e.message || 'Update failed' };
    }
  });
```

- [ ] **Step 2: Verify the app launches without errors**

Run: `npm start` — confirm the app opens. No console errors from the new handler.

- [ ] **Step 3: Commit**

```bash
git add electron/main.js
git commit -m "feat(updater): add download-and-install-update IPC handler with progress"
```

---

### Task 3: Add preload bridge methods

**Files:**
- Modify: `electron/preload.js:68-70` (existing update checker section)

- [ ] **Step 1: Replace the existing update checker section with the full updater API**

Replace lines 68-70:

```javascript
  // Update checker
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
```

With:

```javascript
  // Update checker
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  downloadAndInstallUpdate: (downloadUrl) => ipcRenderer.invoke('download-and-install-update', downloadUrl),
  onUpdateProgress: (callback) => {
    const handler = (_, percent, detail) => callback(percent, detail);
    ipcRenderer.on('update-download-progress', handler);
    return () => ipcRenderer.removeListener('update-download-progress', handler);
  },
  skipUpdateVersion: (version) => ipcRenderer.invoke('skip-update-version', version),
```

- [ ] **Step 2: Verify the app launches without errors**

Run: `npm start` — confirm no preload errors in the console.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.js
git commit -m "feat(updater): add preload bridge for download, progress, and skip"
```

---

### Task 4: Update App.js to pass new update info and handlers to HomeTab

**Files:**
- Modify: `src/App.js:152-158` (update check effect)
- Modify: `src/App.js:503` (HomeTab props)

- [ ] **Step 1: Update the check-for-updates effect to handle skipped versions**

Replace the existing update check effect (lines 152-158):

```javascript
  // Check for updates on startup
  useEffect(() => {
    if (!api?.checkForUpdates) return;
    api.checkForUpdates().then(info => {
      if (info && !info.upToDate && info.latest) setUpdateInfo(info);
    });
  }, []);
```

With:

```javascript
  // Check for updates on startup
  useEffect(() => {
    if (!api?.checkForUpdates) return;
    api.checkForUpdates().then(info => {
      if (info && !info.upToDate && !info.skipped && info.latest) setUpdateInfo(info);
    });
  }, []);

  const handleManualUpdateCheck = async () => {
    if (!api?.checkForUpdates) return null;
    const info = await api.checkForUpdates();
    if (info && !info.upToDate && info.latest) {
      setUpdateInfo(info);
      return info;
    }
    return info;
  };

  const handleSkipVersion = async (version) => {
    if (!api?.skipUpdateVersion) return;
    await api.skipUpdateVersion(version);
    setUpdateInfo(null);
  };

  const handleDismissUpdate = () => {
    setUpdateInfo(null);
  };
```

- [ ] **Step 2: Pass the new handlers to HomeTab**

Find the HomeTab render line (line 503) and update it. Replace:

```javascript
      case 'home': return <HomeTab {...tabProps} onNavigate={guardedSetActiveTab} onLaunch={handleLaunch} isLaunching={isLaunching} launchLog={launchLog} updateInfo={updateInfo} onShowWizard={() => setShowWizard(true)} />;
```

With:

```javascript
      case 'home': return <HomeTab {...tabProps} onNavigate={guardedSetActiveTab} onLaunch={handleLaunch} isLaunching={isLaunching} launchLog={launchLog} updateInfo={updateInfo} onManualUpdateCheck={handleManualUpdateCheck} onSkipVersion={handleSkipVersion} onDismissUpdate={handleDismissUpdate} onShowWizard={() => setShowWizard(true)} />;
```

- [ ] **Step 3: Verify the app launches and Home tab renders**

Run: `npm start` — confirm no errors, Home tab works as before.

- [ ] **Step 4: Commit**

```bash
git add src/App.js
git commit -m "feat(updater): wire update handlers and props through App to HomeTab"
```

---

### Task 5: Rebuild HomeTab update banner with download/install UI

**Files:**
- Modify: `src/tabs/HomeTab.js:7` (props), `src/tabs/HomeTab.js:159-166` (banner JSX)
- Modify: `src/tabs/HomeTab.css:334-378` (banner styles)

- [ ] **Step 1: Update HomeTab props and add updater state**

Replace line 7:

```javascript
function HomeTab({ config, updateConfig, onNavigate, onLaunch, isLaunching, launchLog, updateInfo, onShowWizard }) {
```

With:

```javascript
function HomeTab({ config, updateConfig, onNavigate, onLaunch, isLaunching, launchLog, updateInfo, onManualUpdateCheck, onSkipVersion, onDismissUpdate, onShowWizard }) {
```

Add these state variables after the existing state declarations (after line 21):

```javascript
  const [updateDlStatus, setUpdateDlStatus] = useState(''); // '' | 'downloading' | 'installing' | 'error'
  const [updateDlProgress, setUpdateDlProgress] = useState({ percent: 0, detail: '' });
  const [updateDlError, setUpdateDlError] = useState('');
  const [manualCheckMsg, setManualCheckMsg] = useState('');
```

- [ ] **Step 2: Add the update progress listener and download handler**

Add after the existing `useEffect` blocks (after the server status effect, around line 140):

```javascript
  // Listen for update download progress
  useEffect(() => {
    if (!api?.onUpdateProgress) return;
    const unsub = api.onUpdateProgress((percent, detail) => {
      setUpdateDlProgress({ percent, detail });
      if (percent >= 85) setUpdateDlStatus('installing');
    });
    return unsub;
  }, []);

  const handleDownloadUpdate = async () => {
    if (!api?.downloadAndInstallUpdate || !updateInfo?.downloadUrl) return;
    setUpdateDlStatus('downloading');
    setUpdateDlError('');
    setUpdateDlProgress({ percent: 0, detail: 'Starting...' });
    const result = await api.downloadAndInstallUpdate(updateInfo.downloadUrl);
    if (!result.success) {
      setUpdateDlStatus('error');
      setUpdateDlError(result.error || 'Update failed');
    }
  };

  const handleManualCheck = async () => {
    setManualCheckMsg('Checking...');
    const info = await onManualUpdateCheck();
    if (!info || info.upToDate) {
      setManualCheckMsg('You are on the latest version');
      setTimeout(() => setManualCheckMsg(''), 3000);
    } else {
      setManualCheckMsg('');
    }
  };
```

- [ ] **Step 3: Replace the update banner JSX**

Replace the existing update notification block (lines 159-166):

```javascript
        {/* Update notification */}
        {updateInfo && (
          <div className="home-panel-section home-update-banner" onClick={() => api?.openExternal(updateInfo.releaseUrl)}>
            <div className="home-update-row">
              <span className="home-update-title">Update Available</span>
              <span className="pill pill-gold pill-xs">v{updateInfo.latest}</span>
            </div>
            <p className="home-update-desc">Click to download the latest version</p>
          </div>
        )}
```

With:

```javascript
        {/* Update notification */}
        {updateInfo && updateDlStatus === '' && (
          <div className="home-panel-section home-update-banner">
            <div className="home-update-row">
              <span className="home-update-title">Update Available</span>
              <div className="home-update-row-right">
                <span className="pill pill-gold pill-xs">v{updateInfo.latest}</span>
                <button className="home-update-dismiss" onClick={onDismissUpdate} aria-label="Dismiss">✕</button>
              </div>
            </div>
            {updateInfo.releaseNotes && (
              <p className="home-update-notes">{updateInfo.releaseNotes.split('\n')[0]}</p>
            )}
            <div className="home-update-actions">
              <button className="btn btn-primary btn-sm" onClick={handleDownloadUpdate}>
                Download & Install
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => onSkipVersion(updateInfo.latest)}>
                Skip this version
              </button>
            </div>
          </div>
        )}

        {/* Update downloading */}
        {updateInfo && (updateDlStatus === 'downloading' || updateDlStatus === 'installing') && (
          <div className="home-panel-section home-update-banner">
            <div className="home-update-row">
              <span className="home-update-title">
                {updateDlStatus === 'installing' ? 'Installing...' : 'Downloading update...'}
              </span>
              <span className="pill pill-gold pill-xs">v{updateInfo.latest}</span>
            </div>
            <div className="home-update-progress">
              <div className="home-progress-bar">
                <div className="home-progress-fill" style={{ width: `${updateDlProgress.percent}%` }} />
              </div>
              <span className="home-progress-text">{updateDlProgress.percent}%</span>
            </div>
            <p className="home-update-detail">{updateDlProgress.detail}</p>
          </div>
        )}

        {/* Update error */}
        {updateInfo && updateDlStatus === 'error' && (
          <div className="home-panel-section home-update-banner home-update-error">
            <div className="home-update-row">
              <span className="home-update-title">Update Failed</span>
              <button className="home-update-dismiss" onClick={() => { setUpdateDlStatus(''); setUpdateDlError(''); }} aria-label="Dismiss">✕</button>
            </div>
            <p className="home-update-notes">{updateDlError}</p>
            <button className="btn btn-primary btn-sm" onClick={handleDownloadUpdate}>
              Retry
            </button>
          </div>
        )}
```

- [ ] **Step 4: Add "Check for Updates" button**

Find the section at the bottom of the Home tab with the "Re-run Setup Wizard" button (around line 384). Replace:

```javascript
        {setupComplete && onShowWizard && (
          <div className="home-panel-section home-panel-divider home-panel-center">
            <button className="btn btn-ghost btn-sm" onClick={onShowWizard}>
              Re-run Setup Wizard
            </button>
          </div>
        )}
```

With:

```javascript
        {setupComplete && (
          <div className="home-panel-section home-panel-divider home-panel-center">
            <button className="btn btn-ghost btn-sm" onClick={handleManualCheck}>
              {manualCheckMsg || 'Check for Updates'}
            </button>
            {onShowWizard && (
              <button className="btn btn-ghost btn-sm" onClick={onShowWizard} style={{ marginTop: 4 }}>
                Re-run Setup Wizard
              </button>
            )}
          </div>
        )}
```

- [ ] **Step 5: Verify the app launches and the banner renders correctly**

Run: `npm start` — confirm:
- If on latest version: no banner, "Check for Updates" button visible at bottom
- The button shows "Checking..." briefly, then "You are on the latest version"

- [ ] **Step 6: Commit**

```bash
git add src/tabs/HomeTab.js
git commit -m "feat(updater): rebuild update banner with download/install/skip UI"
```

---

### Task 6: Add CSS for the new update banner states

**Files:**
- Modify: `src/tabs/HomeTab.css:334-378` (update banner styles)

- [ ] **Step 1: Replace the existing update banner CSS**

Replace the existing update banner styles (lines 334-378):

```css
.home-panel-section.home-update-banner {
  background: var(--gold-alpha);
  border-color: var(--gold-dim);
  transition: all 0.15s;
  cursor: pointer;
}
.home-panel-section.home-update-banner:hover {
  background: var(--gold-alpha-strong);
  border-color: var(--gold);
}

/* Server status row */
.home-server-status {
```

With:

```css
.home-panel-section.home-update-banner {
  background: var(--gold-alpha);
  border-color: var(--gold-dim);
  transition: all 0.15s;
}

.home-panel-section.home-update-error {
  background: rgba(200, 64, 64, 0.06);
  border-color: rgba(200, 64, 64, 0.25);
}
.home-panel-section.home-update-error .home-update-title {
  color: var(--red);
}

.home-update-row-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.home-update-dismiss {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}
.home-update-dismiss:hover {
  color: var(--text-primary);
}

.home-update-notes {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 4px;
  line-height: 1.4;
}

.home-update-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.home-update-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.home-update-detail {
  font-size: 11px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  margin-top: 4px;
}

/* Server status row */
.home-server-status {
```

- [ ] **Step 2: Remove the old hover cursor style**

The old banner had `cursor: pointer` because the whole banner was clickable. This is now removed in the replacement above (the buttons handle clicks instead).

- [ ] **Step 3: Verify the banner styles look correct**

Run: `npm start` — if there's no update available, temporarily set `APP_VERSION` to `0.0.1` in `main.js` to trigger the banner, then verify:
- Banner shows with gold background, dismiss X, version pill
- "Download & Install" and "Skip this version" buttons are visible
- Revert the version change after testing

- [ ] **Step 4: Commit**

```bash
git add src/tabs/HomeTab.css
git commit -m "style(updater): add banner styles for download, progress, error, and dismiss states"
```

---

### Task 7: Manual end-to-end test

**Files:** None (testing only)

- [ ] **Step 1: Test "no update available" flow**

Run `npm start`. If you're already on the latest version:
- Confirm no banner appears
- Click "Check for Updates" at the bottom
- Confirm it shows "You are on the latest version" briefly

- [ ] **Step 2: Test "update available" flow**

Temporarily edit `electron/main.js` line 396 to hardcode a lower version:

```javascript
  const APP_VERSION = '0.0.1';
```

Run `npm start`:
- Confirm the update banner appears with the latest version number
- Confirm release notes first line is shown
- Click "Skip this version" — banner disappears
- Restart the app — confirm banner does NOT reappear (it was skipped)
- Delete `runtime/launcher-prefs.json` to clear the skip
- Restart — banner reappears
- Click the dismiss "✕" — banner disappears
- Restart — banner reappears (dismiss is temporary)

- [ ] **Step 3: Test download & install flow**

With `APP_VERSION` still set to `0.0.1`:
- Click "Download & Install"
- Confirm progress bar fills up with MB downloaded
- Confirm it shows "Installing..." then "Restarting..."
- App should close and reopen on the new version
- Confirm `runtime/` folder is intact (all configs, HD packs, etc. preserved)

- [ ] **Step 4: Revert test changes and commit**

Revert `APP_VERSION` back to the real value:

```javascript
  const APP_VERSION = app.getVersion();
```

```bash
git add electron/main.js
git commit -m "chore: clean up after manual update test"
```

- [ ] **Step 5: Bump version and final commit**

Update `package.json` version to `1.0.8`:

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: bump version to 1.0.8"
```
