# Per-Profile Custom DAT Mods

## Problem

The XIPivot overlay system is currently global — all profiles share one `pivot.ini` with one overlay list. Users who play on multiple servers want different DAT mods per server. Additionally, there's no way to install custom DAT mods from GitHub; only the 8 built-in HD packs are supported.

## Solution

Make the XIPivot tab profile-aware and add support for custom DAT mod downloads from GitHub.

## Architecture

### Per-Profile Overlay Storage

- Each profile's overlay selections are stored in electron-store under `profileOverlays.<profileName>` — an array of overlay names (e.g. `["AshenbubsHD", "XiView", "MyCustomMod"]`).
- The XIPivot tab reads/writes overlays for the currently active profile.
- `pivot.ini` is written at launch time from the active profile's overlay list. Cache settings (enabled, size, max_age) remain global since they're hardware-dependent.
- When no profile-specific config exists (migration from pre-update), the current global `pivot.ini` overlays are copied to all existing profiles on first run.

### Custom DAT Mod Downloads

- A "Custom DAT Mods" section appears below the built-in HD packs on the XIPivot tab.
- User pastes a GitHub URL and clicks "Add".
- URL detection:
  - **Repo URL** (`github.com/user/repo`): downloads default branch as zip via GitHub archive endpoint.
  - **Release URL** (`github.com/user/repo/releases/...`): fetches latest release assets via GitHub API, downloads the zip.
- Mods extract to `runtime/ashita/polplugins/DATs/<repo-name>/`, same as built-in packs.
- Custom mod metadata stored in electron-store under `customMods` — array of `{ name, url, description, installedAt }`.
- GitHub repo description fetched from API for card display.

### New IPC Handlers (main.js)

- `install-custom-mod` — takes a GitHub URL, resolves type (repo vs release), downloads zip, extracts to DATs folder. Reuses existing `yauzl` extraction and progress reporting patterns.
- `remove-custom-mod` — deletes the overlay folder from DATs.
- `fetch-github-repo-info` — fetches repo name + description from GitHub API.

## UI Changes

### XIPivot Tab

**Profile indicator (top):**
- Banner below status bar: "Editing overlays for: **ProfileName**".
- If no profile is active: "No active profile — select one on the Profiles tab" (muted style).

**Active Overlays section (per-profile):**
- Overlay list shows only the active profile's overlays (from electron-store, not pivot.ini).
- Add/remove/reorder works the same, saves to `profileOverlays.<profileName>`.

**Built-in HD packs (minimal change):**
- After installing a built-in pack, it's automatically toggled ON for the current profile's overlay list (same behavior, just profile-scoped).

**Custom Mods section (new):**
- Section header: "Custom DAT Mods".
- URL input with placeholder: "Paste a GitHub repo or release URL..."
- "Add" button triggers download + extraction.
- Installed mods render as cards matching existing HD pack card styling: name, description, source link, reinstall/remove buttons, progress bar during install.

### Profile Tab

- Each profile row shows a small badge ("3 mods" / "No mods") indicating how many overlays are configured.

### Launch Flow

- Before starting the game, the app reads the active profile's overlay list from electron-store and writes it to `pivot.ini` via the existing `write-xipivot-config` handler.
- Roughly 5 lines added to the launch sequence in `App.js`.
- Freshly created profiles get an empty overlay list (clean slate).

### Migration

- On first run after update, if `profileOverlays` doesn't exist in electron-store, read current `pivot.ini` overlays and copy to all existing profiles.

## Error Handling

- **Invalid GitHub URL:** Validate format before download. Inline error: "Not a valid GitHub URL".
- **GitHub API rate limit (403):** Show: "GitHub rate limit reached — try again in a few minutes".
- **Download/extraction failure:** Same error pattern as existing HD packs — card shows error state, user can retry.
- **Duplicate custom mod:** If same repo name already installed, prompt to reinstall.
- **Profile deleted:** Clean up its `profileOverlays` entry.
- **Profile cloned:** Copy overlay list to the new profile.
- **Mod folder manually deleted:** Skip at launch (XIPivot handles this). Show "Not found" badge on the card.

## Out of Scope (YAGNI)

- Auto-updating custom mods (user can reinstall manually).
- Private GitHub repos (auth tokens).
- Non-GitHub sources (can add later).
- User-defined categories or grouping for custom mods.
