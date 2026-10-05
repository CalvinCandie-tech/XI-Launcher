# Server List Overhaul — Design

Date: 2026-10-05
Status: approved in brainstorming, awaiting spec review

## Problem

Private servers open, close, and change connection addresses. Today:

- The Servers tab parses `XiPrivateServers/Servers` SERVERS.md at runtime (`electron/main.js` `fetch-server-list`). That list has no connection addresses and leaks formatting junk into tags (`:question: rates`, bare numbers, `40 (Old Retail)`).
- Addresses live in `electron/serverAddresses.js`; extra and removed servers live in `EXTRA_SERVERS` / `REMOVED_SERVERS` in `main.js`. All three ship inside the release, so any address change or closure needs a new launcher release.
- Favourites (`config.favoriteServers` = `{name, host, port}`), each profile's `serverHost`, and the Ashita profile ini `--server` store raw hosts, so even a corrected list never reaches what players already saved.

## Goals

1. Address changes, new servers and closures reach players without a launcher release.
2. Players can add or correct a server on their own machine immediately, and suggest it to everyone.
3. The owner is told automatically when a server stops answering or when the community list changes, and approves every change.
4. Players' saved favourites / profiles follow an address change, after the player confirms.

## Non-goals

- "Play here" one-click profile setup (loader, updater link) — deferred.
- Visual redesign of the cards/tab beyond the elements below — deferred.
- Auto-hiding or reordering unreachable servers — status is a badge only.
- Discovering a server's new address automatically (nothing publishes it).

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Who maintains the data | Owner-curated file + player submissions + automated detection |
| Submission channel | GitHub issues (prefilled from the launcher) |
| Unreachable servers in the UI | Online/Offline badge only |
| XiPrivateServers role | One-time seed, then watched by a daily Action; launcher no longer reads it |
| Local add/edit | In scope |
| Saved favourites/profiles after a move | Updated only after the player confirms |
| Hosting | Raw file on `master` of the public `CalvinCandie-tech/XI-Launcher` repo |

## 1. Data: `servers/servers.json`

URL read by the launcher: `https://raw.githubusercontent.com/CalvinCandie-tech/XI-Launcher/master/servers/servers.json`

```json
{
  "version": 1,
  "updated": "2026-10-05",
  "ignoredUpstream": ["Demiurge", "Era", "DSP Old School", "Tonberry", "Caldera", "Made to Raid"],
  "servers": [
    {
      "id": "valhalla",
      "name": "Valhalla",
      "upstreamName": "Valhalla",
      "category": "90 - Custom Content",
      "host": "logon.valhalla.group",
      "port": "",
      "previousHosts": [],
      "website": "https://...",
      "discord": "https://discord.gg/...",
      "tags": { "expansion": "WotG", "rates": "Custom", "levelSync": true, "trusts": true, "multiBox": true },
      "note": ""
    }
  ]
}
```

Field rules:

- `id` — required, lowercase slug `[a-z0-9-]+`, unique, never changes (survives renames). Ids beginning `local-` are reserved for player-made servers.
- `name`, `category` — required strings. Category order in the tab follows first appearance in the file.
- `host` — may be empty; then `note` explains why (e.g. HorizonXI needs its own launcher; Phoenix not launched). Empty host ⇒ no status badge, no favourite star, no edit-host.
- `port` — optional string of digits. Used only for the status probe (xiloader 2.2.0 has no `--serverport`); probe falls back to 54231.
- `previousHosts` — old addresses, newest first. Must not contain the current `host`. When the owner changes an address, the old one moves here.
- `upstreamName` — optional; the name used on XiPrivateServers when it differs from `name`. Defaults to `name`.
- `tags` — all optional: `expansion` (string), `rates` (string), `moveSpeed` (string), `levelSync`/`trusts`/`multiBox` (booleans).
- `website`, `discord`, `note` — optional strings. Links must be `https://`.
- `ignoredUpstream` — top-level; XiPrivateServers names the owner has deliberately not listed (closed or unsupported).
- Unknown fields are ignored. Removing a server = deleting its entry.

Seed: generated once from today's SERVERS.md parse + `serverAddresses.js` + `EXTRA_SERVERS`, minus `REMOVED_SERVERS` (which become `ignoredUpstream`), with tags cleaned by hand. A copy is bundled in the build as `resources/servers.json` (first-run-offline fallback only).

## 2. Launcher

### 2.1 `electron/serverList.js` (new, pure, unit-tested)

- `validateServerList(json)` → `{ list, errors }`. Drops entries without valid `id`/`name`, duplicate ids (keeps first), non-https links; strips a `previousHosts` entry equal to `host`. Never throws.
- `resolveServerList({ fetched, cached, bundled })` → `{ list, source: 'live'|'cache'|'bundled', updated }`. First valid of live → cache → bundled.
- `applyLocalServers(list, localServers)` → merged list. Overrides (official id) replace host/port/name/links and set `localEdit: true`; custom (`local-*`) entries are appended under category "My servers". An override whose values now equal the official entry is returned in `redundant` and deleted from `localServers` by `fetch-server-list`.
- `findMovedHosts(list, saved)` → array of `{ serverId, name, fromHost, toHost, usedBy: [{ kind: 'favourite'|'profile', profile? }] }`. `saved` = favourites, `profileSettings[*].serverHost`, and the `--server` host read from each Ashita profile ini. Matching is case-insensitive on host.
- `buildIssueUrl(kind, payload)` → GitHub new-issue URL for `server-suggestion.yml` / `server-problem.yml`, prefilled title + body containing the JSON snippet for `servers.json`. Kept under 7,000 characters.

