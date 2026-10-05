#!/usr/bin/env node
// Validate servers/servers.json (or the file given) with the same rules the launcher uses.
// Exits 1 on any problem — run by .github/workflows/servers-validate.yml.
const fs = require('fs');
const path = require('path');
const { parseServerListText, validateServerList } = require('../electron/serverList');

const file = process.argv[2] || path.join(__dirname, '..', 'servers', 'servers.json');
let json;
try {
  json = parseServerListText(fs.readFileSync(file, 'utf-8'));
} catch (e) {
  console.error(`✗ ${file}: ${e.message}`);
  process.exit(1);
}
const { list, errors } = validateServerList(json);
for (const err of errors) console.error(`✗ ${err}`);
if (list && list.servers.length === 0) console.error('✗ The list has no servers.');
if (errors.length || !list || list.servers.length === 0) process.exit(1);
console.log(`✓ ${list.servers.length} servers, no problems.`);
