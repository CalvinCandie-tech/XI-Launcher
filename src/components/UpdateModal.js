import React, { useState } from 'react';
import './UpdateModal.css';
import Modal from './Modal';

const api = window.xiAPI;

function UpdateModal({ updates, ashitaPath, onClose }) {
  const [checked, setChecked] = useState(() =>
    updates.reduce((acc, u) => ({ ...acc, [u.name]: true }), {})
  );
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState(null); // { current, total, name }
  const [results, setResults] = useState({}); // name -> { status: 'ok'|'fail', error }

  const selectedCount = Object.values(checked).filter(Boolean).length;
  const failedCount = Object.values(results).filter(r => r.status === 'fail').length;
  const attempted = Object.keys(results).length > 0;

  const toggleItem = (name) => {
    if (updating) return;
    setChecked(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const runUpdates = async (list) => {
    if (list.length === 0) return;
    setUpdating(true);
    const outcome = {};
    for (let i = 0; i < list.length; i++) {
      const addon = list[i];
      setProgress({ current: i + 1, total: list.length, name: addon.name });
      try {
        const r = await api.installAddon(ashitaPath, addon.installAs || addon.name, addon.repo, addon.subdir, addon.useRelease, addon.releaseFolder, addon.isPlugin, addon.ashitaRoot);
        outcome[addon.name] = r && r.success === false
          ? { status: 'fail', error: r.error || 'Update failed' }
          : { status: 'ok' };
      } catch (e) {
        outcome[addon.name] = { status: 'fail', error: e.message || 'Update failed' };
      }
      setResults(prev => ({ ...prev, ...outcome }));
    }
    setUpdating(false);
    setProgress(null);
    // Only auto-close when everything we just tried succeeded.
    if (list.every(a => outcome[a.name]?.status === 'ok')) onClose();
  };

  const handleUpdate = () => runUpdates(updates.filter(u => checked[u.name]));
  const handleRetryFailed = () => runUpdates(updates.filter(u => results[u.name]?.status === 'fail'));

  return (
    <Modal onClose={updating ? undefined : onClose}>
      <div className="update-dialog">
        <div className="update-header">
          <h3>Addon Updates Available</h3>
          <p>{updates.length} addon{updates.length !== 1 ? 's' : ''} can be updated</p>
        </div>
        <div className="update-list">
          {updates.map(u => {
            const r = results[u.name];
            return (
              <label key={u.name} className="update-item" style={{ cursor: updating ? 'default' : 'pointer' }} title={r?.error || ''}>
                <input
                  type="checkbox"
                  checked={checked[u.name]}
                  onChange={() => toggleItem(u.name)}
                  disabled={updating}
                />
                <span className="update-item-name">{u.name}</span>
                {r?.status === 'ok' && <span className="pill pill-green pill-xs">✓ Updated</span>}
                {r?.status === 'fail' && <span className="pill pill-red pill-xs">✕ Failed</span>}
              </label>
            );
          })}
        </div>
        {updating && progress ? (
          <div className="update-progress">
            <div className="update-progress-text">
              Updating {progress.name} ({progress.current}/{progress.total})
            </div>
            <div className="update-progress-bar">
              <div
                className="update-progress-fill"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : attempted && failedCount > 0 ? (
          <div className="update-footer">
            <div className="update-footer-msg">{failedCount} update{failedCount !== 1 ? 's' : ''} failed. Hover a ✕ for details.</div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
            <button className="btn btn-primary btn-sm" onClick={handleRetryFailed}>
              Retry Failed ({failedCount})
            </button>
          </div>
        ) : (
          <div className="update-footer">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              Skip
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleUpdate}
              disabled={selectedCount === 0}
            >
              Update {selectedCount > 0 ? `(${selectedCount})` : ''}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default UpdateModal;
