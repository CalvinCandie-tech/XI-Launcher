# Prerequisite Runtime Installer Design

**Date:** 2026-07-12
**Status:** Approved

## Overview

First-time FFXI/PlayOnline/Ashita/Windower users often lack the Windows runtime prerequisites these programs silently depend on: several Visual C++ x86 redistributables and .NET Framework. Missing runtimes cause opaque crashes (missing DLL errors) that are hard for non-technical users to diagnose. Add a one-click "Verify & Install Prerequisites" action to the launcher that downloads, verifies, and silently installs everything needed, with a real progress bar.

**Scope:** One IPC-backed install flow, exposed from two call sites (SetupWizard step, Settings tab button). No persistent per-item checklist UI — a single button drives the whole batch, relying on each official installer's own idempotent "already installed, skip" behavior rather than building custom registry-detection logic.

---

## Prerequisite list

Five official Microsoft installers cover the six originally-listed items, because VC++ 2015 and 2017 share the same runtime (merged as "2015-2022"), and .NET Framework 4.x is an in-place upgrade (installing 4.5.2 satisfies a 4.0 requirement too — no separate 4.0 install needed).

All URLs and SHA256 hashes below were pulled live on 2026-07-12 from Microsoft's official `winget-pkgs` manifests (`github.com/microsoft/winget-pkgs`) and the official Microsoft Download Center pages — not from memory/training data — since these run elevated on end users' machines and must be verifiable.

| Component | URL | SHA256 | Silent args | Success exit codes |
|---|---|---|---|---|
| VC++ 2010 SP1 x86 | `https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe` | `99DCE3C841CC6028560830F7866C9CE2928C98CF3256892EF8E6CF755147B0D8` | `/quiet /norestart` | 0, 3010, 1638 |
| VC++ 2012 Update 4 x86 | `https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x86.exe` | `B924AD8062EAF4E70437C8BE50FA612162795FF0839479546CE907FFA8D6E386` | `/quiet` | 0, 3010 |
| VC++ 2013 x86 | `https://download.visualstudio.microsoft.com/download/pr/10912113/5da66ddebb0ad32ebd4b922fd82e8e25/vcredist_x86.exe` | `53B605D1100AB0A88B867447BBF9274B5938125024BA01F5105A9E178A3DCDBD` | `/quiet` | 0, 3010 |
| VC++ 2015-2022 x86 (covers 2015 + 2017) | `https://download.visualstudio.microsoft.com/download/pr/57eef8ae-a341-46c3-b0bc-c041027b54cd/F0BAB33A302B3CDB2E11113760D016F54FD3D2632C65BA7834FAC4F0ABD7F1A3/VC_redist.x86.exe` | `F0BAB33A302B3CDB2E11113760D016F54FD3D2632C65BA7834FAC4F0ABD7F1A3` | `/install /quiet /norestart` | 0, 3010 |
| .NET Framework 4.5.2 (offline, covers 4.0) | `https://download.microsoft.com/download/e/2/1/e21644b5-2df2-47c2-91bd-63c560427900/NDP452-KB2901907-x86-x64-AllOS-ENU.exe` | *(pin at implementation time — see note)* | `/q /norestart` | 0, 3010 |

**Note on the .NET row:** the URL is confirmed directly from the official Microsoft Download Center page (`microsoft.com/en-us/download/details.aspx?id=42642`). No winget manifest exists for the bare 4.5.2 runtime (only for the Developer Pack, a different artifact), so there's no third-party-verified hash to cross-check yet. At implementation time, download this exact URL once, compute its SHA256, and hardcode the result — same trust model as the other four, just pinned a step later instead of copied from winget.

This table is implementation data, not architecture — if Microsoft rotates a URL before implementation happens, re-derive it the same way (winget-pkgs manifest search, or the official Download Center page) rather than guessing.

---

## Architecture

### Backend (`electron/main.js`)

