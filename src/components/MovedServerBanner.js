import React, { useState } from 'react';
import './home/HomePanels.css';

export const moveKey = (m) => `${m.serverId}|${m.fromHost.toLowerCase()}`;

// One row per server whose saved address has moved. Nothing changes until the player clicks Update.
function MovedServerBanner({ moves, onApply, onDismiss }) {
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});
  if (!moves?.length) return null;

  const apply = async (m) => {
    const key = moveKey(m);
    setBusy(key);
    const err = await onApply(m);
    setBusy('');
    setErrors(prev => ({ ...prev, [key]: err || '' }));
  };

  return (
    <>
      {moves.map(m => {
        const key = moveKey(m);
        return (
          <div key={key} className="home-notice" role="status">
            <span className="home-notice-title">Server moved</span>
            <span className="home-notice-text">
              <strong>{m.name}</strong> moved from <span className="mono">{m.fromHost}</span> to{' '}
              <span className="mono">{m.toHost}</span> — used by {m.summary}.
              {errors[key] && <span className="moved-error"> {errors[key]}</span>}
            </span>
            <div className="home-notice-actions">
              <button className="btn btn-primary btn-sm" disabled={busy === key} onClick={() => apply(m)}>
                {busy === key ? 'Updating…' : 'Update'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => onDismiss(m)}>Not now</button>
            </div>
          </div>
        );
      })}
    </>
  );
}

export default MovedServerBanner;
