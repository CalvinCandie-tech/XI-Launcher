#!/usr/bin/env node
// Daily server watch, run by .github/workflows/server-watch.yml. Probes every server in
// servers/servers.json, diffs the XiPrivateServers list, opens/closes issues, and writes
// ./health.json (the workflow keeps it on the server-health branch). DRY_RUN=1 only prints.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { parseServerListText, validateServerList, DEFAULT_PROBE_PORT } = require('../electron/serverList');
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
  const { list, errors } = validateServerList(parseServerListText(fs.readFileSync(path.join(ROOT, 'servers', 'servers.json'), 'utf-8')));
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
