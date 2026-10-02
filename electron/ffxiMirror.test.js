const test = require('node:test');
const assert = require('node:assert/strict');
const { MIRROR_ORIGIN, pickFullClientUrl } = require('./ffxiMirror');

const listing = (files) => ({ ok: true, data: { files } });
const full = (filename, extra = {}) => ({ filename, kind: 'full', available: true, downloadPath: `/api/v1/downloads/${filename}`, ...extra });

test('default mirror is Vana Portal (Vana-Time moved there; its old links 404)', () => {
  assert.equal(MIRROR_ORIGIN, 'https://vana-portal.com');
});

test('pickFullClientUrl returns the full client from the listing', () => {
  const json = listing([
    { filename: 'ffxiUpdate-2026-08.zip', kind: 'monthly', available: true, downloadPath: '/api/v1/downloads/ffxiUpdate-2026-08.zip' },
    full('ffxiFullClient-2026-08.zip'),
  ]);
  assert.equal(pickFullClientUrl(json), 'https://vana-portal.com/api/v1/downloads/ffxiFullClient-2026-08.zip');
});

test('pickFullClientUrl picks the newest full client when several are listed', () => {
  const json = listing([full('ffxiFullClient-2026-07.zip'), full('ffxiFullClient-2026-09.zip'), full('ffxiFullClient-2026-08.zip')]);
  assert.equal(pickFullClientUrl(json), 'https://vana-portal.com/api/v1/downloads/ffxiFullClient-2026-09.zip');
});

test('pickFullClientUrl skips unavailable entries', () => {
  const json = listing([full('ffxiFullClient-2026-09.zip', { available: false }), full('ffxiFullClient-2026-08.zip')]);
  assert.equal(pickFullClientUrl(json), 'https://vana-portal.com/api/v1/downloads/ffxiFullClient-2026-08.zip');
});

test('pickFullClientUrl never leaves the mirror host', () => {
  const json = listing([full('ffxiFullClient-2026-09.zip', { downloadPath: 'https://evil.example/x.zip' })]);
  assert.equal(pickFullClientUrl(json), null);
});

test('pickFullClientUrl returns null for a listing with no full client or a bad shape', () => {
  assert.equal(pickFullClientUrl(listing([])), null);
  assert.equal(pickFullClientUrl({}), null);
  assert.equal(pickFullClientUrl(null), null);
});
