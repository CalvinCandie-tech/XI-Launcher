// Known xiloader connection addresses for private servers. An entry's optional `loader`
// names the loader registry id (electron/loaders.js) that server needs; launches to that
// host use it automatically unless the profile picks a loader explicitly.
const SERVER_ADDRESSES = {
  'Eden': { host: 'play.edenxi.com' },
  'Omega': { host: 'lobby.ffxi.party', port: '54230' },
  'Gaia XI': { host: 'login.gaiaxi.com' },
  'HorizonXI': { host: '', note: 'Uses custom HorizonXI launcher — not compatible with xiloader' },
  'LevelDown': { host: 'leveldownffxi.com' },
  'LevelDown 75': { host: 'ffxileveldown75.ddns.net' },
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
