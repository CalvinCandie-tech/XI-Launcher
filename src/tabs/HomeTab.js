import React, { useState, useEffect, useRef } from 'react';
import './HomeTab.css';
import { DEFAULT_PROFILE_INI } from '../utils/profileTemplates';

const api = window.xiAPI;

function HomeTab({ config, updateConfig, onNavigate, onLaunch, isLaunching, launchLog, updateInfo, onShowWizard }) {
  const [status, setStatus] = useState({ ashita: false, ffxi: false, xiloader: false, profileCount: 0 });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [profileType, setProfileType] = useState('private');
  const [ashitaInstalling, setAshitaInstalling] = useState(false);
  const [ashitaProgress, setAshitaProgress] = useState({ percent: 0, detail: '' });
  const [profiles, setProfiles] = useState([]);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    if (!profileDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [profileDropdownOpen]);

  useEffect(() => {
    if (!api?.onAshitaInstallProgress) return;
    const unsub = api.onAshitaInstallProgress((percent, detail) => {
      setAshitaProgress({ percent, detail });
    });
    return unsub;
  }, []);

  const installAshitaV4 = async () => {
    if (!api) return;
    setAshitaInstalling(true);
    setAshitaProgress({ percent: 0, detail: 'Starting...' });
    const result = await api.installAshitaV4(config.ashitaPath);
    setAshitaInstalling(false);
    if (result.success) {
      const ashita = await api.pathExists(config.ashitaPath + '\\Ashita-cli.exe');
      setStatus(prev => ({ ...prev, ashita }));
    }
  };

  useEffect(() => {
    if (!api) return;
    const check = async () => {
      const [ashita, ffxi, xiloader, profiles] = await Promise.all([
        api.pathExists(config.ashitaPath + '\\Ashita-cli.exe'),
        api.pathExists(config.ffxiPath),
        api.pathExists((config.xiloaderPath || '') + '\\xiloader.exe'),
        api.listProfiles(config.ashitaPath)
      ]);
      setStatus({ ashita, ffxi, xiloader, profileCount: profiles.length });
      setProfiles(profiles);
    };
    check();
  }, [config.ashitaPath, config.ffxiPath, config.xiloaderPath]);

  const createAndActivate = async () => {
    const name = newName.trim();
    if (!name || !api) return;
    setCreating(true);
    await api.saveProfile(config.ashitaPath, name, DEFAULT_PROFILE_INI(name, profileType, config.serverHost, config.serverPort, config.xiloaderPath, config.hairpin, config.loginUser, config.loginPass));
    updateConfig('activeProfile', name);
    const updatedProfiles = await api.listProfiles(config.ashitaPath);
    setStatus(prev => ({ ...prev, profileCount: updatedProfiles.length }));
    setProfiles(updatedProfiles);
    setCreating(false);
  };

  const setupComplete = status.ashita && status.ffxi && config.activeProfile;
  const stepsComplete = [status.ashita, status.ffxi, !!config.activeProfile].filter(Boolean).length;

  return (
    <div className="home-tab">
      {/* Left side — branding area, video shows through */}
      <div className="home-left">
        <div className="home-branding">
          <img className="home-crystal-img" src="./crystal.svg" alt="Crystal" />
          <h1 className="home-title cinzel">XI Launcher</h1>
          <p className="home-subtitle">Final Fantasy XI</p>
        </div>
      </div>

      {/* Right side — status panel */}
      <div className="home-right">
        {/* Update notification */}
        {updateInfo && (
          <div className="home-panel-section home-update-banner" onClick={() => api?.openExternal(updateInfo.releaseUrl)} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 600 }}>Update Available</span>
              <span className="pill pill-gold" style={{ fontSize: 10 }}>v{updateInfo.latest}</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Click to download the latest version</p>
          </div>
        )}

        {/* Profile quick-switch */}
        <div className="home-panel-section">
          <div className="home-panel-label">Game Profile</div>
          {profiles.length > 0 ? (
            <div className="home-profile-switcher" ref={dropdownRef}>
              <div className="home-profile-display" onClick={() => setProfileDropdownOpen(prev => !prev)}>
                <span className="home-profile-name cinzel">{config.activeProfile || 'Select profile'}</span>
                <span className="home-profile-change">{profileDropdownOpen ? '▲' : '▼'}</span>
              </div>
              {profileDropdownOpen && (
                <div className="home-profile-dropdown">
                  {profiles.map(name => (
                    <div
                      key={name}
                      className={`home-profile-option ${config.activeProfile === name ? 'active' : ''}`}
                      onClick={() => { updateConfig('activeProfile', name); setProfileDropdownOpen(false); }}
                    >
                      {config.activeProfile === name && <span className="home-profile-active-dot">✦</span>}
                      <span>{name}</span>
                    </div>
                  ))}
                  <div className="home-profile-option home-profile-manage" onClick={() => { setProfileDropdownOpen(false); onNavigate('profiles'); }}>
                    ⚙ Manage Profiles...
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="home-profile-none" onClick={() => onNavigate('profiles')}>
              <span>No profiles yet</span>
              <span className="home-step-action">Go to Profiles →</span>
            </div>
          )}
        </div>

        {/* Status section — only show when something needs attention */}
        {(!status.ashita || !status.ffxi || !status.xiloader) && (
          <div className="home-panel-section">
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
                  <span>xiloader</span>
                  <span className="pill pill-red">Not Found</span>
                </div>
              )}
            </div>

            {!status.ashita && !ashitaInstalling && (
              <button className="btn btn-primary btn-sm" onClick={installAshitaV4} style={{ width: '100%', marginTop: 8 }}>
                ↓ Install Ashita v4
              </button>
            )}
            {ashitaInstalling && (
              <div style={{ marginTop: 8 }}>
                <div className="home-progress-bar" style={{ marginBottom: 4 }}>
                  <div className="home-progress-fill" style={{ width: `${ashitaProgress.percent}%` }} />
                </div>
                <span className="home-progress-text">{ashitaProgress.detail}</span>
              </div>
            )}
          </div>
        )}

        {/* Quick create — only shows when no profile exists */}
        {!config.activeProfile && status.ashita && status.ffxi && status.profileCount === 0 && (
          <div className="home-panel-section">
            <div className="home-panel-label">Quick Setup</div>
            <div className="home-quick-create">
              <div className="home-profile-type">
                <button
                  className={`btn btn-sm ${profileType === 'private' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setProfileType('private')}
                >Private Server</button>
                <button
                  className={`btn btn-sm ${profileType === 'retail' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setProfileType('retail')}
                >Retail</button>
              </div>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Profile name..."
                onKeyDown={e => e.key === 'Enter' && createAndActivate()}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={createAndActivate}
                disabled={creating || !newName.trim()}
                style={{ width: '100%' }}
              >
                {creating ? '◌ Creating...' : 'Create Profile'}
              </button>
            </div>
          </div>
        )}

        {/* Setup progress — only when not complete */}
        {!setupComplete && (
          <div className="home-panel-section">
            <div className="home-panel-label">Setup Progress</div>
            <div className="home-progress">
              <div className="home-progress-bar">
                <div className="home-progress-fill" style={{ width: `${(stepsComplete / 3) * 100}%` }} />
              </div>
              <span className="home-progress-text">{stepsComplete} of 3</span>
            </div>
          </div>
        )}

        {/* Start Game */}
        {setupComplete && (
          <div className="home-panel-section home-panel-launch">
            <div className="home-launch-toggle">
              <button
                className={`btn btn-sm ${!config.useXiloader ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => updateConfig('useXiloader', false)}
              >Ashita</button>
              <button
                className={`btn btn-sm ${config.useXiloader ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => updateConfig('useXiloader', true)}
              >xiloader</button>
            </div>
            <button
              className="btn btn-primary home-start-btn"
              disabled={isLaunching || !config.activeProfile}
              onClick={() => onLaunch(!!config.useXiloader)}
            >
              {isLaunching ? '◌ Launching...' : '✦ Start Game'}
            </button>
            {launchLog && (
              <span className={`home-launch-msg ${launchLog.startsWith('Error') ? 'home-launch-error' : 'home-launch-ok'}`}>
                {launchLog}
              </span>
            )}
          </div>
        )}

        {setupComplete && onShowWizard && (
          <div className="home-panel-section" style={{ textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={onShowWizard}>
              Re-run Setup Wizard
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

export default HomeTab;
