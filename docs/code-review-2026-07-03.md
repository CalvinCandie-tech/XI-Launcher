# XI-Launcher Full Review — 2026-07-03

Three-track review (Electron main process / React renderer / CSS & design), every source file read in full (~23k lines). Findings ranked by severity within each track. See chat digest for the prioritized cross-track summary.

---

# Track 1: Electron main process (`electron/main.js`, `preload.js`, `package.json`)

## CRITICAL

### C1. Password/credential mangling — `escapePSString` over-escapes for single-quote context
**`main.js:137-139`, used at `1800-1803`, `1817-1819`**

```js
function escapePSString(str) {
  return String(str).replace(/'/g, "''").replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '`"');
}
```
Every call site wraps the result in **single quotes** (`'${escapePSString(a)}'`). Inside a PowerShell single-quoted string, backtick, `$`, and `"` are all **literal** — only `'` needs doubling. So this function *inserts* backticks that then become part of the actual value. A login password like `p$ss` or `` a`b `` is passed to `xiloader --pass` mangled — the user silently logs in with the wrong password and gets "authentication failed" with no explanation.
**Fix:** for single-quoted context, escape only `'` → `''`. Delete the backtick/`$`/`"` replacements.

### C2. `launch-game` puts the plaintext password on a PowerShell command line
**`main.js:1800-1804`** — the decrypted password is interpolated into a PowerShell `-Command` string, visible to any process via WMI/`Get-CimInstance Win32_Process`. Fix: write the exact argv array to a temp `.ps1` (array literal, not string concat), or prefer xiloader's config-file/stdin auth over `--pass`.

## HIGH

### H1. `set-laa` / `check-laa` — arbitrary file modification, no path allow-listing
**`main.js:2622-2721`** — `exePath` is renderer-controlled with **no `isAllowedPath` check**; patches PE headers of any file, with an elevated Copy-Item fallback. Gate on `isAllowedPath` or an explicit allow-list of known exe names under known roots.

### H2. Blocking startup: recursive `Unblock-File` over the runtime tree with a misleading warning
**`main.js:805-811`** — runs synchronously on `app.whenReady` before the window; 51k-file tree on HDD trips the 15s timeout routinely and shows the wrong "Run as administrator" advice. Fix: run in background after window shows; don't warn on timeout; narrow scan to the few files that need it; remember completion in store.

### H3. Ten GitHub API `https.get` calls with no timeout → indefinite hang
**`main.js:2322-2336`, `2417-2430`, `2464-2477`, `2800-2813`, `3143-3156`, `3335-3347`, `3838-3850`** — none call `req.setTimeout`; stalled TLS leaves installs hanging forever with no error. Fix: route all GitHub GETs through the existing `githubGet()` helper (which also adds the saved PAT + rate-limit friendly errors).

### H4. Download-with-redirect routine copy-pasted ~10 times
**`main.js:363-392`, `1238-1287`, `1655-1694`, `2348-2374`, `2515-2556`, `2831-2885`, `3181-3233`, `3365-3404`, `3860-3899`, `4191-4231`** — subtle divergences (307/308 handling, stall-timeouts, activeDownloads registration). Extract one `downloadFile(url, dest, {onProgress, headers, timeoutMs})`.

### H5. Command injection via store-controlled paths in `xcopy`/`Compress-Archive`
**`main.js:4775`, `4784`, `4821`, `4824`, `4827`; robocopy at `2955`, `3064`, `3273`** — `ashitaPath`/`ffxiPath` come from the renderer-writable store; a `"` in the path breaks out of the quoting. Fix: use `fs.cpSync` + archiver library instead of shelling out; if keeping robocopy, `spawn(..., {shell:false})`.

## MEDIUM

- **M1. `store-set` accepts any key** (`main.js:882-890`) → renderer can poison the `isAllowedPath` allow-list (`439-452`). Whitelist settable keys (a set already exists at `4833`).
- **M2. `add-defender-exclusion`** (`main.js:3730-3745`) — elevated, renderer-supplied path, no validation, fragile triple-quoting.
- **M3. `build-xiloader`/`clone-xiloader`** (`main.js:1950`, `1963-1965`) — shell-string interpolation of repoDir; use `spawn` with array args.
- **M4. `copy-xiloader`** (`main.js:1986-1995`) — arbitrary src→dest copy, no allow-list.
- **M5. `get-music-path`** (`main.js:1424-1434`) — sync-reads whole file to base64 data URI over IPC; use a custom protocol to stream.
- **M6. No `app.requestSingleInstanceLock()`** — two instances during self-update can both robocopy `/MIR` over appRoot.
- **M7. Game-exit watcher** (`main.js:1746-1769`) — polls global `pol.exe` name; first client closing fires `game-exited` for all profiles in multibox. Track launched PID via `Start-Process -PassThru`.
- **M8. `open-external`** (`main.js:548-553`, `1403-1409`) — consider host allow-list.
- **M9. Heavy sync `execSync` on main thread** — detect-gpu (2726), controllers (4856), defender check (3751), registry reads (1459/1509/1584), build tools (1926-1932). Convert to existing async `runPowerShell`.
- **M10. Store read-modify-write races** (`908-911`, `4310-4313`, `4384-4388`, `4459-4463`, `4592`) — concurrent addon installs lose writes. Serialize with an async queue.

