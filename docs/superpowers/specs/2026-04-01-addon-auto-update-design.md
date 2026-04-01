# Addon Auto-Update on Launch

## Purpose

Community addons are installed from GitHub but never checked for updates afterward. Users must manually click "Update" on each addon to re-download. This feature checks for addon updates on launcher startup (once per day) and prompts the user with a checklist modal to confirm which addons to update.

## Behavior

### On addon install (existing flow change)

After a successful `installAddon` call, fetch the latest commit SHA from `https://api.github.com/repos/{owner}/{repo}/commits?per_page=1` and store it in `electron-store` under `addonUpdateSHAs[addonName]`. This gives us a baseline to compare against on future launches.

### On launcher start (new flow)

1. After the main window loads, the renderer sends a `check-addon-updates` IPC call.
2. Main process checks `addonUpdateLastCheck` in `electron-store`. If less than 24 hours have passed, return an empty list immediately.
3. Otherwise, read `addonUpdateSHAs` from store. For each addon with a saved SHA, look up its `repo` from the catalogue (passed from renderer or hardcoded — see implementation notes).
4. For each addon, GET `https://api.github.com/repos/{owner}/{repo}/commits?per_page=1` with `User-Agent: XI-Launcher`. Compare the returned SHA against the stored one.
5. Build a list of `{ name, repo, subdir }` objects where the remote SHA differs.
6. Update `addonUpdateLastCheck` to the current timestamp.
7. Return the list to the renderer.

### Update modal (new component)

When the renderer receives a non-empty update list:

- Display a modal overlay matching the existing dark theme.
- Header: "Addon Updates Available"
- Body: a checklist of addon names, all checked by default.
- Footer: "Update Selected" button (primary) and "Skip" button (ghost).
- On "Update Selected": for each checked addon, call the existing `installAddon` IPC sequentially. Show a simple progress state (current addon name, count). After each successful install, save the new SHA.
- On completion: close the modal.
- On "Skip": close the modal, do nothing.

### Rate limiting

GitHub unauthenticated API allows 60 requests/hour. The catalogue has ~20 community addons, so one check cycle uses ~20 requests. The 24-hour cooldown keeps this well within limits.

## Files to change

| File | Change |
|------|--------|
| `electron/main.js` | Add `check-addon-updates` handler: reads stored SHAs, fetches latest from GitHub, compares, returns diff list. After `install-addon` succeeds, fetch and store the commit SHA. |
| `electron/preload.js` | Expose `checkAddonUpdates(addonList)` and `onAddonUpdatesReady(callback)` in `xiAPI`. |
| `src/App.js` | On mount, call `checkAddonUpdates` with the community addon catalogue. Render `UpdateModal` when updates are found. |
| `src/components/UpdateModal.js` | New component: themed modal with addon checklist, update/skip buttons, progress state. |
| `src/components/UpdateModal.css` | Styles for the modal, matching existing panel/card patterns. |
| `src/tabs/AddonsTab.js` | After a manual install succeeds, save the new SHA via the existing store mechanism. |

## Design decisions

- **Checklist, not all-or-nothing**: Users can skip individual addons if a known-bad update exists.
- **24-hour cooldown**: Avoids GitHub rate limits and keeps startup fast for frequent relaunchers.
- **In-app modal, not native dialog**: Matches the launcher's dark themed UI.
- **Sequential updates**: Reuses the existing `installAddon` flow rather than adding parallel download logic.
- **SHA-based comparison**: Simple and reliable. Any commit to the repo's default branch triggers an update, which matches how the install flow works (downloads the branch HEAD zip).
