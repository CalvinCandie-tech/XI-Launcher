# ReShade Preset Tier System

## Goal

Replace the current 3 flat presets (Vibrant/Cinematic/Nostalgic) with a 4-tier additive preset system and expand the shader library from 5 to 12 effects. Casual users pick a tier and they're done; power users expand an advanced panel to tweak individual effects.

## Architecture

The system has three layers:

1. **Shader library** — `.fx` files bundled in the GitHub release zip, installed to `reshade-shaders/Shaders/` in the FFXI directory
2. **Preset definitions** — hardcoded in `ReShadeTab.js`, each tier maps to a set of effects with default values
3. **Backend config writer** — `write-reshade-config` in `main.js` translates effect objects into ReShade 6.x `ReShadePreset.ini` format

## Shader Library (12 Effects)

### Existing (already bundled)
| Effect | File | Purpose |
|--------|------|---------|
| LumaSharpen | `LumaSharpen.fx` | Edge sharpening |
| Vibrance | `Vibrance.fx` | Intelligent saturation boost |
| MagicBloom | `Bloom.fx` | Soft glow on bright areas |
| FilmGrain | `FilmGrain.fx` | Subtle cinematic noise |
| MXAO | `MXAO.fx` | Ambient occlusion (depth shadows) |

### New (add to release zip)
| Effect | File | Purpose |
|--------|------|---------|
| SMAA | `SMAA.fx` | Anti-aliasing (edge smoothing) |
| Clarity | `Clarity.fx` | Mid-tone contrast enhancement |
| Colourfulness | `Colourfulness.fx` | Per-channel color saturation |
| LiftGammaGain | `LiftGammaGain.fx` | Color grading (shadows/mids/highlights) |
| Vignette | `Vignette.fx` | Darken screen edges |
| FakeHDR | `FakeHDR.fx` | Tone mapping for highlight/shadow recovery |
| DepthOfField | `DepthOfField.fx` | Background blur (bokeh) |

### Dependencies
All new shaders depend on `ReShade.fxh` and `ReShadeUI.fxh` which are already bundled. `SMAA.fx` requires its own header files (`SMAA.hlsl`) which must be included in the zip. `MXAO.fx` depends on `qUINT_common.fxh` (already bundled).

## Preset Tiers

Each tier is additive — it includes all effects from the previous tier plus new ones.

### Clean
Fixes FFXI's rough edges without changing the look.

| Effect | Technique Name | Value |
|--------|---------------|-------|
| SMAA | `SMAA@SMAA.fx` | (no slider — on/off) |
| LumaSharpen | `LumaSharpen@LumaSharpen.fx` | 0.60 |
| Clarity | `Clarity@Clarity.fx` | 0.30 |

### Vivid
Clean + punchy, saturated colors.

| Effect | Technique Name | Value |
|--------|---------------|-------|
| *(all Clean effects)* | | |
| Vibrance | `Vibrance@Vibrance.fx` | 0.30 |
| Colourfulness | `Colourfulness@Colourfulness.fx` | 0.40 |

### Cinematic
Vivid + full atmospheric post-processing.

| Effect | Technique Name | Value |
|--------|---------------|-------|
| *(all Vivid effects)* | | |
| MagicBloom | `MagicBloom@Bloom.fx` | 0.30 |
| MXAO | `MXAO@MXAO.fx` | (on/off) |
| Vignette | `Vignette@Vignette.fx` | 0.40 |
| FilmGrain | `FilmGrain@FilmGrain.fx` | 0.15 |

### Screenshot
Cinematic + photo-mode effects. Not recommended for gameplay (DOF impacts visibility).

| Effect | Technique Name | Value |
|--------|---------------|-------|
| *(all Cinematic effects)* | | |
| DepthOfField | `DepthOfField@DepthOfField.fx` | (on/off) |
| FakeHDR | `FakeHDR@FakeHDR.fx` | 0.50 |
| LiftGammaGain | `LiftGammaGain@LiftGammaGain.fx` | (on/off) |

## UI Design

