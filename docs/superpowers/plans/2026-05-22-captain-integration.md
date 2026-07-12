# Captain Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pinned Captain card to the Addons tab that handles install/update from GitHub releases and provides an informational sub-addon reference modal.

**Architecture:** CAPTAIN_ENTRY is defined as a standalone constant (not added to ADDON_CATALOGUE) so it never appears in the catalogue grid or category filter. The pinned card renders above the bundles section and reuses the existing `handleInstall`/`toggleAddon`/`installing`/`installMsg` state already in AddonsTab. CaptainModal is a self-contained read-only component.

**Tech Stack:** React 18, existing `window.xiAPI` IPC (installAddon, readFile), Modal component, CSS custom properties (var(--gold), var(--border), var(--bg-deep), etc.)

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/components/CaptainModal.js` | Create | Sub-addon reference modal component |
| `src/components/CaptainModal.css` | Create | Modal styles |
| `src/tabs/AddonsTab.js` | Modify | CAPTAIN_ENTRY constant, `showCaptainModal` state, pinned card JSX, catalogueNames update, modal render |
| `src/tabs/AddonsTab.css` | Modify | Pinned card and divider styles |

---

## Task 1: Create CaptainModal component

**Files:**
- Create: `src/components/CaptainModal.js`
- Create: `src/components/CaptainModal.css`

- [ ] **Step 1: Create `src/components/CaptainModal.css`**

```css
.captain-modal {
  width: 700px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.captain-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.captain-modal-title {
  margin: 0;
  font-size: 16px;
  color: var(--gold);
}

.captain-modal-banner {
  background: var(--bg-deepest);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.5;
}

.captain-modal-banner code {
  color: var(--gold);
  font-family: monospace;
}

.captain-modal-section-title {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--text-dim);
  text-transform: uppercase;
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
}

.captain-section-caution {
  color: #e8a020;
}

.captain-modal-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.captain-addon-card {
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.captain-addon-caution {
  border-color: #e8a020;
}

.captain-addon-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.captain-addon-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
}

.captain-risk-badge {
  font-size: 13px;
}

.captain-addon-desc {
  font-size: 12px;
  color: var(--text-dim);
  margin: 0;
  line-height: 1.4;
}
```

- [ ] **Step 2: Create `src/components/CaptainModal.js`**

```jsx
import React from 'react';
import Modal from './Modal';
import './CaptainModal.css';

const SAFE_ADDONS = [
  { name: 'PacketLogger', desc: 'Captures all received/emitted packets by ID and direction. Compatible with PVLV/VieweD.' },
  { name: 'PacketBridge', desc: 'Re-emits all received/emitted packets to a configurable UDP port.' },
  { name: 'CapLog', desc: 'Captures chat log content. Strips auto-translate tags and colors.' },
  { name: 'NPCLogger', desc: 'Captures NPC entity packet data — position, model, level.' },
  { name: 'EventView', desc: 'Captures all event packets including event number, parameters, music, animations.' },
  { name: 'HPTrack', desc: 'Logs HP deducted from defeated enemies. Includes enspells, skillchains, spikes.' },
  { name: 'KITrack', desc: 'Logs obtained/lost key items with position and zone.' },
  { name: 'PathLog', desc: 'Tracks and captures player and NPC/mob movement paths.' },
  { name: 'AttackDelay', desc: 'Summarises melee attack delay from enemy action packets.' },
  { name: 'ShopStock', desc: 'Captures items sold by NPCs. Auto-appraise is opt-in (☠️ when enabled).' },
  { name: 'GuildStock', desc: 'Captures items sold and purchased by Guild Shops.' },
  { name: 'WeatherTrack', desc: 'Captures weather on zone-in and subsequent weather events.' },
  { name: 'OBS', desc: 'Automates OBS recording via WebSocket. Sets source to the current FFXI window.' },
  { name: 'FishMon', desc: 'Tracks fishing catches.' },
];

const CAUTION_ADDONS = [
  { name: 'Widescan', risk: '☠️', desc: 'Emits recurring Widescan packets. Enabled by default. Required by LevelRangeTrack.' },
  { name: 'LevelRangeTrack', risk: '☠️', desc: 'Captures level ranges per unique mob. Requires Widescan.' },
  { name: 'CheckParam', risk: '☠️☠️', desc: 'Logs /checkparam results at a defined interval. Intervals below 1s are high risk.' },
  { name: 'SpawnTrack', risk: '☠️☠️☠️', desc: 'Tracks exact spawn times and spawn points for defeated mobs. Must accept warning in settings.' },
  { name: 'ZoneDump', risk: '☠️☠️☠️', desc: 'Queries server for all static entities in zone. Must accept warning in settings.' },
];

