# Addon Update Checker — Manual Check Button Design Spec

## Overview
Add a "Check for Addon Updates" button to the top of the Addons tab. Clicking it bypasses the 24-hour cooldown, checks GitHub for newer addon versions, and shows the existing UpdateModal if updates are found.

## Behavior
1. Button sits at the top of the Addons tab, always visible
2. On click: calls `check-addon-updates` with a `force` flag that bypasses the 24h cooldown
3. While checking: button text changes to "Checking..." and is disabled
4. If updates found: App.js sets `addonUpdates` state, which triggers the existing UpdateModal
5. If no updates found: button briefly shows "All addons up to date" for 3 seconds, then resets
6. If error: button shows "Check failed" briefly, then resets
7. Existing startup auto-check (with 24h cooldown) remains unchanged

## IPC Changes

### `check-addon-updates` handler (electron/main.js)
- Add second parameter `force` (boolean, default false)
- When `force` is true: skip the 24h cooldown check
- When `force` is false: existing behavior (24h cooldown enforced)
- Everything else stays the same (SHA comparison, store updates)

## Frontend Changes

### App.js
- Add `handleManualAddonCheck` function that:
  - Calls `api.checkAddonUpdates(communityAddons, true)` (force=true)
  - Sets `addonUpdates` state if updates found
  - Returns the result so AddonsTab can show feedback
- Pass `onCheckAddonUpdates` prop to AddonsTab

### AddonsTab.js
- Accept new `onCheckAddonUpdates` prop
- Add state: `checkingUpdates` (boolean), `checkMsg` (string)
- Button at top of tab: "Check for Addon Updates"
- On click: set checking state, call `onCheckAddonUpdates`, handle result
- Button text cycles: "Check for Addon Updates" → "Checking..." → "All addons up to date" / resets

### preload.js
- Update `checkAddonUpdates` to pass the force flag: `(addonList, force) => ipcRenderer.invoke('check-addon-updates', addonList, force)`

## Files Changed
- `electron/main.js` — add `force` parameter to existing `check-addon-updates` handler
- `electron/preload.js` — pass `force` parameter through
- `src/App.js` — add `handleManualAddonCheck`, pass to AddonsTab
- `src/tabs/AddonsTab.js` — add button, checking state, result feedback

## Out of Scope
- Plugin update checking (separate feature)
- Per-addon update badges (not needed with modal approach)
- Built-in addon updates (they don't have GitHub repos)
- Changing the UpdateModal UI (already works)
