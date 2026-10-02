const test = require('node:test');
const assert = require('node:assert/strict');
const { SERVER_ADDRESSES } = require('./serverAddresses');
const { isLoaderId } = require('./loaders');

test('every server loader binding names a registry loader', () => {
  for (const [name, entry] of Object.entries(SERVER_ADDRESSES)) {
    if (entry.loader !== undefined) assert.ok(isLoaderId(entry.loader), `${name}: unknown loader ${entry.loader}`);
  }
});

test('server hosts are unique so a host maps to one binding', () => {
  const hosts = Object.values(SERVER_ADDRESSES).map(e => (e.host || '').toLowerCase()).filter(Boolean);
  assert.equal(new Set(hosts).size, hosts.length);
});
