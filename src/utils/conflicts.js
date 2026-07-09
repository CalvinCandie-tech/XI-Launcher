// Conflict groups — items in the same group may overlap. Script names listed here
// must match `(installAs || name).toLowerCase()` from whichever catalogue owns them.
// Used by both AddonsTab and PluginsTab so a cross-tab conflict (e.g. LegacyAC plugin
// vs LuAshitacast addon) still surfaces a warning.
// scripts: lowercase /load or /addon load name. displayNames: same order, used by the
// conflict banner so neither tab has to cross-import the other catalogue for labels.
export const CONFLICT_GROUPS = {
  'hud-bars':    { label: 'HUD / Player Bars', scripts: ['xiui', 'xivbar'],            displayNames: ['XIUI', 'XIVBar'] },
  'hotbar':      { label: 'Hotbar System',     scripts: ['thotbar', 'tcrossbar'],      displayNames: ['tHotBar', 'tCrossBar'] },
  'party-list':  { label: 'Party List',        scripts: ['xivparty', 'xiui'],          displayNames: ['XivParty', 'XIUI'] },
  'buff-timers': { label: 'Buff Timers',       scripts: ['statustimers', 'ttimers'],   displayNames: ['statustimers', 'tTimers'] },
  'gear-swap':   { label: 'Gear Swap Engine',  scripts: ['luashitacast', 'legacyac'],  displayNames: ['LuAshitacast', 'LegacyAC'] },
};

// Detect overlap given the union of enabled script names (lowercase) across addons + plugins.
export function detectConflicts(enabledScriptNames) {
  const enabledSet = new Set(enabledScriptNames.map(n => n.toLowerCase()));
  const warnings = [];
  for (const [groupId, group] of Object.entries(CONFLICT_GROUPS)) {
    const hit = group.scripts.filter(s => enabledSet.has(s));
    if (hit.length > 1) warnings.push({ id: groupId, label: group.label, scripts: hit });
  }
  return warnings;
}
