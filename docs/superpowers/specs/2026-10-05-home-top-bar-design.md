# Home screen redesign — top bar + centred title

Date: 2026-10-05 · Status: design approved in conversation, awaiting spec review

## Why

The current Home tab puts every control in one narrow right-hand column (profile, loader, game files,
server, multi-box, FFXI Files Updater). It needs a scrollbar, long paths wrap badly, everyday and
rarely-used controls are mixed together, and the left half is mostly empty video. The owner doesn't like
the layout overall.

## What the owner asked for

- Keep the tabs on top, the big **XI LAUNCHER / FINAL FANTASY XI** title, and the background video visible.
- Home stays a **control centre** — every control stays on Home.
- Layout: option "C" (a dock of summary tiles that open their controls) but with the dock **at the top,
  just under the tabs**, and **Start Game kept big under the title** (mockup "top-bar A").
- **Everything resizes, moves and stacks** as the window gets smaller or bigger — tiles *and* the tabs.
- Minimum window size lowered from 900 × 600 to **760 × 560**.

Mockups: `.superpowers/brainstorm/5532-1791209872/content/home-topbar.html` (layout) and
`home-responsive.html` (reflow at three widths).

## Layout

```
[ tabs — stretch to fill, wrap onto more rows when narrow ]
[ top bar: Profile | Loader | Game files | Server | Files updater | Multi-box ]
[ notice banner (only when there is one) ]

                 (video)
               ◆ crystal
             XI LAUNCHER
           FINAL FANTASY XI
          [ ✦ START GAME ]
          launch message

[Re-run Setup Wizard]                     (bottom-left, unchanged)
```

The music note stays top-left as today but must never overlap a wrapped tab row.

## The top bar

Six tiles. Each shows a one-line summary; clicking it drops its full controls down underneath it.
Contents of each drop-down are today's right-panel controls, unchanged in behaviour.

| Tile | Summary (closed) | Drop-down |
|---|---|---|
| Profile | active profile name + `installed` / `sandboxed` tag | profile list to switch, "Manage Profiles…" |
| Loader | loader name + ✓, or ⚠ not installed | `LoaderPicker` (compact) |
| Game files | `Installed` / `Sandboxed` + ✓ or ⚠ | `GameFilesPicker` |
| Server | host · ● Online 42 ms / ● Offline / checking | favourite-server switcher + Check connection |
| Files updater | `⚡ Run`, or live `42%` while running | mirror link (per profile), "Downloads into", Run, progress, status, "contributed by Demetrie" |
| Multi-box | number of profiles ticked | profile ticks + launch (tile only shown with 2+ profiles, as today) |

Retail (PlayOnline) profiles: Loader and Server tiles read "Retail (PlayOnline)" and are not clickable.

A tile with a problem (missing loader, no game files, server offline) shows ⚠ / amber so it's visible
without opening anything.

### Drop-down behaviour

- One open at a time; opening another closes the first.
- Closes on ✕, clicking the same tile, clicking anywhere else, or Esc.
- Anchored under its own tile wherever the tile has moved to; never runs off the window edge
  (right-hand tiles open aligned to their right edge).
- Closing the Files updater drop-down never stops a download — its state lives in `HomeTab`, and the
  tile shows the live %.

### Server status (behaviour change)

Today the server shows "—" until **Check connection** is clicked. The Server tile checks automatically
when Home opens and whenever the active profile or server changes (one TCP connect, the existing
`checkServer`), so the summary shows real status. The manual button stays in the drop-down.

## Middle of the screen

- Setup complete: crystal, title, subtitle and **Start Game** centred in the space below the bar, with the
  launch message under the button (as now).
- Setup incomplete (Ashita missing, no FFXI path, or no active profile): the top bar is hidden and a
  **setup card** takes Start Game's place, containing today's Setup Progress, Game Status (with Install
  Ashita v4 + progress/error) and Quick-create profile sections. When setup completes the card is
  replaced by the bar and Start Game.

