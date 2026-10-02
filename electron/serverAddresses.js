// Known xiloader connection addresses for private servers.
const SERVER_ADDRESSES = {
  'Eden': { host: 'play.edenxi.com' },
  'Omega': { host: 'lobby.ffxi.party', port: '54230' },
  'Gaia XI': { host: 'login.gaiaxi.com' },
  'HorizonXI': { host: '', note: 'Uses custom HorizonXI launcher — not compatible with xiloader' },
  'LevelDown': { host: 'leveldownffxi.com' },
  // 75 and 99 players share one server since 2026-09-16 (LevelDown Discord announcement).
  'LevelDown 75': { host: 'leveldownffxi.com' },
  'Nasomi': { host: 'na.nasomi.com' },
  'Supernova': { host: 'login.supernovaffxi.com' },
  'Tabula Rasa': { host: 'login.tabularasaxi.com' },
  'Valhalla': { host: 'logon.valhalla.group' },
  'Omicron': { host: 'omicronffxi.com' },
  'ff11sf': { host: 'update.ff11sf.com' },
  'CatsEyeXI': { host: 'server.catseyexi.com' },
  'Phoenix XI': { host: '', note: 'Launching September 24, 2026 — connection details not yet published. Check phoenix-xi.com closer to launch.' },
};

module.exports = { SERVER_ADDRESSES };
