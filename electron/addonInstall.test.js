const test = require('node:test');
const assert = require('node:assert/strict');
const { interfaceScore, pickReleaseZip } = require('./addonInstall');

const asset = (name) => ({ name, browser_download_url: `https://x/${name}` });

test('interfaceScore reads both "Interface-4.30" and "Ashita-4.30" labels', () => {
  assert.equal(interfaceScore('FindAll.1.18.-.Interface.4.30.zip'), 4030);
  assert.equal(interfaceScore('TrueFPS-v1.1_Interface-4.30.zip'), 4030);
  assert.equal(interfaceScore('SpectralFix-v1.03-Ashita-4.16.zip'), 4016);
  assert.equal(interfaceScore('simplelog.1.1.zip'), -1);
});

test('pickReleaseZip prefers the newest interface build', () => {
  const pick = pickReleaseZip([asset('Lootwhore.1.18.-.Interface.4.16.zip'), asset('Lootwhore.1.18.-.Interface.4.30.zip')]);
  assert.equal(pick.name, 'Lootwhore.1.18.-.Interface.4.30.zip');
});

test('pickReleaseZip handles Ashita-N.NN labelled builds (SpectralFix)', () => {
  const pick = pickReleaseZip([asset('SHA256SUMS.txt'), asset('SpectralFix-v1.03-Ashita-4.16.zip'), asset('SpectralFix-v1.03-Ashita-4.30.zip')]);
  assert.equal(pick.name, 'SpectralFix-v1.03-Ashita-4.30.zip');
});

test('pickReleaseZip skips HorizonXI-specific builds when another zip exists', () => {
  const pick = pickReleaseZip([asset('TreasurePool-HXI-Horizon.zip'), asset('TreasurePool.zip')]);
  assert.equal(pick.name, 'TreasurePool.zip');
});

test('pickReleaseZip returns null when the release has no zip', () => {
  assert.equal(pickReleaseZip([asset('FrameFix.dll')]), null);
  assert.equal(pickReleaseZip([]), null);
  assert.equal(pickReleaseZip(undefined), null);
});
