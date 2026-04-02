# Controller Settings Enhancement Design

**Date:** 2026-04-02
**Scope:** Make the Settings tab's Controller section match Ashita 4's padmode000/padsin000/padguid000 documentation exactly, and add controller GUID selection.

## Context

The current controller settings tab has:
- Incorrect PADSIN_ACTIONS labels for indices 21-26
- Generic "Button 1-15" labels for DirectInput instead of PS-style names
- No support for negative/reversed axis values
- No UI for padguid000 (controller GUID selection)
- Missing Menu/Targeting direction group in sidebar

Reference: https://docs.ashitaxi.com/usage/configurations/

## Changes

### 1. Fix PADSIN_ACTIONS labels

**File:** `src/tabs/SettingsTab.js` lines 193-201

Replace indices 21-26 to match Ashita 4 docs:

| Index | Current (wrong)     | Correct                    |
|-------|---------------------|----------------------------|
| 21    | Camera Zoom In      | Menu Up (targeting)        |
| 22    | Camera Zoom Out     | Menu Down (targeting)      |
| 23    | Camera Reset        | Menu Left (targeting)      |
| 24    | Maintain Target     | Menu Right (targeting)     |
| 25    | Screenshot          | Screenshot (unchanged)     |
| 26    | Prev Party Member   | Toggle Controls            |

### 2. Fix DINPUT_BUTTONS with PS-style labels

**File:** `src/tabs/SettingsTab.js` lines 223-228

Replace generic `Button 1-15` with documented DirectInput names:

| ID | Label              |
|----|--------------------|
| 0  | Square             |
| 1  | Cross (X)          |
| 2  | Circle             |
| 3  | Triangle           |
| 4  | L1                 |
| 5  | R1                 |
| 6  | L2                 |
| 7  | R2                 |
| 8  | Select             |
| 9  | Start              |
| 10 | L3                 |
| 11 | R3                 |
| 12 | PS Button          |
| 13 | Touchpad           |
| 14 | Mute               |

Keep axis entries (32, 33, 34, 37, 40, 41) and None (-1) as-is.

### 3. Add negative/reversed axis values

Add reversed axis entries to both button lists. These are used to invert axis directions for DPad and thumbsticks.

**XINPUT_BUTTONS** — append before the `None` entry:
- `{ id: -32, label: 'L Stick X (Rev)' }`
- `{ id: -33, label: 'L Stick Y (Rev)' }`
- `{ id: -35, label: 'R Stick X (Rev)' }`
- `{ id: -36, label: 'R Stick Y (Rev)' }`

**DINPUT_BUTTONS** — append before the `None` entry:
- `{ id: -32, label: 'L Stick X (Rev)' }`
- `{ id: -33, label: 'L Stick Y (Rev)' }`
- `{ id: -34, label: 'R Stick X (Rev)' }`
- `{ id: -37, label: 'R Stick Y (Rev)' }`
- `{ id: -40, label: 'D-Pad X (Rev)' }`
- `{ id: -41, label: 'D-Pad Y (Rev)' }`

### 4. Add Menu/Targeting direction group

**File:** `src/tabs/SettingsTab.js` line 255-258

Add to `DIR_GROUPS`:
```js
'Menu / Targeting': { indices: [21, 22, 23, 24], labels: ['Up', 'Down', 'Left', 'Right'] }
```

### 5. Update PADSIN_GROUPS

**File:** `src/tabs/SettingsTab.js` lines 204-209

