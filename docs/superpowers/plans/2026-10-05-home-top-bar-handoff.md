# Handoff: build the Home screen top-bar redesign

You are implementing an **approved design**. The owner (the person pasting this) chose every part of it
through mockups; don't re-open design decisions — if something in the spec turns out impossible or wrong,
stop and report it instead of improvising.

## Read first

1. **Spec (approved):** `docs/superpowers/specs/2026-10-05-home-top-bar-design.md` — the source of truth,
   including its "Implementation notes" section (already checked against the code).
2. **Mockups (what the owner picked):**
   `.superpowers/brainstorm/5532-1791209872/content/home-topbar.html` — option **A** (top bar under the tabs,
   Start Game big under the title) and `home-responsive.html` (how tabs/tiles reflow at three widths).
   Open them in a browser to see the intended look; `bg.jpg` / `crystal.svg` beside them are assets.
3. The current Home code: `src/tabs/HomeTab.js` (+ `.css`), `src/components/Sidebar.js` (+ `.css`) for the
   tabs, `src/components/LoaderPicker.js`, `src/components/GameFilesPicker.js`, `electron/windowState.js`.

Then write an implementation plan (superpowers:writing-plans) in `docs/superpowers/plans/` and execute it.
The repo has role agents in `.claude/agents/` (launcher-engineer, launcher-ux-designer, launcher-qa, …)
if you want to split work.

## Repo state — important

- Repo: `Z:\The Vault\xi-launcher`, branch **`fix/client-updater-sandbox`**. It carries a lot of
  **uncommitted, unreleased work from another session** (FFXI Files Updater fixes, per-profile Game files /
  Sandbox, addon update progress, remembered window size). **Build on top of it. Do not commit, stash,
  reset, checkout, revert or "clean up" any of it.** Do not commit your own work either — the owner will
  decide when to commit.
- `src/components/SandboxSwitch.js` / `.css` are unused but **must not be deleted** (owner hasn't decided).
- Don't change main-process/IPC behaviour beyond what the spec says (only `MIN_SIZE`).
- Match the existing code style (2-space indent, comment density and tone of the surrounding code, CSS
  variables from `src/index.css` like `--gold`, `--teal`, `--border-bright`, `--bg-panel-alpha`).

## Environment gotchas (Windows, slow disk)

- `Z:` is a spinning **HDD**; when it's busy (the owner sometimes extracts large modlists), Electron can
  take **2+ minutes** to open a window and builds are slow. A window that doesn't appear quickly is usually
  this, not a bug — check CPU/disk before debugging.
- `npm start` runs the React dev server (port 3000) **and** `wait-on` + Electron; `wait-on` has hung here,
  so Electron may never open. Check whether the dev server is already running
  (`curl http://127.0.0.1:3000`); if so, start Electron directly:
  `node_modules\electron\dist\electron.exe .` (working dir = repo root). The renderer hot-reloads on save;
  **main-process changes (`electron/*.js`) need an Electron restart.**
- When stopping processes, only kill ones whose path/command line contains `xi-launcher` — a blanket
  `node`/`electron` kill takes down the Claude Code MCP servers.
- Lint: the dev server prints `Compiled successfully!` or the eslint errors (check its output); a full
  `CI=true npx react-scripts build` (lint as errors) takes 10+ minutes on this disk — run it once at the end.
- Tests: `npm run test:electron` — **88 passing** before you start; it must stay green (the `windowState`
  minimum-size test needs the update described in the spec).
- Screenshots of the running launcher (also resizes it):
  `powershell -NoProfile -File .superpowers\tools\shot.ps1 -Out <png> [-Width 760 -Height 560]`
  — then look at the PNG. Use it for every visual check.

## Definition of done

- Everything in the spec's "Testing" section, with evidence:
  - `npm run test:electron` output (counts).
  - Dev-server compile clean (no eslint warnings), and the final `CI=true` build result.
  - Screenshots at **full screen, 1200 × 800 and 760 × 560** of Home, plus: one tile drop-down open, the
    setup-incomplete card, a notice banner, the Files updater tile showing a live % with its drop-down
    closed, a retail profile's tiles, and every other tab at 760 × 560.
- The owner checks the final look themselves; don't claim it "looks good" for them.

## Report back (the owner pastes this to the design session)

Reply with:
1. Files created / changed (one line each).
2. Test + build results (numbers / exact output lines).
3. Screenshot file paths (list), and which states each shows.
4. Anything in the spec you couldn't do, did differently, or found wrong — and why.
5. Open questions for the owner.
