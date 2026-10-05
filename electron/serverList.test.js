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

test('validateServerList keeps the standard card fields; yes/no flags are true/false, anything else unknown', () => {
  const { list, errors } = SL.validateServerList(doc([
    entry({ tags: { expansion: ' ToAU ', exp: 'Retail', speed: '2x', levelSync: true, trusts: 'yes', multiBox: false, bogus: 'x' } }),
  ]));
  assert.deepEqual(list.servers[0].tags, { expansion: 'ToAU', exp: 'Retail', speed: '2x', levelSync: true, multiBox: false });
  // a non-boolean flag and an unknown field (e.g. an old "rates" or a typo) are reported
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /trusts must be true or false/);
  assert.match(errors.join('\n'), /unknown card field "bogus"/);
});

test('validateServerList rejects card values outside the standard wording', () => {
  const { list, errors } = SL.validateServerList(doc([
    entry({ tags: { expansion: 'Treasures', exp: '1x rates', speed: 'Slightly faster than retail' } }),
  ]));
  assert.deepEqual(list.servers[0].tags, {});
  assert.equal(errors.length, 3);
  assert.match(errors.join('\n'), /exp must be one of Retail, Custom or a multiplier like 2x/);
});

test('cardFields gives every server the same six fields, ? when unknown', () => {
  assert.deepEqual(SL.cardFields({ expansion: 'ToAU', exp: 'Custom', trusts: false, levelSync: true }), {
    expansion: 'ToAU', exp: 'Custom', speed: '?', trusts: false, levelSync: true, multiBox: null,
  });
  assert.deepEqual(SL.cardFields(undefined), { expansion: '?', exp: '?', speed: '?', trusts: null, levelSync: null, multiBox: null });
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

test('sanitizeLocalServer stores only the fields that differ from the official server', () => {
  const r = SL.sanitizeLocalServer(
    { id: 'eden', name: 'Eden', host: 'new.edenxi.com', port: '', website: '', discord: '' },
    { officialServers: official(), localIds: idSet([]) },
  );
  assert.equal(r.error, undefined);
  assert.deepEqual(r.entry, { id: 'eden', host: 'new.edenxi.com' });
});

test('sanitizeLocalServer gives a new server a unique local- id', () => {
  const r = SL.sanitizeLocalServer(
    { name: 'My Test Server!', host: '10.0.0.5', category: '75 - Custom Content' },
    { officialServers: [], localIds: idSet(['local-my-test-server']) },
  );
  assert.deepEqual(r.entry, {
    id: 'local-my-test-server-2', name: 'My Test Server!', host: '10.0.0.5', port: '',
    website: '', discord: '', category: '75 - Custom Content',
  });
});

test('sanitizeLocalServer keeps an existing custom id when editing it', () => {
  const r = SL.sanitizeLocalServer({ id: 'local-mine', name: 'Mine', host: 'b.com' }, { officialServers: [], localIds: idSet(['local-mine']) });
  assert.equal(r.entry.id, 'local-mine');
});

test('sanitizeLocalServer rejects bad input with a readable message', () => {
  const opts = { officialServers: [], localIds: idSet([]) };
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

test('the shipped servers/servers.json validates with no errors', () => {
  const json = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'servers', 'servers.json'), 'utf-8'));
  const { list, errors } = SL.validateServerList(json);
  assert.deepEqual(errors, []);
  assert.ok(list.servers.length >= 10);
});

test('parseServerListText accepts a UTF-8 BOM (Windows editors add one)', () => {
  const json = SL.parseServerListText('\uFEFF{"servers":[]}');
  assert.deepEqual(json, { servers: [] });
  assert.throws(() => SL.parseServerListText('not json'));
});

test('a port-only edit keeps following the official address when the server moves', () => {
  const r = SL.sanitizeLocalServer(
    { id: 'eden', name: 'Eden', host: 'play.edenxi.com', port: '54231', website: '', discord: '' },
    { officialServers: official(), localIds: idSet([]) },
  );
  assert.deepEqual(r.entry, { id: 'eden', port: '54231' });
  const moved = SL.validateServerList(doc([entry({ host: 'new.edenxi.com', previousHosts: ['play.edenxi.com'] })])).list.servers;
  const eden = SL.applyLocalServers(moved, { eden: r.entry }).servers[0];
  assert.equal(eden.host, 'new.edenxi.com');
  assert.equal(eden.port, '54231');
});

test('profileHostEntry ignores the saved server of a retail profile', () => {
  assert.deepEqual(SL.profileHostEntry('Retail', 'old.host', { isRetail: true, host: null }), { name: 'Retail', settingsHost: '', iniHost: '' });
  assert.deepEqual(SL.profileHostEntry('Main', 'a.com', { isRetail: false, host: 'b.com' }), { name: 'Main', settingsHost: 'a.com', iniHost: 'b.com' });
  assert.deepEqual(SL.profileHostEntry('NoIni', 'a.com', null), { name: 'NoIni', settingsHost: 'a.com', iniHost: '' });
});
