# Captain Integration Design

**Date:** 2026-05-22
**Status:** Approved

## Overview

Add `sruon/captain` — a packet capture and analysis suite for Ashita v4 — to the XI Launcher. Captain is a development tool used for FFXI-Crystal server work (NPC positions, event captures, mob data). It is not a regular gameplay addon and should be treated differently from the addon catalogue.

**Scope:** Install/update from GitHub releases + pinned card in Addons tab + informational sub-addon reference modal. Sub-addon enable/disable is deliberately left to the in-game `/cap` menu — the launcher does not touch Captain's config files.

---

## Architecture

### 1. Pinned card in Addons tab

Captain gets a permanently pinned card at the top of the Addons tab, separated from the regular catalogue by a thin divider. It does NOT appear as a browseable item in the catalogue below.

**Card layout:**
- Left: 👨‍✈️ icon, name "Captain", installed version vs latest GitHub release version
- Middle: Short description — "Packet capture & analysis suite for LandSandBoat development"
- Right: Install/Update button, enable toggle, gear (⚙) icon

**Visual treatment:** Same card size as a regular enabled addon card (not oversized). Pinned position — always first regardless of search/filter state.

### 2. Install / update flow

Captain releases as `captain.zip` on GitHub (`sruon/captain`).

- Launcher fetches the latest release tag via GitHub API
- Compares against installed version read from `<Ashita>/addons/captain/version.txt`
- Button shows **Install** (not installed) or **Update vX.X.X → vX.X.X** (update available) or nothing (up to date)
- Download extracts to `<Ashita>/addons/captain/` — same path as all other addons
- Installed version is cached in `config.json` after install

**Catalogue entry:**
```js
{
  name: 'captain',
  description: 'Packet capture & analysis suite for LandSandBoat development',
  category: 'Dev Tools',
  repo: 'sruon/captain',
  useRelease: true,
  installAs: 'captain',
  pinned: true,
}
```

This reuses the existing GitHub release download machinery (same as LuAshitacast, statustimers, etc.).

### 3. Default.txt integration

Enable toggle adds/removes one line from `Default.txt`:

```
/addon load captain
```

Uses the existing addon enable/disable mechanism — no new logic. If captain was already manually present in `Default.txt` before the launcher was involved, the toggle detects and shows it as enabled (same "detected" logic as other addons).

### 4. Sub-addon info modal (gear ⚙)

Read-only reference panel. No toggles, no save button.

**Modal title:** "Captain — Sub-addons"

**Top banner:** *"Sub-addons are configured in-game via `/cap`. Use this reference to understand what each one does before enabling."*

**Layout:** Two-column scrollable grid, split into two sections:

#### Safe (no known detection risk)
| Addon | Description |
|---|---|
| PacketLogger | Captures all received/emitted packets by ID and direction. Compatible with PVLV/VieweD. |
| CapLog | Captures chat log content. Strips auto-translate tags and colors. |
| NPCLogger | Captures NPC entity packet data (position, model, level). |
| EventView | Captures all event packets including event number, parameters, music, animations. |
| HPTrack | Logs HP deducted from defeated enemies including enspells, skillchains, spikes. |
| KITrack | Logs obtained/lost key items with position and zone. |
| PathLog | Tracks and captures player and NPC/mob movement paths. |
| AttackDelay | Summarises melee attack delay from enemy action packets. |
| ShopStock | Captures items sold by NPCs. Auto-appraise is opt-in (☠️ when enabled). |
| GuildStock | Captures items sold and purchased by Guild Shops. |
| WeatherTrack | Captures weather on zone-in and subsequent weather events. |
| OBS | Automates OBS recording via WebSocket. Sets source to current window. |
| FishMon | Tracks fishing catches. |
| PacketBridge | Re-emits all packets to a configurable UDP port. |

#### Use with caution
| Addon | Risk | Description |
|---|---|---|
| Widescan | ☠️ | Emits recurring Widescan packets. Enabled by default. Required by LevelRangeTrack. |
| LevelRangeTrack | ☠️ | Captures level ranges per unique mob. Requires Widescan. |
| CheckParam | ☠️☠️ | Logs /checkparam results at a defined interval. Intervals below 1s are high risk. |
| SpawnTrack | ☠️☠️☠️ | Tracks exact spawn times and spawn points for defeated mobs. Must accept warning in settings. |
| ZoneDump | ☠️☠️☠️ | Queries server for all static entities in zone. Must accept warning in settings. |

---

## What this does NOT include

- Sub-addon enable/disable from the launcher — use `/cap` in-game
- Reading or writing Captain's Ashita XML config files
- A separate Captain tab
- Any modification to captain.lua or Captain's internals

---

## Files to change

| File | Change |
|---|---|
| `src/tabs/AddonsTab.js` | Add `pinned: true` field to catalogue entry for captain; render pinned card above catalogue |
| `src/tabs/AddonsTab.css` | Style for pinned card divider |
| New: `src/components/CaptainModal.js` | Sub-addon info modal component |
| New: `src/components/CaptainModal.css` | Modal styles |
| `electron/main.js` | No changes required (install/update reuses existing IPC) |
