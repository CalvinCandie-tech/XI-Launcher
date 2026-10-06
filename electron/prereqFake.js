// DEV-ONLY stand-in for the prerequisites IPC, so the Requirements UI can be exercised without
// touching the network, the registry or UAC. Enabled by XI_PREREQS_FAKE=<path to a fixture .json>,
// and ONLY in an unpackaged run (`npm start`): loadFixture() returns null when app.isPackaged, so a
// shipped build never reads the variable. Same precedent as XI_SERVER_LIST_URL in main.js.
// Fixtures live in scripts/fixtures/prereqs/; the format is described there (README.md).
//
// No `electron` import: pure + injected, unit-tested in prereqFake.test.js.

const fs = require('fs');
const { PACKAGES } = require('./prereqs');

const DEFAULT_DETAIL = {
  installed: 'Installed',
  missing: 'Not installed',
  covered: 'Covered by a newer version',
  unsupported: 'Not supported on this Windows',
  unknown: 'Could not check',
};

// A status list may be written in full (array) or as a short form against the real catalogue:
//   { "default": "installed", "overrides": { "<id>": "missing" | ["unknown", "detail text"] } }
// so a fixture only names what differs and still carries the real names, categories and sizes.
function expandStatus(spec) {
  if (Array.isArray(spec)) return spec;
  if (!spec || typeof spec !== 'object') throw new Error('fixture status must be an array or { default, overrides }');
  const overrides = spec.overrides || {};
  for (const id of Object.keys(overrides)) {
    if (!PACKAGES.some((p) => p.id === id)) throw new Error(`fixture names an unknown package id: ${id}`);
  }
  return PACKAGES.map((p) => {
    const o = overrides[p.id];
    const status = Array.isArray(o) ? o[0] : (o || (p.category === 'superseded' ? 'covered' : (spec.default || 'installed')));
    const detail = Array.isArray(o) && o[1] ? o[1] : DEFAULT_DETAIL[status];
    return { id: p.id, name: p.name, category: p.category, status, detail, sizeBytes: p.installer ? p.installer.sizeBytes : null };
  });
}

// null unless the variable is set AND the app is not packaged.
function loadFixture(envValue, isPackaged, readFile = (f) => fs.readFileSync(f, 'utf8')) {
  if (isPackaged || !envValue) return null;
  const fixture = JSON.parse(readFile(envValue));
  return { ...fixture, status: expandStatus(fixture.status) };
}

// deps: sendProgress(percent, detail, info), sleep(ms) -> Promise (both injected).
function createFakeBackend(fixture, deps) {
  let status = fixture.status;
  let running = false;

  return {
    getStatus: async () => status,

    // Plays the scripted events (with their delays) and returns the scripted result. Never rejects.
    install: async () => {
      const empty = (error) => ({ results: [], restartRecommended: false, cancelled: false, error, status: null });
      if (running) return empty('An installation is already running. Wait for it to finish.');
      const scripted = fixture.install;
      if (!scripted) return empty('Fake mode: this fixture has no scripted install.');
      running = true;
      try {
        for (const ev of scripted.events || []) {
          if (ev.delayMs) await deps.sleep(ev.delayMs);
          deps.sendProgress(ev.percent, ev.detail, ev.info);
        }
        const result = scripted.result || {};
        const next = result.status ? expandStatus(result.status) : null;
        if (next) status = next;
        return {
          results: result.results || [],
          restartRecommended: !!result.restartRecommended,
          cancelled: !!result.cancelled,
          error: result.error || null,
          status: next,
        };
      } finally {
        running = false;
      }
    },
  };
}

module.exports = { expandStatus, loadFixture, createFakeBackend };
