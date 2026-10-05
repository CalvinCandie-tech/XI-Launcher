// Curated private-server list (servers/servers.json in the XI-Launcher repo): validating it,
// picking the live / cached / bundled copy, merging the player's local edits, spotting saved
// addresses that have moved, and building prefilled GitHub issue links. Pure — main.js does
// all the network and file I/O.

const SERVER_LIST_URL = 'https://raw.githubusercontent.com/CalvinCandie-tech/XI-Launcher/master/servers/servers.json';
const REPO_URL = 'https://github.com/CalvinCandie-tech/XI-Launcher';
const DEFAULT_PROBE_PORT = '54231';
const MY_SERVERS_CATEGORY = 'My servers';
const ISSUE_URL_MAX = 7000;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOST_RE = /^[A-Za-z0-9.-]+$/;
const PORT_RE = /^\d{1,5}$/;
// Standard card wording, so every server card reads the same ("1x" and "Retail" are one value).
const EXPANSIONS = ['RoZ', 'CoP', 'ToAU', 'WotG', 'Abyssea', 'SoA', 'RoV', 'All'];
const MULTIPLIER_RE = /^\d+(\.\d+)?x$/;
const TAG_VALUES = {
  expansion: { ok: v => EXPANSIONS.includes(v), describe: EXPANSIONS.join(', ') },
  exp: { ok: v => ['Retail', 'Custom'].includes(v) || MULTIPLIER_RE.test(v), describe: 'Retail, Custom or a multiplier like 2x' },
  speed: { ok: v => ['Retail', 'Old retail', 'Faster', 'Custom'].includes(v) || MULTIPLIER_RE.test(v), describe: 'Retail, Old retail, Faster, Custom or a multiplier like 2x' },
};
// true / false / missing = unknown
const TAG_FLAGS = ['trusts', 'levelSync', 'multiBox'];

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
  for (const [k, rule] of Object.entries(TAG_VALUES)) {
    const v = str(rawTags[k]);
    if (!v) continue;
    if (rule.ok(v)) tags[k] = v;
    else errors.push(`${where}: ${k} must be one of ${rule.describe} (got "${v}").`);
  }
  for (const k of TAG_FLAGS) {
    if (typeof rawTags[k] === 'boolean') tags[k] = rawTags[k];
    else if (rawTags[k] !== undefined) errors.push(`${where}: ${k} must be true or false (leave it out if unknown).`);
  }
  for (const k of Object.keys(rawTags)) {
    if (!(k in TAG_VALUES) && !TAG_FLAGS.includes(k)) errors.push(`${where}: unknown card field "${k}".`);
  }

  const server = {
    id, name, category, host, port, previousHosts,
    website: link('website'), discord: link('discord'), tags, note: str(raw.note),
  };
  const upstreamName = str(raw.upstreamName);
  if (upstreamName) server.upstreamName = upstreamName;
  return server;
}

// The six fields every server card shows, in a fixed shape: '?' / null when unknown.
function cardFields(tags) {
  const t = tags && typeof tags === 'object' ? tags : {};
  const flag = (k) => (typeof t[k] === 'boolean' ? t[k] : null);
  return {
    expansion: str(t.expansion) || '?',
    exp: str(t.exp) || '?',
    speed: str(t.speed) || '?',
    trusts: flag('trusts'),
    levelSync: flag('levelSync'),
    multiBox: flag('multiBox'),
  };
}

// JSON.parse, tolerating the byte-order mark Windows editors put at the start of a file.
function parseServerListText(text) {
  return JSON.parse(String(text).replace(/^﻿/, ''));
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

const OVERRIDE_KEYS = ['name', 'host', 'port', 'website', 'discord'];

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
}

// Check what the Add / Edit form sent. Editing an official server stores only the fields the
// player filled in (an override); anything else is the player's own server under a local- id.
function sanitizeLocalServer(input, { officialServers = [], localIds = new Set() } = {}) {
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
  const official = officialServers.find(s => s.id === id);
  if (official) {
    // Only what the player actually changed — a field left as-is must keep following the
    // official list (e.g. a port-only edit still picks up a later address move).
    const entry = { id };
    for (const [k, v] of Object.entries({ name, host, port, website, discord })) {
      const same = k === 'host' ? sameHost(v, official.host) : v === official[k];
      if (v && !same) entry[k] = v;
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

// One profile's saved addresses for findMovedHosts. `boot` is loaders.parseIniBoot() of its ini
// (null if there is none). Retail profiles never connect to a private server, so the server the
// launcher copied into their settings is ignored.
function profileHostEntry(name, settingsHost, boot) {
  return {
    name,
    settingsHost: boot && boot.isRetail ? '' : str(settingsHost),
    iniHost: (boot && str(boot.host)) || '',
  };
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
  parseServerListText,
  cardFields,
  validateServerList,
  resolveServerList,
  groupByCategory,
  slugify,
  sanitizeLocalServer,
  applyLocalServers,
  findMovedHosts,
  profileHostEntry,
  describeUsedBy,
  applyMoveToConfig,
  ISSUE_URL_MAX,
  serverSnippet,
  buildIssueUrl,
};