- Remove index 24 from "Combat / Targeting" (it's now "Menu Right (targeting)")
- Add a "Menu / Targeting" group with indices [21, 22, 23, 24]
- Rename "Combat / Targeting" to "Combat" since targeting indices moved out

Updated groups:
```js
const PADSIN_GROUPS = [
  { name: 'Movement', indices: [13, 14, 15, 16, 0] },
  { name: 'Camera', indices: [17, 18, 19, 20, 2, 11] },
  { name: 'Menu / UI', indices: [7, 5, 6, 9, 10, 8, 12] },
  { name: 'Menu / Targeting', indices: [21, 22, 23, 24] },
  { name: 'Combat', indices: [4, 1, 3] },
  { name: 'Other', indices: [25, 26] },
];
```

### 6. padguid000 — Controller GUID selection

#### 6a. IPC handler: `enumerate-game-controllers`

**File:** `electron/main.js`

New IPC handler that runs a PowerShell command to enumerate game controller devices and return their names + instance GUIDs.

PowerShell approach:
```powershell
Get-PnpDevice -Class 'HIDClass' -Status 'OK' | Where-Object { $_.FriendlyName -match 'game|controller|gamepad|joystick|xbox|playstation|dualshock|dualsense' } | Select-Object FriendlyName, InstanceId | ConvertTo-Json
```

The InstanceId is not the same as the DirectInput GUID. For the actual DirectInput device GUID, query the registry under `HKLM\SYSTEM\CurrentControlSet\Control\MediaProperties\PrivateProperties\DirectInput` or use `Get-WmiObject Win32_PnPEntity` to get the device instance path and derive the GUID.

Alternative simpler approach — query DirectInput GUIDs from the registry:
```powershell
Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\MediaProperties\PrivateProperties\DirectInput' -Recurse -ErrorAction SilentlyContinue
```

If this proves unreliable, fall back to just enumerating PnP game devices with their instance IDs, since Ashita may accept either format.

Returns: `Array<{ name: string, guid: string }>`

Timeout: 5 seconds (same as existing registry queries).

#### 6b. Preload bridge

**File:** `electron/preload.js`

Expose `enumerateGameControllers` via the `xiAPI` bridge:
```js
enumerateGameControllers: () => ipcRenderer.invoke('enumerate-game-controllers')
```

#### 6c. UI in SettingsTab

**Location:** Inside the controller panel, below the "Enable Gamepad" toggle, above the gamepad config section. Only visible when gamepad is enabled.

Components:
- **Dropdown** listing detected controllers: `[controller name] — {GUID}`. First option is "Auto-detect (first found)" with empty string value.
- **Manual input** field below the dropdown for pasting a GUID directly. Placeholder text: `{00000000-0000-0000-0000-000000000000}`
- **Refresh** button next to the dropdown to re-scan controllers
- **Clear** button to reset to empty (auto-detect mode)

The dropdown and manual input are synced: selecting from dropdown populates the manual field; editing the manual field deselects the dropdown. The value written to padguid000 is whatever is in the manual field.

State:
- `controllers` — array from enumerate call, loaded on mount + refresh
- Value stored via `setPending('padguid000', guid)` / `getValue('padguid000')` like all other settings

### 7. GAMEPAD_CONFIG_ROWS adjustment

The row `{ label: 'Active Window / Window Options', btnIdx: 8, comboIdx: 24 }` previously mapped combo to "Maintain Target" (index 24). Index 24 is now "Menu Right (targeting)" per the docs. The padsin000 positional mapping hasn't changed — only our label was wrong. The combo column for this row should display whatever button is assigned to padsin index 24, which the user may or may not want as the combo for "Active Window". 

Since the GAMEPAD_CONFIG_ROWS table mirrors the official FFXI gamepad config tool layout (which maps these exact index pairs), keep the row as-is. The index positions in padsin000 are fixed by the game client — we just fix the label.

## Files modified

| File | Change |
|------|--------|
| `src/tabs/SettingsTab.js` | Fix constants, add GUID UI, update groups |
| `src/tabs/SettingsTab.css` | Styles for GUID selector |
| `electron/main.js` | New `enumerate-game-controllers` IPC handler |
| `electron/preload.js` | Expose `enumerateGameControllers` |

## Testing

- Verify padmode000 toggles still produce correct comma-separated output
- Verify padsin000 button mapping uses correct action labels at all 27 indices
- Verify DirectInput mode shows PS-style button names
- Verify reversed axis values appear in dropdowns and save correctly
- Verify Menu/Targeting direction group appears in sidebar and binds work
- Verify GUID dropdown populates with connected controllers (if any)
- Verify manual GUID input writes to padguid000
- Verify clearing GUID resets to empty string