## Modernization

- **Electron 28 is EOL** (`package.json:22`); upgrade, then enable `sandbox: true` (contextIsolation/nodeIntegration already correct at `525-527`).
- **`check-for-updates`** (`main.js:1137-1156`) reimplements githubGet inline and skips the PAT.
- **`@electron/packager`** devDependency appears unused (dist uses electron-builder).
- Quick wins: refuse plain-HTTP downloads into install dirs (`2522`, `4198`); absolute-path powershell.exe; consolidate the two `before-quit` handlers (`846`, `1772`); `typeof e.status === 'number'` for robocopy exit checks (`2959`, `3067`, `3276`).

## Suggested module split

- `lib/security.js` (validators, escapePSString fixed, sanitizeName, isAllowedPath), `lib/download.js` (downloadFile + extractZip), `lib/github.js` (githubGet + release helpers), `lib/powershell.js` (runPowerShell, elevatedRun, friendlyError), `lib/ini.js`, `lib/fsutil.js`.
- `ipc/` modules: store, fs, registry, xiloader, launch, appUpdate, addons, hdpacks, xipivot, dgvoodoo, reshade, defender, backup, servers, music, system — each with a `register(ipcMain, ctx)`.

---

# Track 2: React renderer (`src/`)

## CRITICAL

### C1. "Apply to Profile" corrupts retail profiles
**`tabs/ProfileTab.js:725-741`** — blindly rewrites `file=`/`command=`; a retail profile (`file=` empty, `command=/game eAZcFcB`, see `utils/profileTemplates.js:8-9`) gets xiloader boot lines written in and never reaches PlayOnline again. Detect profile type and skip/patch only private-server keys.

### C2. Double-launch race
**`App.js:511-579`** — many awaits before `doLaunch` sets `isLaunching` (`App.js:464`); HomeTab's button (`HomeTab.js:467-473`) only disables on `isLaunching`. Double-click spawns two game instances. Set `isLaunching(true)` at top of `handleLaunch` (and clear on the modal early-return at `539-542`).

### C3. Startup can hang forever on "Loading..."
**`App.js:56-169`** — ~20 awaited pathExists probes before `setConfig`; any rejection → `config` stays null → permanent Loading screen (`591-593`). Wrap in try/catch, degrade gracefully. Same for `App.js:181-183`.

### C4. Reading a value "out of" a setState updater
**`tabs/XIPivotTab.js:325-332`, `353-359`** — `storeSet('customMods', persisted)` where `persisted` is assigned inside the updater; when React defers, store gets `undefined` and wipes the list. Mirror the existing `profileOverlaysRef` pattern (`39-42`).

## HIGH

- **H1. ~15 async handlers without try/catch** leave UI stuck in "downloading/installing" on IPC rejection: `ProfileTab.js:107-121`, `123-137`, `321-375`; `HomeTab.js:182-192`, `194-203`, `159-168`; `XIPivotTab.js:171-184`, `289-347`. Consider a `useAsyncAction` hook.
- **H2. Backup/Restore feedback invisible** — `SettingsTab.js:1630-1641` sets `applyMessage` but the bar renders only when `(pendingCount > 0 || applyStatus)` (`1660`); status never shown.
- **H3. SettingsTab shows stale values after profile switch** — `449-461`, `464-467`, `469-485`: values only set when present in new profile; always reset to defaults first.
- **H4. `configRef` stale for consecutive `updateConfig` calls** — `App.js:400-419` + `HomeTab.js:443-447`: host+port picker saves old-host+new-port. Update ref synchronously or add batch API.
- **H5. `key={activeTab}` remounts every tab** (`App.js:678`) — in-flight download UI destroyed on tab switch; progress lost, controls gone, mount IO re-runs. Lift long-running state to App/context or keep tabs mounted; re-hydrate active downloads on mount.
- **H6. UpdateModal ignores install failures** (`components/UpdateModal.js:26-34`) — collect failures, per-item status like MissingAddonsModal (`41-71`).
- **H7. Profile name validation in only 1 of 3 creation paths** — `ProfileTab.js:176-196` good; `HomeTab.js:99-109` none; `SetupWizard.js:146-161` silently no-ops but still finishes. Extract `validateProfileName` util.
- **H8. Side effects inside state updaters in music `ended` handler** (`App.js:261-281`) — StrictMode double-invoke skips tracks; rewrite against refs.

