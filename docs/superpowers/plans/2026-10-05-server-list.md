# Server List Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the release-baked server addresses with a curated `servers/servers.json` that every launcher reads live from GitHub, let players add/correct servers locally and suggest them via GitHub issues, offer to update saved favourites/profiles when an address moves, and have a daily GitHub Action flag dead servers and community-list changes.

**Architecture:** Pure logic lives in `electron/serverList.js` (validation, live/cache/bundled resolution, local edits, moved-host detection, issue links) and `scripts/serverWatchCore.js` (Action decisions), both unit-tested with `node --test`. `electron/main.js` does the I/O behind new IPC handlers; the React Servers tab, a new edit modal, and a moved-server banner (Home + Servers) consume them. The GitHub side is two workflows + two issue forms in the same repo.

**Tech Stack:** Electron 28 (Node 18 main), React 18 via react-scripts, electron-store, `node:test`, GitHub Actions (Node 22, `gh` CLI), GitHub REST API via `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-05-server-list-design.md`

## Global Constraints

- Repo: `Z:\The Vault\xi-launcher`, branch `feature/server-list`. Never push, create issues, run workflows or release without the owner's explicit go-ahead.
- Live list URL: `https://raw.githubusercontent.com/CalvinCandie-tech/XI-Launcher/master/servers/servers.json`.
- Issue URL base: `https://github.com/CalvinCandie-tech/XI-Launcher/issues/new`; templates `server-suggestion.yml` / `server-problem.yml`; prefill fields `server-id`, `details`, `json`; URL ≤ 7,000 characters.
- `id`: lowercase `[a-z0-9]+(-[a-z0-9]+)*`, unique, never changes; `local-` prefix reserved for player-made servers.
- Links must start with `https://` or `http://`. Hosts match `^[A-Za-z0-9.-]+$` (same as `set-profile-server`). Ports are 1–5 digits ≤ 65535.
- Status probe port falls back to `54231`. Fetch timeout 8 s. Down threshold 3 days. Probe attempts 3, 30 s apart.
- Host comparisons are case-insensitive everywhere.
- Status is a badge only — never hide or reorder servers by status.
- Moved addresses are applied only after the player clicks **Update**; **Not now** hides until next launcher start (memory only).
- Kill only Electron processes whose path contains `xi-launcher` — a blanket `node`/`electron` kill takes down Claude Code's MCP servers.
- Before any live test that writes settings: back up `%APPDATA%\xi-launcher\config.json` and every touched profile ini, restore afterwards, compare hashes.
- Tests: `npm run test:electron` (currently 95 passing) must stay green after every task.

## Review Focus

1. **GitHub unreachable or hanging at startup** — the launcher must open normally and the Servers tab must fall back to the cached/bundled copy within ~20 s, never spin forever. Pinned by Task 12 live check "black-hole URL".
2. **A profile ini that can't be read or written when applying a move** (locked by Ashita, deleted) — the other saved places must still update and the player gets a readable error, not a crash. Pinned by the per-ini `try` in Task 6 `apply-moved-host` and Task 12 check "read-only ini".
3. **Retail profiles** — a retail ini has no `--server`; it must never be reported as moved or rewritten. Pinned by Task 3 test "retail profile hosts are ignored" (main passes `iniHost: ''` for retail via `parseIniBoot(...).host === null`).
4. **A player's local edit of a server that is later removed from servers.json** — must not crash or resurrect the server; it is simply not shown. Pinned by Task 2 test "override for an unknown id is ignored".
5. **Favourite saved before this change (no `id`)** — must still match its card by host, toggle off correctly, and follow a local address edit. Pinned by Task 8 Step "favourite without id follows edit" (live) and `sameFav` in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `electron/serverList.js` (create) | Pure: validate/resolve/group list, local edits, moved hosts, issue links |
| `electron/serverList.test.js` (create) | Unit tests for the above + "shipped servers.json validates" |
| `servers/servers.json` (create) | The curated list (seed) |
| `scripts/validate-servers.js` (create) | CLI validator used by CI |
| `scripts/serverWatchCore.js` (create) | Pure: Action decisions (health + upstream diff) |
| `scripts/serverWatchCore.test.js` (create) | Unit tests for the above |
| `scripts/server-watch.js` (create) | Action runner: probes, GitHub API, health.json |
| `.github/workflows/servers-validate.yml` (create) | Validate servers.json on push/PR |
| `.github/workflows/server-watch.yml` (create) | Daily watch |
| `.github/ISSUE_TEMPLATE/server-suggestion.yml`, `server-problem.yml` (create) | Issue forms |
| `electron/main.js` (modify ~5334-5433, 10) | Replace `fetch-server-list`; add local-server, moved-host, issue IPC |
| `electron/preload.js` (modify ~170) | Expose new IPC |
| `electron/serverAddresses.js` (delete) | Superseded by servers.json |
| `package.json` (modify) | `test:electron` includes `scripts/*.test.js`; `build.files` includes `servers/servers.json` |
| `src/components/servers/ServerCard.js` (create) | One server card |
| `src/components/servers/ServerEditModal.js` (create) | Add/Edit form |
| `src/components/MovedServerBanner.js` (create) | "X moved — Update / Not now" rows |
| `src/tabs/ServerBrowserTab.js` (rewrite) | Tab: load, status probes, filters, modal, banner |
| `src/tabs/ServerBrowserTab.css` (modify) | New classes |
| `src/App.js` (modify) | Startup list fetch, moved state, handlers, props |
| `src/tabs/HomeTab.js` (modify ~16, ~447) | Render banner |
| `.superpowers/tools/cdp-eval.js` (create, untracked) | Evaluate JS in the running renderer over CDP |

---

### Task 1: serverList core — validate, resolve, group

**Files:**
- Create: `electron/serverList.js`
- Test: `electron/serverList.test.js`

**Interfaces:**
- Produces:
  - `SERVER_LIST_URL: string`, `REPO_URL: string`, `DEFAULT_PROBE_PORT = '54231'`, `MY_SERVERS_CATEGORY = 'My servers'`
  - `str(v) -> string` (trimmed string or `''`), `sameHost(a, b) -> boolean`, `isLink(v) -> boolean`, `HOST_RE`, `PORT_RE`, `ID_RE`
  - `validateServerList(json) -> { list: { version, updated, ignoredUpstream: string[], servers: Server[] } | null, errors: string[] }`
  - `Server = { id, name, category, host, port, previousHosts: string[], website, discord, tags: { expansion?, rates?, moveSpeed?, levelSync?, trusts?, multiBox? }, note, upstreamName? }`
  - `resolveServerList({ fetched, cached, bundled }) -> { list, source: 'live'|'cache'|'bundled'|'none' }`
  - `groupByCategory(servers) -> [{ name, servers }]`

- [ ] **Step 1: Write the failing tests**

Create `electron/serverList.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const SL = require('./serverList');

const entry = (over = {}) => ({ id: 'eden', name: 'Eden', category: '75 - Retail-Like', host: 'play.edenxi.com', ...over });
const doc = (servers, extra = {}) => ({ version: 1, updated: '2026-10-05', servers, ...extra });

test('validateServerList keeps a well-formed entry and fills defaults', () => {
  const { list, errors } = SL.validateServerList(doc([entry()]));
  assert.deepEqual(errors, []);
  assert.deepEqual(list.servers[0], {
    id: 'eden', name: 'Eden', category: '75 - Retail-Like', host: 'play.edenxi.com', port: '',
    previousHosts: [], website: '', discord: '', tags: {}, note: '',
  });
  assert.equal(list.updated, '2026-10-05');
  assert.deepEqual(list.ignoredUpstream, []);
});

test('validateServerList rejects a non-object or missing servers array without throwing', () => {
  for (const bad of [null, 'x', 42, {}, { servers: 'nope' }]) {
    const { list, errors } = SL.validateServerList(bad);
    assert.equal(list, null);
    assert.equal(errors.length, 1);
  }
});

test('validateServerList drops entries with a bad id, no name or no category', () => {
  const { list, errors } = SL.validateServerList(doc([
    entry({ id: 'Eden XI' }), entry({ id: 'a', name: '' }), entry({ id: 'b', category: ' ' }), entry({ id: 'ok' }), 'junk',
  ]));
  assert.deepEqual(list.servers.map(s => s.id), ['ok']);
  assert.equal(errors.length, 4);
});

test('validateServerList keeps the first of duplicate ids and reserves local- ids', () => {
  const { list, errors } = SL.validateServerList(doc([entry(), entry({ name: 'Eden 2' }), entry({ id: 'local-x' })]));
  assert.deepEqual(list.servers.map(s => s.name), ['Eden']);
  assert.equal(errors.length, 2);
});

test('validateServerList clears non-http(s) links and bad hosts/ports but keeps the server', () => {
  const { list, errors } = SL.validateServerList(doc([
    entry({ website: 'javascript:alert(1)', discord: 'http://discord.gg/x', host: 'bad host', port: '54a' }),
  ]));
  const s = list.servers[0];
  assert.equal(s.website, '');
  assert.equal(s.discord, 'http://discord.gg/x');
  assert.equal(s.host, '');
  assert.equal(s.port, '');
  assert.equal(errors.length, 3);
});

test('validateServerList rejects ports above 65535', () => {
  const { list, errors } = SL.validateServerList(doc([entry({ port: '70000' })]));
  assert.equal(list.servers[0].port, '');
  assert.equal(errors.length, 1);
});

test('validateServerList removes the current host from previousHosts (any case) and dedupes', () => {
  const { list, errors } = SL.validateServerList(doc([
    entry({ previousHosts: ['PLAY.edenxi.com', 'old.edenxi.com', 'Old.EdenXI.com'] }),
  ]));
  assert.deepEqual(list.servers[0].previousHosts, ['old.edenxi.com']);
  assert.equal(errors.length, 1);
});

test('validateServerList keeps only known tag fields with the right types', () => {
  const { list } = SL.validateServerList(doc([
    entry({ tags: { expansion: ' ToAU ', rates: 3, levelSync: true, trusts: 'yes', multiBox: false, bogus: 'x' } }),
  ]));
  assert.deepEqual(list.servers[0].tags, { expansion: 'ToAU', levelSync: true });
});

test('validateServerList keeps upstreamName and ignoredUpstream strings', () => {
  const { list } = SL.validateServerList(doc([entry({ upstreamName: ' Eden ' })], { ignoredUpstream: ['Era', '', 5] }));
  assert.equal(list.servers[0].upstreamName, 'Eden');
  assert.deepEqual(list.ignoredUpstream, ['Era']);
});

test('resolveServerList prefers live, then cache, then bundled', () => {
  const live = doc([entry({ name: 'Live' })]);
  const cache = doc([entry({ name: 'Cache' })]);
  const bundled = doc([entry({ name: 'Bundled' })]);
  assert.equal(SL.resolveServerList({ fetched: live, cached: cache, bundled }).source, 'live');
  assert.equal(SL.resolveServerList({ fetched: null, cached: cache, bundled }).list.servers[0].name, 'Cache');
  assert.equal(SL.resolveServerList({ fetched: { servers: [] }, cached: null, bundled }).source, 'bundled');
});

test('resolveServerList reports none when nothing is usable', () => {
  const r = SL.resolveServerList({});
  assert.equal(r.source, 'none');
  assert.deepEqual(r.list.servers, []);
});

test('groupByCategory keeps first-appearance order and puts My servers first', () => {
  const servers = [
    entry({ id: 'a', category: 'X' }), entry({ id: 'b', category: 'Y' }),
    entry({ id: 'c', category: 'X' }), entry({ id: 'local-d', category: 'My servers' }),
  ];
  assert.deepEqual(
    SL.groupByCategory(servers).map(c => [c.name, c.servers.map(s => s.id)]),
    [['My servers', ['local-d']], ['X', ['a', 'c']], ['Y', ['b']]],
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test electron/serverList.test.js`
Expected: FAIL — `Cannot find module './serverList'`.

- [ ] **Step 3: Write the implementation**

Create `electron/serverList.js`:

```js
// Curated private-server list (servers/servers.json in the XI-Launcher repo): validating it,
// picking the live / cached / bundled copy, merging the player's local edits, spotting saved
// addresses that have moved, and building prefilled GitHub issue links. Pure — main.js does
// all the network and file I/O.

const SERVER_LIST_URL = 'https://raw.githubusercontent.com/CalvinCandie-tech/XI-Launcher/master/servers/servers.json';
const REPO_URL = 'https://github.com/CalvinCandie-tech/XI-Launcher';
const DEFAULT_PROBE_PORT = '54231';
const MY_SERVERS_CATEGORY = 'My servers';

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOST_RE = /^[A-Za-z0-9.-]+$/;
const PORT_RE = /^\d{1,5}$/;
const TAG_STRINGS = ['expansion', 'rates', 'moveSpeed'];
const TAG_FLAGS = ['levelSync', 'trusts', 'multiBox'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const sameHost = (a, b) => !!str(a) && !!str(b) && str(a).toLowerCase() === str(b).toLowerCase();
const isLink = (v) => /^https?:\/\/\S+$/i.test(str(v));
const isPort = (v) => PORT_RE.test(v) && Number(v) <= 65535;

function normalizeServer(raw, errors) {
  if (!raw || typeof raw !== 'object') {
    errors.push('A server entry is not an object.');
    return null;
  }
  const id = str(raw.id);
  const where = `server "${id || '(no id)'}"`;
  if (!ID_RE.test(id)) {
    errors.push(`${where}: id must be lowercase letters, digits and dashes.`);
    return null;
  }
  const name = str(raw.name);
  const category = str(raw.category);
  if (!name) {
    errors.push(`${where}: missing name.`);
    return null;
  }
  if (!category) {
    errors.push(`${where}: missing category.`);
    return null;
  }

  let host = str(raw.host);
  if (host && !HOST_RE.test(host)) {
    errors.push(`${where}: host "${host}" is not a valid address.`);
    host = '';
  }
  let port = str(raw.port);
  if (port && !isPort(port)) {
    errors.push(`${where}: port "${port}" is not a valid port.`);
    port = '';
  }

  const previousHosts = [];
  for (const h of Array.isArray(raw.previousHosts) ? raw.previousHosts : []) {
    const ph = str(h);
    if (!ph || !HOST_RE.test(ph)) {
      errors.push(`${where}: previousHosts has an invalid entry.`);
      continue;
    }
    if (sameHost(ph, host)) {
      errors.push(`${where}: previousHosts contains the current host.`);
      continue;
    }
    if (!previousHosts.some(x => sameHost(x, ph))) previousHosts.push(ph);
  }

  const link = (key) => {
    const v = str(raw[key]);
    if (v && !isLink(v)) {
      errors.push(`${where}: ${key} must start with https:// or http://.`);
      return '';
    }
    return v;
  };

  const rawTags = raw.tags && typeof raw.tags === 'object' ? raw.tags : {};
  const tags = {};
  for (const k of TAG_STRINGS) {
    const v = str(rawTags[k]);
    if (v) tags[k] = v;
  }
  for (const k of TAG_FLAGS) {
    if (rawTags[k] === true) tags[k] = true;
  }

  const server = {
    id, name, category, host, port, previousHosts,
    website: link('website'), discord: link('discord'), tags, note: str(raw.note),
  };
  const upstreamName = str(raw.upstreamName);
  if (upstreamName) server.upstreamName = upstreamName;
  return server;
}

