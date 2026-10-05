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
