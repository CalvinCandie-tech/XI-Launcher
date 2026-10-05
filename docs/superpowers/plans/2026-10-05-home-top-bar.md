# Home top bar Implementation Plan

> **For agentic workers:** executed inline (superpowers:executing-plans) in the session that wrote it — the
> owner asked for the work to be done straight away. **No commits** (handoff rule: the owner commits).

**Goal:** Replace Home's right-hand control column with a top bar of summary tiles that drop their
controls down, keep the big title + Start Game centred, make tabs/tiles reflow, and lower the minimum
window to 760 × 560.

**Architecture:** `HomeTab` keeps all shared state (status checks, updater progress, multi-box picks,
server status, notices) and lays out three regions: `.home-top` (bar + notices), `.home-middle`
(title/Start Game or setup card, scrolls when short) and the wizard corner. `HomeTopBar` owns the tile
shell and drop-down mechanics; the drop-down is portalled to `document.body` with `position: fixed` so
it is never clipped by `.app-content`'s scroll box, sits above the Sidebar's music cluster, and can be
clamped to the window edge from the tile's `getBoundingClientRect()`.

**Tech Stack:** React 18 (CRA 5 / react-scripts, eslint as errors under `CI=true`), Electron 28,
`node --test` for `electron/*.test.js`.

**Spec:** `docs/superpowers/specs/2026-10-05-home-top-bar-design.md` (+ handoff
`docs/superpowers/plans/2026-10-05-home-top-bar-handoff.md`).

## Global Constraints

- Build on the uncommitted work on `fix/client-updater-sandbox`; never commit/stash/reset/clean.
- Don't delete `src/components/SandboxSwitch.*`.
- Only main-process change: `windowState.MIN_SIZE` → `{ width: 760, height: 560 }`.
- 2-space indent, existing comment tone, CSS variables from `src/index.css`.
- `setupComplete = status.ashita && status.ffxi && config.activeProfile` (unchanged).
- Multi-box tile condition `setupComplete && profiles.length > 1`; Server tile only when `config.serverHost`.
- Drop-down contents keep today's behaviour; `LoaderPicker` / `GameFilesPicker` reused as-is.

## Review Focus

1. A download running while its drop-down is closed / another tile opened → download continues, tile shows live %.
2. Server changed (favourite picked, profile switched) while a check is in flight → the stale result must not land on the new server.
3. Profiles exist but none is active (setup incomplete, bar hidden) → the player must still be able to pick one (spec's setup card omits this; keep today's Game Profile picker in the card).
4. Window resized while a drop-down is open → panel follows its tile and stays inside the window.
5. Music note with wrapped tabs / multi-row bar / notice banner → never overlaps any of them.

These have no automated renderer tests in this repo (only `electron/*.test.js` exists); each is checked
by hand in the running launcher with a screenshot in Task 6.

---

### Task 1: Minimum window size

**Files:** Modify `electron/windowState.js:6`, `electron/windowState.test.js:38`

- [ ] Update test expectation `{ width: 900, height: 600 }` → `{ width: 760, height: 560 }`; run `npm run test:electron` → expect 1 fail.
- [ ] `MIN_SIZE = { width: 760, height: 560 }`; rerun → 88 pass. (main.js already reads `MIN_SIZE`; needs an Electron restart.)

### Task 2: `HomeTopBar` (tile shell + drop-down mechanics)

**Files:** Create `src/components/home/HomeTopBar.js`, `HomeTopBar.css`

**Interfaces — produces:**
`<HomeTopBar tiles={[{ id, label, summary, title?, warn?, readOnly?, wide?, render: (close) => node }]} />`
- `summary`: node shown on one ellipsised line; `title`: tooltip with full text.
- `readOnly`: not clickable, no caret (retail Loader/Server).
- `render(close)`: drop-down body; `close()` closes it.

