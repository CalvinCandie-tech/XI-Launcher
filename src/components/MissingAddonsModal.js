import React, { useState } from 'react';
import Modal from './Modal';
import './MissingAddonsModal.css';

const api = window.xiAPI;

// Resolve the active profile's script path, then mutate its lines and write back.
async function rewriteScript(ashitaPath, activeProfile, mutate) {
  const profile = await api.readProfile(ashitaPath, activeProfile);
  if (!profile?.exists) return false;
  let scriptName = 'default.txt';
  for (const line of profile.content.split('\n')) {
    const m = line.match(/^\s*script\s*=\s*(.+)/i);
    if (m && m[1].trim()) { scriptName = m[1].trim(); break; }
  }
  const scriptPath = ashitaPath + '\\scripts\\' + scriptName;
  const res = await api.readFile(scriptPath);
  const lines = (res?.content || '').split('\n');
  const next = mutate(lines);
  const result = await api.writeFile(scriptPath, next.join('\n'));
  return result?.success !== false;
}

const loadCmd = (item) =>
  (item.type === 'addon' ? '/addon load ' : '/load ') + item.name.toLowerCase();

function MissingAddonsModal({ missing, ashitaPath, activeProfile, catalogue, onClose, onLaunch, useXiloader }) {
  const [items, setItems] = useState(() => missing.map(m => ({ ...m, enabled: true, status: 'idle' })));
  const [fixingAll, setFixingAll] = useState(false);

  const patch = (name, changes) =>
    setItems(prev => prev.map(x => x.name === name ? { ...x, ...changes } : x));

  const entryFor = (item) => catalogue.find(a =>
    (a.installAs || a.name).toLowerCase() === item.name.toLowerCase() ||
    a.name.toLowerCase() === item.name.toLowerCase()
  );

  // Restore/install a single item. Community addons (have a repo) install from
  // GitHub; everything else is restored from the launcher's bundled Ashita.
  const fixItem = async (item) => {
    const entry = entryFor(item);
    patch(item.name, { status: 'fixing' });
    try {
      let result;
      if (entry?.repo) {
        result = await api.installAddon(
          ashitaPath, entry.installAs || entry.name, entry.repo, entry.subdir,
          entry.useRelease, entry.releaseFolder, entry.isPlugin, entry.ashitaRoot
        );
      } else {
        result = await api.restoreBundledItem(item.type, item.name);
      }
      patch(item.name, { status: result?.success ? 'fixed' : 'error', error: result?.error });
      return !!result?.success;
    } catch (e) {
      patch(item.name, { status: 'error', error: String(e) });
      return false;
    }
  };

  const fixAll = async () => {
    setFixingAll(true);
    // Snapshot current names that still need fixing.
    const todo = items.filter(i => i.status !== 'fixed' && i.status !== 'removed' && i.enabled);
    for (const item of todo) {
      // eslint-disable-next-line no-await-in-loop
      await fixItem(item);
    }
    setFixingAll(false);
  };

  // Toggle whether the item is loaded by the script (turn on/off in place).
  const toggleEnabled = async (item) => {
    const turningOff = item.enabled;
    const cmd = loadCmd(item);
    const ok = await rewriteScript(ashitaPath, activeProfile, (lines) => {
      if (turningOff) {
        return lines.filter(l => l.trim().toLowerCase() !== cmd);
      }
      // turning on — re-add after the last load line if not already present
      if (lines.some(l => l.trim().toLowerCase() === cmd)) return lines;
      const lastLoad = lines.reduce((acc, l, i) =>
        /^\/(addon\s+load|load)\s+/i.test(l.trim()) ? i : acc, -1);
      const at = lastLoad >= 0 ? lastLoad + 1 : lines.length;
      const copy = [...lines];
      copy.splice(at, 0, cmd);
      return copy;
    });
    if (ok) patch(item.name, { enabled: !item.enabled });
  };

  const removeItem = async (item) => {
    const cmd = loadCmd(item);
    const ok = await rewriteScript(ashitaPath, activeProfile, (lines) =>
      lines.filter(l => l.trim().toLowerCase() !== cmd));
    if (ok) patch(item.name, { status: 'removed', enabled: false });
  };

  // An item no longer blocks launch once it's fixed, removed, or turned off.
  const isResolved = (i) => i.status === 'fixed' || i.status === 'removed' || !i.enabled;
  const unresolved = items.filter(i => !isResolved(i));
  const allResolved = unresolved.length === 0;
  const anyFixable = items.some(i => !isResolved(i));

  return (
    <Modal onClose={onClose} ariaLabel="Missing addons and plugins" zIndex={1100}>
      <div className="missing-modal panel">
        <div className="missing-modal-header">
          <div>
            <h3 className="cinzel missing-modal-title">Missing Addons / Plugins</h3>
            <p className="missing-modal-subtitle">
              These are turned on in <strong>{activeProfile}</strong> but their files aren’t on disk, so
              they’ll error at startup. <strong>Fix</strong> restores them, the toggle turns one off, or
              remove it from the script entirely.
            </p>
          </div>
          <div className="missing-modal-summary">
            <span className="missing-modal-count">{unresolved.length}</span>
            <span className="missing-modal-count-label">unresolved</span>
          </div>
        </div>

        <div className="missing-modal-toolbar">
          <button className="btn btn-primary btn-sm" onClick={fixAll} disabled={fixingAll || !anyFixable}>
            {fixingAll ? '◌ Fixing…' : '⛭ Try to Fix All'}
          </button>
          <span className="missing-modal-hint">
            Built-in items are restored from the launcher’s bundled Ashita; community addons reinstall from GitHub.
          </span>
        </div>

        <div className="missing-modal-list">
          {items.map(item => {
            const entry = entryFor(item);
            const isCommunity = !!entry?.repo;
            const resolved = isResolved(item);
            return (
              <div key={item.name} className={`missing-item${resolved ? ' resolved' : ''}`}>
                <div className="missing-item-main">
                  <label className="missing-toggle" title={item.enabled ? 'Turn off (won’t load)' : 'Turn on (load at startup)'}>
                    <div className="toggle" onClick={(e) => { e.preventDefault(); toggleEnabled(item); }}>
                      <input type="checkbox" checked={item.enabled} readOnly />
                      <span className="toggle-slider" />
                    </div>
                  </label>
                  <span className="mono missing-item-name">{item.name}</span>
                  <span className={`pill pill-xs ${item.type === 'plugin' ? 'pill-teal' : 'pill-gold'}`}>{item.type}</span>
                  <span className="missing-item-source">{isCommunity ? 'Community (GitHub)' : 'Built-in'}</span>
                </div>

                <div className="missing-item-actions">
                  {item.status === 'fixing' && <span className="missing-status missing-status-teal">Fixing…</span>}
                  {item.status === 'fixed' && <span className="missing-status missing-status-green">✓ Fixed</span>}
                  {item.status === 'removed' && <span className="missing-status missing-status-dim">Removed</span>}
                  {item.status === 'error' && <span className="missing-status missing-status-red" title={item.error}>Failed</span>}
                  {!item.enabled && item.status !== 'removed' && <span className="missing-status missing-status-dim">Turned off</span>}

                  {item.status !== 'fixed' && item.status !== 'removed' && item.status !== 'fixing' && item.enabled && (
                    <>
                      <button className="btn btn-primary btn-xs" onClick={() => fixItem(item)}>
                        {isCommunity ? '↓ Install' : '⟳ Fix'}
                      </button>
                      <button className="btn btn-ghost btn-xs btn-danger-outline" onClick={() => removeItem(item)}>
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="missing-modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => { onClose(); onLaunch(useXiloader); }}
          >
            {allResolved ? 'Launch' : 'Launch Anyway'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default MissingAddonsModal;
