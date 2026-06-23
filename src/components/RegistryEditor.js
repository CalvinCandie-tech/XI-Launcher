import React, { useState } from 'react';
import Modal from './Modal';
import { getSection, setSectionValues } from '../utils/iniParser';
import './RegistryEditor.css';

// Friendly definitions for the [ffxi.registry] section (Ashita v4).
// A value of "-1" means "use whatever is in the real game registry" (Default).
// type: 'select' renders a dropdown (options include the -1 Default entry automatically);
//       'number'/'text' render an input where an empty field maps to -1 (Default).
// Unknown/unused keys and the pad* gamepad arrays are intentionally omitted — those
// stay in the raw ini and are left untouched on save.
const SEL = (...pairs) => pairs.map(([v, label]) => ({ v: String(v), label }));

const REGISTRY_GROUPS = [
  {
    title: 'Display & Resolution',
    fields: [
      { key: '0034', label: 'Window mode', rec: '3', type: 'select',
        options: SEL([0, 'Fullscreen'], [1, 'Windowed'], [2, 'Fullscreen Windowed'], [3, 'Borderless Windowed']),
        desc: 'How the game window is presented. Note: a client bug swaps the labels of "Fullscreen Windowed" and "Borderless Windowed".' },
      { key: '0001', label: 'Window width', type: 'number', desc: 'Game window resolution width (pixels).' },
      { key: '0002', label: 'Window height', type: 'number', desc: 'Game window resolution height (pixels).' },
      { key: '0003', label: 'Background width', rec: '4096', type: 'number', desc: 'Internal render (background) width. Higher = sharper world, more GPU. Best divisible by 2.' },
      { key: '0004', label: 'Background height', rec: '4096', type: 'number', desc: 'Internal render (background) height. Best divisible by 2.' },
      { key: '0037', label: 'Menu width', type: 'number', desc: 'Menu/UI resolution width. Usually set to match the window width.' },
      { key: '0038', label: 'Menu height', type: 'number', desc: 'Menu/UI resolution height. Usually set to match the window height.' },
      { key: '0044', label: 'Maintain aspect ratio', type: 'select', options: SEL([0, 'Off'], [1, 'On']),
        desc: 'Keep the correct aspect ratio when the window is resized.' },
      { key: '0040', label: 'Graphics stabilization', rec: '0', type: 'select', options: SEL([0, 'Off'], [1, 'On']),
        desc: 'Client graphics stabilization. Usually left Off.' },
    ],
  },
  {
    title: 'Graphics Quality',
    fields: [
      { key: '0000', label: 'Mip mapping', rec: '6', type: 'select',
        options: SEL([0, 'Off'], [1, 'On — Lowest'], [2, 'On — 2'], [3, 'On — 3'], [4, 'On — 4'], [5, 'On — 5'], [6, 'On — Best']),
        desc: 'Texture detail scaling with distance. 6 = best quality.' },
      { key: '0017', label: 'Bump mapping', rec: '1', type: 'select', options: SEL([0, 'Off'], [1, 'On']),
        desc: 'Surface bump-mapping detail.' },
      { key: '0018', label: 'Texture compression', rec: '2', type: 'select', options: SEL([0, 'High'], [1, 'Low'], [2, 'Uncompressed']),
        desc: 'Texture compression level. Uncompressed = best quality.' },
      { key: '0019', label: 'Texture compression (2)', rec: '1', type: 'select', options: SEL([0, 'Compressed'], [1, 'Uncompressed']),
        desc: 'Secondary texture compression toggle. Uncompressed = best quality.' },
      { key: '0011', label: 'Environment animations', type: 'select', options: SEL([0, 'Off'], [1, 'Normal'], [2, 'Smooth']),
        desc: 'Animated environment effects (water, etc.).' },
      { key: '0036', label: 'Font compression', rec: '2', type: 'select', options: SEL([0, 'Compressed'], [1, 'Uncompressed'], [2, 'High Quality']),
        desc: 'On-screen font rendering quality.' },
      { key: '0028', label: 'Gamma base', type: 'number', desc: 'Brightness/gamma. 0 = game default (float value).' },
    ],
  },
  {
    title: 'Sound',
    fields: [
      { key: '0007', label: 'Sound enabled', type: 'select', options: SEL([0, 'Disabled'], [1, 'Enabled']),
        desc: 'Master toggle for in-game sound.' },
      { key: '0035', label: 'Sound in background', rec: '1', type: 'select', options: SEL([0, 'Off'], [1, 'On']),
        desc: 'Keep playing sound while the game window is not focused.' },
      { key: '0029', label: 'Max sounds', rec: '20', type: 'number', desc: 'Maximum simultaneous sounds. Range 12 (lowest) to 20 (highest).' },
    ],
  },
  {
    title: 'Input & Misc',
    fields: [
      { key: '0021', label: 'Hardware mouse', rec: '1', type: 'select', options: SEL([0, 'Off'], [1, 'On']),
        desc: 'Use the OS hardware cursor (smoother) instead of the software one.' },
      { key: '0022', label: 'Show opening movie', rec: '0', type: 'select', options: SEL([0, 'Off'], [1, 'On']),
        desc: 'Play the intro movie on launch.' },
      { key: '0023', label: 'Simplified char creation', rec: '0', type: 'select', options: SEL([0, 'Off'], [1, 'On']),
        desc: 'Use simplified visuals during character creation.' },
      { key: '0039', label: 'IME mode', type: 'select', options: SEL([0, 'v1'], [1, 'v2']),
        desc: 'Japanese input method editor version.' },
      { key: '0030', label: '3D LCD mode', type: 'select', options: SEL([0, 'Disabled'], [1, 'Enabled']),
        desc: 'Stereoscopic 3D output. Leave disabled unless you use 3D hardware.' },
      { key: '0041', label: 'Beta UI', type: 'select', options: SEL([0, 'Disabled'], [1, 'Enabled']),
        desc: 'Experimental UI. Not available on the retail client.' },
      { key: '0043', label: 'Screenshot at screen res', type: 'select', options: SEL([0, 'Off'], [1, 'On']),
        desc: 'Save the game’s built-in screenshots at full screen resolution. (Ashita’s Screenshots addon ignores this.)' },
      { key: '0042', label: 'Screenshot path', type: 'text',
        desc: 'Folder for the game’s built-in screenshots. (Ashita’s Screenshots addon uses its own path.)' },
    ],
  },
];

