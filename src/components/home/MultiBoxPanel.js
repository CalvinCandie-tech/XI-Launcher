import React from 'react';
import './HomePanels.css';

// Multi-box drop-down: tick profiles and launch them one after another.
function MultiBoxPanel({ profiles, activeProfile, selected, onToggle, launching, log, onLaunch }) {
  return (
    <div>
      <p className="home-multibox-hint">
        Select profiles to launch simultaneously. Each will start in sequence with a 2-second delay.
      </p>
      <div className="home-multibox-list">
        {profiles.map(name => (
          <label key={name} className={`home-multibox-label ${selected.includes(name) ? 'selected' : ''}`}>
            <input type="checkbox" checked={selected.includes(name)} onChange={() => onToggle(name)} />
            <span>{name}</span>
            {activeProfile === name && <span className="pill pill-gold pill-xs">Active</span>}
          </label>
        ))}
      </div>
      <button
        className="btn btn-primary btn-sm home-full-btn"
        disabled={launching || selected.length === 0}
        onClick={onLaunch}
      >
        {launching ? '◌ Launching...' : `Launch ${selected.length} Instance${selected.length !== 1 ? 's' : ''}`}
      </button>
      {log && (
        <pre className="home-multibox-log">{log}</pre>
      )}
    </div>
  );
}

export default MultiBoxPanel;
