# Prerequisite Runtime Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Verify & Install Prerequisites" action to XI Launcher that downloads, checksum-verifies, and silently installs the five Windows runtimes (VC++ 2010/2012/2013/2015-2022 x86, .NET Framework 4.5.2) that FFXI/PlayOnline/Ashita/Windower depend on, with a real progress bar, from both the first-run SetupWizard and the Settings tab.

**Architecture:** One new Electron IPC handler (`install-prerequisites`) in `electron/main.js` downloads and verifies 5 installers, then runs them all in one elevated PowerShell batch (single UAC prompt) while a separate progress-log file lets the non-elevated main process poll and report per-component progress back to the renderer. Two thin UI call sites (`SetupWizard.js`, `SettingsTab.js`) both invoke the same handler through `preload.js`.

**Tech Stack:** Electron (main/renderer/preload, contextBridge IPC), Node's built-in `https`/`crypto`/`child_process`/`fs`, React (class-free function components), no new npm dependencies.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-12-prerequisite-runtime-installer-design.md` — all installer URLs, SHA256 hashes, silent args, and exit-code handling in this plan are copied verbatim from that spec's table.
- No custom registry-based detection — rely on each installer's own idempotent no-op / exit-code-1638 behavior (spec: "Known quirk" section).
- Single UAC prompt for the whole batch, not one per installer.
- Progress bar must visibly move during the elevated install phase, not just during downloads (this was the main gap the spec review caught — don't regress it).
- **No automated test framework exists in this repo** (`package.json` has no `test` script, no Jest/RTL config in active use). Follow the project's existing convention: verify with concrete manual steps (exact commands / exact UI interactions with exact expected results) instead of inventing a test harness for this one feature. Every step below still follows write → run → verify → commit; "run" just means "execute the real thing," not "run a test suite."

---

## File Structure

- **Modify `electron/main.js`**: add `PREREQUISITES` data array, `sha256File()` helper, `buildPrereqInnerScript()` / `classifyPrereqResults()` pure helpers, and the `install-prerequisites` IPC handler. All additions go in one contiguous block after the existing `install-ashita-v4` handler (main.js:1976-1978), matching that handler's indentation and error-message style.
- **Modify `electron/preload.js`**: add `installPrerequisites` and `onPrerequisitesProgress` next to the existing `installAshitaV4`/`onAshitaInstallProgress` pair (preload.js:130-135).
- **Modify `src/components/SetupWizard.js`**: add a prerequisites section to the existing `welcome` step, reusing the existing `wizard-progress-wrapper`/`wizard-progress-track`/`wizard-progress-bar`/`wizard-progress-detail` CSS classes already defined in `SetupWizard.css` (no new CSS needed here).
- **Modify `src/tabs/SettingsTab.js`**: add a new "System Prerequisites" section between the existing "Ashita Logs" section (SettingsTab.js:1662-1675) and the sticky bar (SettingsTab.js:1677).
- **Modify `src/tabs/SettingsTab.css`**: add `.settings-prereq-actions` / `.settings-prereq-progress-box` / `.settings-prereq-progress-bar` / `.settings-prereq-progress-fill` / `.settings-prereq-progress-text`, mirroring the existing `dgv-progress-*` pattern in `DgVoodooTab.css:281-301`.

---

### Task 1: Prerequisite data + SHA256 helper

**Files:**
- Modify: `electron/main.js` (insert after line 1977, before the `// Watch for game process to exit` comment at line 1979)

**Interfaces:**
- Produces: `const PREREQUISITES = [...]` — array of `{ name, filename, url, sha256, args, successCodes }`. `successCodes` is an array of numbers.
- Produces: `function sha256File(filePath): Promise<string>` — resolves to lowercase hex SHA256 of the file at `filePath`.

- [ ] **Step 1: Add the `PREREQUISITES` constant**

Insert this block at `electron/main.js` right after line 1977 (the blank line following the `install-ashita-v4` handler's closing `});`), before the `// Watch for game process to exit` comment:

```js
  // Five official Microsoft installers covering the runtime prerequisites FFXI/
  // PlayOnline/Ashita/Windower depend on. URLs and hashes sourced from Microsoft's
  // winget-pkgs manifests and Microsoft Download Center, verified 2026-07-12 — see
  // docs/superpowers/specs/2026-07-12-prerequisite-runtime-installer-design.md.
  // VC++ 2015-2022 covers both the 2015 and 2017 requirements (shared runtime).
  // .NET 4.5.2 covers the .NET 4.0 requirement (in-place upgrade model).
  const PREREQUISITES = [
    {
      name: 'Visual C++ 2010 SP1 Redistributable (x86)',
      filename: 'vcredist_2010_x86.exe',
      url: 'https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe',
      sha256: '99dce3c841cc6028560830f7866c9ce2928c98cf3256892ef8e6cf755147b0d8',
      args: '/quiet /norestart',
      successCodes: [0, 3010, 1638]
    },
    {
      name: 'Visual C++ 2012 Update 4 Redistributable (x86)',
      filename: 'vcredist_2012_x86.exe',
      url: 'https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x86.exe',
      sha256: 'b924ad8062eaf4e70437c8be50fa612162795ff0839479546ce907ffa8d6e386',
      args: '/quiet',
      successCodes: [0, 3010, 1638]
    },
    {
      name: 'Visual C++ 2013 Redistributable (x86)',
      filename: 'vcredist_2013_x86.exe',
      url: 'https://download.visualstudio.microsoft.com/download/pr/10912113/5da66ddebb0ad32ebd4b922fd82e8e25/vcredist_x86.exe',
      sha256: '53b605d1100ab0a88b867447bbf9274b5938125024ba01f5105a9e178a3dcdbd',
      args: '/quiet',
      successCodes: [0, 3010, 1638]
    },
    {
      name: 'Visual C++ 2015-2022 Redistributable (x86)',
      filename: 'vcredist_2015_2022_x86.exe',
      url: 'https://download.visualstudio.microsoft.com/download/pr/57eef8ae-a341-46c3-b0bc-c041027b54cd/F0BAB33A302B3CDB2E11113760D016F54FD3D2632C65BA7834FAC4F0ABD7F1A3/VC_redist.x86.exe',
      sha256: 'f0bab33a302b3cdb2e11113760d016f54fd3d2632c65ba7834fac4f0abd7f1a3',
      args: '/install /quiet /norestart',
      successCodes: [0, 3010, 1638]
    },
    {
      name: '.NET Framework 4.5.2',
      filename: 'ndp452_x86_x64.exe',
      url: 'https://download.microsoft.com/download/e/2/1/e21644b5-2df2-47c2-91bd-63c560427900/NDP452-KB2901907-x86-x64-AllOS-ENU.exe',
      sha256: '6c2c589132e830a185c5f40f82042bee3022e721a216680bd9b3995ba86f3781',
      args: '/q /norestart',
      successCodes: [0, 3010]
    }
  ];
```

- [ ] **Step 2: Add the `sha256File` helper**

Immediately below the `PREREQUISITES` array, add (this extracts the existing inline pattern already used at main.js:1627-1633 into a reusable function):

```js
  // Compute the lowercase hex SHA256 of a file on disk.
  function sha256File(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const rs = fs.createReadStream(filePath);
      rs.on('error', reject);
      rs.on('data', (chunk) => hash.update(chunk));
      rs.on('end', () => resolve(hash.digest('hex')));
    });
  }
```

- [ ] **Step 3: Verify by hand — cross-check against a real download**

Run (from the repo root, using PowerShell or Bash — this reuses the exact same check already done during planning, now as a permanent record you can re-run):

```bash
curl -sL -o /tmp/vc2012check.exe "https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x86.exe" && sha256sum /tmp/vc2012check.exe && rm /tmp/vc2012check.exe
```

Expected output: `b924ad8062eaf4e70437c8be50fa612162795ff0839479546ce907ffa8d6e386  /tmp/vc2012check.exe` — matches the `sha256` value on the VC++ 2012 entry above exactly. If it doesn't match, stop and re-derive the hash before continuing (Microsoft rotated the file).

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat: add prerequisite runtime installer data and SHA256 helper"
```

---

### Task 2: PowerShell script builder and result classifier (pure helpers)

**Files:**
- Modify: `electron/main.js` (insert immediately after the `sha256File` function added in Task 1)

**Interfaces:**
- Consumes: `PREREQUISITES` shape from Task 1 (`{name, filename, args, successCodes}` per downloaded item), `escapePSString(str)` (existing helper, main.js:145-147).
- Produces: `function buildPrereqInnerScript(items, progressLogPath, resultFilePath): string` — `items` is an array of `{name, localPath, args}`; returns the full PowerShell script body text.
- Produces: `function classifyPrereqResults(items, exitCodesByName): Array<{component, success, exitCode}>` — `items` is `PREREQUISITES`-shaped (needs `.name` and `.successCodes`), `exitCodesByName` is a plain object `{ [name]: number }`.

- [ ] **Step 1: Add `buildPrereqInnerScript`**

```js
  // Builds the PowerShell script that runs (elevated) all downloaded installers in
  // sequence, logging STARTED/DONE lines to progressLogPath as it goes (polled by
  // the non-elevated main process for live UI progress) and writing final exit
  // codes as JSON to resultFilePath.
  function buildPrereqInnerScript(items, progressLogPath, resultFilePath) {
    const lines = ['$results = @{}'];
    for (const item of items) {
      const safeName = escapePSString(item.name);
      lines.push(`Add-Content -Path '${escapePSString(progressLogPath)}' -Value 'STARTED|${safeName}'`);
      lines.push(`$p = Start-Process -FilePath '${escapePSString(item.localPath)}' -ArgumentList '${item.args}' -Wait -PassThru`);
      lines.push(`$results['${safeName}'] = $p.ExitCode`);
      lines.push(`Add-Content -Path '${escapePSString(progressLogPath)}' -Value ('DONE|${safeName}|' + $p.ExitCode)`);
    }
    lines.push(`$results | ConvertTo-Json | Set-Content -Path '${escapePSString(resultFilePath)}'`);
    return lines.join('\n');
  }
```

- [ ] **Step 2: Add `classifyPrereqResults`**

```js
  // Turns the { name: exitCode } map read back from resultFilePath into a
  // per-component success/failure list, using each PREREQUISITES entry's own
  // successCodes (0, 3010, and — for the four VC++ entries — 1638).
  function classifyPrereqResults(items, exitCodesByName) {
    return items.map((item) => {
      const exitCode = exitCodesByName[item.name];
      const success = item.successCodes.includes(exitCode);
      return { component: item.name, success, exitCode: exitCode === undefined ? null : exitCode };
    });
  }
```

- [ ] **Step 3: Verify by hand**

Run this from the repo root (Bash tool — Node script inlined via `-e`, no test framework needed since these are pure functions with no Electron dependency):

```bash
node -e "
const crypto = require('crypto');
function escapePSString(str) { return String(str).replace(/'/g, \"''\"); }
function buildPrereqInnerScript(items, progressLogPath, resultFilePath) {
  const lines = ['\$results = @{}'];
  for (const item of items) {
    const safeName = escapePSString(item.name);
    lines.push(\`Add-Content -Path '\${escapePSString(progressLogPath)}' -Value 'STARTED|\${safeName}'\`);
    lines.push(\`\\\$p = Start-Process -FilePath '\${escapePSString(item.localPath)}' -ArgumentList '\${item.args}' -Wait -PassThru\`);
    lines.push(\`\\\$results['\${safeName}'] = \\\$p.ExitCode\`);
    lines.push(\`Add-Content -Path '\${escapePSString(progressLogPath)}' -Value ('DONE|\${safeName}|' + \\\$p.ExitCode)\`);
  }
  lines.push(\`\\\$results | ConvertTo-Json | Set-Content -Path '\${escapePSString(resultFilePath)}'\`);
  return lines.join('\n');
}
function classifyPrereqResults(items, exitCodesByName) {
  return items.map((item) => {
    const exitCode = exitCodesByName[item.name];
    const success = item.successCodes.includes(exitCode);
    return { component: item.name, success, exitCode: exitCode === undefined ? null : exitCode };
  });
}
const items = [{ name: 'Visual C++ 2012 Update 4 Redistributable (x86)', localPath: 'C:\\\\temp\\\\vc2012.exe', args: '/quiet' }];
console.log(buildPrereqInnerScript(items, 'C:\\\\temp\\\\progress.log', 'C:\\\\temp\\\\result.json'));
console.log('---');
const classified = classifyPrereqResults(
  [{ name: 'Visual C++ 2012 Update 4 Redistributable (x86)', successCodes: [0, 3010, 1638] }, { name: '.NET Framework 4.5.2', successCodes: [0, 3010] }],
  { 'Visual C++ 2012 Update 4 Redistributable (x86)': 1638 }
);
console.log(JSON.stringify(classified));
"
```

Expected output: the generated PowerShell script text (5 lines: `$results = @{}`, `Add-Content ... STARTED|...`, `$p = Start-Process ...`, `$results[...] = $p.ExitCode`, `Add-Content ... DONE|...`, `$results | ConvertTo-Json ...`), then `---`, then:
```json
[{"component":"Visual C++ 2012 Update 4 Redistributable (x86)","success":true,"exitCode":1638},{"component":".NET Framework 4.5.2","success":false,"exitCode":null}]
```
Confirming: the 1638 code classifies as `success: true` (the exit-code-1638 handling from the spec review), and a component missing from the exit-code map classifies as `success: false, exitCode: null` rather than throwing.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat: add PowerShell script builder and result classifier for prerequisite installer"
```

---

### Task 3: The `install-prerequisites` IPC handler + preload wiring

This task covers both the main-process handler and its `preload.js` exposure together, not split across two tasks — the handler can't be meaningfully exercised end to end (the real integration point, given no test framework exists) until it's reachable from `window.xiAPI`, so a reviewer can't actually approve "the handler works" without the preload wiring present too.

**Files:**
- Modify: `electron/main.js` (insert immediately after the `classifyPrereqResults` function from Task 2, still before the `// Watch for game process to exit` comment)
- Modify: `electron/preload.js` (insert after line 135, following the existing `onAshitaInstallProgress` block)

**Interfaces:**
- Consumes: `PREREQUISITES`, `sha256File`, `buildPrereqInnerScript`, `classifyPrereqResults` (Tasks 1-2), `downloadFile` (existing, main.js:406), `runPowerShellFile` (existing, main.js:247), `escapePSString` (existing, main.js:145), `mainWindow` (existing module-scope variable).
- Produces: IPC channel `install-prerequisites` — `ipcRenderer.invoke('install-prerequisites')` resolves to `{ success: boolean, results?: Array<{component, success, exitCode}>, anyRebootRequired?: boolean, error?: string }`. Emits `prerequisites-progress` events via `mainWindow.webContents.send('prerequisites-progress', percent, detail)` (same 2-arg shape as every other progress channel in this file, e.g. `ashita-install-progress`).
- Produces: `window.xiAPI.installPrerequisites(): Promise<{success, results?, anyRebootRequired?, error?}>` and `window.xiAPI.onPrerequisitesProgress((percent, detail) => void): () => void` (unsubscribe function) — used by Tasks 4 and 5.

- [ ] **Step 1: Add the handler**

```js
  ipcMain.handle('install-prerequisites', async () => {
    const tmpDir = path.join(app.getPath('temp'), `xi-launcher-prereqs-${Date.now()}`);
    const sendProgress = (percent, detail) => {
      try { mainWindow?.webContents?.send('prerequisites-progress', percent, detail); } catch {}
    };
    const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };

    try {
      fs.mkdirSync(tmpDir, { recursive: true });

      // Phase 1 (0-50%): download and checksum-verify every installer before
      // anything is executed. A mismatch aborts the whole batch immediately.
      const downloaded = [];
      for (let i = 0; i < PREREQUISITES.length; i++) {
        const item = PREREQUISITES[i];
        const destPath = path.join(tmpDir, item.filename);
        const baseP = Math.round((i / PREREQUISITES.length) * 50);
        const spanP = Math.round(50 / PREREQUISITES.length);

        sendProgress(baseP, `Downloading ${item.name}...`);
        await downloadFile(item.url, destPath, {
          label: item.name,
          onProgress: (received, total) => {
            if (total > 0) {
              const pct = baseP + Math.round((received / total) * spanP);
              const mb = (received / 1048576).toFixed(1);
              const totalMb = (total / 1048576).toFixed(1);
              sendProgress(pct, `Downloading ${item.name}... ${mb} / ${totalMb} MB`);
            }
          }
        });

        sendProgress(baseP + spanP, `Verifying ${item.name}...`);
        const actualHash = await sha256File(destPath);
        if (actualHash.toLowerCase() !== item.sha256.toLowerCase()) {
          cleanup();
          return { success: false, error: `Checksum verification failed for ${item.name}. The downloaded file may be corrupted or tampered with. Nothing was installed. (expected ${item.sha256.slice(0, 12)}…, got ${actualHash.slice(0, 12)}…)` };
        }
        downloaded.push({ ...item, localPath: destPath });
      }

      // Phase 2 (50-55%): build the elevated inner script.
      sendProgress(50, 'Preparing installation...');
      const progressLog = path.join(tmpDir, 'progress.log');
      const resultFile = path.join(tmpDir, 'result.json');
      fs.writeFileSync(progressLog, '', 'utf-8');
      const innerScript = buildPrereqInnerScript(downloaded, progressLog, resultFile);
      const innerScriptPath = path.join(tmpDir, 'inner.ps1');
      fs.writeFileSync(innerScriptPath, innerScript, 'utf-8');

      // Phase 3 (55-95%): launch elevated (one UAC prompt for the whole batch) via
      // Node's async spawn (through runPowerShellFile) so the main process stays
      // responsive, and poll progressLog concurrently to drive per-component
      // progress — the -Wait call itself gives no visibility into what's running.
      sendProgress(55, 'Requesting administrator permission...');
      const outerScript = `Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${escapePSString(innerScriptPath)}' -Verb RunAs -Wait -WindowStyle Hidden`;

      let lastLineCount = 0;
      const totalMarkers = downloaded.length * 2; // STARTED + DONE per component
      const pollTimer = setInterval(() => {
        try {
          const lines = fs.readFileSync(progressLog, 'utf-8').split('\n').filter(Boolean);
          for (let i = lastLineCount; i < lines.length; i++) {
            const parts = lines[i].split('|');
            const stageMarker = parts[0];
            const name = parts[1];
            const pct = 55 + Math.round(((i + 1) / totalMarkers) * 40);
            if (stageMarker === 'STARTED') sendProgress(pct, `Installing ${name}... please wait`);
            else if (stageMarker === 'DONE') sendProgress(pct, `${name} finished`);
          }
          lastLineCount = lines.length;
        } catch {}
      }, 500);

      try {
        await runPowerShellFile(outerScript, 600000); // 10 minutes for the whole batch
      } catch (e) {
        clearInterval(pollTimer);
        cleanup();
        const msg = e.message || '';
        if (msg.includes('elevation') || msg.includes('denied') || msg.includes('UAC')) {
          return { success: false, error: 'Administrator permission is required to install these components. Installation was cancelled.' };
        }
        return { success: false, error: `Installation failed: ${msg}` };
      }
      clearInterval(pollTimer);

      // Phase 4 (95-100%): read results, classify, report.
      sendProgress(95, 'Verifying results...');
      let exitCodesByName = {};
      try { exitCodesByName = JSON.parse(fs.readFileSync(resultFile, 'utf-8')); } catch {}
      const results = classifyPrereqResults(downloaded, exitCodesByName);
      const allSuccess = results.every(r => r.success);
      const anyRebootRequired = results.some(r => r.exitCode === 3010);
      cleanup();
      sendProgress(100, allSuccess ? 'All prerequisites installed successfully' : 'Some components failed');
      return { success: allSuccess, results, anyRebootRequired };
    } catch (e) {
      cleanup();
      return { success: false, error: `Installation failed: ${e.message}` };
    }
  });
```

- [ ] **Step 2: Add the preload entries**

Insert into `electron/preload.js` right after line 135 (`},` closing `onAshitaInstallProgress`):

```js

  // Prerequisite runtime installer (VC++ redistributables + .NET Framework)
  installPrerequisites: () => ipcRenderer.invoke('install-prerequisites'),
  onPrerequisitesProgress: (callback) => {
    const handler = (_, percent, detail) => callback(percent, detail);
    ipcRenderer.on('prerequisites-progress', handler);
    return () => ipcRenderer.removeListener('prerequisites-progress', handler);
  },
```

- [ ] **Step 3: Run it for real, end to end**

This is the integration point — the pure-function checks in Tasks 1-2 can't substitute for actually exercising downloads + elevation + the real installers on a real Windows machine. Launch the app and drive it directly from DevTools rather than adding a temporary UI trigger (the real UI comes in Tasks 4-5):

1. Run `npm start`.
2. Open DevTools (View → Toggle Developer Tools) in the launcher window.
3. In the console, run:

```js
window.xiAPI.onPrerequisitesProgress((pct, detail) => console.log(pct, detail));
window.xiAPI.installPrerequisites().then(r => console.log('RESULT', r));
```

4. Expected behavior: progress log lines print with increasing percent from 0 through 100; **exactly one** UAC prompt appears (not five); after accepting it, a few installer windows may flash briefly (some show a UI despite `/quiet` depending on Windows version — that's fine, they're still non-interactive) and progress messages continue printing during that phase, not just during the download phase; final `RESULT` logs `{ success: true, results: [...5 entries, each success:true], anyRebootRequired: <boolean> }`.
5. Re-run it a second time immediately. Expected: much faster (all 5 already-present, several likely returning 1638), still `success: true` — confirms the exit-code-1638 handling from the spec review actually works on a real machine, not just in the Task 2 pure-function check.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat: add install-prerequisites IPC handler with elevated batch install and live progress polling"
```

---

### Task 4: SetupWizard.js UI

**Files:**
- Modify: `src/components/SetupWizard.js`

**Interfaces:**
- Consumes: `window.xiAPI.installPrerequisites()`, `window.xiAPI.onPrerequisitesProgress()` (Task 3).

- [ ] **Step 1: Add state and the progress subscription**

In `SetupWizard.js`, add new state near the existing `installing`/`installProgress` state (after line 22):

```js
  const [prereqInstalling, setPrereqInstalling] = useState(false);
  const [prereqProgress, setPrereqProgress] = useState({ percent: 0, detail: '' });
  const [prereqResult, setPrereqResult] = useState(null); // { success, results, anyRebootRequired, error }
```

Add a subscription effect near the existing `onAshitaInstallProgress` effect (after line 58):

```js
  useEffect(() => {
    if (!api?.onPrerequisitesProgress) return;
    const unsub = api.onPrerequisitesProgress((percent, detail) => {
      setPrereqProgress({ percent, detail });
    });
    return unsub;
  }, []);
```

- [ ] **Step 2: Add the trigger function**

Add near the existing `installAshita` function (after line 137):

```js
  const installPrerequisites = async () => {
    setPrereqInstalling(true);
    setPrereqResult(null);
    setPrereqProgress({ percent: 0, detail: 'Starting...' });
    const result = await api.installPrerequisites();
    setPrereqInstalling(false);
    setPrereqResult(result);
  };
```

- [ ] **Step 3: Add the UI section to the `welcome` step**

In the JSX, inside the `currentStep === 'welcome'` block (lines 181-197), add this after the closing `</ul>` (before the closing `</>`):

```jsx
              <div className="wizard-field">
                <label>System Prerequisites</label>
                <span className="field-hint">Visual C++ Runtimes and .NET Framework — required by FFXI, PlayOnline, Ashita, and Windower</span>
                {!prereqInstalling && !prereqResult && (
                  <button className="btn btn-primary btn-sm wizard-action-btn" onClick={installPrerequisites}>
                    ↓ Verify &amp; Install Prerequisites
                  </button>
                )}
                {prereqInstalling && (
                  <div className="wizard-progress-wrapper">
                    <div className="wizard-progress-track">
                      <div className="wizard-progress-bar" style={{ width: `${prereqProgress.percent}%` }} />
                    </div>
                    <span className="wizard-progress-detail">{prereqProgress.detail}</span>
                  </div>
                )}
                {prereqResult && prereqResult.success && (
                  <p className="wizard-status-msg wizard-status-msg-success">
                    ✓ All prerequisites installed{prereqResult.anyRebootRequired ? ' — a restart may be needed for some changes to take effect' : ''}
                  </p>
                )}
                {prereqResult && !prereqResult.success && prereqResult.error && (
                  <p className="wizard-status-msg wizard-status-msg-error">
                    {prereqResult.error}{' '}
                    <span className="wizard-link" onClick={installPrerequisites}>Retry</span>
                  </p>
                )}
                {prereqResult && !prereqResult.success && !prereqResult.error && prereqResult.results && (
                  <p className="wizard-status-msg wizard-status-msg-error">
                    Some components failed: {prereqResult.results.filter(r => !r.success).map(r => r.component).join(', ')}.{' '}
                    <span className="wizard-link" onClick={installPrerequisites}>Retry</span>
                  </p>
                )}
              </div>
```

This step never blocks wizard progression — it's inside the `welcome` step alongside informational content, and the wizard's existing "Skip Setup" / "Next →" footer buttons (lines 393-406) are untouched, so a failed or skipped install never strands the user.

- [ ] **Step 4: Verify by hand**

Run `npm start`, and in the app:
1. On first launch (or delete `config.json` / clear `setupComplete` to force the wizard), confirm the "System Prerequisites" field appears on the welcome step with a "Verify & Install Prerequisites" button.
2. Click it. Confirm the progress bar appears and moves (both during download and during the elevated install phase — this is the specific behavior the spec review added; don't just check that it eventually finishes, watch that the percentage visibly advances more than once during the "Installing..." phase).
3. Confirm exactly one UAC prompt appears.
4. Confirm a success message appears, and that clicking "Next →" or "Skip Setup" both still work normally regardless of the install outcome.
5. Decline the UAC prompt on a fresh run (or cancel it) — confirm the wizard shows the "Administrator permission is required..." message with a Retry link, and the wizard remains fully usable (Back/Next/Skip all still work).

- [ ] **Step 5: Commit**

```bash
git add src/components/SetupWizard.js
git commit -m "feat: add prerequisite runtime installer to SetupWizard welcome step"
```

---

### Task 5: SettingsTab.js + SettingsTab.css UI

**Files:**
- Modify: `src/tabs/SettingsTab.js` (insert between the "Ashita Logs" section ending at line 1675 and the sticky bar starting at line 1677)
- Modify: `src/tabs/SettingsTab.css` (add new classes)

**Interfaces:**
- Consumes: `window.xiAPI.installPrerequisites()`, `window.xiAPI.onPrerequisitesProgress()` (Task 3). Same result shape as Task 4.

- [ ] **Step 1: Add state and subscription to `SettingsTab`**

Near the top of the `SettingsTab` function body (after line 382's function declaration, alongside other `useState` calls in that component — find the existing `useState` block and add these with it):

```js
  const [prereqInstalling, setPrereqInstalling] = useState(false);
  const [prereqProgress, setPrereqProgress] = useState({ percent: 0, detail: '' });
  const [prereqResult, setPrereqResult] = useState(null);

  useEffect(() => {
    if (!api?.onPrerequisitesProgress) return;
    const unsub = api.onPrerequisitesProgress((percent, detail) => {
      setPrereqProgress({ percent, detail });
    });
    return unsub;
  }, []);

  const installPrerequisites = async () => {
    setPrereqInstalling(true);
    setPrereqResult(null);
    setPrereqProgress({ percent: 0, detail: 'Starting...' });
    const result = await api.installPrerequisites();
    setPrereqInstalling(false);
    setPrereqResult(result);
  };
```

- [ ] **Step 2: Add the "System Prerequisites" section**

Insert into the JSX at `SettingsTab.js` between line 1675 (`</div>` closing the "Ashita Logs" panel) and line 1677 (the `{(pendingCount > 0 || applyStatus) &&` sticky bar):

```jsx

      <div className="section-header">System Prerequisites</div>
      <div className="panel">
        <p className="settings-hint settings-hint-compact">
          Visual C++ Runtimes and .NET Framework required by FFXI, PlayOnline, Ashita, and Windower. Safe to run any time — already-installed components are detected and skipped automatically.
        </p>
        <div className="settings-prereq-actions">
          <button className="btn btn-primary" onClick={installPrerequisites} disabled={prereqInstalling}>
            {prereqInstalling ? 'Installing...' : '↓ Verify & Install Prerequisites'}
          </button>
        </div>
        {prereqInstalling && (
          <div className="settings-prereq-progress-box">
            <div className="settings-prereq-progress-bar">
              <div className="settings-prereq-progress-fill" style={{ width: `${prereqProgress.percent}%` }} />
            </div>
            <span className="settings-prereq-progress-text">{prereqProgress.detail}</span>
          </div>
        )}
        {prereqResult && prereqResult.success && (
          <p className="settings-hint settings-hint-compact" style={{ color: 'var(--ok, #6c6)' }}>
            ✓ All prerequisites installed{prereqResult.anyRebootRequired ? ' — a restart may be needed for some changes to take effect' : ''}
          </p>
        )}
        {prereqResult && !prereqResult.success && (
          <p className="settings-hint settings-hint-compact" style={{ color: 'var(--error, #e66)' }}>
            {prereqResult.error || `Some components failed: ${prereqResult.results.filter(r => !r.success).map(r => r.component).join(', ')}.`}
          </p>
        )}
      </div>
```

- [ ] **Step 3: Add CSS**

Append to `src/tabs/SettingsTab.css` (mirroring the existing `dgv-progress-*` pattern from `DgVoodooTab.css:281-301`):

```css
.settings-prereq-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.settings-prereq-progress-box {
  margin: 14px 0;
}
.settings-prereq-progress-bar {
  height: 5px;
  background: var(--bg-deepest);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 6px;
}
.settings-prereq-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--teal), var(--gold));
  border-radius: 3px;
  transition: width 0.3s ease;
}
.settings-prereq-progress-text {
  font-size: 12px;
  color: var(--text-dim);
  font-family: var(--font-mono);
}
```

- [ ] **Step 4: Verify by hand**

Run `npm start`, open the Settings tab, scroll to "System Prerequisites" (below "Ashita Logs"). Click "Verify & Install Prerequisites". Confirm the button disables and shows "Installing...", the progress bar appears and moves through both download and install phases, and a final success/failure message appears below — independent of the SetupWizard (no wizard needs to be open). Confirm this works identically whether or not `setupComplete` is true.

- [ ] **Step 5: Commit**

```bash
git add src/tabs/SettingsTab.js src/tabs/SettingsTab.css
git commit -m "feat: add prerequisite runtime installer to Settings tab"
```

---

### Task 6: Final combined verification pass

**Files:** none (verification only)

- [ ] **Step 1: Clean-slate behavior**

If possible, test on a Windows install/VM without these runtimes present (or accept that most dev machines already have them — in that case Step 2's 1638-heavy run is the realistic case). Confirm: all 5 install, exactly one UAC prompt, progress advances visibly through both download and install phases for every component, final state is success with no reboot-required note (unless one was genuinely needed).

- [ ] **Step 2: Already-installed behavior**

On a normal dev machine (which almost certainly already has some/all of these), run "Verify & Install Prerequisites" from Settings. Confirm it completes quickly, reports success, and doesn't show any of the 4 VC++ components as failed even though they likely returned 1638 internally (open DevTools and check the resolved `result.results` array to confirm `exitCode: 1638, success: true` for any already-present component).

- [ ] **Step 3: Checksum-mismatch handling**

Temporarily change one `sha256` value in the `PREREQUISITES` array in `electron/main.js` to an obviously wrong value (e.g. flip one hex character), rebuild, run the install, confirm it stops immediately with a "Checksum verification failed for..." error naming the right component, and that nothing was executed (no UAC prompt appears at all — the checksum check happens before elevation). Revert the change afterward.

- [ ] **Step 4: UAC decline handling**

Trigger the install, and when the UAC prompt appears, click "No" / cancel it. Confirm the app shows "Administrator permission is required to install these components. Installation was cancelled." in both the wizard and Settings entry points (test both), and that the rest of the UI (wizard navigation, other Settings sections) remains fully responsive — the failed prerequisite install must not freeze or block anything else.

- [ ] **Step 5: Final commit**

If any fixes were needed during this verification pass, commit them individually with descriptive messages as you go (not batched at the end). If everything passed as designed, no commit is needed for this task — it's a verification checkpoint, not a code change.