## Notices

Startup warnings, "launcher update available", "update downloading" and "update failed" become one slim
dismissible banner centred under the top bar, same content and actions as today. It overlays the video
and does not move the title.

## Resizing

- **Tabs (whole app, `Sidebar`)**: tabs share the row evenly and wrap onto further rows when they don't
  fit, instead of overflowing. Music note repositions so it never covers a tab row.
- **Top bar**: CSS grid `repeat(auto-fit, minmax(~130px, 1fr))` — 6 across on wide windows, 3 × 2 on
  medium, 2 × 3 on narrow; tiles always stretch to fill. Long text is ellipsised (full text in the
  drop-down / tooltip).
- **Title / Start Game**: sizes scale with the window (`clamp()`).
- **Short windows**: the middle area scrolls rather than hiding Start Game.
- **Minimum window**: `windowState.MIN_SIZE` → 760 × 560 (also used by `BrowserWindow` minWidth/
  minHeight and by saved-size restoring). Every other tab is checked at 760 × 560 and anything that
  overflows or breaks is fixed — no redesign of other tabs.

## Code structure

`src/tabs/HomeTab.js` (688 lines, all inline) is split:

- `src/components/home/HomeTopBar.js` (+ `.css`) — the bar, tile shell, and drop-down mechanics
  (one-open, outside-click/Esc close, edge clamping).
- `src/components/home/ProfileSwitcher.js`, `ServerPanel.js`, `FilesUpdaterPanel.js`, `MultiBoxPanel.js`
  — each tile's drop-down contents, moved out of `HomeTab` unchanged in behaviour.
- `src/components/home/SetupCard.js`, `NoticeBanner.js`.
- `LoaderPicker` and `GameFilesPicker` are reused as-is.
- `HomeTab` keeps shared state (status checks, updater progress, launch) and lays the pieces out.

No IPC or main-process behaviour changes except the minimum window size.

## Implementation notes (checked against the code 2026-10-05)

- **Setup complete** is the existing `setupComplete = status.ashita && status.ffxi && config.activeProfile`
  in `HomeTab.js` — keep that definition.
- **Retail detection**: `HomeTab`'s status effect already calls `api.resolveLoader(config.activeProfile)`,
  whose result has `isRetail`. Keep that result in state and use it for the read-only Loader/Server tiles.
- **Server auto-check**: `HomeTab` has `checkServer()` and an effect that resets `serverStatus` to null
  when `config.serverHost` / `config.serverPort` change. Trigger the check from there (and on mount and
  active-profile change); `checkServer` already ignores calls while one is running. The Server tile only
  appears when `config.serverHost` is set (as today).
- **Multi-box** keeps its existing condition `setupComplete && profiles.length > 1`.
- **Minimum size**: change `MIN_SIZE` in `electron/windowState.js` to `{ width: 760, height: 560 }`.
  `electron/windowState.test.js` → "a saved size below the minimum is raised to it" expects 900 × 600 and
  must be updated to 760 × 560 (that test's other expectations are unaffected).
- **Music note**: `.topnav-music-btn` in `src/components/Sidebar.css` is absolutely positioned
  (`bottom: -72px`) relative to the Home tab; once tabs wrap it must be positioned so it can't land on a
  second/third tab row.
- Fixed-width CSS ≥ 700 px found: `CaptainModal.css` (700 px modal — check it fits at 760) and a
  decorative 800 px glow in `index.css` (harmless).

## Out of scope

- Redesigning other tabs (only fixing breakage at the new minimum size).
- Graphics mods into sandboxed copies; one-click server setup (separate follow-ups).

## Testing

- `CI=true` renderer build (lint as errors) and `npm run test:electron`.
- Run the launcher; screenshots at full screen, 1200 × 800 and 760 × 560; click every tile; check
  setup-incomplete state, a notice banner, a download running with its drop-down closed, a retail profile,
  and each other tab at 760 × 560.
- Owner reviews the final look in the real launcher.
