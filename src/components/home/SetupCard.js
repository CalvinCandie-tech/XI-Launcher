import React from 'react';
import './HomePanels.css';

// Takes Start Game's place (and hides the top bar) until setup is complete: progress, what's
// missing (with Install Ashita v4), quick-create for a first profile, and the profile picker.
function SetupCard({
  status, stepsComplete, activeProfile, profiles, profileSwitcher, onNavigate,
  ashitaInstalling, ashitaProgress, ashitaError, onInstallAshita,
  profileType, onProfileTypeChange, newName, onNewNameChange, creating, onCreate,
}) {
  const showQuickCreate = !activeProfile && status.ashita && status.ffxi && status.profileCount === 0;
  return (
    <div className="home-setup-card">
      <div className="home-setup-section">
        <div className="home-panel-label">Setup Progress</div>
        <div className="home-progress">
          <div className="home-progress-bar">
            <div className="home-progress-fill" style={{ width: `${(stepsComplete / 3) * 100}%` }} />
          </div>
          <span className="home-progress-text">{stepsComplete} of 3</span>
        </div>
      </div>

      {(!status.ashita || !status.ffxi || !status.xiloader) && (
        <div className="home-setup-section">
          <div className="home-panel-label">Game Status</div>
          <div className="home-status-rows">
            {!status.ashita && (
              <div className="home-status-row">
                <span>Ashita v4</span>
                <span className="pill pill-red">Not Found</span>
              </div>
            )}
            {!status.ffxi && (
              <div className="home-status-row">
                <span>FFXI Client</span>
                <span className="pill pill-red">Not Set</span>
              </div>
            )}
            {!status.xiloader && (
              <div className="home-status-row">
                <span>{status.loaderName || 'xiloader'}</span>
                <span className="pill pill-red">Not Installed</span>
              </div>
            )}
          </div>

          {!status.ashita && !ashitaInstalling && ashitaError && (
            <div className="home-ffxiupd-status err">✖ {ashitaError}</div>
          )}
          {!status.ashita && !ashitaInstalling && (
            <button className="btn btn-primary btn-sm home-full-btn" onClick={onInstallAshita}>
              ↓ Install Ashita v4
            </button>
          )}
          {ashitaInstalling && (
            <div className="home-install-progress">
              <div className="home-progress-bar home-progress-bar-tight">
                <div className="home-progress-fill" style={{ width: `${ashitaProgress.percent}%` }} />
              </div>
              <span className="home-progress-text">{ashitaProgress.detail}</span>
            </div>
          )}
        </div>
      )}

      {showQuickCreate && (
        <div className="home-setup-section">
          <div className="home-panel-label">Quick Setup</div>
          <div className="home-quick-create">
            <select
              className="form-select home-full-input"
              value={profileType}
              onChange={e => onProfileTypeChange(e.target.value)}
            >
              <option value="private">Private server</option>
              <option value="retail">Retail (PlayOnline)</option>
            </select>
            <input
              type="text"
              value={newName}
              onChange={e => onNewNameChange(e.target.value)}
              placeholder="Profile name..."
              onKeyDown={e => e.key === 'Enter' && onCreate()}
            />
            <button
              className="btn btn-primary btn-sm home-full-btn"
              onClick={onCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? '◌ Creating...' : 'Create Profile'}
            </button>
          </div>
        </div>
      )}

      <div className="home-setup-section">
        <div className="home-panel-label">Game Profile</div>
        {profiles.length > 0 ? profileSwitcher : (
          <div className="home-profile-none" onClick={() => onNavigate('profiles')}>
            <span>No profiles yet</span>
            <span className="home-step-action">Go to Profiles →</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default SetupCard;
