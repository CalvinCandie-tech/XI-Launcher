import React from 'react';
import './HomePanels.css';

const api = window.xiAPI;

// FFXI Files Updater drop-down. All of its state lives in HomeTab, so closing the drop-down
// never stops a download (the tile keeps showing the live %).
function FilesUpdaterPanel({ activeProfile, mirrorUrl, onMirrorUrlChange, updating, percent, detail, status, target, onRun }) {
  return (
    <div>
      <div className="form-field home-ffxiupd-field">
        <div className="form-field-label">
          <span className="form-field-name">Mirror URL</span>
          {activeProfile && <span className="home-ffxiupd-for">for {activeProfile}</span>}
        </div>
        <input
          type="text"
          className="form-input"
          value={mirrorUrl}
          placeholder="Custom mirror link (optional, https)"
          onChange={e => onMirrorUrlChange(e.target.value)}
          disabled={updating}
          spellCheck={false}
        />
        <p className="form-field-desc">
          Downloads pre-patched FFXI files into this profile's game files (the folder below). Leave blank for the default{' '}
          <a href="#vana-portal" className="home-ffxiupd-link" onClick={e => { e.preventDefault(); api?.openExternal?.('https://vana-portal.com/downloads/updates'); }}>Vana Portal</a>{' '}
          mirror. Close FFXI before running.
        </p>
        {target && (
          <p className="form-field-desc home-ffxiupd-target">
            Downloads into: <span className="mono">{target}</span>
          </p>
        )}
      </div>
      {updating && (
        <div className="home-install-progress">
          <div className="home-progress-bar home-progress-bar-tight">
            <div className="home-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="home-progress-text">{detail}</span>
        </div>
      )}
      {status && !updating && (
        <div className={`home-ffxiupd-status ${status.ok ? 'ok' : 'err'}`}>
          {status.ok ? '✔ ' : '✖ '}{status.msg}
        </div>
      )}
      <button
        className="btn btn-primary btn-sm home-full-btn"
        onClick={onRun}
        disabled={updating}
      >
        {updating ? `◌ Updating (${percent}%)` : '⚡ Run FFXI Files Updater'}
      </button>
      <div className="home-contrib-credit">
        contributed by Demetrie
      </div>
    </div>
  );
}

export default FilesUpdaterPanel;
