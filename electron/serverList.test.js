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