// Never throws. Bad entries are dropped (or bad fields cleared) and described in `errors`,
// so one typo in servers.json can't take the Servers tab down.
function validateServerList(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.servers)) {
    return { list: null, errors: ['Server list must be an object with a "servers" array.'] };
  }
  const errors = [];
  const servers = [];
  const seen = new Set();
  for (const raw of json.servers) {
    const server = normalizeServer(raw, errors);
    if (!server) continue;
    if (server.id.startsWith('local-')) {
      errors.push(`server "${server.id}": ids starting with "local-" are reserved for players' own servers.`);
      continue;
    }
    if (seen.has(server.id)) {
      errors.push(`server "${server.id}": duplicate id (kept the first).`);
      continue;
    }
    seen.add(server.id);
    servers.push(server);
  }
  const ignoredUpstream = (Array.isArray(json.ignoredUpstream) ? json.ignoredUpstream : []).map(str).filter(Boolean);
  return {
    list: { version: Number(json.version) || 1, updated: str(json.updated), ignoredUpstream, servers },
    errors,
  };
}

// First usable copy wins: freshly fetched, then the last good fetch, then the one shipped
// inside the launcher (first run with no internet).
function resolveServerList({ fetched, cached, bundled } = {}) {
  for (const [source, json] of [['live', fetched], ['cache', cached], ['bundled', bundled]]) {
    if (!json) continue;
    const { list } = validateServerList(json);
    if (list && list.servers.length > 0) return { list, source };
  }
  return { list: { version: 1, updated: '', ignoredUpstream: [], servers: [] }, source: 'none' };
}

// Categories in the order they first appear in the file; the player's own servers on top.
function groupByCategory(servers) {
  const categories = [];
  for (const s of servers) {
    let cat = categories.find(c => c.name === s.category);
    if (!cat) {
      cat = { name: s.category, servers: [] };
      categories.push(cat);
    }
    cat.servers.push(s);
  }
  return [
    ...categories.filter(c => c.name === MY_SERVERS_CATEGORY),
    ...categories.filter(c => c.name !== MY_SERVERS_CATEGORY),
  ];
}