### 2.2 IPC (in `main.js`)

- `fetch-server-list` (replaced): called once in the background at launcher start (so the moved banner can appear on Home without visiting the Servers tab) and again when the Servers tab opens. Fetch the URL above with existing `retryAsync` and an 8 s timeout; on a valid result write store `serverListCache = { json, fetchedAt }`; resolve via `resolveServerList`; apply `localServers`; return `{ success, categories, source, updated }`. The SERVERS.md parser, `SERVER_ADDRESSES`, `EXTRA_SERVERS`, `REMOVED_SERVERS` and `electron/serverAddresses.js` are deleted.
- `save-local-server(entry)` / `reset-local-server(id)` — write store `localServers` (object keyed by id). Host validated with the same regex as `set-profile-server`.
- `get-moved-hosts` → `findMovedHosts` result for the current saved state.
- `apply-moved-host({ serverId, fromHost, toHost })` → rewrites matching favourites (host, and adds `id`), every `profileSettings[*].serverHost` equal to `fromHost`, and each matching profile ini via the existing `loaders.setIniServer`. Returns what changed.
- `check-server-status` — unchanged; the tab calls it per server.

### 2.3 Servers tab (`src/tabs/ServerBrowserTab.js`)

Keeps the current card layout. Additions:

- Toolbar: **+ Add a server** button; status line "Live list · updated <date>" or "Offline copy from <date>"; ↻ re-check button.
- Card: **● Online 42 ms / ● Offline** pill (probes run in parallel on tab open, 5 s timeout each, not stored); **✎ Edit** (official servers with a host, and custom ones); **⚑ Report problem** link (opens `server-problem` issue); **"Your edit"** marker + **Reset to official** on overridden cards; note text as today.
- Tags rendered from `tags` only (no more `:question:` parsing).
- **"My servers"** category for `local-*` entries, shown first.
- Edit/Add form (small modal): name, host, port, website, Discord, category; checkbox **Suggest to everyone** (default on for Add, off for Edit) — saving applies locally and, if ticked, opens the prefilled `server-suggestion` issue in the browser.
- **Moved banner** at the top of Home (existing `NoticeBanner` area) and of the Servers tab: one per moved server — *"Valhalla moved to X — used by your favourite and profile 'Main'. [Update] [Not now]"*. "Not now" hides it until the next launcher start (in-memory only).
- Favourites keep `{name, host, port}` and gain `id` when known; Home's `ServerPanel` is unchanged.

## 3. GitHub side (XI-Launcher repo)

### 3.1 `scripts/server-watch.js` + `.github/workflows/server-watch.yml`

Daily schedule + `workflow_dispatch`. Node, no dependencies; reuses `validateServerList` from `electron/serverList.js`.

- **Health:** TCP-probe each `host` (`port` or 54231), 3 attempts 30 s apart. State `health.json` = `{ [id]: { lastOk, firstFail } }` committed to branch `server-health` (not `master`). If `now - lastOk ≥ 3 days` and no open issue labelled `server-down` with that id in the title → open "⚠ <name> unreachable since <date> (<id>)". When the server answers again → comment and close that issue.
- **Upstream watch:** fetch SERVERS.md, collect names; diff against `upstreamName ?? name` of all entries plus `ignoredUpstream`. Open one issue per change, labelled `upstream-change`, deduped by title: "XiPrivateServers added: <name>" / "XiPrivateServers removed: <name>".
- Uses `GITHUB_TOKEN` with `issues: write`, `contents: write`.

### 3.2 `.github/workflows/servers-validate.yml`

On push / PR touching `servers/servers.json`: run `validateServerList`; fail on any error (bad JSON, missing/duplicate id, non-https link, current host in `previousHosts`).

### 3.3 Issue templates

`.github/ISSUE_TEMPLATE/server-suggestion.yml` (label `server-suggestion`) and `server-problem.yml` (label `server-problem`). The launcher opens them with `?template=…&title=…&body=…`. Owner loop: read issue → edit `servers.json` (or merge PR) → close issue; players get it within ~5 minutes (raw CDN cache).

## 4. Testing

- `electron/serverList.test.js`: validation cases; live/cache/bundled fallback; local override merge + redundant-override detection; custom servers; moved detection across favourites, profile settings and ini text; issue URL contents and length cap.
- `scripts/server-watch.test.js`: probe and GitHub API faked — 3-day threshold, no duplicate issue, auto-close on recovery, upstream diff with `upstreamName` and `ignoredUpstream`.
- Existing `npm run test:electron` stays green.
- Live: drive the real Servers tab over CDP (`--remote-debugging-port=9223`) with screenshots — live / offline-cache / bundled loads, add/edit/reset, moved banner (local test `servers.json`; `config.json` and the profile ini backed up and restored, hashes compared).
- Action: first run via `workflow_dispatch` on the branch, after owner approval (it creates real issues).

## 5. Rollout

1. Seed `servers/servers.json` + `servers-validate.yml`; push to `master` first so the URL is live.
2. Launcher code; delete `serverAddresses.js`, `EXTRA_SERVERS`, `REMOVED_SERVERS`, SERVERS.md parser.
3. `server-watch` Action + issue templates.
4. Release when the owner chooses.

Launchers ≤ 1.8.0 keep their old behaviour until they update. Every push, issue creation and release needs the owner's go-ahead.
