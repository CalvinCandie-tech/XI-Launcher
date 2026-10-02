// Choosing which release asset to install for a catalogue addon/plugin. Plugins are built
// per Ashita plugin interface, and authors label the builds either "Interface-4.30" or
// "Ashita-4.30"; Ashita refuses to load a DLL built for another interface.

// 4.30 → 4030, or -1 when the name carries no interface label.
function interfaceScore(name) {
  const m = String(name).match(/(?:Interface|Ashita)[._-]?(\d+)[._-](\d+)/i);
  return m ? parseInt(m[1], 10) * 1000 + parseInt(m[2], 10) : -1;
}

// The .zip asset to install: skip HorizonXI-specific builds when there's an alternative,
// then take the highest interface. Null when the release has no zip at all.
function pickReleaseZip(assets) {
  const zips = (assets || []).filter(a => a && /\.zip$/i.test(a.name));
  const general = zips.filter(a => !/horizon/i.test(a.name));
  const pool = general.length ? general : zips;
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => interfaceScore(b.name) - interfaceScore(a.name))[0];
}

module.exports = { interfaceScore, pickReleaseZip };