## MEDIUM

- M1. DgVoodoo Defender step shows "Checking..." forever (`DgVoodooTab.js:69`, `110-116`, `708-716`).
- M2. `customModAdding` dead → double-submit (`XIPivotTab.js:47`, `808-810`).
- M3. Delete profile fails silently (`ProfileTab.js:218-244`).
- M4. Multibox launch skips per-profile overlay write (`HomeTab.js:117-152` vs `App.js:467-472`).
- M5. ReShade config writes fail silently (`ReShadeTab.js:160-166`, `184-190`).
- M6. `[ashita.addons]` written with bare names incl. plugins (`AddonsTab.js:618-633`).
- M7. Modal: Escape closes all stacked modals; no focus trap (`components/Modal.js:6-12`).
- M8. Mixed confirm UIs: `window.confirm` at `AddonsTab.js:411`, `DgVoodooTab.js:246`, `ScriptEditorTab.js:208` vs styled Modal elsewhere.
- M9. Toggle divs not keyboard accessible (`AddonsTab.js:1101-1104`, `ReShadeTab.js:267-270`, `334-337`, `SettingsTab.js:1564-1571`, `MissingAddonsModal.js:142-145`); PluginsTab (`322-331`) has the correct pattern — extract `<Toggle>`.
- M10. Dead components: `LaunchBar.js`, `BgWikiTab.js`, `LogViewerTab.js` (unreachable); `checkTools` (`ProfileTab.js:301-319`); `INI_BLOCKED_KEYS`; unused `utils/conflicts.js` while both tabs re-implement inline. LogViewer/ScriptEditor disagree on `api.readDir` shape.
- M11. Clicking active graphics preset queues no-op pending set (`SettingsTab.js:787-793`, `947`).
- M12. Resolution inputs zero out while typing (`SettingsTab.js:986-988`, `1039-1041`).
- M13. ServerBrowser/wizard fetch failure has no retry (`ServerBrowserTab.js:23-37`, `SetupWizard.js:69-85`).
- M14. HomeTab Ashita-install errors invisible (`HomeTab.js:67-82`).
- M15. Script editor reads DOM instead of state (`ScriptEditorTab.js:426-435`).

## Structure / state

- Split SettingsTab (1705 lines) → GamepadConfigPanel + GamepadTestModal + settingsData.js.
- Move ADDON_CATALOGUE/PLUGIN_CATALOGUE to `src/data/` (kills App.js importing from tab components).
- Extract `HDPackCard` (duplicated 70-line JSX at `XIPivotTab.js:626-698` vs `713-786`).
- Shared `<ProgressBar>` (8 hand-rolled copies), `<StatusPill>`, `PathRow`.
- `useProfileScript` hook: 7 inline `script\s*=` regex re-implementations; PluginsTab writer races AddonsTab's serialized writer on the same file.
- `profiles` list tripled (App/HomeTab/ProfileTab); pass down from App.
- `profileOverlays` map written from 4 sites read-modify-write; centralize with write queue.
- Secrets (`loginPass`, `githubToken`) in plaintext electron-store; consider `safeStorage`.

## Feature ideas

- **F1.** Wire the fully-built LogViewerTab into Sidebar/App (fix readDir shape first).
- **F2.** Launch-again from recent-launch history rows (`HomeTab.js:517-530`).
- **F3.** Auto server-check on Home mount + latency per favorite in the picker.
- **F4.** Persist multibox profile selection.
- **F5.** Addon-update count badge on Addons tab.
- **F6.** xiloader version pill next to "already exists" (data already returned by check-xiloader-update).

---

# Track 3: CSS / look & feel

## Quick wins

