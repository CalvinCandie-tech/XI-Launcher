# ReShade Preset Tier System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3 flat ReShade presets with a 4-tier additive system (Clean/Vivid/Cinematic/Screenshot), expand from 5 to 12 shader effects, and add a collapsible advanced panel for individual effect tweaking.

**Architecture:** Frontend preset definitions in `ReShadeTab.js` drive a vertical tier selector UI. Each tier maps to a set of effect keys with default values. The backend `write-reshade-config` / `read-reshade-config` handlers in `main.js` translate between the frontend effect object and ReShade 6.x `ReShadePreset.ini` format. New shader `.fx` files are added to the existing GitHub release zip.

**Tech Stack:** React 18, Electron 28, ReShade 6.x INI format, GitHub Releases for shader distribution

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/tabs/ReShadeTab.js` | Preset tier definitions, vertical selector UI, collapsible advanced panel, effect state management |
| `src/tabs/ReShadeTab.css` | Styles for vertical preset rows, active tier gradient border, collapsible panel |
| `electron/main.js` | `write-reshade-config` and `read-reshade-config` IPC handlers with 12-effect mappings |
| GitHub release `reshade-v1.0` | Zip containing all 12 `.fx` shader files plus dependencies |

Existing reused component: `src/components/CollapsibleSection.js` (already has chevron + open/close toggle)

---

### Task 1: Update Backend — Expand write-reshade-config to 12 Effects

**Files:**
- Modify: `electron/main.js:2536-2591`

- [ ] **Step 1: Replace the `write-reshade-config` handler**

Open `electron/main.js` and replace the entire `write-reshade-config` handler (lines 2536–2591) with the expanded version. The new handler uses a data-driven `EFFECT_MAP` to build the Techniques line and INI sections for all 12 effects.

```js
  ipcMain.handle('write-reshade-config', async (_, ffxiPath, effects) => {
    try {
      validateStoredFfxiPath(ffxiPath);
      const dllDir = getReshadeDllDir() || ffxiPath;

      // ReShade 6.x: main INI has paths/general config, preset file has effect values
      const iniPath = path.join(dllDir, 'ReShade.ini');
      if (!fs.existsSync(iniPath)) {
        const shadersAbsPath = path.join(ffxiPath, 'reshade-shaders', 'Shaders');
        const texturesAbsPath = path.join(ffxiPath, 'reshade-shaders', 'Textures');
        const iniLines = [
          '[GENERAL]',
          `EffectSearchPaths=${shadersAbsPath}`,
          `TextureSearchPaths=${texturesAbsPath}`,
          'PreprocessorDefinitions=',
          'PresetPath=.\\ReShadePreset.ini',
          '',
        ];
        fs.writeFileSync(iniPath, iniLines.join('\r\n'), 'utf8');
      }

      // Map of effect key -> { technique, iniSection, iniKey }
      const EFFECT_MAP = {
        smaa:             { technique: 'SMAA@SMAA.fx' },
        sharpening:       { technique: 'LumaSharpen@LumaSharpen.fx', iniSection: 'LumaSharpen.fx', iniKey: 'sharp_strength' },
        clarity:          { technique: 'Clarity@Clarity.fx', iniSection: 'Clarity.fx', iniKey: 'ClarityStrength' },
        vibrance:         { technique: 'Vibrance@Vibrance.fx', iniSection: 'Vibrance.fx', iniKey: 'Vibrance' },
        colourfulness:    { technique: 'Colourfulness@Colourfulness.fx', iniSection: 'Colourfulness.fx', iniKey: 'colourfulness' },
        bloom:            { technique: 'MagicBloom@Bloom.fx', iniSection: 'Bloom.fx', iniKey: 'BloomIntensity' },
        ambientOcclusion: { technique: 'MXAO@MXAO.fx' },
        vignette:         { technique: 'Vignette@Vignette.fx', iniSection: 'Vignette.fx', iniKey: 'VignetteAmount' },
        filmGrain:        { technique: 'FilmGrain@FilmGrain.fx', iniSection: 'FilmGrain.fx', iniKey: 'Intensity' },
        depthOfField:     { technique: 'DepthOfField@DepthOfField.fx' },
        fakeHDR:          { technique: 'FakeHDR@FakeHDR.fx', iniSection: 'FakeHDR.fx', iniKey: 'HDRPower' },
        liftGammaGain:    { technique: 'LiftGammaGain@LiftGammaGain.fx' },
      };

      // Build Techniques line from enabled effects
      const techniques = [];
      for (const [key, map] of Object.entries(EFFECT_MAP)) {
        if (effects[key]?.enabled) techniques.push(map.technique);
      }

      // Build INI sections for effects that have slider values
      const sectionLines = [];
      for (const [key, map] of Object.entries(EFFECT_MAP)) {
        if (map.iniSection && map.iniKey && effects[key]?.value !== undefined) {
          sectionLines.push('', `[${map.iniSection}]`, `${map.iniKey}=${effects[key].value.toFixed(6)}`);
        }
      }

      const presetLines = [
        'PreprocessorDefinitions=',
        `Techniques=${techniques.join(',')}`,
        `TechniqueSorting=${techniques.join(',')}`,
        ...sectionLines,
        '',
      ];

      fs.writeFileSync(path.join(dllDir, 'ReShadePreset.ini'), presetLines.join('\r\n'), 'utf8');

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
```

- [ ] **Step 2: Verify the file saves correctly**

Run the launcher with `npm start`, go to ReShade tab, toggle any effect, and check that `ReShadePreset.ini` in the xiloader directory contains the new format. The file should have `Techniques=` with comma-separated entries and `[SectionName]` blocks with values.

- [ ] **Step 3: Commit**

```bash
git add electron/main.js
git commit -m "feat(reshade): expand write-reshade-config to support 12 effects"
```

---

### Task 2: Update Backend — Expand read-reshade-config to 12 Effects

**Files:**
- Modify: `electron/main.js:2593-2652`

- [ ] **Step 1: Replace the `read-reshade-config` handler**

Replace the entire `read-reshade-config` handler (lines 2593–2652) with the expanded version that uses the same `EFFECT_MAP` pattern. Since `EFFECT_MAP` is defined inside the `write-reshade-config` closure, we need to define a shared version above both handlers, or duplicate it. To keep things simple and avoid refactoring scope, define the map inline in each handler.

```js
  ipcMain.handle('read-reshade-config', async (_, ffxiPath) => {
    try {
      validateStoredFfxiPath(ffxiPath);
      const dllDir = getReshadeDllDir() || ffxiPath;

      const parseIni = (filePath) => {
        if (!fs.existsSync(filePath)) return {};
        const content = fs.readFileSync(filePath, 'utf8');
        let currentSection = '';
        const sections = {};
        for (const line of content.split(/\r?\n/)) {
          const sectionMatch = line.match(/^\[(.+)\]$/);
          if (sectionMatch) { currentSection = sectionMatch[1]; sections[currentSection] = {}; continue; }
          const kvMatch = line.match(/^(\w+)\s*=\s*(.*)$/);
          if (kvMatch && currentSection) sections[currentSection][kvMatch[1]] = kvMatch[2];
        }
        return sections;
      };

      const presetPath = path.join(dllDir, 'ReShadePreset.ini');
      const presetSections = parseIni(presetPath);

      let techniquesLine = '';
      if (fs.existsSync(presetPath)) {
        const raw = fs.readFileSync(presetPath, 'utf8');
        const m = raw.match(/^Techniques=(.*)$/m);
        if (m) techniquesLine = m[1];
      }
      const enabledTechniques = techniquesLine.split(',').map(s => s.trim()).filter(Boolean);

      // Map technique substring -> effect key, plus optional INI section/key/default
      const READ_MAP = [
        { key: 'smaa',             match: 'SMAA' },
        { key: 'sharpening',       match: 'LumaSharpen', section: 'LumaSharpen.fx', iniKey: 'sharp_strength', defaultVal: 0.60 },
        { key: 'clarity',          match: 'Clarity',     section: 'Clarity.fx',     iniKey: 'ClarityStrength', defaultVal: 0.30 },
        { key: 'vibrance',         match: 'Vibrance',    section: 'Vibrance.fx',    iniKey: 'Vibrance',        defaultVal: 0.30 },
        { key: 'colourfulness',    match: 'Colourfulness', section: 'Colourfulness.fx', iniKey: 'colourfulness', defaultVal: 0.40 },
        { key: 'bloom',            match: 'Bloom',       section: 'Bloom.fx',       iniKey: 'BloomIntensity',  defaultVal: 0.20 },
        { key: 'ambientOcclusion', match: 'MXAO' },
        { key: 'vignette',         match: 'Vignette',    section: 'Vignette.fx',    iniKey: 'VignetteAmount',  defaultVal: 0.40 },
        { key: 'filmGrain',        match: 'FilmGrain',   section: 'FilmGrain.fx',   iniKey: 'Intensity',       defaultVal: 0.15 },
        { key: 'depthOfField',     match: 'DepthOfField' },
        { key: 'fakeHDR',          match: 'FakeHDR',     section: 'FakeHDR.fx',     iniKey: 'HDRPower',        defaultVal: 0.50 },
        { key: 'liftGammaGain',    match: 'LiftGammaGain' },
      ];

      const effects = {};
      for (const entry of READ_MAP) {
        const enabled = enabledTechniques.some(t => t.includes(entry.match));
        if (entry.section && entry.iniKey) {
          effects[entry.key] = {
            enabled,
            value: parseFloat(presetSections[entry.section]?.[entry.iniKey]) || entry.defaultVal,
          };
        } else {
          effects[entry.key] = { enabled };
        }
      }

      return { success: true, effects };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
```

- [ ] **Step 2: Verify round-trip**

Run the launcher, go to ReShade tab, toggle a few effects and change slider values. Navigate away from the tab and back. Confirm that the toggle and slider states are preserved (written by Task 1's handler, read back by this handler).

- [ ] **Step 3: Commit**

```bash
git add electron/main.js
git commit -m "feat(reshade): expand read-reshade-config to parse 12 effects"
```

---

### Task 3: Update Frontend — New Preset Definitions and Effect Metadata

**Files:**
- Modify: `src/tabs/ReShadeTab.js:1-56`

- [ ] **Step 1: Replace PRESETS, DEFAULT_EFFECTS, and EFFECT_META**

Replace the top section of `ReShadeTab.js` (lines 6–56, after the `const api` line) with the new 4-tier presets and expanded effect metadata. The key change: presets are now additive tiers, and there are 12 effects instead of 5.

```js
const EFFECT_META = [
  { key: 'smaa',             label: 'SMAA Anti-Aliasing',  hint: 'Smooths jagged edges — big quality boost for FFXI',       hasSlider: false },
  { key: 'sharpening',       label: 'Sharpening',          hint: 'Crisp edges and fine texture detail',                      hasSlider: true, min: 0, max: 1, step: 0.05 },
  { key: 'clarity',          label: 'Clarity',             hint: 'Mid-tone contrast — textures look more detailed',          hasSlider: true, min: 0, max: 1, step: 0.05 },
  { key: 'vibrance',         label: 'Vibrance',            hint: 'Intelligent saturation — boosts dull colors, preserves vivid ones', hasSlider: true, min: 0, max: 1, step: 0.05 },
  { key: 'colourfulness',    label: 'Colourfulness',       hint: 'Per-channel saturation — makes each color more distinct',  hasSlider: true, min: 0, max: 1, step: 0.05 },
  { key: 'bloom',            label: 'Bloom / Glow',        hint: 'Candles, fires, and crystals radiate soft light',          hasSlider: true, min: 0, max: 1, step: 0.05 },
  { key: 'ambientOcclusion', label: 'Ambient Occlusion',   hint: 'Adds depth shadows in corners and crevices',              hasSlider: false },
  { key: 'vignette',         label: 'Vignette',            hint: 'Darkens screen edges — draws focus to the center',         hasSlider: true, min: 0, max: 1, step: 0.05 },
  { key: 'filmGrain',        label: 'Film Grain',          hint: 'Subtle noise for a cinematic look',                        hasSlider: true, min: 0, max: 1, step: 0.05 },
  { key: 'depthOfField',     label: 'Depth of Field',      hint: 'Blurs background like a camera lens — great for screenshots', hasSlider: false },
  { key: 'fakeHDR',          label: 'Fake HDR',            hint: 'Tone mapping — recovers highlight and shadow detail',      hasSlider: true, min: 0, max: 1, step: 0.05 },
  { key: 'liftGammaGain',    label: 'Lift Gamma Gain',     hint: 'Color grading — adjust shadows, midtones, and highlights', hasSlider: false },
];

// All effects default to off
const DEFAULT_EFFECTS = Object.fromEntries(
  EFFECT_META.map(m => [m.key, m.hasSlider ? { enabled: false, value: 0.50 } : { enabled: false }])
);

// Additive preset tiers — each includes all effects from the previous tier
const PRESETS = [
  {
    name: 'Clean',
    desc: "Fixes FFXI's rough edges without changing the look.",
    effects: {
      smaa: { enabled: true },
      sharpening: { enabled: true, value: 0.60 },
      clarity: { enabled: true, value: 0.30 },
    },
    count: 3,
  },
  {
    name: 'Vivid',
    desc: 'Clean + punchy, saturated colors that make zones pop.',
    effects: {
      smaa: { enabled: true },
      sharpening: { enabled: true, value: 0.60 },
      clarity: { enabled: true, value: 0.30 },
      vibrance: { enabled: true, value: 0.30 },
      colourfulness: { enabled: true, value: 0.40 },
    },
    count: 5,
  },
  {
    name: 'Cinematic',
    desc: 'Vivid + bloom, ambient occlusion, vignette, and film grain.',
    effects: {
      smaa: { enabled: true },
      sharpening: { enabled: true, value: 0.60 },
      clarity: { enabled: true, value: 0.30 },
      vibrance: { enabled: true, value: 0.30 },
      colourfulness: { enabled: true, value: 0.40 },
      bloom: { enabled: true, value: 0.30 },
      ambientOcclusion: { enabled: true },
      vignette: { enabled: true, value: 0.40 },
      filmGrain: { enabled: true, value: 0.15 },
    },
    count: 9,
  },
  {
    name: 'Screenshot',
    desc: 'Cinematic + depth of field, HDR, and color grading. Not for gameplay.',
    effects: {
      smaa: { enabled: true },
      sharpening: { enabled: true, value: 0.60 },
      clarity: { enabled: true, value: 0.30 },
      vibrance: { enabled: true, value: 0.30 },
      colourfulness: { enabled: true, value: 0.40 },
      bloom: { enabled: true, value: 0.30 },
      ambientOcclusion: { enabled: true },
      vignette: { enabled: true, value: 0.40 },
      filmGrain: { enabled: true, value: 0.15 },
      depthOfField: { enabled: true },
      fakeHDR: { enabled: true, value: 0.50 },
      liftGammaGain: { enabled: true },
    },
    count: 12,
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/tabs/ReShadeTab.js
git commit -m "feat(reshade): add 4-tier preset definitions and 12-effect metadata"
```

---

### Task 4: Update Frontend — Vertical Preset Selector and Collapsible Advanced Panel

**Files:**
- Modify: `src/tabs/ReShadeTab.js:136-324` (the `activePreset`, `applyPreset`, and JSX render sections)

- [ ] **Step 1: Update the preset matching logic**

Replace the `activePreset` calculation (around line 137) with one that works with the new preset structure. The new presets have varying numbers of effects, so we need to check both enabled state and values. Effects not listed in a preset definition should be disabled.

Replace lines 136–162 (from `const activePreset = ...` through `const updateEffect = ...`) with:

```js
  // Determine which preset matches current effects (or 'Custom')
  const activePreset = PRESETS.find(preset => {
    return EFFECT_META.every(meta => {
      const presetEffect = preset.effects[meta.key];
      const currentEffect = effects[meta.key];
      // If preset defines this effect, it should be enabled with matching value
      if (presetEffect) {
        if (!currentEffect?.enabled) return false;
        if (presetEffect.value !== undefined && currentEffect.value !== undefined) {
          return Math.abs(presetEffect.value - currentEffect.value) < 0.01;
        }
        return true;
      }
      // If preset doesn't define this effect, it should be disabled
      return !currentEffect?.enabled;
    });
  })?.name || 'Custom';

  const applyPreset = async (preset) => {
    // Build full effects object: preset effects enabled, everything else disabled
    const newEffects = {};
    for (const meta of EFFECT_META) {
      if (preset.effects[meta.key]) {
        newEffects[meta.key] = { ...preset.effects[meta.key] };
      } else {
        newEffects[meta.key] = meta.hasSlider ? { enabled: false, value: DEFAULT_EFFECTS[meta.key].value } : { enabled: false };
      }
    }
    setEffects(newEffects);
    await api.writeReShadeConfig(ffxiPath, newEffects);
  };

  const updateEffect = async (key, changes) => {
    const newEffects = {
      ...effects,
      [key]: { ...effects[key], ...changes },
    };
    setEffects(newEffects);
    await api.writeReShadeConfig(ffxiPath, newEffects);
  };
```

- [ ] **Step 2: Replace the JSX for presets and effects panels**

Add the `CollapsibleSection` import at the top of the file (line 2):

```js
import CollapsibleSection from '../components/CollapsibleSection';
```

Then replace the entire JSX block inside `{status?.installed && enabled && ( ... )}` (around lines 262–323) with the new vertical preset selector and collapsible advanced panel:

```jsx
      {status?.installed && enabled && (
        <>
          <div className="section-header">Presets</div>
          <div className="reshade-presets-list">
            {PRESETS.map(preset => (
              <div
                key={preset.name}
                className={`reshade-preset-row ${activePreset === preset.name ? 'active' : ''}`}
                onClick={() => applyPreset(preset)}
              >
                <div className="reshade-preset-name cinzel">{preset.name}</div>
                <div className="reshade-preset-desc">{preset.desc}</div>
                <div className="reshade-preset-count">{preset.count} effects</div>
              </div>
            ))}
          </div>

          <CollapsibleSection title="Customize Effects" defaultOpen={false}>
            <div className="reshade-effects-list">
              {EFFECT_META.map(meta => {
                const effect = effects[meta.key];
                return (
                  <div key={meta.key} className={`reshade-effect-row ${effect?.enabled ? '' : 'disabled'}`}>
                    <div className="toggle" onClick={() => updateEffect(meta.key, { enabled: !effect?.enabled })}>
                      <input type="checkbox" checked={effect?.enabled ?? false} readOnly />
                      <span className="toggle-slider" />
                    </div>
                    <div className="reshade-effect-info">
                      <div className="reshade-effect-label">{meta.label}</div>
                      <div className="reshade-effect-hint">{meta.hint}</div>
                    </div>
                    {meta.hasSlider && (
                      <div className="reshade-effect-slider">
                        <input
                          type="range"
                          min={meta.min ?? 0}
                          max={meta.max ?? 1}
                          step={meta.step ?? 0.05}
                          value={effect?.value ?? 0.5}
                          onChange={e => updateEffect(meta.key, { value: parseFloat(e.target.value) })}
                          disabled={!effect?.enabled}
                          className="reshade-slider"
                        />
                        <span className={`reshade-effect-value ${effect?.enabled ? 'active' : ''}`}>
                          {effect?.enabled ? (effect?.value ?? 0).toFixed(2) : 'Off'}
                        </span>
                      </div>
                    )}
                    {!meta.hasSlider && (
                      <div className="reshade-effect-slider">
                        <span className={`reshade-effect-value ${effect?.enabled ? 'active' : ''}`}>
                          {effect?.enabled ? 'On' : 'Off'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {activePreset === 'Custom' && (
              <div className="reshade-custom-hint">
                Slider values differ from all presets — showing as <strong>Custom</strong>.
              </div>
            )}
          </CollapsibleSection>
        </>
      )}
```

- [ ] **Step 3: Verify the UI renders**

Run `npm start`. Navigate to the ReShade tab. Confirm:
- 4 preset rows visible (Clean, Vivid, Cinematic, Screenshot)
- Each row shows name, description, and effect count
- Clicking a preset applies its effects
- "Customize Effects" section is collapsed by default
- Expanding it shows 12 effect toggles/sliders
- Changing a slider switches the active preset to "Custom"
- Setting values back to match a preset snaps the label back

- [ ] **Step 4: Commit**

```bash
git add src/tabs/ReShadeTab.js
git commit -m "feat(reshade): vertical preset selector with collapsible advanced panel"
```

---

### Task 5: Update CSS — Vertical Preset Row Styles

**Files:**
- Modify: `src/tabs/ReShadeTab.css:149-201`

- [ ] **Step 1: Replace the preset grid CSS with vertical list CSS**

Replace the `.reshade-presets-grid` and `.reshade-preset-card` block (lines 149–201) with the new vertical row styles. Keep all other CSS unchanged.

```css
.reshade-presets-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.reshade-preset-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}
.reshade-preset-row:hover {
  border-color: var(--border-bright);
}
.reshade-preset-row.active {
  border-color: transparent;
  background: var(--active-bg);
  box-shadow: var(--active-glow);
}
.reshade-preset-row.active::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 9px;
  padding: 2px;
  background: linear-gradient(135deg, var(--teal), var(--gold));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.reshade-preset-row .reshade-preset-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--gold);
  min-width: 100px;
}

.reshade-preset-row .reshade-preset-desc {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.reshade-preset-count {
  font-size: 12px;
  color: var(--teal);
  white-space: nowrap;
  font-family: var(--font-mono);
}

.reshade-custom-hint {
  margin-top: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-dim);
  background: rgba(200, 168, 78, 0.05);
  border: 1px solid rgba(200, 168, 78, 0.15);
  border-radius: 6px;
}
```

- [ ] **Step 2: Remove stale CSS classes**

Delete the following classes that are no longer used (they belonged to the old card grid layout):
- `.reshade-preset-badge` (lines 182–188 in the original)

These selectors existed only for the old horizontal card preset UI and have no references in the new JSX.

- [ ] **Step 3: Verify styling**

Run `npm start`. Confirm:
- Preset rows are full-width, vertically stacked
- Active preset has the teal/gold gradient border
- Effect count badge is right-aligned in teal mono text
- Hover highlights work
- "Customize Effects" section inherits existing CollapsibleSection styling
- Custom hint shows when effects don't match any preset

- [ ] **Step 4: Commit**

```bash
git add src/tabs/ReShadeTab.css
git commit -m "style(reshade): vertical preset rows and collapsible panel CSS"
```

---

### Task 6: Bundle New Shader Files in GitHub Release

**Files:**
- GitHub release: `CalvinCandie-tech/XI-Launcher/releases/tags/reshade-v1.0`

This task requires manual preparation of the shader files before uploading.

- [ ] **Step 1: Download the new shader .fx files**

The official source is the ReShade shader repository. Download these 7 files from `github.com/crosire/reshade-shaders/tree/master/Shaders`:

- `SMAA.fx`
- `Clarity.fx`
- `Colourfulness.fx`
- `LiftGammaGain.fx`
- `Vignette.fx`
- `FakeHDR.fx`
- `DepthOfField.fx`

Also download `SMAA.hlsl` from the same directory (SMAA.fx depends on it).

- [ ] **Step 2: Create the updated reshade-shaders zip**

The zip should contain a `reshade-shaders/` directory with:
```
reshade-shaders/
  Shaders/
    Bloom.fx          (existing)
    Clarity.fx         (new)
    Colourfulness.fx   (new)
    DepthOfField.fx    (new)
    FakeHDR.fx         (new)
    FilmGrain.fx       (existing)
    LiftGammaGain.fx   (new)
    LumaSharpen.fx     (existing)
    MXAO.fx            (existing)
    SMAA.fx            (new)
    SMAA.hlsl          (new — dependency)
    Vibrance.fx        (existing)
    Vignette.fx        (new)
    ReShade.fxh        (existing)
    ReShadeUI.fxh      (existing)
    qUINT_common.fxh   (existing)
  Textures/
    (empty or existing textures)
```

- [ ] **Step 3: Update the GitHub release**

Delete the old asset from the `reshade-v1.0` release and upload the new zip. The release tag stays the same — the `install-reshade` handler already downloads from `CalvinCandie-tech/XI-Launcher/releases/tags/reshade-v1.0`.

```bash
# Delete old asset and upload new one
gh release delete-asset reshade-v1.0 reshade-shaders.zip --repo CalvinCandie-tech/XI-Launcher --yes
gh release upload reshade-v1.0 reshade-shaders.zip --repo CalvinCandie-tech/XI-Launcher
```

- [ ] **Step 4: Test fresh install**

In the launcher, if ReShade is already installed, manually delete the `reshade-shaders` directory from the FFXI path, then click "Download & Install ReShade" again. Verify that all 16 files (12 .fx + SMAA.hlsl + 3 .fxh) appear in `reshade-shaders/Shaders/`.

- [ ] **Step 5: Commit** (nothing to commit — this is a release asset change, not a code change)

---

### Task 7: End-to-End Verification

- [ ] **Step 1: Fresh install test**

Delete `ReShadePreset.ini`, `ReShade.ini`, and the `reshade-shaders` directory from the xiloader/FFXI directories. Open the launcher, go to ReShade tab, install ReShade. Verify all files are created.

- [ ] **Step 2: Preset tier test**

Click each preset tier (Clean, Vivid, Cinematic, Screenshot) and verify:
- The correct effects are toggled on in the advanced panel
- `ReShadePreset.ini` contains the expected `Techniques=` line
- The active preset label updates correctly

- [ ] **Step 3: Custom effects test**

Expand "Customize Effects", change a slider value. Verify:
- Active preset changes to "Custom"
- Setting the value back to match a preset snaps the label back
- Values persist after navigating away and returning to the tab

- [ ] **Step 4: In-game test**

Launch the game with the "Cinematic" preset. Verify:
- ReShade banner appears in-game
- Visual effects are visible (bloom glow, sharper textures, vignette)
- The ReShade overlay (Home key) shows all enabled techniques

- [ ] **Step 5: Final commit and push**

```bash
git add -A
git commit -m "feat(reshade): complete 4-tier preset system with 12 effects"
git push origin master
```
