# Loader Registry — Design

**Date:** 2026-10-02
**Status:** Draft — awaiting review

## Problem

The launcher can only use a loader named `xiloader.exe`. It stores a loader *folder* and appends
`\xiloader.exe` in ~15 places (launch, existence checks, profile template, setup wizard, update
check, process detection). Any loader with another filename fails every check.

LevelDown (Demetrie) ships **ldloader.exe** — a fork of LSB xiloader 2.2.0
(`jeffnavy14/xiloader`, commit `060a809b`) with two client-side port remaps for VPN compatibility:

| Port | Stock xiloader 2.2.0 | ldloader | Configurable by CLI? |
|---|---|---|---|
| PlayOnline profile server | 51220 | 51221 | Yes — `--profileport` already exists upstream |
| IRC relay (upstream side) | 51240 (`kIrcPort`) | 51241 | **No** — hardcoded in `src/polrelay.cpp` |

The IRC port has no CLI flag, so a separate exe is genuinely needed today. ldloader's CLI is
otherwise identical to xiloader 2.2.0 (`--server`, `--user`, `--pass`, `--hairpin`, ...).

## Goal

Users can have several loaders installed side by side, and the launcher picks the correct one for
the server they're connecting to — with no renaming, no manual folder juggling, and no change for
users who only ever use stock xiloader.

**Success criteria**
1. Stock xiloader and ldloader are installed simultaneously; installing/updating one never touches
   the other.
2. Connecting to LevelDown uses ldloader automatically; connecting to any other server uses stock
   xiloader — under the same profile, without the user changing a setting.
3. A user can still force a specific loader (or any custom exe) per profile.
4. Existing installs and per-profile xiloader overrides keep working after upgrade with no user
   action.
5. Adding a future loader is a single registry entry.

## Non-goals (YAGNI)

- Per-server custom launch-argument editing in the UI.
- Build-from-source for loaders other than stock xiloader (the existing clone/build flow stays
  xiloader-only).
- Bundling ldloader in the release zip — it's downloaded on demand.
- Moving the existing xiloader install into a new folder.

## Design

### 1. Loader registry — `electron/loaders.js` (new)

