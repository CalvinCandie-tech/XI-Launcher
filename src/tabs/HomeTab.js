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
  const [multiBoxOpen, setMultiBoxOpen] = useState(false);
  const [multiBoxProfiles, setMultiBoxProfiles] = useState([]);
  const [multiBoxLaunching, setMultiBoxLaunching] = useState(false);
  const [multiBoxLog, setMultiBoxLog] = useState('');
  const [serverStatus, setServerStatus] = useState(null); // { online, latency }

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
    try {
      const result = await api.installAshitaV4(config.ashitaPath);
      if (result.success) {
        const ashita = await api.pathExists(config.ashitaPath + '\\Ashita-cli.exe');
        setStatus(prev => ({ ...prev, ashita }));
      }
    } catch (e) {
      console.error('Failed to install Ashita v4:', e);
    } finally {
      setAshitaInstalling(false);
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
  }, [config.ashitaPath, config.ffxiPath, config.xiloaderPath, config.activeProfile]);

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

  const toggleMultiBoxProfile = (name) => {
    setMultiBoxProfiles(prev =>
      prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]
    );
  };

  const launchMultiBox = async () => {
    if (!api || multiBoxProfiles.length === 0) return;
    setMultiBoxLaunching(true);
    setMultiBoxLog('');
    const logs = [];
    for (const profileName of multiBoxProfiles) {
      // Load per-profile settings if available
      let profileSettings = {};
      try {
        const ps = await api.loadProfileSettings(profileName);
        if (ps) profileSettings = ps;
      } catch (e) { console.error('Failed to load profile settings for', profileName, e); }
      const result = await api.launchGame({
        ashitaPath: config.ashitaPath,
        profileName,
        useXiloader: !!config.useXiloader,
        xiloaderPath: config.xiloaderPath,
        serverName: profileSettings.serverHost || config.serverHost,
        serverPort: profileSettings.serverPort || config.serverPort,
        loginUser: profileSettings.loginUser || config.loginUser,
        loginPass: profileSettings.loginPass || config.loginPass,
        hairpin: config.hairpin
      });
      if (result.error) {
        logs.push(`${profileName}: ${result.error}`);
      } else {
        logs.push(`${profileName}: launched`);
      }
      // Small delay between launches to avoid conflicts
      if (multiBoxProfiles.indexOf(profileName) < multiBoxProfiles.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    setMultiBoxLog(logs.join('\n'));
    setMultiBoxLaunching(false);
  };

  // Server status check
  useEffect(() => {
    if (!api?.checkServerStatus || !config.serverHost) { setServerStatus(null); return; }
    const check = async () => {
      const result = await api.checkServerStatus(config.serverHost, config.serverPort);
      setServerStatus(result);
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [config.serverHost, config.serverPort]);

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
          <div className="home-panel-section home-update-banner" onClick={() => api?.openExternal(updateInfo.releaseUrl)}>
            <div className="home-update-row">
              <span className="home-update-title">Update Available</span>
              <span className="pill pill-gold pill-xs">v{updateInfo.latest}</span>
            </div>
            <p className="home-update-desc">Click to download the latest version</p>
          </div>
        )}

        {/* Profile quick-switch */}
        <div className="home-panel-section">
          <div className="home-panel-label">Game Profile</div>
          {profiles.length > 0 ? (
            <div className="home-profile-switcher" ref={dropdownRef}>
              <div className="home-profile-display" role="button" aria-expanded={profileDropdownOpen} onClick={() => setProfileDropdownOpen(prev => !prev)}>
                <span className="home-profile-name cinzel">{config.activeProfile || 'Select profile'}</span>
                <span className="home-profile-change">{profileDropdownOpen ? '▲' : '▼'}</span>
              </div>
              {profileDropdownOpen && (
                <div className="home-profile-dropdown" role="listbox">
                  {profiles.map(name => (
                    <div
                      key={name}
                      role="option"
                      aria-selected={config.activeProfile === name}
                      className={`home-profile-option ${config.activeProfile === name ? 'active' : ''}`}
                      onClick={() => { updateConfig('activeProfile', name); setProfileDropdownOpen(false); }}
                    >
                      {config.activeProfile === name && <span className="home-profile-active-dot">✦</span>}
                      <span>{name}</span>
                    </div>
                  ))}
                  <div role="option" className="home-profile-option home-profile-manage" onClick={() => { setProfileDropdownOpen(false); onNavigate('profiles'); }}>
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

        {/* Server Status */}
        {config.serverHost && serverStatus && (
          <div className="home-panel-section home-server-status">
            <div className="home-server-status-left">
              <span className={`status-dot ${serverStatus.online ? 'status-dot-online' : 'status-dot-offline'}`} />
              <span className="mono">{config.serverHost}</span>
            </div>
            <span className={`pill ${serverStatus.online ? 'pill-green' : 'pill-red'}`}>
              {serverStatus.online ? `Online (${serverStatus.latency}ms)` : 'Offline'}
            </span>
          </div>
        )}

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
              <button className="btn btn-primary btn-sm home-full-btn" onClick={installAshitaV4}>
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
                className="btn btn-primary btn-sm home-full-btn"
                onClick={createAndActivate}
                disabled={creating || !newName.trim()}
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

        {/* Multi-Box Launch */}
        {setupComplete && profiles.length > 1 && (
          <div className="home-panel-section home-panel-divider">
            <button className="btn btn-ghost btn-sm home-full-btn" onClick={() => setMultiBoxOpen(o => !o)}>
              {multiBoxOpen ? '▾ Multi-Box Launch' : '▸ Multi-Box Launch'}
            </button>
            {multiBoxOpen && (
              <div className="home-multibox-body">
                <p className="home-multibox-hint">
                  Select profiles to launch simultaneously. Each will start in sequence with a 2-second delay.
                </p>
                <div className="home-multibox-list">
                  {profiles.map(name => (
                    <label key={name} className={`home-multibox-label ${multiBoxProfiles.includes(name) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={multiBoxProfiles.includes(name)} onChange={() => toggleMultiBoxProfile(name)} />
                      <span>{name}</span>
                      {config.activeProfile === name && <span className="pill pill-gold pill-xs">Active</span>}
                    </label>
                  ))}
                </div>
                <button
                  className="btn btn-primary btn-sm home-full-btn"
                  disabled={multiBoxLaunching || multiBoxProfiles.length === 0}
                  onClick={launchMultiBox}
                >
                  {multiBoxLaunching ? '◌ Launching...' : `Launch ${multiBoxProfiles.length} Instance${multiBoxProfiles.length !== 1 ? 's' : ''}`}
                </button>
                {multiBoxLog && (
                  <pre className="home-multibox-log">{multiBoxLog}</pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* Launch History */}
        {config.launchHistory && config.launchHistory.length > 0 && (
          <div className="home-panel-section home-panel-divider">
            <div className="home-panel-label home-panel-label-tight">Recent Launches</div>
            <div className="home-history-list">
              {config.launchHistory.slice(0, 5).map((entry, i) => (
                <div key={i} className="home-history-row">
                  <span className="home-history-name">{entry.profile}</span>
                  <span>{new Date(entry.time).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {setupComplete && onShowWizard && (
          <div className="home-panel-section home-panel-divider home-panel-center">
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
