/**
 * Shared INI parser/writer for Ashita boot profiles.
 * Pure functions — no side effects or API calls.
 */

/**
 * Parse an INI string into { sectionName: { key: value } }.
 * Section names are stored without brackets.
 */
export function parseIni(content) {
  const sections = {};
  let current = null;
  const headerLines = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) {
      current = secMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current === null) {
      headerLines.push(raw);
    } else if (line && !line.startsWith(';') && !line.startsWith('#')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim();
        sections[current][key] = value;
      }
    }
  }
  if (headerLines.length > 0) {
    sections.__header__ = headerLines;
  }
  return sections;
}

/**
 * Get a single section's key-value pairs from INI content.
 */
export function getSection(content, sectionName) {
  const sections = parseIni(content);
  return sections[sectionName] || null;
}

/**
 * Merge updates into a section and return the full INI string.
 * Existing keys are overwritten, new keys are appended.
 */
export function setSectionValues(content, sectionName, updates) {
  const lines = content.split('\n');
  const header = `[${sectionName}]`;
  const secIdx = lines.findIndex(l => l.trim() === header);

  if (secIdx === -1) {
    // Section doesn't exist — append it
    const newLines = [header, ...Object.entries(updates).map(([k, v]) => `${k} = ${v}`), ''];
    return [...lines, ...newLines].join('\n');
  }

  // Find end of section
  let endIdx = lines.length;
  for (let i = secIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().match(/^\[.+\]$/)) { endIdx = i; break; }
  }

  // Replace matching key lines in place; track which keys were seen so we can
  // append new ones at the end of the section. Comments and blank lines inside
  // the section are preserved byte-for-byte.
  const sectionLines = lines.slice(secIdx + 1, endIdx);
  const seen = new Set();
  for (let i = 0; i < sectionLines.length; i++) {
    const line = sectionLines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      sectionLines[i] = `${key} = ${String(updates[key])}`;
      seen.add(key);
    }
  }

  // Append any keys we didn't find in the existing section
  const toAppend = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) toAppend.push(`${key} = ${String(value)}`);
  }

  const before = lines.slice(0, secIdx + 1);
  const after = lines.slice(endIdx);
  const needsSeparator = after.length > 0 && after[0].trim() !== '';
  return [...before, ...sectionLines, ...toAppend, ...(needsSeparator ? [''] : []), ...after].join('\n');
}

/**
 * Extract the script filename from a boot profile's [ashita.boot] section.
 */
export function getScriptName(profileContent) {
  const boot = getSection(profileContent, 'ashita.boot');
  return boot?.script?.trim() || 'default.txt';
}
