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