### Preset Selector
Vertical list of full-width rows. Each row shows:
- Tier name (gold text, left-aligned)
- Description of what it does (secondary text, center)
- Effect count badge (teal text, right-aligned)

Active tier gets the gradient border treatment (same as current active preset card). Clicking a row applies that tier's effects immediately.

### Advanced Panel
Below the preset selector, a collapsible section labeled "Customize Effects". Collapsed by default.

When expanded, shows all 12 effects as rows with:
- Toggle (on/off)
- Label + hint text
- Slider (for effects that have a continuous value)
- Current value display

Behavior:
- Changing any slider/toggle sets the active preset to "Custom"
- If manual values happen to exactly match a tier definition, the preset snaps back to that tier name
- The "Custom" state persists across tab navigation (written to ReShadePreset.ini like any other config)

### Collapse Animation
CSS `max-height` transition with `overflow: hidden`. Toggle button shows a chevron that rotates on expand.

## Backend Changes

### `write-reshade-config` handler
Currently handles 5 effects. Expand the technique mapping to cover all 12:

```
Effect Key       -> Technique String           -> INI Section
smaa             -> SMAA@SMAA.fx               -> [SMAA@SMAA.fx]
sharpening       -> LumaSharpen@LumaSharpen.fx -> [LumaSharpen@LumaSharpen.fx]
clarity          -> Clarity@Clarity.fx         -> [Clarity@Clarity.fx]
vibrance         -> Vibrance@Vibrance.fx       -> [Vibrance@Vibrance.fx]
colourfulness    -> Colourfulness@Colourfulness.fx -> [Colourfulness@Colourfulness.fx]
bloom            -> MagicBloom@Bloom.fx        -> [MagicBloom@Bloom.fx]
ambientOcclusion -> MXAO@MXAO.fx              -> [MXAO@MXAO.fx]
vignette         -> Vignette@Vignette.fx       -> [Vignette@Vignette.fx]
filmGrain        -> FilmGrain@FilmGrain.fx     -> [FilmGrain@FilmGrain.fx]
depthOfField     -> DepthOfField@DepthOfField  -> [DepthOfField@DepthOfField.fx]
fakeHDR          -> FakeHDR@FakeHDR.fx         -> [FakeHDR@FakeHDR.fx]
liftGammaGain    -> LiftGammaGain@LiftGammaGain.fx -> [LiftGammaGain@LiftGammaGain.fx]
```

Each effect's INI section contains the ReShade uniform variable names and their values. Effects without sliders (SMAA, MXAO, DepthOfField, LiftGammaGain) are either in the Techniques line or not — no per-section values needed.

### `read-reshade-config` handler
Parse the Techniques line to determine which effects are enabled. Parse per-section values for effects that have sliders. Return the full effects object to the frontend.

### No new IPC handlers
The existing `write-reshade-config` and `read-reshade-config` handlers are sufficient. They just need expanded mappings.

## Files Changed

| File | Change |
|------|--------|
| `src/tabs/ReShadeTab.js` | New 4-tier preset definitions, vertical list UI, collapsible advanced panel, expanded EFFECT_META array |
| `src/tabs/ReShadeTab.css` | Styles for vertical preset rows, collapsible section, chevron animation |
| `electron/main.js` | Expanded effect-to-technique mappings in `write-reshade-config` and `read-reshade-config` |
| GitHub release `reshade-v1.0` | Updated zip with 7 new .fx files + SMAA.hlsl |

## Shader File Sourcing

All shader files come from the official ReShade shader repository (github.com/crosire/reshade-shaders). The new .fx files will be added to the existing self-hosted release at `CalvinCandie-tech/XI-Launcher/releases/tags/reshade-v1.0`. The install handler already downloads and extracts from this location — no download logic changes needed.

## What This Does NOT Include

- Before/after preview images (would require screenshots per zone — out of scope)
- Per-zone presets (automatic switching based on area — unnecessary complexity)
- ReShade overlay/GUI integration (the in-game ReShade menu is separate from the launcher)
- Splitting `main.js` into modules (out of scope, tracked separately)