module.exports = {
  SERVER_LIST_URL,
  REPO_URL,
  DEFAULT_PROBE_PORT,
  MY_SERVERS_CATEGORY,
  ID_RE,
  HOST_RE,
  PORT_RE,
  str,
  sameHost,
  isLink,
  validateServerList,
  resolveServerList,
  groupByCategory,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test electron/serverList.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/serverList.js electron/serverList.test.js
git commit -m "feat(servers): server list validation and live/cache/bundled resolution"
```

---

### Task 2: Local add/edit — sanitize and merge

**Files:**
- Modify: `electron/serverList.js` (add functions + exports)
- Test: `electron/serverList.test.js` (append)

**Interfaces:**
- Consumes: `str`, `sameHost`, `isLink`, `HOST_RE`, `MY_SERVERS_CATEGORY`, `validateServerList` (Task 1)
- Produces:
  - `slugify(name) -> string` (`'server'` if empty)
  - `sanitizeLocalServer(input, { officialIds: Set, localIds: Set }) -> { entry } | { error: string }`
    - override of an official id → `{ id, ...non-empty of name/host/port/website/discord }`
    - custom → `{ id: 'local-…', name, host, port, website, discord, category }`
  - `applyLocalServers(servers, localServers) -> { servers: Server[], redundant: string[] }`
    - overridden server gains `localEdit: true`, `official: { name, host, port }`
    - custom server shape: `{ id, name, category: 'My servers', suggestedCategory, host, port, previousHosts: [], website, discord, tags: {}, note: '', custom: true }`

- [ ] **Step 1: Write the failing tests**

Append to `electron/serverList.test.js`:

```js
const official = () => SL.validateServerList(doc([
  entry(),
  entry({ id: 'valhalla', name: 'Valhalla', category: '90 - Custom Content', host: 'logon.valhalla.group' }),
])).list.servers;
const idSet = (arr) => new Set(arr);

test('slugify makes a servers.json-style id', () => {
  assert.equal(SL.slugify('My Test Server!'), 'my-test-server');
  assert.equal(SL.slugify('  ***  '), 'server');
  assert.equal(SL.slugify(undefined), 'server');
});

test('sanitizeLocalServer turns an edit of an official server into an override of non-empty fields', () => {
  const r = SL.sanitizeLocalServer(
    { id: 'eden', name: 'Eden', host: 'new.edenxi.com', port: '', website: '', discord: '' },
    { officialIds: idSet(['eden']), localIds: idSet([]) },
  );
  assert.equal(r.error, undefined);
  assert.deepEqual(r.entry, { id: 'eden', name: 'Eden', host: 'new.edenxi.com' });
});

test('sanitizeLocalServer gives a new server a unique local- id', () => {
  const r = SL.sanitizeLocalServer(
    { name: 'My Test Server!', host: '10.0.0.5', category: '75 - Custom Content' },
    { officialIds: idSet([]), localIds: idSet(['local-my-test-server']) },
  );
  assert.deepEqual(r.entry, {
    id: 'local-my-test-server-2', name: 'My Test Server!', host: '10.0.0.5', port: '',
    website: '', discord: '', category: '75 - Custom Content',
  });
});

test('sanitizeLocalServer keeps an existing custom id when editing it', () => {
  const r = SL.sanitizeLocalServer({ id: 'local-mine', name: 'Mine', host: 'b.com' }, { officialIds: idSet([]), localIds: idSet(['local-mine']) });
  assert.equal(r.entry.id, 'local-mine');
});

test('sanitizeLocalServer rejects bad input with a readable message', () => {
  const opts = { officialIds: idSet([]), localIds: idSet([]) };
  assert.match(SL.sanitizeLocalServer({ name: '', host: 'a.com' }, opts).error, /name/i);
  assert.match(SL.sanitizeLocalServer(null, opts).error, /name/i);
  assert.match(SL.sanitizeLocalServer({ name: 'X', host: '' }, opts).error, /address/i);
  assert.match(SL.sanitizeLocalServer({ name: 'X', host: 'a b' }, opts).error, /address/i);
  assert.match(SL.sanitizeLocalServer({ name: 'X', host: 'a.com', port: '99999x' }, opts).error, /port/i);
  assert.match(SL.sanitizeLocalServer({ name: 'X', host: 'a.com', website: 'file://c:/x' }, opts).error, /http/i);
});

test('applyLocalServers applies an override and remembers the official values', () => {
  const { servers, redundant } = SL.applyLocalServers(official(), { eden: { id: 'eden', host: 'new.edenxi.com' } });
  const eden = servers.find(s => s.id === 'eden');
  assert.equal(eden.host, 'new.edenxi.com');
  assert.equal(eden.localEdit, true);
  assert.deepEqual(eden.official, { name: 'Eden', host: 'play.edenxi.com', port: '' });
  assert.deepEqual(redundant, []);
});

test('applyLocalServers reports an override that now matches the official entry', () => {
  const { servers, redundant } = SL.applyLocalServers(official(), { eden: { id: 'eden', name: 'Eden', host: 'PLAY.edenxi.com' } });
  assert.deepEqual(redundant, ['eden']);
  assert.equal(servers.find(s => s.id === 'eden').localEdit, undefined);
});

test('applyLocalServers lists custom servers first under My servers and ignores junk', () => {
  const { servers } = SL.applyLocalServers(official(), {
    'local-mine': { id: 'local-mine', name: 'Mine', host: 'b.com', port: '', website: '', discord: '', category: '75 - Custom Content' },
    junk: 'x',
  });
  assert.deepEqual(servers.map(s => s.id), ['local-mine', 'eden', 'valhalla']);
  assert.equal(servers[0].category, 'My servers');
  assert.equal(servers[0].suggestedCategory, '75 - Custom Content');
  assert.equal(servers[0].custom, true);
});

test('applyLocalServers ignores an override for an id that is no longer listed', () => {
  const { servers, redundant } = SL.applyLocalServers(official(), { ghost: { id: 'ghost', host: 'g.com' } });
  assert.deepEqual(servers.map(s => s.id), ['eden', 'valhalla']);
  assert.deepEqual(redundant, []);
});

test('applyLocalServers tolerates a missing store value', () => {
  assert.equal(SL.applyLocalServers(official(), undefined).servers.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test electron/serverList.test.js`
Expected: FAIL — `SL.slugify is not a function`.

- [ ] **Step 3: Write the implementation**

In `electron/serverList.js`, add above `module.exports`:

```js
const OVERRIDE_KEYS = ['name', 'host', 'port', 'website', 'discord'];

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
}

// Check what the Add / Edit form sent. Editing an official server stores only the fields the
// player filled in (an override); anything else is the player's own server under a local- id.
function sanitizeLocalServer(input, { officialIds = new Set(), localIds = new Set() } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const name = str(src.name);
  if (!name) return { error: 'Give the server a name.' };
  const host = str(src.host);
  if (host && !HOST_RE.test(host)) return { error: 'The address can only contain letters, digits, dots and dashes.' };
  const port = str(src.port);
  if (port && !isPort(port)) return { error: 'The port must be a number up to 65535.' };
  const website = str(src.website);
  const discord = str(src.discord);
  if ((website && !isLink(website)) || (discord && !isLink(discord))) {
    return { error: 'Links must start with https:// or http://.' };
  }

  const id = str(src.id);
  if (officialIds.has(id)) {
    const entry = { id };
    for (const [k, v] of Object.entries({ name, host, port, website, discord })) {
      if (v) entry[k] = v;
    }
    return { entry };
  }

  if (!host) return { error: 'Enter the server address (for example login.example.com).' };
  let localId = id.startsWith('local-') && localIds.has(id) ? id : '';
  if (!localId) {
    const base = `local-${slugify(name)}`;
    localId = base;
    for (let n = 2; localIds.has(localId); n++) localId = `${base}-${n}`;
  }
  return { entry: { id: localId, name, host, port, website, discord, category: str(src.category) } };
}

// Lay the player's local edits over the official list. Overrides whose values now match the
// official entry are returned in `redundant` so the caller can delete them.
function applyLocalServers(servers, localServers) {
  const local = localServers && typeof localServers === 'object' ? localServers : {};
  const redundant = [];
  const merged = servers.map((s) => {
    const o = local[s.id];
    if (!o || typeof o !== 'object') return s;
    const changes = {};
    for (const k of OVERRIDE_KEYS) {
      const v = str(o[k]);
      if (!v) continue;
      const same = k === 'host' ? sameHost(v, s.host) : v === s[k];
      if (!same) changes[k] = v;
    }
    if (Object.keys(changes).length === 0) {
      redundant.push(s.id);
      return s;
    }
    return { ...s, ...changes, localEdit: true, official: { name: s.name, host: s.host, port: s.port } };
  });
  const custom = Object.values(local)
    .filter(o => o && typeof o === 'object' && typeof o.id === 'string' && o.id.startsWith('local-'))
    .map(o => ({
      id: o.id,
      name: str(o.name) || o.id,
      category: MY_SERVERS_CATEGORY,
      suggestedCategory: str(o.category),
      host: str(o.host),
      port: str(o.port),
      previousHosts: [],
      website: str(o.website),
      discord: str(o.discord),
      tags: {},
      note: '',
      custom: true,
    }));
  return { servers: [...custom, ...merged], redundant };
}
```

Add to `module.exports`: `slugify, sanitizeLocalServer, applyLocalServers,`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test electron/serverList.test.js`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/serverList.js electron/serverList.test.js
git commit -m "feat(servers): local add/edit overrides merged over the official list"
```

---

### Task 3: Moved-address detection

**Files:**
- Modify: `electron/serverList.js`
- Test: `electron/serverList.test.js` (append)

**Interfaces:**
- Consumes: `str`, `sameHost` (Task 1)
- Produces:
  - `findMovedHosts(servers, { favorites, serverHost, profiles: [{ name, settingsHost, iniHost }] }) -> Move[]`
  - `Move = { serverId, name, fromHost, toHost, usedBy: [{ kind: 'favourite' } | { kind: 'current' } | { kind: 'profile', profile }] }`
  - `describeUsedBy(usedBy) -> string` e.g. `"your favourite, the selected server and profiles 'Main' and 'Alt'"`
  - `applyMoveToConfig({ favorites, serverHost }, move) -> { favorites, serverHost, changed: boolean }`

- [ ] **Step 1: Write the failing tests**

Append to `electron/serverList.test.js`:

```js
const movedList = () => SL.validateServerList(doc([
  entry({ id: 'valhalla', name: 'Valhalla', host: 'new.valhalla.group', previousHosts: ['logon.valhalla.group'] }),
  entry(),
])).list.servers;

test('findMovedHosts finds a favourite, the selected server and profiles still on an old host', () => {
  const moves = SL.findMovedHosts(movedList(), {
    favorites: [{ name: 'Valhalla', host: 'LOGON.valhalla.group' }, { name: 'Eden', host: 'play.edenxi.com' }],
    serverHost: 'logon.valhalla.group',
    profiles: [
      { name: 'Main', settingsHost: 'logon.valhalla.group', iniHost: 'logon.valhalla.group' },
      { name: 'Alt', settingsHost: '', iniHost: 'logon.valhalla.group' },
      { name: 'Eden', settingsHost: 'play.edenxi.com', iniHost: 'play.edenxi.com' },
    ],
  });
  assert.deepEqual(moves, [{
    serverId: 'valhalla', name: 'Valhalla', fromHost: 'LOGON.valhalla.group', toHost: 'new.valhalla.group',
    usedBy: [{ kind: 'favourite' }, { kind: 'current' }, { kind: 'profile', profile: 'Main' }, { kind: 'profile', profile: 'Alt' }],
  }]);
});

test('findMovedHosts returns nothing when no saved host is an old address', () => {
  assert.deepEqual(SL.findMovedHosts(movedList(), { favorites: [], serverHost: 'new.valhalla.group', profiles: [] }), []);
  assert.deepEqual(SL.findMovedHosts(movedList(), undefined), []);
});

test('findMovedHosts: retail profile hosts are ignored', () => {
  // main passes iniHost '' for retail profiles (parseIniBoot(...).host is null)
  assert.deepEqual(SL.findMovedHosts(movedList(), { profiles: [{ name: 'Retail', settingsHost: '', iniHost: '' }] }), []);
});

test("findMovedHosts ignores an old host that is now some server's current host", () => {
  const servers = SL.validateServerList(doc([
    entry({ id: 'a', host: 'a2.com', previousHosts: ['shared.com'] }),
    entry({ id: 'b', host: 'shared.com' }),
  ])).list.servers;
  assert.deepEqual(SL.findMovedHosts(servers, { serverHost: 'shared.com' }), []);
});

test('findMovedHosts skips servers with no current host', () => {
  const servers = SL.validateServerList(doc([entry({ host: '', previousHosts: ['old.com'] })])).list.servers;
  assert.deepEqual(SL.findMovedHosts(servers, { serverHost: 'old.com' }), []);
});

test('describeUsedBy reads naturally', () => {
  assert.equal(SL.describeUsedBy([{ kind: 'favourite' }]), 'your favourite');
  assert.equal(SL.describeUsedBy([{ kind: 'profile', profile: 'Main' }]), "profile 'Main'");
  assert.equal(
    SL.describeUsedBy([{ kind: 'favourite' }, { kind: 'current' }, { kind: 'profile', profile: 'Main' }, { kind: 'profile', profile: 'Alt' }]),
    "your favourite, the selected server and profiles 'Main' and 'Alt'",
  );
});

const move = { serverId: 'valhalla', name: 'Valhalla', fromHost: 'logon.valhalla.group', toHost: 'new.valhalla.group', usedBy: [] };

test('applyMoveToConfig rewrites matching favourites and the selected server', () => {
  const r = SL.applyMoveToConfig({
    favorites: [{ name: 'Valhalla', host: 'Logon.Valhalla.Group', port: '' }, { name: 'Eden', host: 'play.edenxi.com' }],
    serverHost: 'logon.valhalla.group',
  }, move);
  assert.deepEqual(r.favorites, [
    { id: 'valhalla', name: 'Valhalla', host: 'new.valhalla.group', port: '' },
    { name: 'Eden', host: 'play.edenxi.com' },
  ]);
  assert.equal(r.serverHost, 'new.valhalla.group');
  assert.equal(r.changed, true);
});

test('applyMoveToConfig drops a moved favourite that would duplicate one already on the new host', () => {
  const r = SL.applyMoveToConfig({
    favorites: [{ name: 'V', host: 'new.valhalla.group' }, { name: 'V old', host: 'logon.valhalla.group' }],
    serverHost: 'x.com',
  }, move);
  assert.deepEqual(r.favorites.map(f => f.host), ['new.valhalla.group']);
  assert.equal(r.serverHost, 'x.com');
  assert.equal(r.changed, true);
});

test('applyMoveToConfig leaves unrelated config alone', () => {
  const r = SL.applyMoveToConfig({ favorites: [{ name: 'Eden', host: 'play.edenxi.com' }], serverHost: 'play.edenxi.com' }, move);
  assert.equal(r.changed, false);
  assert.equal(r.serverHost, 'play.edenxi.com');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test electron/serverList.test.js`
Expected: FAIL — `SL.findMovedHosts is not a function`.

- [ ] **Step 3: Write the implementation**

In `electron/serverList.js`, add above `module.exports`:

```js
// Saved addresses (favourites, the selected server, each profile's settings and ini) that a
// server has since moved away from. One Move per server + old host, listing everywhere it's used.
function findMovedHosts(servers, { favorites = [], serverHost = '', profiles = [] } = {}) {
  const moves = new Map();
  const ownerOf = (host) => {
    if (!str(host) || servers.some(s => sameHost(s.host, host))) return null;
    return servers.find(s => s.host && s.previousHosts.some(p => sameHost(p, host))) || null;
  };
  const note = (host, use) => {
    const server = ownerOf(host);
    if (!server) return;
    const key = `${server.id}|${str(host).toLowerCase()}`;
    if (!moves.has(key)) {
      moves.set(key, { serverId: server.id, name: server.name, fromHost: str(host), toHost: server.host, usedBy: [] });
    }
    const usedBy = moves.get(key).usedBy;
    if (!usedBy.some(u => u.kind === use.kind && u.profile === use.profile)) usedBy.push(use);
  };
  for (const f of Array.isArray(favorites) ? favorites : []) {
    if (f && typeof f === 'object') note(f.host, { kind: 'favourite' });
  }
  note(serverHost, { kind: 'current' });
  for (const p of Array.isArray(profiles) ? profiles : []) {
    if (!p || typeof p !== 'object') continue;
    note(p.settingsHost, { kind: 'profile', profile: p.name });
    note(p.iniHost, { kind: 'profile', profile: p.name });
  }
  return [...moves.values()];
}

function joinAnd(parts) {
  if (parts.length <= 1) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function describeUsedBy(usedBy = []) {
  const parts = [];
  if (usedBy.some(u => u.kind === 'favourite')) parts.push('your favourite');
  if (usedBy.some(u => u.kind === 'current')) parts.push('the selected server');
  const profiles = usedBy.filter(u => u.kind === 'profile').map(u => `'${u.profile}'`);
  if (profiles.length) parts.push(`${profiles.length === 1 ? 'profile' : 'profiles'} ${joinAnd(profiles)}`);
  return joinAnd(parts);
}

// New favourites + selected server after the player accepts a move.
function applyMoveToConfig({ favorites = [], serverHost = '' } = {}, move) {
  let changed = false;
  const out = [];
  for (const f of Array.isArray(favorites) ? favorites : []) {
    const moved = !!f && typeof f === 'object' && sameHost(f.host, move.fromHost);
    const next = moved ? { ...f, id: move.serverId, host: move.toHost } : f;
    if (moved) {
      changed = true;
      if (out.some(o => o && sameHost(o.host, next.host))) continue;
    }
    out.push(next);
  }
  const nextHost = sameHost(serverHost, move.fromHost) ? move.toHost : serverHost;
  if (nextHost !== serverHost) changed = true;
  return { favorites: out, serverHost: nextHost, changed };
}
```

Add to `module.exports`: `findMovedHosts, describeUsedBy, applyMoveToConfig,`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test electron/serverList.test.js`
Expected: PASS, 31 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/serverList.js electron/serverList.test.js
git commit -m "feat(servers): detect saved addresses a server has moved away from"
```

---

### Task 4: Prefilled GitHub issue links

**Files:**
- Modify: `electron/serverList.js`
- Test: `electron/serverList.test.js` (append)

**Interfaces:**
- Consumes: `str`, `sameHost`, `slugify`, `REPO_URL`, `MY_SERVERS_CATEGORY`
- Produces:
  - `serverSnippet(server) -> string` (pretty JSON of a servers.json entry)
  - `buildIssueUrl(kind: 'suggestion'|'problem', { server, details }) -> string`
  - `ISSUE_URL_MAX = 7000`

- [ ] **Step 1: Write the failing tests**

Append to `electron/serverList.test.js`:

```js
test('serverSnippet strips local- ids and launcher-only fields', () => {
  const mine = {
    id: 'local-mine', name: 'Mine', category: 'My servers', suggestedCategory: '75 - Custom Content', host: 'b.com', port: '',
    previousHosts: [], website: '', discord: '', tags: {}, note: '', custom: true,
  };
  assert.deepEqual(JSON.parse(SL.serverSnippet(mine)), {
    id: 'mine', name: 'Mine', category: '75 - Custom Content', host: 'b.com', port: '',
    previousHosts: [], website: '', discord: '', tags: {}, note: '',
  });
});

test('serverSnippet records the official host as previous when the address was edited', () => {
  const edited = {
    ...entry(), port: '', previousHosts: [], website: '', discord: '', tags: {}, note: '',
    host: 'new.edenxi.com', localEdit: true, official: { name: 'Eden', host: 'play.edenxi.com', port: '' },
  };
  assert.deepEqual(JSON.parse(SL.serverSnippet(edited)).previousHosts, ['play.edenxi.com']);
});

test('buildIssueUrl opens the suggestion form with fields prefilled by id', () => {
  const url = new URL(SL.buildIssueUrl('suggestion', { server: { ...entry(), host: 'new.edenxi.com' }, details: 'Address change' }));
  assert.equal(url.origin + url.pathname, 'https://github.com/CalvinCandie-tech/XI-Launcher/issues/new');
  assert.equal(url.searchParams.get('template'), 'server-suggestion.yml');
  assert.equal(url.searchParams.get('title'), 'Server suggestion: Eden');
  assert.equal(url.searchParams.get('server-id'), 'eden');
  assert.equal(url.searchParams.get('details'), 'Address change');
  assert.equal(JSON.parse(url.searchParams.get('json')).host, 'new.edenxi.com');
});

test('buildIssueUrl problem reports carry no json field', () => {
  const url = new URL(SL.buildIssueUrl('problem', { server: entry(), details: 'Closed' }));
  assert.equal(url.searchParams.get('template'), 'server-problem.yml');
  assert.equal(url.searchParams.get('title'), 'Server problem: Eden');
  assert.equal(url.searchParams.has('json'), false);
});

test('buildIssueUrl stays under the length cap by trimming details', () => {
  const url = SL.buildIssueUrl('suggestion', { server: entry(), details: 'é'.repeat(5000) });
  assert.ok(url.length <= SL.ISSUE_URL_MAX, `length ${url.length}`);
  assert.ok(new URL(url).searchParams.get('details').length > 0);
  assert.ok(new URL(url).searchParams.get('json'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test electron/serverList.test.js`
Expected: FAIL — `SL.serverSnippet is not a function`.

- [ ] **Step 3: Write the implementation**

In `electron/serverList.js`, add near the top constants: `const ISSUE_URL_MAX = 7000;` and above `module.exports`:

```js
const issueId = (s) => (!s.id || String(s.id).startsWith('local-') ? slugify(s.name) : s.id);

// The servers.json entry a suggestion would add, ready for the owner to paste.
function serverSnippet(server) {
  const s = server && typeof server === 'object' ? server : {};
  const host = str(s.host);
  const previousHosts = (Array.isArray(s.previousHosts) ? s.previousHosts : []).map(str).filter(Boolean);
  const officialHost = str(s.official && s.official.host);
  if (officialHost && !sameHost(officialHost, host) && !previousHosts.some(h => sameHost(h, officialHost))) {
    previousHosts.unshift(officialHost);
  }
  return JSON.stringify({
    id: issueId(s),
    name: str(s.name),
    category: str(s.suggestedCategory) || (s.category === MY_SERVERS_CATEGORY ? '' : str(s.category)),
    host,
    port: str(s.port),
    previousHosts,
    website: str(s.website),
    discord: str(s.discord),
    tags: s.tags && typeof s.tags === 'object' ? s.tags : {},
    note: str(s.note),
  }, null, 2);
}

// New-issue link for the repo's issue forms. Forms prefill by field id; `body` is ignored.
function buildIssueUrl(kind, { server, details = '' } = {}) {
  const s = server && typeof server === 'object' ? server : {};
  const problem = kind === 'problem';
  const params = {
    template: problem ? 'server-problem.yml' : 'server-suggestion.yml',
    title: `${problem ? 'Server problem' : 'Server suggestion'}: ${str(s.name) || 'unnamed server'}`,
    'server-id': issueId(s),
  };
  let det = String(details || '');
  let json = problem ? '' : serverSnippet(s);
  const make = () => {
    const q = new URLSearchParams(params);
    if (det) q.set('details', det);
    if (json) q.set('json', json);
    return `${REPO_URL}/issues/new?${q}`;
  };
  let url = make();
  while (url.length > ISSUE_URL_MAX && det) {
    det = det.slice(0, Math.max(0, det.length - Math.ceil((url.length - ISSUE_URL_MAX) / 9)));
    url = make();
  }
  if (url.length > ISSUE_URL_MAX) {
    json = '';
    url = make();
  }
  return url;
}
```

Add to `module.exports`: `ISSUE_URL_MAX, serverSnippet, buildIssueUrl,`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test electron/serverList.test.js`
Expected: PASS, 36 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/serverList.js electron/serverList.test.js
git commit -m "feat(servers): prefilled GitHub issue links for suggestions and problem reports"
```

---

### Task 5: Seed servers.json + validator + CI check

**Files:**
- Create: `servers/servers.json`, `scripts/validate-servers.js`, `.github/workflows/servers-validate.yml`
- Modify: `package.json` (`scripts.test:electron`, `build.files`)
- Test: `electron/serverList.test.js` (append)

**Interfaces:**
- Consumes: `validateServerList` (Task 1)
- Produces: `servers/servers.json` (read by Task 6 as the bundled copy and by Task 11's Action); `node scripts/validate-servers.js [file]` exits 1 on any error.

- [ ] **Step 1: Write the failing test**

Append to `electron/serverList.test.js`:

```js
test('the shipped servers/servers.json validates with no errors', () => {
  const json = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'servers', 'servers.json'), 'utf-8'));
  const { list, errors } = SL.validateServerList(json);
  assert.deepEqual(errors, []);
  assert.ok(list.servers.length >= 10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test electron/serverList.test.js`
Expected: FAIL — `ENOENT ... servers\servers.json`.

- [ ] **Step 3: Check the two unknowns before seeding**

- Phoenix XI was due to launch 2026-09-24. Open `https://phoenix-xi.com` (Playwright `browser_navigate` + read text). If a connection address is published, use it as `host` and clear `note`; otherwise keep `host: ""` and set `note` to "Connection details not published yet — check phoenix-xi.com."
- Legendary has no known address in `serverAddresses.js`. **Ask the owner** for it. Do not guess (the store default `172.215.213.23` is unverified). If unknown, keep `host: ""` with the note shown below.

- [ ] **Step 4: Create `servers/servers.json`**

Built from today's XiPrivateServers parse + `electron/serverAddresses.js` + `EXTRA_SERVERS`, with tags cleaned (no `:question:`, bare move-speed numbers dropped). LevelDown 75/99 share one server since 2026-09-16, so it is one entry.

```json
{
  "version": 1,
  "updated": "2026-10-05",
  "ignoredUpstream": ["Demiurge", "Era", "DSP Old School", "Tonberry", "Caldera", "Made to Raid"],
  "servers": [
    {
      "id": "eden",
      "name": "Eden",
      "category": "75 - Retail-Like",
      "host": "play.edenxi.com",
      "port": "",
      "previousHosts": [],
      "website": "https://edenxi.com/",
      "discord": "https://discord.gg/S3EAWr2Jec",
      "tags": { "expansion": "ToAU", "rates": "Retail", "levelSync": true, "multiBox": true },
      "note": ""
    },
    {
      "id": "omega",
      "name": "Omega",
      "category": "75 - Retail-Like",
      "host": "lobby.ffxi.party",
      "port": "54230",
      "previousHosts": [],
      "website": "https://ffxi.party/",
      "discord": "https://discord.gg/srNwwCs",
      "tags": { "expansion": "ToAU", "rates": "Retail", "moveSpeed": "Slightly faster than retail", "levelSync": true, "multiBox": true },
      "note": ""
    },
    {
      "id": "phoenix-xi",
      "name": "Phoenix XI",
      "upstreamName": "Phoenix XI",
      "category": "75 - Retail-Like",
      "host": "",
      "port": "",
      "previousHosts": [],
      "website": "https://phoenix-xi.com",
      "discord": "",
      "tags": { "expansion": "ToAU", "rates": "1x" },
      "note": "Connection details not published yet — check phoenix-xi.com."
    },
    {
      "id": "gaia-xi",
      "name": "Gaia XI",
      "category": "75 - Custom Content",
      "host": "login.gaiaxi.com",
      "port": "",
      "previousHosts": [],
      "website": "https://gaiaxi.com/",
      "discord": "https://discord.gg/2c6HjwNuNK",
      "tags": { "expansion": "ToAU", "rates": "Custom", "moveSpeed": "2x retail", "levelSync": true, "multiBox": true },
      "note": ""
    },
    {
      "id": "horizonxi",
      "name": "HorizonXI",
      "category": "75 - Custom Content",
      "host": "",
      "port": "",
      "previousHosts": [],
      "website": "https://horizonxi.com/",
      "discord": "https://discord.gg/horizonxi",
      "tags": { "expansion": "CoP", "rates": "Retail" },
      "note": "Uses its own HorizonXI launcher — it can't be started from XI Launcher."
    },
    {
      "id": "leveldown",
      "name": "LevelDown",
      "category": "75 - Custom Content",
      "host": "leveldownffxi.com",
      "port": "",
      "previousHosts": [],
      "website": "https://ffxileveldown.fandom.com/wiki/FFXILevelDown_Wiki",
      "discord": "https://discord.gg/uZ5J2KwAPA",
      "tags": { "expansion": "WotG", "rates": "Custom", "levelSync": true, "trusts": true, "multiBox": true },
      "note": "75 and 99 players share one server since 2026-09-16."
    },
    {
      "id": "nasomi",
      "name": "Nasomi",
      "category": "75 - Custom Content",
      "host": "na.nasomi.com",
      "port": "",
      "previousHosts": [],
      "website": "https://na.nasomi.com/",
      "discord": "",
      "tags": { "expansion": "ToAU", "levelSync": true, "multiBox": true },
      "note": ""
    },
    {
      "id": "supernova",
      "name": "Supernova",
      "category": "75 - Custom Content",
      "host": "login.supernovaffxi.com",
      "port": "",
      "previousHosts": [],
      "website": "https://supernovaffxi.wordpress.com/",
      "discord": "https://discord.gg/QBBdfQh",
      "tags": { "expansion": "ToAU", "rates": "Custom", "levelSync": true, "multiBox": true },
      "note": ""
    },
    {
      "id": "catseyexi",
      "name": "CatsEyeXI",
      "category": "75 - Custom Content",
      "host": "server.catseyexi.com",
      "port": "",
      "previousHosts": [],
      "website": "https://catseyexi.com",
      "discord": "https://discord.gg/catseyexi",
      "tags": { "expansion": "WotG", "rates": "Custom", "levelSync": true, "trusts": true, "multiBox": true },
      "note": ""
    },
    {
      "id": "valhalla",
      "name": "Valhalla",
      "category": "90 - Custom Content",
      "host": "logon.valhalla.group",
      "port": "",
      "previousHosts": [],
      "website": "https://valhalla.group/",
      "discord": "https://discord.gg/enB8nh3FKp",
      "tags": { "expansion": "Abyssea", "rates": "Custom", "levelSync": true, "trusts": true, "multiBox": true },
      "note": ""
    },
    {
      "id": "legendary",
      "name": "Legendary",
      "category": "99 - Custom Content",
      "host": "",
      "port": "",
      "previousHosts": [],
      "website": "https://legendary-ffxi.pages.dev/",
      "discord": "https://discord.gg/7asbVtR",
      "tags": { "expansion": "All", "rates": "Custom", "moveSpeed": "5x retail", "levelSync": true, "trusts": true, "multiBox": true },
      "note": "Connection address not listed yet — use Edit if you know it."
    },
    {
      "id": "ff11sf",
      "name": "ff11sf",
      "category": "99 - Custom Content (Chinese Servers)",
      "host": "update.ff11sf.com",
      "port": "",
      "previousHosts": [],
      "website": "http://update.ff11sf.com/",
      "discord": "",
      "tags": { "expansion": "All", "rates": "Retail", "levelSync": true, "trusts": true, "multiBox": true },
      "note": ""
    }
  ]
}
```

Apply the Step 3 findings to `phoenix-xi` and `legendary` before continuing.

- [ ] **Step 5: Create `scripts/validate-servers.js`**

```js
#!/usr/bin/env node
// Validate servers/servers.json (or the file given) with the same rules the launcher uses.
// Exits 1 on any problem — run by .github/workflows/servers-validate.yml.
const fs = require('fs');
const path = require('path');
const { validateServerList } = require('../electron/serverList');

const file = process.argv[2] || path.join(__dirname, '..', 'servers', 'servers.json');
let json;
try {
  json = JSON.parse(fs.readFileSync(file, 'utf-8'));
} catch (e) {
  console.error(`✗ ${file}: ${e.message}`);
  process.exit(1);
}
const { list, errors } = validateServerList(json);
for (const err of errors) console.error(`✗ ${err}`);
if (list && list.servers.length === 0) console.error('✗ The list has no servers.');
if (errors.length || !list || list.servers.length === 0) process.exit(1);
console.log(`✓ ${list.servers.length} servers, no problems.`);
```

- [ ] **Step 6: Create `.github/workflows/servers-validate.yml`**

```yaml
name: Validate servers.json
on:
  push:
    paths: ['servers/servers.json', 'electron/serverList.js', 'scripts/validate-servers.js']
  pull_request:
    paths: ['servers/servers.json', 'electron/serverList.js', 'scripts/validate-servers.js']
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: node scripts/validate-servers.js
```

- [ ] **Step 7: Update `package.json`**

- `"test:electron": "node --test electron/*.test.js"` → `"test:electron": "node --test electron/*.test.js scripts/*.test.js"`
- In `build.files`, add `"servers/servers.json"` after `"electron/**/*"`.

- [ ] **Step 8: Run tests and the validator**

Run: `node --test electron/serverList.test.js` → Expected: PASS, 37 tests.
Run: `node scripts/validate-servers.js` → Expected: `✓ 12 servers, no problems.`
Run: `node scripts/validate-servers.js package.json` → Expected: `✗ Server list must be an object with a "servers" array.` and exit code 1.
Run: `npm run test:electron` → Expected: all pass (95 existing + 37 new). If Node errors on a glob that matches nothing (`scripts/*.test.js` before Task 10), temporarily keep the old script and switch it in Task 10.

- [ ] **Step 9: Commit**

```bash
git add servers/servers.json scripts/validate-servers.js .github/workflows/servers-validate.yml package.json electron/serverList.test.js
git commit -m "feat(servers): seed curated servers.json with validator and CI check"
```

---

### Task 6: Main-process IPC + preload; remove baked-in addresses

**Files:**
- Modify: `electron/main.js` — line 10 (`require('./serverAddresses')`), lines ~5334-5433 (`fetch-server-list` block)
- Modify: `electron/preload.js` — after line 170 (`fetchServerList`)
- Delete: `electron/serverAddresses.js`
- Create (untracked): `.superpowers/tools/cdp-eval.js`

**Interfaces:**
- Consumes: everything exported from `electron/serverList.js`; `loaders.parseIniBoot`, `loaders.setIniServer`, `profileIniPath`, `sanitizeName`, `retryAsync`, `friendlyError`, `store`, `defaultAshitaPath`, `shell`, `app` (existing in `main.js`)
- Produces (renderer `window.xiAPI`):
  - `fetchServerList() -> { success: true, categories: [{name, servers}], source, updated, fetchedAt } | { success: false, error }`
  - `saveLocalServer(form) -> { success: true, id } | { error }`
  - `resetLocalServer(id) -> { success: true }`
  - `getMovedHosts() -> Array<Move & { summary: string }>`
  - `applyMovedHost({ serverId, fromHost }) -> { success: true, favoriteServers, serverHost, changedProfiles: string[], warnings: string[] } | { error }`
  - `openServerIssue(kind, { server, details }) -> boolean`

- [ ] **Step 1: Replace the require at `electron/main.js:10`**

```js
const { SERVER_ADDRESSES } = require('./serverAddresses');
```
→
```js
const serverList = require('./serverList');
```

- [ ] **Step 2: Replace the block from the comment `// Fetch community server list from XiPrivateServers GitHub` through the end of the `fetch-server-list` handler (the `});` before `// One-Click Backup`)**

```js
  // Curated server list — servers/servers.json in the XI-Launcher repo, so addresses, new
  // servers and closures reach players without a launcher release. Falls back to the last
  // good fetch, then to the copy packaged with the launcher.
  let serverListState = null;

  function readBundledServerList() {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'servers', 'servers.json'), 'utf-8'));
    } catch {
      return null;
    }
  }

  function fetchServerListJson() {
    // Dev-only override for testing the offline / cache / moved-banner paths.
    const override = !app.isPackaged && process.env.XI_SERVER_LIST_URL;
    const url = override || serverList.SERVER_LIST_URL;
    if (override && !/^https?:/i.test(url)) {
      return Promise.resolve(JSON.parse(fs.readFileSync(url, 'utf-8')));
    }
    return retryAsync(() => new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'XI-Launcher', 'Cache-Control': 'no-cache' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Server list is not valid JSON'));
          }
        });
        res.on('error', reject);
      });
      req.setTimeout(8000, () => req.destroy(new Error('Timed out')));
      req.on('error', reject);
    }), { retries: 2, delay: 1000, label: 'Server list fetch' });
  }

  async function loadServerList() {
    let fetched = null;
    try {
      fetched = await fetchServerListJson();
    } catch (e) {
      console.error('[server-list] fetch failed:', e.message);
    }
    if (fetched && serverList.validateServerList(fetched).list?.servers.length) {
      store.set('serverListCache', { json: fetched, fetchedAt: Date.now() });
    }
    const cache = store.get('serverListCache');
    const resolved = serverList.resolveServerList({ fetched, cached: cache?.json, bundled: readBundledServerList() });
    const fetchedAt = resolved.source === 'live' ? Date.now() : resolved.source === 'cache' ? cache?.fetchedAt || null : null;
    serverListState = { ...resolved, fetchedAt };
    return serverListState;
  }

  // Every place a server address is saved: favourites, the selected server, and each
  // profile's settings + Ashita ini (--server). Retail inis have no host.
  function savedServerHosts() {
    const ashitaPath = store.get('ashitaPath') || defaultAshitaPath;
    const profileSettings = store.get('profileSettings') || {};
    const names = new Set(Object.keys(profileSettings));
    try {
      for (const f of fs.readdirSync(path.join(ashitaPath, 'config', 'boot'))) {
        if (f.toLowerCase().endsWith('.ini')) names.add(f.slice(0, -4));
      }
    } catch { /* no Ashita profiles yet */ }
    const profiles = [];
    for (const name of names) {
      if (sanitizeName(name) !== name) continue;
      let iniHost = '';
      try {
        iniHost = loaders.parseIniBoot(fs.readFileSync(profileIniPath(ashitaPath, name), 'utf-8')).host || '';
      } catch { /* settings-only profile */ }
      const ps = profileSettings[name];
      profiles.push({ name, settingsHost: (ps && typeof ps === 'object' && ps.serverHost) || '', iniHost });
    }
    return {
      ashitaPath,
      favorites: store.get('favoriteServers') || [],
      serverHost: store.get('serverHost') || '',
      profiles,
    };
  }

  ipcMain.handle('fetch-server-list', async () => {
    try {
      const state = await loadServerList();
      if (state.source === 'none') {
        return { success: false, error: 'Could not load the server list. Check your internet connection and try again.' };
      }
      const local = store.get('localServers') || {};
      const { servers, redundant } = serverList.applyLocalServers(state.list.servers, local);
      if (redundant.length) {
        const next = { ...local };
        for (const id of redundant) delete next[id];
        store.set('localServers', next);
      }
      return {
        success: true,
        categories: serverList.groupByCategory(servers),
        source: state.source,
        updated: state.list.updated,
        fetchedAt: state.fetchedAt,
      };
    } catch (e) {
      const err = friendlyError(e, 'Fetching server list');
      return { success: false, error: typeof err === 'string' ? err : err.error };
    }
  });

  ipcMain.handle('save-local-server', async (_, input) => {
    const state = serverListState || await loadServerList();
    const local = { ...(store.get('localServers') || {}) };
    const result = serverList.sanitizeLocalServer(input, {
      officialIds: new Set(state.list.servers.map(s => s.id)),
      localIds: new Set(Object.keys(local)),
    });
    if (result.error) return { error: result.error };
    local[result.entry.id] = result.entry;
    store.set('localServers', local);
    return { success: true, id: result.entry.id };
  });

  ipcMain.handle('reset-local-server', (_, id) => {
    const local = { ...(store.get('localServers') || {}) };
    if (typeof id === 'string') delete local[id];
    store.set('localServers', local);
    return { success: true };
  });

  ipcMain.handle('get-moved-hosts', async () => {
    try {
      const state = serverListState || await loadServerList();
      return serverList.findMovedHosts(state.list.servers, savedServerHosts())
        .map(m => ({ ...m, summary: serverList.describeUsedBy(m.usedBy) }));
    } catch (e) {
      console.error('[server-list] moved-host check failed:', e.message);
      return [];
    }
  });

  // Player clicked Update on a "server moved" banner. The move is re-derived here from the
  // official list rather than trusted from the renderer. Main rewrites profile settings and
  // inis; the renderer saves favourites + selected server through updateConfig.
  ipcMain.handle('apply-moved-host', async (_, request) => {
    try {
      const state = serverListState || await loadServerList();
      const saved = savedServerHosts();
      const move = serverList.findMovedHosts(state.list.servers, saved).find(m =>
        m.serverId === request?.serverId && serverList.sameHost(m.fromHost, request?.fromHost));
      if (!move) return { error: 'That server address change no longer applies.' };

      const changedProfiles = [];
      const warnings = [];
      const all = store.get('profileSettings') || {};
      let settingsChanged = false;
      for (const [name, ps] of Object.entries(all)) {
        if (ps && typeof ps === 'object' && serverList.sameHost(ps.serverHost, move.fromHost)) {
          all[name] = { ...ps, serverHost: move.toHost };
          settingsChanged = true;
          changedProfiles.push(name);
        }
      }
      if (settingsChanged) store.set('profileSettings', all);

      for (const p of saved.profiles) {
        if (!serverList.sameHost(p.iniHost, move.fromHost)) continue;
        try {
          const iniPath = profileIniPath(saved.ashitaPath, p.name);
          const content = fs.readFileSync(iniPath, 'utf-8');
          const updated = loaders.setIniServer(content, move.toHost);
          if (updated !== content) fs.writeFileSync(iniPath, updated, 'utf-8');
          if (!changedProfiles.includes(p.name)) changedProfiles.push(p.name);
        } catch (e) {
          warnings.push(`Could not update profile '${p.name}': ${e.message}`);
        }
      }

      const next = serverList.applyMoveToConfig({ favorites: saved.favorites, serverHost: saved.serverHost }, move);
      return { success: true, favoriteServers: next.favorites, serverHost: next.serverHost, changedProfiles, warnings };
    } catch (e) {
      return { error: `Could not update: ${e.message}` };
    }
  });

  ipcMain.handle('open-server-issue', async (_, kind, payload) => {
    if (kind !== 'suggestion' && kind !== 'problem') return false;
    await shell.openExternal(serverList.buildIssueUrl(kind, payload || {}));
    return true;
  });
```

- [ ] **Step 3: Add to `electron/preload.js` after the `fetchServerList` line**

```js
  saveLocalServer: (entry) => ipcRenderer.invoke('save-local-server', entry),
  resetLocalServer: (id) => ipcRenderer.invoke('reset-local-server', id),
  getMovedHosts: () => ipcRenderer.invoke('get-moved-hosts'),
  applyMovedHost: (move) => ipcRenderer.invoke('apply-moved-host', move),
  openServerIssue: (kind, payload) => ipcRenderer.invoke('open-server-issue', kind, payload),
```

- [ ] **Step 4: Delete `electron/serverAddresses.js` and confirm nothing else references it**

Run: `git rm electron/serverAddresses.js`
Run: Grep for `serverAddresses|SERVER_ADDRESSES|EXTRA_SERVERS|REMOVED_SERVERS` in `electron/` and `src/`.
Expected: no matches.

- [ ] **Step 5: Run unit tests and a syntax check**

Run: `node --check electron/main.js` → Expected: no output.
Run: `npm run test:electron` → Expected: all pass.

- [ ] **Step 6: Create the CDP helper (untracked; `.superpowers/` is gitignored)**

`.superpowers/tools/cdp-eval.js`:

```js
// Evaluate a JS expression in the running XI Launcher renderer over CDP and print the result.
// Start the launcher with --remote-debugging-port=9223 first.
// Usage: node .superpowers/tools/cdp-eval.js "await window.xiAPI.fetchServerList()"
const expr = process.argv[2];
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('No page target — is the launcher running with --remote-debugging-port=9223?');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id !== 1) return;
    const r = msg.result;
    console.log(r.exceptionDetails ? `EXCEPTION: ${JSON.stringify(r.exceptionDetails)}` : JSON.stringify(r.result.value, null, 2));
    ws.close();
  };
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true },
  }));
})().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 7: Live-check the IPC**

Stop only the launcher's Electron processes (PowerShell):
`Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*xi-launcher*' } | Stop-Process`
Start the React dev server in the background: `npm run react-start` (wait for "Compiled successfully").
Start Electron in the background: `npx electron . --remote-debugging-port=9223`.

Until Task 5 is pushed, the GitHub URL 404s, so this run exercises the bundled fallback:
Run: `node .superpowers/tools/cdp-eval.js "await window.xiAPI.fetchServerList()"`
Expected: `success: true`, `source: "bundled"`, the categories in file order, `updated: "2026-10-05"`.
Run: `node .superpowers/tools/cdp-eval.js "await window.xiAPI.getMovedHosts()"` → Expected: `[]`.

- [ ] **Step 8: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat(servers): read curated servers.json with cache/bundled fallback; local edits, moved-host and issue IPC

Removes the release-baked serverAddresses.js, EXTRA_SERVERS, REMOVED_SERVERS and the
SERVERS.md parser."
```

---

### Task 7: Servers tab — cards from the new data, Online pills, source line, Report link

**Files:**
- Create: `src/components/servers/ServerCard.js`
- Rewrite: `src/tabs/ServerBrowserTab.js`
- Modify: `src/tabs/ServerBrowserTab.css` (append)

**Interfaces:**
- Consumes: `window.xiAPI.fetchServerList`, `checkServerStatus(host, port)`, `openServerIssue`, `openExternal` (Task 6)
- Produces: `ServerCard({ server, status, favorite, onToggleFavorite, onReport, onEdit?, onReset? })` — Edit/Reset buttons render only when their handler is passed (Task 8 passes them). `ServerBrowserTab` keeps props `{ config, updateConfig }` (Task 9 adds more).

- [ ] **Step 1: Create `src/components/servers/ServerCard.js`**

```jsx
import React from 'react';

const api = window.xiAPI;

function StatusPill({ status }) {
  if (!status) return null;
  if (status.checking) return <span className="server-status checking">● Checking…</span>;
  if (status.online) return <span className="server-status online">● Online {status.latency}ms</span>;
  return <span className="server-status offline">● Offline</span>;
}

// One server on the Servers tab. Edit / Reset buttons only appear when the tab passes handlers.
function ServerCard({ server, status, favorite, onToggleFavorite, onReport, onEdit, onReset }) {
  const tags = server.tags || {};
  const open = (url) => api?.openExternal(url);
  const officialHost = server.official?.host;

  return (
    <div className={`server-card${favorite ? ' favorited' : ''}`}>
      <div className="server-card-header">
        <div className="server-card-name-wrap">
          {server.website ? (
            <button className="link-btn server-card-name" onClick={() => open(server.website)}>{server.name}</button>
          ) : (
            <span className="server-card-name">{server.name}</span>
          )}
          {server.host && (
            <span className="server-card-address mono">{server.host}{server.port ? ':' + server.port : ''}</span>
          )}
        </div>
        <div className="server-card-header-right">
          {server.host && <StatusPill status={status} />}
          {server.host && (
            <button
              className={`server-fav-btn${favorite ? ' favorited' : ''}`}
              onClick={() => onToggleFavorite(server)}
              title={favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              {favorite ? '★' : '☆'}
            </button>
          )}
        </div>
      </div>

      {server.localEdit && (
        <div className="server-card-local">
          Your edit{officialHost && officialHost !== server.host ? ` · official address: ${officialHost}` : ''}
        </div>
      )}

      <div className="server-card-tags">
        {tags.expansion && <span className="server-tag server-tag-exp">{tags.expansion}</span>}
        {tags.rates && <span className="server-tag">{tags.rates} rates</span>}
        {tags.moveSpeed && <span className="server-tag">{tags.moveSpeed}</span>}
        {tags.levelSync && <span className="server-tag server-tag-feature">Level Sync</span>}
        {tags.trusts && <span className="server-tag server-tag-feature">Trusts</span>}
        {tags.multiBox && <span className="server-tag server-tag-feature">Multi-Box</span>}
      </div>

      {server.note && <p className="server-card-note">{server.note}</p>}

      <div className="server-card-footer">
        {server.discord && <button className="btn btn-ghost btn-sm" onClick={() => open(server.discord)}>Discord</button>}
        {server.website && <button className="btn btn-ghost btn-sm" onClick={() => open(server.website)}>Website</button>}
        <span className="server-card-footer-spacer" />
        {onEdit && <button className="btn btn-ghost btn-sm" onClick={() => onEdit(server)} title="Change this server on this PC">✎ Edit</button>}
        {onReset && server.localEdit && (
          <button className="btn btn-ghost btn-sm" onClick={() => onReset(server)}>Reset to official</button>
        )}
        {onReset && server.custom && <button className="btn btn-ghost btn-sm" onClick={() => onReset(server)}>Remove</button>}
        {!server.custom && (
          <button className="link-btn server-card-report" onClick={() => onReport(server)} title="Wrong address or server closed? Tell the launcher team on GitHub">
            ⚑ Report problem
          </button>
        )}
      </div>
    </div>
  );
}

export default ServerCard;
```

- [ ] **Step 2: Rewrite `src/tabs/ServerBrowserTab.js`**

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import './ServerBrowserTab.css';
import ServerCard from '../components/servers/ServerCard';

const api = window.xiAPI;

// Favourites saved before servers had ids only carry a host.
const sameFav = (f, s) => (f.id ? f.id === s.id : f.host === s.host);

function sourceLabel(meta) {
  if (!meta) return '';
  if (meta.source === 'live') return `Live list${meta.updated ? ` · updated ${meta.updated}` : ''}`;
  if (meta.source === 'cache') {
    return `Offline copy${meta.fetchedAt ? ` from ${new Date(meta.fetchedAt).toLocaleDateString()}` : ''}`;
  }
  return 'Built-in copy (could not reach GitHub)';
}

function ServerBrowserTab({ config, updateConfig }) {
  const [categories, setCategories] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState({});

  const favorites = config?.favoriteServers || [];
  const isFavorite = (s) => favorites.some(f => sameFav(f, s));
  const toggleFavorite = (s) => {
    if (!s.host) return;
    const next = isFavorite(s)
      ? favorites.filter(f => !sameFav(f, s))
      : [...favorites, { id: s.id, name: s.name, host: s.host, port: s.port || '' }];
    updateConfig('favoriteServers', next);
  };

  const load = useCallback(async () => {
    if (!api?.fetchServerList) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.fetchServerList();
      if (result?.success) {
        setCategories(result.categories);
        setMeta({ source: result.source, updated: result.updated, fetchedAt: result.fetchedAt });
      } else {
        setError(typeof result?.error === 'string' ? result.error : 'Failed to fetch server list');
      }
    } catch {
      setError('Failed to fetch server list');
    }
    setLoading(false);
  }, []);

  const checkAll = useCallback((cats) => {
    if (!api?.checkServerStatus) return;
    const servers = cats.flatMap(c => c.servers).filter(s => s.host);
    setStatus(Object.fromEntries(servers.map(s => [s.id, { checking: true }])));
    for (const s of servers) {
      api.checkServerStatus(s.host, s.port)
        .then(r => setStatus(prev => ({ ...prev, [s.id]: { online: !!r?.online, latency: r?.latency } })))
        .catch(() => setStatus(prev => ({ ...prev, [s.id]: { online: false } })));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { checkAll(categories); }, [categories, checkAll]);

  const handleReport = (s) => api?.openServerIssue('problem', { server: s });

  const q = filter.trim().toLowerCase();
  const filteredCategories = categories.map(cat => ({
    ...cat,
    servers: cat.servers.filter(s =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      (s.tags?.expansion || '').toLowerCase().includes(q) ||
      (s.host || '').toLowerCase().includes(q)
    ),
  })).filter(cat => cat.servers.length > 0);

  const totalCount = categories.reduce((sum, c) => sum + c.servers.length, 0);

  return (
    <div className="server-browser">
      <div className="server-browser-toolbar panel">
        <div className="server-browser-toolbar-left">
          <span className="server-browser-title cinzel">Private Servers</span>
          <span className="pill pill-teal">{totalCount} servers</span>
          {meta && <span className={`server-browser-status${meta.source === 'live' ? '' : ' stale'}`}>{sourceLabel(meta)}</span>}
        </div>
        <div className="server-browser-toolbar-right">
          <button className="btn btn-ghost btn-sm" onClick={() => checkAll(categories)} title="Check which servers are online">
            ↻ Check
          </button>
          <input
            type="text"
            placeholder="Search servers..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="server-browser-search"
          />
        </div>
      </div>

      {loading && <div className="server-browser-loading">Loading server list...</div>}
      {error && <div className="server-browser-error panel">{error}</div>}

      {!loading && !error && filteredCategories.map(cat => (
        <div key={cat.name} className="server-category">
          <div className="section-header">{cat.name}</div>
          <div className="server-cards">
            {cat.servers.map(server => (
              <ServerCard
                key={server.id}
                server={server}
                status={status[server.id]}
                favorite={isFavorite(server)}
                onToggleFavorite={toggleFavorite}
                onReport={handleReport}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default ServerBrowserTab;
```

- [ ] **Step 3: Append to `src/tabs/ServerBrowserTab.css`**

```css
/* Where the list came from */
.server-browser-status {
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
}
.server-browser-status.stale { color: var(--gold); }

/* Card header right: status + star */
.server-card-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.server-status {
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.server-status.online { color: var(--green, #5cc46a); }
.server-status.offline { color: var(--red); }
.server-status.checking { color: var(--text-dim); }

.server-card-local {
  font-size: 11px;
  color: var(--gold);
}

.server-card-footer { align-items: center; flex-wrap: wrap; }
.server-card-footer-spacer { flex: 1; }
.server-card-report {
  font-size: 11px;
  color: var(--text-dim);
}
```

- [ ] **Step 4: Live check**

The dev server hot-reloads. Open the Servers tab (or run `node .superpowers/tools/cdp-eval.js "document.querySelectorAll('.server-card').length"` after clicking the tab). Screenshot: `powershell -NoProfile -File .superpowers/tools/shot.ps1 -Out .superpowers/shots/servers/01-cards.png`.
Expected:
- 12 cards in the seed's categories.
- Each card with a host shows Checking… and then Online N ms or Offline.
- HorizonXI, Phoenix and Legendary show their note and have no star or pill.
- No `:question:` tags.
- The toolbar shows "Built-in copy (could not reach GitHub)" in gold.
- Clicking ⚑ on Eden opens a browser page `…/issues/new?template=server-problem.yml&title=Server+problem%3A+Eden&server-id=eden`. That form 404s until Task 11 is pushed, which is expected.

- [ ] **Step 5: Commit**

```bash
git add src/components/servers/ServerCard.js src/tabs/ServerBrowserTab.js src/tabs/ServerBrowserTab.css
git commit -m "feat(servers): Servers tab reads curated list with live status pills and problem reports"
```

---

### Task 8: Add a server / Edit — local edits with "Suggest to everyone"

**Files:**
- Create: `src/components/servers/ServerEditModal.js`
- Modify: `src/tabs/ServerBrowserTab.js`, `src/tabs/ServerBrowserTab.css`

**Interfaces:**
- Consumes: `saveLocalServer`, `resetLocalServer`, `openServerIssue` (Task 6); `ServerCard` `onEdit`/`onReset` (Task 7); `src/components/Modal.js` (`{ children, onClose, ariaLabel }`)
- Produces: `ServerEditModal({ server?, onSave(form, suggest) -> Promise<string|null>, onClose })` — `server` undefined means Add.

- [ ] **Step 1: Create `src/components/servers/ServerEditModal.js`**

```jsx
import React, { useState } from 'react';
import Modal from '../Modal';

// Add a server (server undefined) or edit one. Saves on this PC straight away; ticking
// "Suggest to everyone" also opens a prefilled GitHub issue for the launcher team.
function ServerEditModal({ server, onSave, onClose }) {
  const isAdd = !server;
  const showCategory = isAdd || !!server?.custom;
  const [form, setForm] = useState({
    id: server?.id || '',
    name: server?.name || '',
    host: server?.host || '',
    port: server?.port || '',
    website: server?.website || '',
    discord: server?.discord || '',
    category: server?.custom ? server.suggestedCategory || '' : '',
  });
  const [suggest, setSuggest] = useState(isAdd);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const err = await onSave(form, suggest);
    setSaving(false);
    if (err) setError(err);
  };

  const field = (key, label, placeholder = '') => (
    <label className="form-field">
      <span className="form-field-name">{label}</span>
      <input className="form-input" value={form[key]} onChange={set(key)} placeholder={placeholder} />
    </label>
  );

  return (
    <Modal onClose={onClose} ariaLabel={isAdd ? 'Add a server' : `Edit ${server.name}`}>
      <form className="server-edit panel" onSubmit={submit}>
        <h3 className="cinzel modal-title">{isAdd ? 'Add a server' : `Edit ${server.name}`}</h3>
        <p className="modal-desc">
          {isAdd
            ? 'Saved on this PC straight away. It appears under "My servers".'
            : 'Your changes apply on this PC straight away. "Reset to official" undoes them.'}
        </p>
        <div className="form-grid">
          {field('name', 'Name')}
          {field('host', 'Address', 'login.example.com')}
          {field('port', 'Port (only used for the Online check)', '54231')}
          {field('website', 'Website', 'https://')}
          {field('discord', 'Discord', 'https://discord.gg/')}
          {showCategory && field('category', 'Category (for the suggestion)', '75 - Custom Content')}
        </div>
        <label className="server-edit-suggest">
          <input type="checkbox" checked={suggest} onChange={e => setSuggest(e.target.checked)} />
          Suggest to everyone — opens a GitHub issue for the launcher team (needs a GitHub account)
        </label>
        {error && <div className="server-edit-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default ServerEditModal;
```

- [ ] **Step 2: Wire it into `src/tabs/ServerBrowserTab.js`**

Add the import under the `ServerCard` import:

```jsx
import ServerEditModal from '../components/servers/ServerEditModal';
```

Add state after `const [status, setStatus] = useState({});`:

```jsx
  const [editing, setEditing] = useState(null); // null | { server } — server undefined = Add
```

Add handlers after `handleReport`:

```jsx
  const handleSave = async (form, suggest) => {
    const res = await api.saveLocalServer(form);
    if (!res || res.error) return res?.error || 'Could not save the server.';
    const before = editing?.server;
    // Keep a favourite of this server pointing at the address the player just entered.
    if (before && form.host.trim()) {
      const next = favorites.map(f => (sameFav(f, before)
        ? { ...f, id: before.id, host: form.host.trim(), port: form.port.trim() }
        : f));
      if (next.some((f, i) => f !== favorites[i])) updateConfig('favoriteServers', next);
    }
    if (suggest) {
      const official = before?.official || (before && !before.custom ? { name: before.name, host: before.host, port: before.port } : undefined);
      const server = { ...(before || {}), ...form, id: res.id, official };
      const details = !before
        ? 'New server, added in XI Launcher.'
        : official?.host && form.host.trim() && official.host !== form.host.trim()
          ? `Address change: ${official.host} → ${form.host.trim()}`
          : `Updated details for ${form.name.trim()}.`;
      await api.openServerIssue('suggestion', { server, details });
    }
    setEditing(null);
    await load();
    return null;
  };

  const handleReset = async (s) => {
    await api.resetLocalServer(s.id);
    await load();
  };
```

In the toolbar, add before the `↻ Check` button:

```jsx
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ server: undefined })}>
            + Add a server
          </button>
```

Pass the handlers to each card — add these props to `<ServerCard … />`:

```jsx
                onEdit={(s) => setEditing({ server: s })}
                onReset={handleReset}
```

Render the modal just before the closing `</div>` of `.server-browser`:

```jsx
      {editing && (
        <ServerEditModal server={editing.server} onSave={handleSave} onClose={() => setEditing(null)} />
      )}
```

- [ ] **Step 3: Append to `src/tabs/ServerBrowserTab.css`**

```css
/* Add / Edit modal */
.server-edit {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 20px;
}
.server-edit-suggest {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 13px;
  color: var(--text-secondary);
}
.server-edit-error {
  margin-top: 10px;
  color: var(--red);
  font-size: 13px;
}
```

- [ ] **Step 4: Live checks (back up first)**

Back up `%APPDATA%\xi-launcher\config.json` to the scratchpad and record its SHA256.
1. **Add.** Click **+ Add a server**, fill Name `Test Server`, Address `test.example.invalid`, untick Suggest, then Save.
   Expected: a "My servers" section at the top with Test Server and a Remove button. `node .superpowers/tools/cdp-eval.js "await window.xiAPI.storeGet('localServers')"` shows `local-test-server`.
2. **Validation.** Edit Test Server, set the address to `bad host` and Save.
   Expected: the red message "The address can only contain letters, digits, dots and dashes." The modal stays open.
3. **Override.** Edit Eden, set the address to `new.edenxi.example` and Save.
   Expected: the card shows "Your edit · official address: play.edenxi.com" and Reset to official. Reset brings back `play.edenxi.com`.
4. **Favourite without id follows an edit.** Set favourites to an old-style entry: `node .superpowers/tools/cdp-eval.js "await window.xiAPI.storeSet('favoriteServers',[{name:'Eden',host:'play.edenxi.com',port:''}])"`. Reload the renderer with Ctrl+R in the window, or `location.reload()` via cdp-eval. Eden's star is filled. Edit Eden's address to `new.edenxi.example`.
   Expected: the star stays filled and `storeGet('favoriteServers')` shows `{id:'eden', host:'new.edenxi.example'}`. Reset Eden afterwards.
5. **Suggest.** Edit Valhalla, tick Suggest, change nothing, then Save.
   Expected: the browser opens `…issues/new?template=server-suggestion.yml&title=Server+suggestion%3A+Valhalla&server-id=valhalla&details=Updated+details+for+Valhalla.&json=…`. Close the tab and do not submit.
6. Take screenshots of the modal and the My servers section into `.superpowers/shots/servers/`.

Restore `config.json` and compare the SHA256 with the backup.

- [ ] **Step 5: Commit**

```bash
git add src/components/servers/ServerEditModal.js src/tabs/ServerBrowserTab.js src/tabs/ServerBrowserTab.css
git commit -m "feat(servers): add/edit servers locally with optional GitHub suggestion"
```

---

### Task 9: "Server moved" banner on Home and Servers

**Files:**
- Create: `src/components/MovedServerBanner.js`
- Modify: `src/App.js` (after `updateConfig` at ~line 443; render cases at ~616 and ~625), `src/tabs/HomeTab.js` (signature line 16; notices block ~447), `src/tabs/ServerBrowserTab.js`, `src/tabs/ServerBrowserTab.css`

**Interfaces:**
- Consumes: `fetchServerList`, `getMovedHosts`, `applyMovedHost` (Task 6); `updateConfig`, `configRef` (existing in `App.js`)
- Produces: `MovedServerBanner({ moves, onApply(move) -> Promise<string|null>, onDismiss(move) })`. New props `movedServers`, `onApplyMove`, `onDismissMove` on `HomeTab` and `ServerBrowserTab`.

- [ ] **Step 1: Create `src/components/MovedServerBanner.js`**

```jsx
import React, { useState } from 'react';
import './home/HomePanels.css';

export const moveKey = (m) => `${m.serverId}|${m.fromHost.toLowerCase()}`;

// One row per server whose saved address has moved. Nothing changes until the player clicks Update.
function MovedServerBanner({ moves, onApply, onDismiss }) {
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});
  if (!moves?.length) return null;

  const apply = async (m) => {
    const key = moveKey(m);
    setBusy(key);
    const err = await onApply(m);
    setBusy('');
    setErrors(prev => ({ ...prev, [key]: err || '' }));
  };

  return (
    <>
      {moves.map(m => {
        const key = moveKey(m);
        return (
          <div key={key} className="home-notice" role="status">
            <span className="home-notice-title">Server moved</span>
            <span className="home-notice-text">
              <strong>{m.name}</strong> moved from <span className="mono">{m.fromHost}</span> to{' '}
              <span className="mono">{m.toHost}</span> — used by {m.summary}.
              {errors[key] && <span className="moved-error"> {errors[key]}</span>}
            </span>
            <div className="home-notice-actions">
              <button className="btn btn-primary btn-sm" disabled={busy === key} onClick={() => apply(m)}>
                {busy === key ? 'Updating…' : 'Update'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => onDismiss(m)}>Not now</button>
            </div>
          </div>
        );
      })}
    </>
  );
}

export default MovedServerBanner;
```

- [ ] **Step 2: App state + handlers in `src/App.js`**

Add the import with the other component imports at the top of `src/App.js`:

```jsx
import { moveKey } from './components/MovedServerBanner';
```

Directly after the `updateConfig` `useCallback` (the block ending `}, [settingsDirty, doUpdateConfig]);`), add:

```jsx
  // Curated server list: fetched once at startup so a moved server address can be offered on
  // Home without visiting the Servers tab. "Not now" lasts until the launcher restarts.
  const [movedServers, setMovedServers] = useState([]);
  const dismissedMovesRef = useRef(new Set());
  const configLoaded = !!config;

  useEffect(() => {
    if (!configLoaded || !api?.fetchServerList || !api?.getMovedHosts) return;
    api.fetchServerList()
      .catch(() => {})
      .then(() => api.getMovedHosts())
      .then(moves => setMovedServers((moves || []).filter(m => !dismissedMovesRef.current.has(moveKey(m)))))
      .catch(err => console.error('Moved-server check failed:', err));
  }, [configLoaded]);

  const handleDismissMove = useCallback((m) => {
    dismissedMovesRef.current.add(moveKey(m));
    setMovedServers(prev => prev.filter(x => moveKey(x) !== moveKey(m)));
  }, []);

  const handleApplyMove = useCallback(async (m) => {
    const res = await api.applyMovedHost({ serverId: m.serverId, fromHost: m.fromHost });
    if (!res || res.error) return res?.error || 'Could not update.';
    updateConfig('favoriteServers', res.favoriteServers);
    if (res.serverHost !== configRef.current?.serverHost) updateConfig('serverHost', res.serverHost);
    setMovedServers(prev => prev.filter(x => moveKey(x) !== moveKey(m)));
    // The row is gone by now, so per-profile write failures can only go to the console.
    if (res.warnings?.length) console.warn('Server move warnings:', res.warnings);
    return null;
  }, [updateConfig]);
```

Change the render cases:

```jsx
      case 'home': return <HomeTab {...tabProps} onNavigate={guardedSetActiveTab} onLaunch={handleLaunch} isLaunching={isLaunching} launchLog={launchLog} updateInfo={updateInfo} onSkipVersion={handleSkipVersion} onDismissUpdate={handleDismissUpdate} onShowWizard={() => setShowWizard(true)} movedServers={movedServers} onApplyMove={handleApplyMove} onDismissMove={handleDismissMove} />;
```

```jsx
      case 'servers': return <ServerBrowserTab {...tabProps} movedServers={movedServers} onApplyMove={handleApplyMove} onDismissMove={handleDismissMove} />;
```

Confirm `useRef` and `useEffect` are already imported at the top of `App.js`. They are, because `configRef` uses `useRef`.

- [ ] **Step 3: Home renders the banner (`src/tabs/HomeTab.js`)**

Add the import beside `NoticeBanner`:

```jsx
import MovedServerBanner from '../components/MovedServerBanner';
```

Extend the signature on line 16 with `movedServers, onApplyMove, onDismissMove`:

```jsx
function HomeTab({ config, updateConfig, onNavigate, onLaunch, isLaunching, launchLog, updateInfo, onSkipVersion, onDismissUpdate, onShowWizard, movedServers, onApplyMove, onDismissMove }) {
```

Inside `<div className="home-notices" ref={noticesRef}>`, directly after the `<NoticeBanner … />` element:

```jsx
          <MovedServerBanner moves={movedServers} onApply={onApplyMove} onDismiss={onDismissMove} />
```

- [ ] **Step 4: Servers tab renders the banner**

In `src/tabs/ServerBrowserTab.js`:
- add the import `import MovedServerBanner from '../components/MovedServerBanner';`
- change the signature to `function ServerBrowserTab({ config, updateConfig, movedServers = [], onApplyMove, onDismissMove }) {`
- put this directly after the toolbar `</div>`:

```jsx
      <MovedServerBanner moves={movedServers} onApply={onApplyMove} onDismiss={onDismissMove} />
```

Append to `src/tabs/ServerBrowserTab.css`:

```css
.server-browser .home-notice { margin-bottom: 10px; }
.moved-error { color: var(--red); }
```

- [ ] **Step 5: Live check with a test list (back up first)**

Back up `%APPDATA%\xi-launcher\config.json` and the active profile's ini (`<ashitaPath>\config\boot\<activeProfile>.ini`). Record the SHA256 of both.
1. Read the current host: `node .superpowers/tools/cdp-eval.js "await window.xiAPI.storeGet('serverHost')"`. Call it `H`.
2. Copy `servers/servers.json` to `<scratchpad>\servers-moved.json`. Add this entry: `{ "id": "test-moved", "name": "Test Moved", "category": "Test", "host": "moved.example.invalid", "previousHosts": ["H"] }`, with the real value in place of H.
3. Restart Electron with the override. PowerShell: `$env:XI_SERVER_LIST_URL = '<scratchpad>\servers-moved.json'; npx electron . --remote-debugging-port=9223`.
   Expected: Home shows "Server moved — Test Moved moved from H to moved.example.invalid — used by the selected server and profile '<active>'". The Servers tab shows the same row.
4. Click **Not now**. Expected: the row disappears from both places and stays gone until restart.
5. Restart and click **Update**. Expected:
   - the row disappears
   - `storeGet('serverHost')` is `moved.example.invalid`
   - the active profile ini's `command` line has `--server moved.example.invalid`
   - `storeGet('profileSettings')[<active>].serverHost` is `moved.example.invalid`
6. **Read-only ini (Review Focus 2).** Restore the backups, make the ini read-only (`attrib +r`), restart and click Update. Expected: no crash, the settings and selected server still update, and the console has a `Server move warnings` entry. Clear the attribute with `attrib -r`.
7. Restore `config.json` and the ini from the backups, compare the SHA256 values, unset `XI_SERVER_LIST_URL` and restart normally.

- [ ] **Step 6: Commit**

```bash
git add src/components/MovedServerBanner.js src/App.js src/tabs/HomeTab.js src/tabs/ServerBrowserTab.js src/tabs/ServerBrowserTab.css
git commit -m "feat(servers): offer to update saved favourites and profiles when a server moves"
```

---

### Task 10: Server-watch decisions (pure, tested)

**Files:**
- Create: `scripts/serverWatchCore.js`
- Test: `scripts/serverWatchCore.test.js`

**Interfaces:**
- Consumes: nothing (takes plain data)
- Produces:
  - `DOWN_DAYS = 3`, `DAY_MS`
  - `parseUpstreamNames(markdown) -> string[]` (sorted, unique)
  - `planWatch({ servers, ignoredUpstream, results: { [id]: boolean }, upstreamNames: string[]|null, state: { health?, upstream? }, openIssues: [{ number, title, labels: string[] }], now: number }) -> { state, open: [{ label, title, body }], close: [{ number, title, comment }] }`

- [ ] **Step 1: Write the failing tests**

Create `scripts/serverWatchCore.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./serverWatchCore');

const DAY = W.DAY_MS;
const NOW = Date.UTC(2026, 9, 10, 6, 0, 0);
const valhalla = { id: 'valhalla', name: 'Valhalla', host: 'logon.valhalla.group', port: '' };
const base = (over = {}) => ({
  servers: [valhalla], ignoredUpstream: [], results: { valhalla: true },
  upstreamNames: null, state: {}, openIssues: [], now: NOW, ...over,
});

test('parseUpstreamNames reads server names from every Level Cap table', () => {
  const md = [
    '# Intro', '| Name | x |', '| --- | --- |', '| [Ignored](https://a) | x |',
    '# Level Cap: 75 - Retail-Like', '| Name | Discord |', '|---|---|',
    '| [Eden](https://edenxi.com/) | [Join](https://d) |', '| Plain Name | - |', '| N/A | - |',
    '# Level Cap: 99 - Custom', '| Name | Discord |', '| [Eden](https://edenxi.com/) | x |', '| [Legendary](https://l) | x |',
  ].join('\n');
  assert.deepEqual(W.parseUpstreamNames(md), ['Eden', 'Legendary', 'Plain Name']);
});

test('a server that answers records lastOk and opens nothing', () => {
  const r = W.planWatch(base());
  assert.deepEqual(r.state.health, { valhalla: { lastOk: NOW } });
  assert.deepEqual(r.open, []);
  assert.deepEqual(r.close, []);
});

test('a server down for less than 3 days is only recorded', () => {
  const r = W.planWatch(base({ results: { valhalla: false }, state: { health: { valhalla: { lastOk: NOW - 5 * DAY, firstFail: NOW - 2 * DAY } } } }));
  assert.deepEqual(r.state.health.valhalla, { lastOk: NOW - 5 * DAY, firstFail: NOW - 2 * DAY });
  assert.deepEqual(r.open, []);
});

test('a server down for 3 days opens one server-down issue', () => {
  const r = W.planWatch(base({ results: { valhalla: false }, state: { health: { valhalla: { lastOk: NOW - 5 * DAY, firstFail: NOW - 3 * DAY } } } }));
  assert.equal(r.open.length, 1);
  assert.equal(r.open[0].label, 'server-down');
  assert.equal(r.open[0].title, '⚠ Valhalla unreachable since 2026-10-07 (valhalla)');
  assert.match(r.open[0].body, /logon\.valhalla\.group:54231/);
  assert.match(r.open[0].body, /last answered 2026-10-05/);
});

test('no duplicate issue when one is already open', () => {
  const r = W.planWatch(base({
    results: { valhalla: false },
    state: { health: { valhalla: { firstFail: NOW - 10 * DAY } } },
    openIssues: [{ number: 7, title: '⚠ Valhalla unreachable since 2026-09-30 (valhalla)', labels: ['server-down'] }],
  }));
  assert.deepEqual(r.open, []);
});

test('first failure starts the clock', () => {
  const r = W.planWatch(base({ results: { valhalla: false } }));
  assert.deepEqual(r.state.health.valhalla, { firstFail: NOW });
  assert.deepEqual(r.open, []);
});

test('a server that answers again closes its open issue', () => {
  const r = W.planWatch(base({
    openIssues: [{ number: 7, title: '⚠ Valhalla unreachable since 2026-09-30 (valhalla)', labels: ['server-down'] }],
  }));
  assert.deepEqual(r.close, [{ number: 7, title: '⚠ Valhalla unreachable since 2026-09-30 (valhalla)', comment: 'Valhalla answered again on 2026-10-10 — closing automatically.' }]);
});

test('servers without a host or without a probe result are skipped and pruned', () => {
  const r = W.planWatch(base({
    servers: [valhalla, { id: 'horizonxi', name: 'HorizonXI', host: '' }],
    results: {},
    state: { health: { gone: { lastOk: 1 } } },
  }));
  assert.deepEqual(r.state.health, {});
});

test('upstream: first run reports every unlisted, non-ignored name', () => {
  const r = W.planWatch(base({ upstreamNames: ['Era', 'NewXI', 'Valhalla'], ignoredUpstream: ['Era'] }));
  assert.deepEqual(r.open.map(i => i.title), ['XiPrivateServers added: NewXI']);
  assert.equal(r.open[0].label, 'upstream-change');
  assert.deepEqual(r.state.upstream, ['Era', 'NewXI', 'Valhalla']);
});

test('upstream: later runs report only names that appeared since last run', () => {
  const r = W.planWatch(base({ upstreamNames: ['NewXI', 'OtherXI', 'Valhalla'], state: { upstream: ['NewXI', 'Valhalla'] } }));
  assert.deepEqual(r.open.map(i => i.title), ['XiPrivateServers added: OtherXI']);
});

test('upstream: a listed server disappearing is reported; unlisted ones are not', () => {
  const r = W.planWatch(base({ upstreamNames: [], state: { upstream: ['NewXI', 'Valhalla'] } }));
  assert.deepEqual(r.open.map(i => i.title), ['XiPrivateServers removed: Valhalla']);
});

test('upstream: upstreamName is used for matching', () => {
  const r = W.planWatch(base({ servers: [{ ...valhalla, upstreamName: 'Valhalla Group' }], upstreamNames: ['Valhalla Group'] }));
  assert.deepEqual(r.open, []);
});

test('upstream: an open issue with the same title is not duplicated', () => {
  const r = W.planWatch(base({
    upstreamNames: ['NewXI', 'Valhalla'],
    openIssues: [{ number: 3, title: 'XiPrivateServers added: NewXI', labels: ['upstream-change'] }],
  }));
  assert.deepEqual(r.open, []);
});

test('upstream: a failed fetch keeps the previous names', () => {
  const r = W.planWatch(base({ upstreamNames: null, state: { upstream: ['Valhalla'] } }));
  assert.deepEqual(r.state.upstream, ['Valhalla']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/serverWatchCore.test.js`
Expected: FAIL — `Cannot find module './serverWatchCore'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/serverWatchCore.js`:

```js
// Decisions for the daily server watch (scripts/server-watch.js): which servers count as down,
// which issues to open or close, and what changed on the community XiPrivateServers list.
// Pure — the runner does the probing and GitHub calls.

const DAY_MS = 24 * 60 * 60 * 1000;
const DOWN_DAYS = 3;
const DEFAULT_PROBE_PORT = '54231';

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const lower = (s) => String(s).toLowerCase();

function parseUpstreamNames(markdown) {
  const names = new Set();
  let inCategory = false;
  for (const line of String(markdown).split('\n')) {
    if (/^#\s+Level Cap:/.test(line)) {
      inCategory = true;
      continue;
    }
    if (/^#/.test(line)) inCategory = false;
    if (!inCategory || !line.startsWith('|') || line.includes('---')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const m = cells[0].match(/\[([^\]]+)\]\(/);
    const name = (m ? m[1] : cells[0]).trim();
    if (!name || lower(name) === 'name' || name === 'N/A') continue;
    names.add(name);
  }
  return [...names].sort();
}

function hasLabel(issue, label) {
  return Array.isArray(issue.labels) && issue.labels.includes(label);
}

function planWatch({ servers, ignoredUpstream = [], results, upstreamNames, state = {}, openIssues = [], now }) {
  const open = [];
  const close = [];
  const health = {};
  const prevHealth = state.health || {};

  for (const s of servers) {
    if (!s.host || !(s.id in results)) continue;
    const prev = prevHealth[s.id] || {};
    const existing = openIssues.find(i => hasLabel(i, 'server-down') && i.title.endsWith(`(${s.id})`));
    if (results[s.id]) {
      health[s.id] = { lastOk: now };
      if (existing) {
        close.push({ number: existing.number, title: existing.title, comment: `${s.name} answered again on ${isoDay(now)} — closing automatically.` });
      }
      continue;
    }
    const firstFail = prev.firstFail || now;
    health[s.id] = prev.lastOk ? { lastOk: prev.lastOk, firstFail } : { firstFail };
    if (now - firstFail >= DOWN_DAYS * DAY_MS && !existing) {
      const address = `${s.host}:${s.port || DEFAULT_PROBE_PORT}`;
      open.push({
        label: 'server-down',
        title: `⚠ ${s.name} unreachable since ${isoDay(firstFail)} (${s.id})`,
        body: [
          `**${s.name}** (\`${address}\`) has not answered a connection check since ${isoDay(firstFail)}`
            + `${prev.lastOk ? ` (last answered ${isoDay(prev.lastOk)})` : ''}.`,
          '',
          "Checked once a day from GitHub's servers (US), 3 tries 30 s apart.",
          '- **Moved?** Put the new address in `host` and add the old one to `previousHosts` in `servers/servers.json`.',
          "- **Closed?** Remove its entry and add its XiPrivateServers name to `ignoredUpstream`.",
          '',
          'This issue closes itself when the server answers again.',
        ].join('\n'),
      });
    }
  }

  let upstream = Array.isArray(state.upstream) ? state.upstream : undefined;
  if (Array.isArray(upstreamNames)) {
    const listed = new Set(servers.map(s => lower(s.upstreamName || s.name)));
    const known = new Set([...listed, ...ignoredUpstream.map(lower)]);
    const now_ = new Set(upstreamNames.map(lower));
    const prev = upstream ? new Set(upstream.map(lower)) : null;
    const alreadyOpen = (title) => openIssues.some(i => hasLabel(i, 'upstream-change') && i.title === title);
    const report = (title, body) => {
      if (!alreadyOpen(title)) open.push({ label: 'upstream-change', title, body });
    };
    for (const name of upstreamNames) {
      if (known.has(lower(name)) || (prev && prev.has(lower(name)))) continue;
      report(`XiPrivateServers added: ${name}`,
        `**${name}** is on the [XiPrivateServers list](https://github.com/XiPrivateServers/Servers/blob/main/SERVERS.md) but not in \`servers/servers.json\`.\n\n`
        + "Add it (find its connection address on its website/Discord), or add the name to `ignoredUpstream` to stop hearing about it.");
    }
    for (const name of upstream || []) {
      if (!listed.has(lower(name)) || now_.has(lower(name))) continue;
      report(`XiPrivateServers removed: ${name}`,
        `**${name}** was removed from the XiPrivateServers list. It may have closed — check, then remove it from \`servers/servers.json\` or close this issue.`);
    }
    upstream = upstreamNames;
  }

  return { state: { health, ...(upstream ? { upstream } : {}) }, open, close };
}

module.exports = { DAY_MS, DOWN_DAYS, parseUpstreamNames, planWatch };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/serverWatchCore.test.js` → Expected: PASS, 14 tests.
Run: `npm run test:electron` → Expected: all pass, including the scripts tests. If Task 5 Step 8 deferred the `test:electron` change, make it now.

- [ ] **Step 5: Commit**

```bash
git add scripts/serverWatchCore.js scripts/serverWatchCore.test.js package.json
git commit -m "feat(servers): daily watch decisions — down servers and community list changes"
```

---

### Task 11: Watch runner, workflow and issue forms

**Files:**
- Create: `scripts/server-watch.js`, `.github/workflows/server-watch.yml`, `.github/ISSUE_TEMPLATE/server-suggestion.yml`, `.github/ISSUE_TEMPLATE/server-problem.yml`

**Interfaces:**
- Consumes: `validateServerList`, `DEFAULT_PROBE_PORT` (`electron/serverList.js`); `parseUpstreamNames`, `planWatch` (Task 10)
- Produces: the `node scripts/server-watch.js` runner. Env: `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `DRY_RUN=1` (print only). Reads and writes `./health.json`.

- [ ] **Step 1: Create `scripts/server-watch.js`**

```js
#!/usr/bin/env node
// Daily server watch, run by .github/workflows/server-watch.yml. Probes every server in
// servers/servers.json, diffs the XiPrivateServers list, opens/closes issues, and writes
// ./health.json (the workflow keeps it on the server-health branch). DRY_RUN=1 only prints.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { validateServerList, DEFAULT_PROBE_PORT } = require('../electron/serverList');
const { parseUpstreamNames, planWatch } = require('./serverWatchCore');

const ROOT = path.join(__dirname, '..');
const DRY_RUN = !!process.env.DRY_RUN;
const REPO = process.env.GITHUB_REPOSITORY || 'CalvinCandie-tech/XI-Launcher';
const TOKEN = process.env.GITHUB_TOKEN || '';
const UPSTREAM_URL = 'https://raw.githubusercontent.com/XiPrivateServers/Servers/main/SERVERS.md';
const STATE_FILE = path.join(process.cwd(), 'health.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function probeOnce(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(5000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function probe(server) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await probeOnce(server.host, server.port || DEFAULT_PROBE_PORT)) return true;
    if (attempt < 3) await sleep(30000);
  }
  return false;
}

async function gh(method, apiPath, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'xi-launcher-server-watch',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${apiPath}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function openIssuesWithLabel(label) {
  if (!TOKEN) return [];
  const issues = await gh('GET', `/issues?state=open&per_page=100&labels=${encodeURIComponent(label)}`);
  return issues.filter(i => !i.pull_request).map(i => ({ number: i.number, title: i.title, labels: i.labels.map(l => l.name) }));
}

async function main() {
  const { list, errors } = validateServerList(JSON.parse(fs.readFileSync(path.join(ROOT, 'servers', 'servers.json'), 'utf-8')));
  if (!list) throw new Error(errors.join('\n'));
  for (const err of errors) console.log(`warning: ${err}`);

  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch { /* first run */ }

  const probed = list.servers.filter(s => s.host);
  const results = Object.fromEntries(await Promise.all(probed.map(async s => [s.id, await probe(s)])));
  for (const s of probed) console.log(`${results[s.id] ? 'UP  ' : 'DOWN'}  ${s.id}  ${s.host}:${s.port || DEFAULT_PROBE_PORT}`);

  let upstreamNames = null;
  try {
    const res = await fetch(UPSTREAM_URL, { headers: { 'User-Agent': 'xi-launcher-server-watch' } });
    if (res.ok) upstreamNames = parseUpstreamNames(await res.text());
    else console.log(`Upstream list: HTTP ${res.status} (keeping previous names)`);
  } catch (e) {
    console.log(`Upstream list: ${e.message} (keeping previous names)`);
  }

  const openIssues = [...await openIssuesWithLabel('server-down'), ...await openIssuesWithLabel('upstream-change')];
  const plan = planWatch({
    servers: list.servers, ignoredUpstream: list.ignoredUpstream, results, upstreamNames, state, openIssues, now: Date.now(),
  });

  for (const issue of plan.open) {
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}OPEN   ${issue.title}`);
    if (!DRY_RUN) await gh('POST', '/issues', { title: issue.title, body: issue.body, labels: [issue.label] });
  }
  for (const c of plan.close) {
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}CLOSE  #${c.number} ${c.title}`);
    if (!DRY_RUN) {
      await gh('POST', `/issues/${c.number}/comments`, { body: c.comment });
      await gh('PATCH', `/issues/${c.number}`, { state: 'closed' });
    }
  }
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(plan.state, null, 2)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Create `.github/workflows/server-watch.yml`**

```yaml
name: Server watch
on:
  schedule:
    - cron: '17 6 * * *'
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Only print what would happen (no issues, no health commit)'
        type: boolean
        default: true
permissions:
  contents: write
  issues: write
concurrency: server-watch
jobs:
  watch:
    runs-on: ubuntu-latest
    env:
      DRY: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Ensure labels exist
        if: env.DRY != 'true'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh label create server-down --color B60205 --description "Server not answering" --force
          gh label create upstream-change --color 5319E7 --description "XiPrivateServers list changed" --force
          gh label create server-suggestion --color 0E8A16 --description "Player-suggested server change" --force
          gh label create server-problem --color D93F0B --description "Player-reported server problem" --force
      - name: Load health state
        run: git show origin/server-health:health.json > health.json 2>/dev/null || echo '{}' > health.json
      - name: Watch servers
        env:
          GITHUB_TOKEN: ${{ github.token }}
          DRY_RUN: ${{ env.DRY == 'true' && '1' || '' }}
        run: node scripts/server-watch.js
      - name: Save health state
        if: env.DRY != 'true'
        run: |
          mv health.json "$RUNNER_TEMP/health.json"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if git show-ref --quiet refs/remotes/origin/server-health; then
            git switch -c server-health origin/server-health
          else
            git switch --orphan server-health
          fi
          cp "$RUNNER_TEMP/health.json" health.json
          git add health.json
          git commit -m "health: $(date -u +%F)" || exit 0
          git push origin server-health
```

- [ ] **Step 3: Create the issue forms**

`.github/ISSUE_TEMPLATE/server-suggestion.yml`:

```yaml
name: Server suggestion
description: Add a server or correct a server's address (usually opened from XI Launcher)
title: "Server suggestion: "
labels: ["server-suggestion"]
body:
  - type: input
    id: server-id
    attributes:
      label: Server id
      description: The id used in servers/servers.json
  - type: textarea
    id: details
    attributes:
      label: What changed?
      description: New server, new address, where you found it…
    validations:
      required: true
  - type: textarea
    id: json
    attributes:
      label: servers.json entry
      description: Filled in by XI Launcher. The launcher team checks it before adding it.
      render: json
```

`.github/ISSUE_TEMPLATE/server-problem.yml`:

```yaml
name: Server problem
description: A server's address is wrong or the server has closed (usually opened from XI Launcher)
title: "Server problem: "
labels: ["server-problem"]
body:
  - type: input
    id: server-id
    attributes:
      label: Server id
      description: The id used in servers/servers.json
  - type: textarea
    id: details
    attributes:
      label: What's wrong?
      description: Wrong address (what is the right one?), server closed, can't connect since…
    validations:
      required: true
```

- [ ] **Step 4: Run the runner locally in dry-run mode**

PowerShell, run from the scratchpad so `health.json` lands there:
`$env:DRY_RUN='1'; node "Z:\The Vault\xi-launcher\scripts\server-watch.js"`

Expected:
- one `UP`/`DOWN` line per server with a host (about 1.5 minutes worst case for DOWN servers)
- `[dry-run] OPEN XiPrivateServers added: …` lines for any upstream names that aren't listed or ignored. On today's list that should be none.
- the scratchpad's `health.json` contains `health` and `upstream`

No GitHub calls happen without a token. Delete the scratchpad `health.json` afterwards.

Validate the YAML files parse: `node -e "for (const f of process.argv.slice(1)) { require('fs').readFileSync(f,'utf8'); } console.log('read ok')" .github/workflows/server-watch.yml .github/workflows/servers-validate.yml .github/ISSUE_TEMPLATE/server-suggestion.yml .github/ISSUE_TEMPLATE/server-problem.yml`. Then check them visually against GitHub's form schema: `type`, `id`, `attributes.label`.

- [ ] **Step 5: Commit**

```bash
git add scripts/server-watch.js .github/workflows/server-watch.yml .github/ISSUE_TEMPLATE/server-suggestion.yml .github/ISSUE_TEMPLATE/server-problem.yml
git commit -m "feat(servers): daily GitHub watch for dead servers and community list changes; issue forms"
```

---

### Task 12: Whole-feature live verification + notes

**Files:**
- Modify (vault, not repo): `C:\Users\Calvin Candie\.claude\projects\Z--The-Vault\memory\project_xi_launcher_release.md`

- [ ] **Step 1: Full test run**

Run: `npm run test:electron`
Expected: all pass. Report the exact count, which should be 95 + 37 + 14.

- [ ] **Step 2: Black-hole URL (Review Focus 1)**

Back up `config.json`. Restart Electron with `$env:XI_SERVER_LIST_URL='https://10.255.255.1/servers.json'`.
Expected:
- Home renders immediately, with no banner and no freeze.
- Opening the Servers tab shows "Loading…" for at most about 20 s (2 × 8 s plus backoff), then the list with "Offline copy from <date>" if a cache exists, otherwise "Built-in copy".

Time it and report the number.

- [ ] **Step 3: Cache path**

With `XI_SERVER_LIST_URL` unset and the branch not yet pushed (the GitHub URL 404s), point `XI_SERVER_LIST_URL` at the local `servers/servers.json`. Open the tab, which shows "Live list · updated 2026-10-05" and writes the cache. Restart with the black-hole URL.
Expected: "Offline copy from <today>".

- [ ] **Step 4: Screenshots**

Take these into `.superpowers/shots/servers/`: Home with no banner, the Servers tab (live), the Servers tab (offline copy), the Add modal, My servers, a card with "Your edit", and the moved banner on Home. Restore `config.json`, compare the SHA256, unset the env var and restart normally.

- [ ] **Step 5: Update the launcher memory**

In `project_xi_launcher_release.md`, add a section `## Server list overhaul (branch feature/server-list, 2026-10-05)` covering:
- the spec and plan paths
- `servers/servers.json` is now the source of truth, and the first push must land on `master` before a release ships it
- the dev override `XI_SERVER_LIST_URL`
- the Action and labels, with the first `workflow_dispatch` run to be done in dry-run mode
- what was and wasn't verified in-client

Update the index line in `MEMORY.md` if the hook changes.

- [ ] **Step 6: Hand back to the owner — do not push**

Report the commits and test count, and attach the screenshots. Then ask for go-ahead on, in order:
1. Push `servers/servers.json` and the validate workflow to `master`.
2. Merge the branch.
3. Do the first `Server watch` run with dry_run = true.
4. Do a real run.
5. Release.
