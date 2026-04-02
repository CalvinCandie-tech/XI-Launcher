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

  // Parse existing entries preserving order
  const entries = {};
  const order = [];
  for (let i = secIdx + 1; i < endIdx; i++) {
    const line = lines[i].trim();
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim();
      entries[key] = line.slice(eqIdx + 1).trim();
      order.push(key);
    }
  }

  // Apply updates
  for (const [key, value] of Object.entries(updates)) {
    entries[key] = String(value);
    if (!order.includes(key)) order.push(key);
  }

  // Rebuild
  const before = lines.slice(0, secIdx + 1);
  const after = lines.slice(endIdx);
  const sectionLines = order.map(k => `${k} = ${entries[k]}`);
  // Only add blank line separator if the next line isn't already empty
  const needsSeparator = after.length > 0 && after[0].trim() !== '';
  return [...before, ...sectionLines, ...(needsSeparator ? [''] : []), ...after].join('\n');
}

/**
 * Extract the script filename from a boot profile's [ashita.boot] section.
 */
export function getScriptName(profileContent) {
  const boot = getSection(profileContent, 'ashita.boot');
  return boot?.script?.trim() || 'default.txt';
}