- New constant array `PREREQUISITES` holding the five entries above (name, url, sha256, filename, silent args, success codes).
- New handler `ipcMain.handle('install-prerequisites', async () => {...})`:
  1. For each entry, download to a temp dir via the existing `downloadFile()` helper, emitting `{stage: 'downloading', component, percent}` progress events (same pattern as xiloader/Ashita downloads).
  2. After each download, compute SHA256 and compare to the pinned hash. Mismatch → abort the whole batch immediately, before anything is executed, with an error naming the failed component. Nothing unverified ever runs.
  3. Once all five are downloaded and verified, generate one PowerShell script that runs all five silently in sequence (each with its own silent args from the table), and writes each installer's exit code to a JSON result file in the temp dir.
  4. Launch that script once via `Start-Process powershell -Verb RunAs -Wait` — a single UAC prompt for the whole batch, not five.
  5. While the elevated script runs, emit `{stage: 'installing', component, percent: null}` (indeterminate — native installers don't report real-time progress) for each component in sequence, timed by watching for the result file's entries to appear, or simply emitted optimistically per component before the wait completes (implementation detail, not a design blocker).
  6. Read the result JSON, classify each component's exit code as success (0 or 3010) or failure (anything else), and emit a final `{stage: 'done', results: [{component, success, exitCode}], anyRebootRequired}` event.
  7. Delete all downloaded installer files and the temp result file in a `finally`, regardless of outcome.

### Preload (`electron/preload.js`)

- `installPrerequisites: () => ipcRenderer.invoke('install-prerequisites')`
- `onPrerequisitesProgress: (cb) => ipcRenderer.on('prerequisites-progress', ...)` — mirrors the existing `onXProgress` subscribe/unsubscribe pattern already used for other progress events.

### Frontend

- **`SetupWizard.js`**: new step with a "Verify & Install Prerequisites" button, a progress bar reusing existing styling from the Ashita/xiloader steps, live status text ("Downloading VC++ 2013 Redistributable... 64%" / "Installing VC++ 2013 Redistributable... please wait"), and a visible **Skip** link. This step must never hard-block wizard progression — declined UAC, offline, or a locked-down machine should not strand the user.
- **`SettingsTab.js`**: same button and progress UI, callable standalone at any time later, using the identical IPC call. No wizard-specific state threading — both call sites are thin wrappers around `installPrerequisites()`.

---

## Data flow

1. User clicks "Verify & Install Prerequisites" (wizard step, or Settings button).
2. Renderer calls `window.xiAPI.installPrerequisites()` and subscribes via `onPrerequisitesProgress`.
3. Main process downloads all five (real byte-percentage progress), verifying checksums as they land.
4. Main process builds and elevates one PowerShell script running all five silently.
5. Main process parses the result file, reports final success/failure per component.
6. Renderer shows a final state: all-success checkmark, or a per-component failure list with a "some components failed, try again" message. Temp files are always cleaned up.

---

## Error handling

- **Download failure** (network/404): stop before elevation, name the failed file, offer Retry. Other already-downloaded files are discarded (don't proceed with a partial batch).
- **Checksum mismatch**: stop immediately, treated as a hard failure — this happens pre-elevation, before anything with admin rights runs.
- **UAC declined/cancelled**: `Start-Process -Verb RunAs` throws; caught and surfaced as "Administrator permission is required to install these components. Installation was cancelled." with Retry. Non-fatal to the wizard.
- **Per-installer non-success exit code** (e.g., one component blocked by antivirus): reported by name with its exit code; components that did succeed stay installed, no rollback attempted.
- **Exit code 3010** (success, reboot required) is treated as success; final UI notes a restart may be needed if any component returned it.

---

## Testing plan

- Clean VM with none of the five present → all install, exactly one UAC prompt, progress bar moves through download+install stages per component, ends in success.
- VM with everything already present → fast no-op pass for each (installers self-skip), still reports overall success rather than false failures.
- Simulated checksum mismatch (corrupt a downloaded file before verification) → batch blocked, correct component-named error shown, nothing executed.
- Decline the UAC prompt → graceful non-blocking failure message; wizard remains usable and skippable.
- Trigger from Settings tab standalone, independent of wizard state.
