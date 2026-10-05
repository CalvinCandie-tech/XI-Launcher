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
          '- **Closed?** Remove its entry and add its XiPrivateServers name to `ignoredUpstream`.',
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
    const current = new Set(upstreamNames.map(lower));
    const prev = upstream ? new Set(upstream.map(lower)) : null;
    const alreadyOpen = (title) => openIssues.some(i => hasLabel(i, 'upstream-change') && i.title === title);
    const report = (title, body) => {
      if (!alreadyOpen(title)) open.push({ label: 'upstream-change', title, body });
    };
    for (const name of upstreamNames) {
      if (known.has(lower(name)) || (prev && prev.has(lower(name)))) continue;
      report(`XiPrivateServers added: ${name}`,
        `**${name}** is on the [XiPrivateServers list](https://github.com/XiPrivateServers/Servers/blob/main/SERVERS.md) but not in \`servers/servers.json\`.\n\n`
        + 'Add it (find its connection address on its website/Discord), or add the name to `ignoredUpstream` to stop hearing about it.');
    }
    for (const name of upstream || []) {
      if (!listed.has(lower(name)) || current.has(lower(name))) continue;
      report(`XiPrivateServers removed: ${name}`,
        `**${name}** was removed from the XiPrivateServers list. It may have closed — check, then remove it from \`servers/servers.json\` or close this issue.`);
    }
    upstream = upstreamNames;
  }

  return { state: { health, ...(upstream ? { upstream } : {}) }, open, close };
}

module.exports = { DAY_MS, DOWN_DAYS, parseUpstreamNames, planWatch };