Behaviour:
- `openId` state; one open at a time; clicking the open tile closes it.
- Close on ✕, Esc (focus returns to the tile), mousedown outside bar + panel.
- Panel `position: fixed` via `createPortal(document.body)`; `top = tile.bottom + 6`;
  `left = tile.left`, or aligned to `tile.right` when it would run off the right edge; clamped to a
  12 px window margin; `max-height` = space below, body scrolls. Re-positioned on window resize and
  when the bar resizes (ResizeObserver).
- Layout: rows are balanced — column count is the first of `n, ceil(n/2), ceil(n/3), 1` whose tiles are
  ≥ 130 px — so 6 tiles go 6 → 3 × 2 → 2 × 3 (spec) instead of `auto-fit`'s 5 + 1; flex-wrap so a
  short last row still stretches.

### Task 3: Drop-down panels + setup card + notices

**Files:** Create in `src/components/home/`: `ProfileSwitcher.js`, `ServerPanel.js`,
`FilesUpdaterPanel.js`, `MultiBoxPanel.js`, `SetupCard.js`, `NoticeBanner.js`, `HomePanels.css`

Each is presentational; markup/handlers moved from `HomeTab.js` unchanged in behaviour:
- `ProfileSwitcher({ profiles, activeProfile, gameFilesTag, onSelect, onManage })` — list + "⚙ Manage Profiles...".
- `ServerPanel({ config, serverStatus, checkingServer, onCheck, onPick })` — favourites list (inline, no nested
  picker) + Check connection + status box.
- `FilesUpdaterPanel({ activeProfile, mirrorUrl, setMirrorUrl, updating, percent, detail, status, target, onRun })`.
- `MultiBoxPanel({ profiles, activeProfile, selected, onToggle, launching, log, onLaunch })`.
- `SetupCard({ status, stepsComplete, ashita…, quick-create…, profile picker… })` — Setup Progress, Game Status
  (+ Install Ashita v4), Quick Setup, Game Profile.
- `NoticeBanner({ startupWarnings, onDismissWarnings, updateInfo, updateDlStatus, updateDlProgress, updateDlError, onDownload, onSkip, onDismissUpdate, onDismissError })`.

### Task 4: Rewire `HomeTab`

**Files:** Modify `src/tabs/HomeTab.js`, `src/tabs/HomeTab.css`

- Keep `resolveLoader` result (`loaderInfo`) and `getProfileGameFiles` result (`gameFiles`) in state for tile summaries.
- Server auto-check: `checkServer` as `useCallback([host, port])` with a request-id ref (stale results dropped);
  effect on `[checkServer, config.activeProfile, isRetail]` resets status and checks (skips retail / no host).
- Layout: `.home-tab` fills `.app-content` (`position: absolute; inset: 0`), column flex; `.home-top` (bar + absolute
  notices), `.home-middle` (flex 1, `overflow-y: auto`, centred), title/crystal/button sized with `clamp()`.
- Publish `--home-top-h` (bar + notices height) on `document.documentElement` for the music cluster.
- Remove CSS made unused by the move.

### Task 5: Tabs wrap + music cluster (`Sidebar`)

**Files:** Modify `src/components/Sidebar.js`, `src/components/Sidebar.css`

- `.topnav { flex-wrap: wrap; position: relative }`, tabs `flex: 1 1 auto; justify-content: center`.
- Music button/controls/track/slider move into one `.topnav-music` box positioned
  `top: calc(100% + var(--home-top-h, 0px) + 8px); left: 16px` of the nav — under the last tab row and
  under the Home bar, whatever their heights.

### Task 6: Other tabs at 760 × 560 + verification

- Screenshot every tab at 760 × 560; fix only overflow/breakage (check `CaptainModal.css` 700 px modal).
- `npm run test:electron` (88 pass), dev-server compile clean, `CI=true npx react-scripts build` once at the end.
- Screenshots (full screen, 1200 × 800, 760 × 560) of: Home, a tile open, setup-incomplete card, notice banner,
  updater live % with drop-down closed, retail profile tiles; plus every other tab at 760 × 560.
  States the real config doesn't reach are forced with a temporary, clearly marked dev-only edit that is
  reverted before the report.