const DEFAULT = '-1';

function RegistryEditor({ iniContent, onSave, onClose }) {
  const original = getSection(iniContent, 'ffxi.registry') || {};
  const [values, setValues] = useState(() => {
    const init = {};
    for (const group of REGISTRY_GROUPS) {
      for (const f of group.fields) {
        init[f.key] = original[f.key] !== undefined ? String(original[f.key]) : DEFAULT;
      }
    }
    return init;
  });
  const [saving, setSaving] = useState(false);

  const setVal = (key, v) => setValues(prev => ({ ...prev, [key]: v }));

  const applyRecommended = () => {
    setValues(prev => {
      const next = { ...prev };
      for (const group of REGISTRY_GROUPS) {
        for (const f of group.fields) {
          if (f.rec !== undefined) next[f.key] = f.rec;
        }
      }
      return next;
    });
  };

  const handleSave = async () => {
    // Only write keys that actually changed. A value of -1 that wasn't in the file
    // before is skipped (no point writing a "default" line); -1 on an existing key
    // is written so the user can reset a setting back to the game default.
    const updates = {};
    for (const group of REGISTRY_GROUPS) {
      for (const f of group.fields) {
        const nv = (values[f.key] ?? DEFAULT).trim() === '' ? DEFAULT : values[f.key];
        const ov = original[f.key];
        if (String(nv) === String(ov ?? '')) continue;          // unchanged
        if (nv === DEFAULT && ov === undefined) continue;        // new -1, skip
        updates[f.key] = nv;
      }
    }
    if (Object.keys(updates).length === 0) { onClose(); return; }
    setSaving(true);
    const newContent = setSectionValues(iniContent, 'ffxi.registry', updates);
    await onSave(newContent);
    setSaving(false);
  };

  return (
    <Modal onClose={onClose} ariaLabel="FFXI Graphics & Client Settings" zIndex={1100}>
      <div className="registry-editor panel">
        <div className="registry-editor-header">
          <div>
            <h3 className="cinzel registry-editor-title">FFXI Graphics &amp; Client Settings</h3>
            <p className="registry-editor-subtitle">
              These override the game’s registry settings for this profile. Leave a field on
              <em> Default</em> (or blank) to use whatever the game already has.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="registry-editor-body">
          {REGISTRY_GROUPS.map(group => (
            <div key={group.title} className="registry-group">
              <div className="registry-group-title">{group.title}</div>
              <div className="registry-fields">
                {group.fields.map(f => {
                  const val = values[f.key] ?? DEFAULT;
                  const isDefault = val === DEFAULT;
                  return (
                    <div key={f.key} className="registry-field">
                      <div className="registry-field-label">
                        <span className="registry-field-name">{f.label}</span>
                        {f.rec !== undefined && (
                          <span className="registry-field-rec" title="Recommended value">rec</span>
                        )}
                      </div>
                      {f.type === 'select' ? (
                        <select
                          className="registry-field-input"
                          value={val}
                          onChange={e => setVal(f.key, e.target.value)}
                        >
                          <option value={DEFAULT}>Default (game registry)</option>
                          {f.options.map(o => (
                            <option key={o.v} value={o.v}>
                              {o.label}{f.rec === o.v ? ' — recommended' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="registry-field-input"
                          type={f.type === 'number' ? 'number' : 'text'}
                          value={isDefault ? '' : val}
                          placeholder={f.rec !== undefined ? `Default (rec: ${f.rec})` : 'Default'}
                          onChange={e => setVal(f.key, e.target.value === '' ? DEFAULT : e.target.value)}
                        />
                      )}
                      <p className="registry-field-desc">{f.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="registry-editor-footer">
          <button className="btn btn-ghost btn-sm" onClick={applyRecommended}>Apply recommended</button>
          <div className="registry-editor-footer-right">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save to profile'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default RegistryEditor;
