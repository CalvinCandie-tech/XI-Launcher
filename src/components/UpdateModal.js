import React, { useState, useEffect, useRef } from 'react';
import './UpdateModal.css';
import Modal from './Modal';

const api = window.xiAPI;

function UpdateModal({ updates, ashitaPath, onClose }) {
  const [checked, setChecked] = useState(() =>
    updates.reduce((acc, u) => ({ ...acc, [u.name]: true }), {})
  );
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState(null); // { current, total, name }
  const [itemProgress, setItemProgress] = useState({ percent: 0, detail: '' }); // addon being updated
  const [results, setResults] = useState({}); // name -> { status: 'ok'|'fail', error }
  const installingKey = useRef(null); // install-addon reports progress under installAs || name
  // Minimized = a corner card instead of the blocking overlay, so the launcher stays usable
  // while updates run. The update loop lives here, so it keeps going either way.
  const [minimized, setMinimized] = useState(false);
  const minimizedRef = useRef(false);
  minimizedRef.current = minimized;
  const [doneMsg, setDoneMsg] = useState('');

  useEffect(() => {
    if (!api?.onAddonProgress) return;
    return api.onAddonProgress((addonName, percent, detail) => {
      if (addonName !== installingKey.current) return;
      setItemProgress({ percent: Math.max(0, Math.min(100, Math.round(percent))), detail: detail || '' });
    });
  }, []);

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
      installingKey.current = addon.installAs || addon.name;
      setItemProgress({ percent: 0, detail: 'Starting...' });
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
    installingKey.current = null;
    setUpdating(false);
    setProgress(null);
    // Only auto-close when everything we just tried succeeded. In the background, say so
    // first — otherwise the card would just vanish.
    if (list.every(a => outcome[a.name]?.status === 'ok')) {
      if (minimizedRef.current) {
        setDoneMsg(`${list.length} addon${list.length !== 1 ? 's' : ''} updated`);
        setTimeout(onClose, 4000);
      } else {
        onClose();
      }
    }
  };

  const handleUpdate = () => runUpdates(updates.filter(u => checked[u.name]));
  const handleRetryFailed = () => runUpdates(updates.filter(u => results[u.name]?.status === 'fail'));

  // Finished addons plus the current one's share, so the bar moves during each download
  const overallPercent = progress
    ? ((progress.current - 1 + itemProgress.percent / 100) / progress.total) * 100
    : 100;

  if (minimized) {
    return (
      <div className="update-mini" role="status">
        {updating && progress ? (
          <>
            <div className="update-mini-head">
              <span className="update-mini-title">Updating {progress.name}</span>
              <span className="update-mini-count">{progress.current}/{progress.total} · {itemProgress.percent}%</span>
            </div>
            <div className="update-progress-bar">
              <div className="update-progress-fill" style={{ width: `${overallPercent}%` }} />
            </div>
            <div className="update-mini-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setMinimized(false)}>Show details</button>
            </div>
          </>
        ) : doneMsg ? (
          <div className="update-mini-head solo">
            <span className="update-mini-done">✓ {doneMsg}</span>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Dismiss">✕</button>
          </div>
        ) : (
          <div className="update-mini-head solo">
            <span className="update-mini-fail">✕ {failedCount} update{failedCount !== 1 ? 's' : ''} failed</span>
            <button className="btn btn-primary btn-sm" onClick={() => setMinimized(false)}>View</button>
          </div>
        )}
      </div>
    );
  }

  return (
    // While updating, Escape / clicking outside sends it to the background instead of closing.
    <Modal onClose={updating ? () => setMinimized(true) : onClose}>
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
                {updating && progress?.name === u.name && (
                  <span className="update-item-progress" title={itemProgress.detail}>
                    <span className="update-item-progress-bar">
                      <span className="update-item-progress-fill" style={{ width: `${itemProgress.percent}%` }} />
                    </span>
                    <span className="update-item-progress-pct">{itemProgress.percent}%</span>
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {updating && progress ? (
          <div className="update-progress">
            <div className="update-progress-text">
              Updating {progress.name} ({progress.current}/{progress.total})
              {itemProgress.detail && <span className="update-progress-detail"> — {itemProgress.detail}</span>}
            </div>
            <div className="update-progress-bar">
              <div className="update-progress-fill" style={{ width: `${overallPercent}%` }} />
            </div>
            <div className="update-progress-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setMinimized(true)}
                title="Keep updating while you use the rest of the launcher"
              >
                Run in background
              </button>
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