- **QW1. Nonexistent-token bugs (live defects):** `SettingsTab.css:686-704` gamepad GUID inputs use undefined `--bg-elevated/--text/--text-muted` → render navy-purple `#1a1a2e` in a teal/gold app. Also `SetupWizard.css:281,377` (`--text` undefined), `CaptainModal.css:48,68` (`--amber` missing), `ProfileTab.css:600` (`--panel-bg` vs real `--bg-panel-alpha`).
- **QW2. Foreign fallback values** (Tailwind-palette landmines): `var(--teal, #00c8b4)`/`#2dd4bf`, wrong `--teal-rgb` triples, `#ff4d4f`, `#f1c40f`, `#ffd700` — `ProfileTab.css:609`, `XIPivotTab.css:229,244,507-509,525`, `SettingsTab.css:372,377,477,480,483,554`, `SetupWizard.css:325,373`, `ServerBrowserTab.css:141,229`. Policy: no `var()` fallbacks in this codebase.
- **QW3. Add warn/amber token trio** (`--amber`, `--amber-alpha`, `--amber-border`, `--red-hover`, `--green-rgb`, `--red-rgb`) and sweep the off-token greens/reds/ambers (DgVoodooTab, MissingAddonsModal, ReShadeTab, ServerBrowserTab, Sidebar, CaptainModal).
- **QW4. `.btn-xs` defined 3× with different metrics** (`App.css:77-80`, `XIPivotTab.css:232-235`, `MissingAddonsModal.css:139-142`); `.pill-xs` 2× (`App.css:174-177` vs `HomeTab.css:546-549`). Keep one each.
- **QW5. Global focus ring** for non-`.btn` buttons (topnav tabs, category tiles, preset buttons, etc.): `button:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }`. Clickable divs need `tabIndex`/keydown in JS.
- **QW6. Readability floor:** kill 9-10px text (`SettingsTab.css:933`, `HomeTab.css:547`, `AddonsTab.css:911`, `RegistryEditor.css:76`, `SetupWizard.css:351,359`); `--gold-dim` as text fails contrast (`DgVoodooTab.css:641`); `--text-dim` vs `--text-secondary` nearly identical — push dim to ~#6b7a8c.
- **QW7. Bundle fonts locally** (`public/index.html:8-13`) — offline first launch loses the whole FFXI identity; ship woff2 + `@font-face`.
- **QW8. `.plugins-filter-pill` ≡ `.addons-filter-pill`** byte-for-byte (`PluginsTab.css:52-93`, `AddonsTab.css:227-274`) → one `.filter-pill`.
- **QW9. Duplicate keyframes:** title/subtitle-glisten identical (`HomeTab.css:32-42`); 3 identical fade-ups (`App.css:115`, `DgVoodooTab.css:130`, `XIPivotTab.css:374`) → one `fade-in-up`.
- **QW10. Overflow guards:** gamepad table ~1080px wide vs 900px min window (`SettingsTab.css:404-433`) needs `overflow-x:auto`; `.addon-help-modal` needs `width:min(600px,92vw)` (`AddonsTab.css:672`); log columns too wide (`LogViewerTab.css:126,140`).
- **QW11. z-index sweep to tokens** — confirm dialogs at z 200 sit under z 1000 modals (`SettingsTab.css:234`, `ProfileTab.css:401`, `SetupWizard.css:5`, `UpdateModal.css:5`, `AddonsTab.css:510,669`, etc.).
- **QW12. `.script-sticky-bar` paints over LaunchBar** (`ScriptEditorTab.css:347-362`, `position:fixed`) — use `position:sticky` like SettingsTab (`210-224`).

## Bigger efforts

- **BE1. Shared `.progress-track/.progress-fill`, `.status-msg{success,error,warning}`, `.confirm-dialog`** — 9 progress bars, 7 status boxes, 2 identical confirm dialogs currently drift. Canonical CSS snippets in review chat.
- **BE2. Masked-gradient-border utility** — 17 copies of the `mask-composite: exclude` trick; `.selectable-card.active::before` (`index.css:388-399`) is the correct shared version (`border-radius: inherit`). Add `.framed-card` modifier; delete ~350 lines.
- **BE3. Typography/token adoption** — 416 font-size decls, only 15 use tokens; add `--text-xxs: 11px`, spacing `--space-1..6`, radius `--radius-sm/md/lg/xl`, transition tokens; outlaw `transition: all` (38×).
- **BE4. Top nav resilience** — `.topnav` no wrap/overflow at 900px min width (`Sidebar.css:1-9`); active tab changes font metrics causing layout jump (`34-44`); music controls positioned with magic offsets (`76,177,255`).
- **BE5. Shared `.empty-state` + finish skeleton rollout** (skeleton exists at `App.css:121-141`, used by 2 tabs; 6 scattered one-liner empty states).
- **BE6. Toast system** — none exists; results of long ops invisible after tab switch. `ToastHost` portal bottom-right above LaunchBar, styled off status tokens.
- **BE7. `!important` cleanup (31×)** — root cause is high-specificity global input rule (`index.css:178-192`); wrap in `:where()` and delete the shouts.
- **BE8. HomeTab:** `-24px` margin hack (`HomeTab.css:5`), fixed 280px right column (`92`), continuous GPU animations — pause when window blurred.

---

*Generated by three parallel review agents (Fable 5), 2026-07-03. Line numbers valid as of commit state on this date; main.js numbers reflect the tree including the check-xiloader-update feature added earlier today.*