function CaptainModal({ onClose }) {
  return (
    <Modal onClose={onClose} ariaLabel="Captain Sub-addons">
      <div className="captain-modal panel">
        <div className="captain-modal-header">
          <h3 className="cinzel captain-modal-title">👨‍✈️ Captain — Sub-addons</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="captain-modal-banner">
          Sub-addons are configured in-game via <code>/cap</code>. Use this reference to understand what each one does before enabling.
        </div>

        <div className="captain-modal-section-title cinzel">Safe</div>
        <div className="captain-modal-grid">
          {SAFE_ADDONS.map(a => (
            <div key={a.name} className="captain-addon-card">
              <span className="captain-addon-name mono">{a.name}</span>
              <p className="captain-addon-desc">{a.desc}</p>
            </div>
          ))}
        </div>

        <div className="captain-modal-section-title cinzel captain-section-caution">Use with caution</div>
        <div className="captain-modal-grid">
          {CAUTION_ADDONS.map(a => (
            <div key={a.name} className="captain-addon-card captain-addon-caution">
              <div className="captain-addon-card-header">
                <span className="captain-addon-name mono">{a.name}</span>
                <span className="captain-risk-badge">{a.risk}</span>
              </div>
              <p className="captain-addon-desc">{a.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default CaptainModal;
```

- [ ] **Step 3: Verify the file renders without errors**

Open the launcher (`npm start` if not already running), navigate to the Addons tab — no console errors should appear (CaptainModal is not wired yet, just confirming the file is syntactically valid by checking the browser console).

- [ ] **Step 4: Commit**

```bash
git add src/components/CaptainModal.js src/components/CaptainModal.css
git commit -m "feat: add CaptainModal sub-addon reference component"
```

---

## Task 2: Wire the pinned Captain card into AddonsTab

**Files:**
- Modify: `src/tabs/AddonsTab.js`
- Modify: `src/tabs/AddonsTab.css`

### Step 2a — Add CAPTAIN_ENTRY constant and import

- [ ] **Step 1: Add the import for CaptainModal at the top of AddonsTab.js**

Find the existing import block at the top of `src/tabs/AddonsTab.js` (around line 1-5):
```js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from '../components/Modal';
import { CONFLICT_GROUPS } from '../utils/conflicts';
import './AddonsTab.css';
```

Add one line after the Modal import:
```js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from '../components/Modal';
import CaptainModal from '../components/CaptainModal';
import { CONFLICT_GROUPS } from '../utils/conflicts';
import './AddonsTab.css';
```

- [ ] **Step 2: Add CAPTAIN_ENTRY constant after the ADDON_HELP closing brace**

Find the end of the `ADDON_HELP` object (around line 187):
```js
};
```

Insert after it:
```js
const CAPTAIN_ENTRY = {
  name: 'captain',
  description: 'Packet capture & analysis suite for LandSandBoat development',
  repo: 'sruon/captain',
  useRelease: true,
  installAs: 'captain',
};
```

### Step 2b — Add state and update catalogueNames

- [ ] **Step 3: Add `showCaptainModal` state**

Find the state declarations block inside the `AddonsTab` function (around line 191-210). They look like:
```js
const [installedAddons, setInstalledAddons] = useState([]);
...
const [importMsg, setImportMsg] = useState(null);
```

Add after `importMsg`:
```js
const [showCaptainModal, setShowCaptainModal] = useState(false);
```

- [ ] **Step 4: Update `catalogueNames` to include captain**

Find this line (around line 693-695):
```js
const catalogueNames = new Set(
  ADDON_CATALOGUE.map(a => (a.installAs || a.name).toLowerCase())
);
```

Replace it with:
```js
const catalogueNames = new Set(
  [...ADDON_CATALOGUE, CAPTAIN_ENTRY].map(a => (a.installAs || a.name).toLowerCase())
);
```

This prevents `captain` from appearing in the "Custom / Detected" section if it was manually installed.

### Step 2c — Add pinned card JSX

- [ ] **Step 5: Add derived values for captain install/enable state**

Find the line just before `return (` inside the `AddonsTab` function (around line 698):
```js
  return (
```

Insert just above it:
```js
  const isCaptainInstalled = installedAddons.includes('captain');
  const isCaptainEnabled = enabledAddons.includes('captain');

  return (
```

- [ ] **Step 6: Add the pinned card and divider JSX**

Find this block inside the JSX (around line 752-756), which comes right after the toolbar:
```jsx
      {importMsg && (
        <div className={`addon-install-msg ${importMsg.success ? 'success' : 'error'}`} style={{ margin: '0 0 8px' }}>
          {importMsg.text}
        </div>
      )}

      {/* Conflict warnings */}
```

Insert the pinned card block between the importMsg block and the conflict warnings comment:
```jsx
      {importMsg && (
        <div className={`addon-install-msg ${importMsg.success ? 'success' : 'error'}`} style={{ margin: '0 0 8px' }}>
          {importMsg.text}
        </div>
      )}

      {/* Captain — pinned dev tools card */}
      <div className="captain-pinned-card panel">
        <div className="captain-pinned-body">
          <span className="captain-pinned-icon">👨‍✈️</span>
          <div className="captain-pinned-info">
            <span className="captain-pinned-name cinzel">Captain</span>
            <span className="captain-pinned-desc">Packet capture &amp; analysis suite for LandSandBoat development</span>
          </div>
          <div className="captain-pinned-actions">
            {isCaptainInstalled && (
              <>
                <div className="toggle" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleAddon('captain'); }}>
                  <input type="checkbox" checked={isCaptainEnabled} readOnly />
                  <span className="toggle-slider" />
                </div>
                <span className="addon-status-label">{isCaptainEnabled ? 'Enabled' : 'Disabled'}</span>
              </>
            )}
            {installing['captain'] ? (
              <div className="addon-progress">
                <div className="addon-progress-bar">
                  <div className="addon-progress-fill" style={{ width: `${installing['captain'].percent}%` }} />
                </div>
                <span className="addon-progress-text">{installing['captain'].detail}</span>
              </div>
            ) : (
              <button
                className={`btn btn-sm ${isCaptainInstalled ? 'btn-ghost' : 'btn-primary'}`}
                onClick={() => handleInstall(CAPTAIN_ENTRY)}
              >
                {isCaptainInstalled ? '↻ Update' : '↓ Install'}
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm captain-gear-btn"
              onClick={() => setShowCaptainModal(true)}
              title="Sub-addon reference"
            >
              ⚙
            </button>
          </div>
        </div>
        {installMsg?.addonName === 'captain' && (
          <div className={`addon-install-msg ${installMsg.success ? 'success' : 'error'}`}>
            {installMsg.text}
          </div>
        )}
      </div>
      <div className="captain-pinned-divider" />

      {/* Conflict warnings */}
```

- [ ] **Step 7: Add CaptainModal render alongside the other modals**

Find the block of modal renders (around line 847 — the `pendingBundle` modal block):
```jsx
      {pendingBundle && (
        <Modal onClose={() => setPendingBundle(null)} ariaLabel="Bundle Confirmation">
```

Insert the CaptainModal right before it:
```jsx
      {showCaptainModal && (
        <CaptainModal onClose={() => setShowCaptainModal(false)} />
      )}

      {pendingBundle && (
        <Modal onClose={() => setPendingBundle(null)} ariaLabel="Bundle Confirmation">
```

### Step 2d — Add CSS

- [ ] **Step 8: Add pinned card styles to `src/tabs/AddonsTab.css`**

Append to the end of `src/tabs/AddonsTab.css`:
```css
/* Captain pinned card */
.captain-pinned-card {
  margin-bottom: 0;
}

.captain-pinned-body {
  display: flex;
  align-items: center;
  gap: 12px;
}

.captain-pinned-icon {
  font-size: 22px;
  flex-shrink: 0;
}

.captain-pinned-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.captain-pinned-name {
  font-size: 14px;
  color: var(--gold);
  font-weight: 600;
}

.captain-pinned-desc {
  font-size: 12px;
  color: var(--text-dim);
}

.captain-pinned-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.captain-gear-btn {
  font-size: 14px;
}

.captain-pinned-divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
  opacity: 0.4;
}
```

### Step 2e — Verify in the running app

- [ ] **Step 9: Check the Addons tab renders correctly**

With the launcher running (`npm start`), open the Addons tab and verify:
- Captain pinned card appears at the top of the content area below the toolbar
- Card shows: 👨‍✈️ icon, "Captain" in gold, description text, "↓ Install" button (or toggle if already installed), ⚙ gear button
- A thin divider line separates it from the bundles/catalogue below
- No console errors

- [ ] **Step 10: Check the gear modal opens**

Click the ⚙ button on the Captain card and verify:
- Modal opens with title "👨‍✈️ Captain — Sub-addons"
- Info banner is visible with `/cap` in gold monospace
- "Safe" section shows 14 addon cards in a two-column grid
- "Use with caution" section shows 5 addon cards with amber border and ☠️ risk badges
- Pressing Escape or clicking outside closes the modal
- No console errors

- [ ] **Step 11: Check install flow (if Ashita path is configured)**

Click "↓ Install" on the Captain card and verify:
- Progress bar appears with percentage updates
- On completion, a success message appears under the card
- The toggle (Enabled/Disabled) appears, replacing the "Install to enable" state
- `<ashita>/addons/captain/` folder exists with captain files

- [ ] **Step 12: Check enable/disable toggle**

With captain installed, click the toggle and verify:
- Toggle state flips
- The Default.txt script file gains/loses the line `/addon load captain`
- captain does NOT appear in the "Custom / Detected" section at the bottom of the Addons tab

- [ ] **Step 13: Commit**

```bash
git add src/tabs/AddonsTab.js src/tabs/AddonsTab.css
git commit -m "feat: add Captain pinned card to Addons tab with install and sub-addon modal"
```