A plain CommonJS module with the loader table and pure resolution logic (no Electron, no fs side
effects beyond what's passed in), so it can be unit-tested with `node --test`.

```js
const LOADERS = {
  xiloader: { name: 'xiloader (LandSandBoat)', repo: 'LandSandBoat/xiloader', asset: 'xiloader.exe', exe: 'xiloader.exe' },
  ldloader: { name: 'ldloader (LevelDown)',    repo: 'jeffnavy14/xiloader',  asset: 'ldloader.exe', exe: 'ldloader.exe' },
};
```

- `xiloader` keeps its existing install dir (`store.xiloaderPath`, default `defaultXiloaderPath`)
  and existing bundled-exe deploy. Nothing moves.
- Every other registry loader installs to `runtime/loaders/<id>/<exe>`.
- A **custom** loader is not a registry entry; it is a profile setting holding an absolute exe path.

Exports:
- `LOADERS`
- `loaderExeNames()` → `['xiloader.exe', 'ldloader.exe']` (for process detection)
- `resolveLoader({ profileLoader, serverHost, serverTable, paths })` → `{ id, exePath, source }`
  where `source` is `'profile' | 'server' | 'default'` (shown in the UI and launch log).

### 2. Resolution order

```
profile setting (explicit loader id, or custom exe path)
  └─ else: server binding (serverHost matches a SERVER_ADDRESSES entry with `loader`)
       └─ else: 'xiloader'
```

- Profile setting `loader` values: `'auto'` (default — follow server), a registry id, or
  `'custom'` + `loaderExePath`.
- Server matching is a case-insensitive exact match of the **host actually being connected to**
  against the `host` of `SERVER_ADDRESSES` entries. A host with no entry (e.g. Demetrie's test
  server at his house) falls through to default — the user picks ldloader on that profile
  explicitly.
- **Which host is "actually being connected to" depends on launch mode** (verified in code):
  - *Via Ashita* — the host is the `--server` value in the profile ini's `command =` line. This
    is **not** kept in sync with `config.serverHost`: the ini is only written at profile creation
    and by ProfileTab's manual "apply to profile"; the Home-tab favourites picker only changes
    `config.serverHost`. So the resolver must parse `--server` out of the ini, never read
    `config.serverHost`, or it could pick ldloader while the game connects to Eden.
  - *Direct (`useXiloader`)* — the host is `profileSettings.serverHost || config.serverHost`,
    exactly what `launch-game` already passes as `--server` (multi-box uses the same per-profile
    rule).
  - (The Home picker not updating the ini is a pre-existing bug, out of scope here — noted so it
    isn't mistaken for a loader-resolution bug.)

### 3. Server binding

`SERVER_ADDRESSES` entries gain an optional `loader` field:

```js
'LevelDown': { host: 'leveldownffxi.com', loader: 'ldloader' },
```

`LevelDown 75` is **not** bound — no evidence it uses the remapped ports.

**Rollout gate:** Demetrie said the remapped ports are currently only on his *test* server, not
live. Binding the live `leveldownffxi.com` entry before live switches ports would point
ldloader's profile-server and IRC relays at 51221/51241 on a server listening on 51220/51240.
(Verified in source: `polrelay::start` only fails on *local* listen/TLS setup, so login likely
proceeds and the upstream relay connections fail afterwards — friend list / PlayOnline-side
features. Exact in-game symptom is NOT verified.) The binding line
ships only once Demetrie confirms live has moved; until then, test-server users set
`loader = ldloader` on their profile. Everything else in this design ships regardless.

The server card shows a small `ldloader` tag when an entry has a `loader` field.

### 4. Install & update

Generalise the existing xiloader download/update handlers to take a loader id:

- `fetchLatestLoaderRelease(id)` → GitHub `releases/latest` on the registry `repo`, select the
  asset whose name equals the registry `asset` (case-insensitive). Replaces
  `fetchLatestXiloaderRelease` (which becomes the `xiloader` case).
- Download goes through the existing `downloadXiloaderExe` (rename-aside replace, AV retry, stale
  `.old-*` sweep), renamed `downloadLoaderExe`; it already takes `destExe` so works for any name.
- **Update detection by asset, not FileVersion.** ldloader reports FileVersion 2.2.0, same as
  stock, so versions can't distinguish builds. After each install, store
  `store.loaders[<id>] = { assetId, assetUpdatedAt, tag }`. An update is available when the
  latest release's matching asset `id` differs. If no record exists (pre-upgrade xiloader
  installs), fall back to today's FileVersion comparison for `xiloader` only.
- IPC: `download-loader(id)`, `check-loader-update(id)`; the existing `download-xiloader` /
  `check-xiloader-update` channels become thin wrappers calling them with `'xiloader'` so existing
  renderer calls keep working during the transition.
- `isAllowedPath` adds `runtime/loaders/` only. Custom loader folders are **not** added: launching
  a custom exe only needs an existence check, and adding arbitrary user-picked folders would widen
  the filesystem trust boundary for every file handler (the same reason `store-set` validates
  `xiloaderPath`). `loaderExePath` gets the same validation on save: string, absolute, ends in
  `.exe`, no quotes/newlines.

### 5. Launch

Both launch paths use `resolveLoader`:

- **Resolution happens in the main process.** `launch-game` no longer accepts a loader path from
  the renderer; it resolves from stored profile settings + the host rules in §2. Today the
  renderer passes a folder and main appends the fixed name `xiloader.exe`; accepting a free exe
  path from the renderer and running it with `-Verb RunAs` would let any renderer bug elevate an
  arbitrary exe.
- **Direct (`useXiloader`)** — runs the resolved exe; working directory = its folder. Error
  messages name the loader (`ldloader.exe not found …`).
- **Via Ashita** — the loader path is baked into the profile ini (`file = …`) at profile-creation
  time. Add `syncProfileLoader(profileIni, exePath)` next to `stripRemovedXiloaderArgs`: before
  each launch, rewrite the `[ashita.boot] file =` line to the resolved exe if it differs. This is
  what makes "loader follows server" work without regenerating profiles.

The launch log line includes the choice, e.g. `Using ldloader (from server LevelDown)`.

### 6. Every hardcoded `xiloader.exe`

All call sites switch to the resolver / registry:

| Location | Change |
|---|---|
| `main.js` launch-game, update handlers, deploy, default-profile gen | use resolver / registry exe |
| `main.js` ~1601 game-running check | `['pol.exe', 'Ashita-cli.exe', ...loaderExeNames()]` plus the active custom exe name |
| `profileTemplates.js` | takes a full `loaderExe` path instead of folder + appended name |
| `App.js`, `HomeTab.js`, `ProfileTab.js`, `SetupWizard.js` existence checks | check resolved exe path via a new `resolve-loader` IPC |

Build-from-source (`clone/build/copy-xiloader`) stays xiloader-only and untouched.

### 7. Migration (on startup, once, idempotent)

- Global `xiloaderPath` → unchanged; it remains the `xiloader` install dir.
- Each profile settings file with a non-empty `xiloaderPath` (today's "custom xiloader folder")
  → `loader = 'custom'`, `loaderExePath = <folder>\xiloader.exe`; old key **kept** (ignored by
  the new code) so rolling back to v1.6.x still finds it. If the exe
  isn't there, still migrate (the UI then shows the existing "not found" warning).
- Profiles without an override → `loader = 'auto'`.
- Write a `loaderMigrationVersion = 1` flag to the store so it runs once.

### 8. UI — Profiles tab

The existing "custom xiloader folder" block becomes a **Loader** section:

- Dropdown: `Auto (from server)` · `xiloader (LandSandBoat)` · `ldloader (LevelDown)` · `Custom exe…`
- Under it, the resolved result: `Will use: ldloader — from server LevelDown` or
  `Will use: xiloader — default`.
- Per registry loader row: installed status, last tag, `Install` / `Check for update` buttons
  (reusing the existing progress bar/event).
- `Custom exe…` opens a file picker filtered to `.exe` and shows the existing found/not-found pill.

No change to the Home tab beyond the launch-log line.

### 9. Errors

- Missing loader at launch: `ldloader.exe is not installed. Install it from Profiles → Loader.`
  (one click there downloads it). No silent fallback to stock xiloader — a wrong loader fails in
  confusing ways (wrong ports), so failing loudly is better.
- Release asset missing on GitHub: `No ldloader.exe found in the latest jeffnavy14/xiloader release.`
- AV lock / Defender: `XILOADER_IN_USE_ERROR` becomes a function of the exe name so the message
  names the blocked loader.

## Testing

- **Unit (`node --test electron/loaders.test.js`)** — no new dependencies:
  - resolution order: profile id > custom path > server binding > default
  - server host matching: case-insensitive, unmatched host → default, unbound server → default
  - host source: Ashita mode reads `--server` from the ini `command =` line (and ignores a
    different `config.serverHost`); direct mode uses the per-profile → global host
  - `loaderExeNames()` contents
  - migration transform on sample profile-settings objects (with/without override, idempotent
    on second run)
  - release asset selection by name (fixture JSON of a GitHub release with several assets)
- **`syncProfileLoader`** — unit test against temp ini files: rewrites `file =`, leaves the rest of
  the file byte-identical, no-op when already correct.
- **Manual in-launcher** (user):
  1. Fresh profile, server Eden → launch log says xiloader/default.
  2. Install ldloader from Profiles → both exes present in their own folders.
  3. Set profile to ldloader explicitly → profile ini `file =` points at ldloader; game launches
     (against Demetrie's test server).
  4. Switch back to Auto → ini `file =` back to xiloader on next launch.
  5. Upgrade an install with a per-profile custom xiloader folder → still launches the same exe.

## Future

If an `--ircport` flag is added to LSB xiloader upstream, the ldloader entry could become
"stock xiloader + extra args" (`--profileport 51221 --ircport 51241`) and the separate exe retired.
The registry shape allows adding an `args` field then; it is deliberately not added now.
