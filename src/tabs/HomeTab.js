import React, { useState, useEffect, useRef } from 'react';
import './HomeTab.css';
import { DEFAULT_PROFILE_INI } from '../utils/profileTemplates';

const api = window.xiAPI;

function HomeTab({ config, updateConfig, onNavigate, onLaunch, isLaunching, launchLog, updateInfo, onSkipVersion, onDismissUpdate, onShowWizard }) {
  const [status, setStatus] = useState({ ashita: false, ffxi: false, xiloader: false, profileCount: 0 });
  const [startupWarnings, setStartupWarnings] = useState([]);
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
  const [serverPickerOpen, setServerPickerOpen] = useState(false);
  const serverPickerRef = useRef(null);
  const [updateDlStatus, setUpdateDlStatus] = useState(''); // '' | 'downloading' | 'installing' | 'error'
  const [updateDlProgress, setUpdateDlProgress] = useState({ percent: 0, detail: '' });
  const [updateDlError, setUpdateDlError] = useState('');

  // ── 📥 FFXI Files Updater (Vana-Time mirror or custom URL) ──
  const [ffxiDlPercent, setFfxiDlPercent] = useState(0);
  const [ffxiDlDetail, setFfxiDlDetail] = useState('');
  const [ffxiUpdating, setFfxiUpdating] = useState(false);
  const [ffxiMirrorUrl, setFfxiMirrorUrl] = useState('');
  const [ffxiUpdaterStatus, setFfxiUpdaterStatus] = useState(null); // { ok: bool, msg: string }

  useEffect(() => {
    if (!api?.storeGet) return;
    api.storeGet('ffxiUpdaterUrl').then(v => setFfxiMirrorUrl(v || ''));
  }, []);

  useEffect(() => {
    if (!api?.onFullClientProgress) return;
    return api.onFullClientProgress((pct, detail) => {
      setFfxiDlPercent(pct);
      setFfxiDlDetail(detail);
    });
  }, []);

  const runFfxiUpdater = async () => {
    if (!api?.downloadFullClient) return;
    setFfxiUpdaterStatus(null);
    setFfxiUpdating(true);
    setFfxiDlDetail('Starting FFXI files update...');
    if (api.storeSet) await api.storeSet('ffxiUpdaterUrl', ffxiMirrorUrl);
    const result = await api.downloadFullClient(ffxiMirrorUrl);
    setFfxiUpdating(false);
    if (result.success) {
      setFfxiUpdaterStatus({ ok: true, msg: result.message || 'FFXI files successfully updated!' });
    } else {
      setFfxiUpdaterStatus({ ok: false, msg: result.error });
    }
  };

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

  // Close server picker when clicking outside
  useEffect(() => {
    if (!serverPickerOpen) return;
    const handleClickOutside = (e) => {
      if (serverPickerRef.current && !serverPickerRef.current.contains(e.target)) {
        setServerPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [serverPickerOpen]);

  useEffect(() => {
    if (!api?.getStartupWarnings) return;
    api.getStartupWarnings().then(w => { if (w?.length) setStartupWarnings(w); }).catch(() => {});
    // The Mark-of-the-Web unblock now runs in the background and may surface a
    // warning after this tab has mounted — listen for late warnings too.
    if (!api.onStartupWarning) return;
    return api.onStartupWarning((msg) => {
      setStartupWarnings(prev => prev.includes(msg) ? prev : [...prev, msg]);
    });
  }, []);

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
    await api.saveProfile(config.ashitaPath, name, DEFAULT_PROFILE_INI(name, profileType, config.serverHost, config.serverPort, config.xiloaderPath, config.hairpin, config.loginUser, config.loginPass, config.ffxiPath));
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
        xiloaderPath: profileSettings.xiloaderPath || config.xiloaderPath,
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

  // Server status — checked on demand only. Auto-polling was removed because
  // probing the LSB login port with a TCP connect+destroy shows up in the
  // connect server log as "stream truncated / Failed to handshake" for every
  // poll (auth_session sees EOF mid-handshake).
  const [checkingServer, setCheckingServer] = useState(false);
  const checkServer = async () => {
    if (!api?.checkServerStatus || !config.serverHost || checkingServer) return;
    setCheckingServer(true);
    try {
      const result = await api.checkServerStatus(config.serverHost, config.serverPort);
      setServerStatus(result);
    } catch (e) {
      setServerStatus({ online: false, error: e.message || 'Check failed' });
    } finally {
      setCheckingServer(false);
    }
  };
  // Clear stale status when the target server changes
  useEffect(() => { setServerStatus(null); }, [config.serverHost, config.serverPort]);

  // Listen for update download progress
  useEffect(() => {
    if (!api?.onUpdateProgress) return;
    const unsub = api.onUpdateProgress((percent, detail) => {
      setUpdateDlProgress({ percent, detail });
      if (percent >= 85) setUpdateDlStatus('installing');
    });
    return unsub;
  }, []);

  const handleDownloadUpdate = async () => {
    if (!api?.downloadAndInstallUpdate || !updateInfo?.downloadUrl) return;
    setUpdateDlStatus('downloading');
    setUpdateDlError('');
    setUpdateDlProgress({ percent: 0, detail: 'Starting...' });
    try {
      const result = await api.downloadAndInstallUpdate(updateInfo.downloadUrl);
      if (!result.success) {
        setUpdateDlStatus('error');
        setUpdateDlError(result.error || 'Update failed');
      }
    } catch (e) {
      setUpdateDlStatus('error');
      setUpdateDlError(e.message || 'Update failed');
    }
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
        {/* Startup warnings */}
        {startupWarnings.length > 0 && (
          <div className="home-panel-section home-warning-banner">
            {startupWarnings.map((w, i) => (
              <div key={i} className="home-warning-text">{w}</div>
            ))}
            <button className="home-update-dismiss" onClick={() => setStartupWarnings([])} aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* Update notification */}
        {updateInfo && updateDlStatus === '' && (
          <div className="home-panel-section home-update-banner">
            <div className="home-update-row">
              <span className="home-update-title">Update Available</span>
              <div className="home-update-row-right">
                <span className="pill pill-gold pill-xs">v{updateInfo.latest}</span>
                <button className="home-update-dismiss" onClick={() => { setUpdateDlStatus(''); setUpdateDlProgress({ percent: 0, detail: '' }); setUpdateDlError(''); onDismissUpdate(); }} aria-label="Dismiss">✕</button>
              </div>
            </div>
            {updateInfo.releaseNotes && (
              <p className="home-update-notes">{updateInfo.releaseNotes.split('\n')[0]}</p>
            )}
            <div className="home-update-actions">
              <button className="btn btn-primary btn-sm" onClick={handleDownloadUpdate}>
                Download & Install
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => onSkipVersion(updateInfo.latest)}>
                Skip this version
              </button>
            </div>
          </div>
        )}

        {/* Update downloading */}
        {updateInfo && (updateDlStatus === 'downloading' || updateDlStatus === 'installing') && (
          <div className="home-panel-section home-update-banner">
            <div className="home-update-row">
              <span className="home-update-title">
                {updateDlStatus === 'installing' ? 'Installing...' : 'Downloading update...'}
              </span>
              <span className="pill pill-gold pill-xs">v{updateInfo.latest}</span>
            </div>
            <div className="home-update-progress">
              <div className="home-progress-bar">
                <div className="home-progress-fill" style={{ width: `${updateDlProgress.percent}%` }} />
              </div>
              <span className="home-progress-text">{updateDlProgress.percent}%</span>
            </div>
            <p className="home-update-detail">{updateDlProgress.detail}</p>
          </div>
        )}

        {/* Update error */}
        {updateInfo && updateDlStatus === 'error' && (
          <div className="home-panel-section home-update-banner home-update-error">
            <div className="home-update-row">
              <span className="home-update-title">Update Failed</span>
              <button className="home-update-dismiss" onClick={() => { setUpdateDlStatus(''); setUpdateDlError(''); }} aria-label="Dismiss">✕</button>
            </div>
            <p className="home-update-notes">{updateDlError}</p>
            <button className="btn btn-primary btn-sm" onClick={handleDownloadUpdate}>
              Retry
            </button>
          </div>
        )}

        {/* Profile quick-switch */}
        <div className="home-panel-section">
          <div className="home-panel-label">Game Profile</div>
          {profiles.length > 0 ? (
            <div className="home-profile-switcher" ref={dropdownRef}>
              <div
                className="home-profile-display"
                role="button"
                tabIndex={0}
                aria-expanded={profileDropdownOpen}
                onClick={() => setProfileDropdownOpen(prev => !prev)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setProfileDropdownOpen(prev => !prev); } }}
              >
                <span className="home-profile-name mono">{config.activeProfile || 'Select profile'}</span>
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
              <select
                className="form-select home-full-input"
                value={profileType}
                onChange={e => setProfileType(e.target.value)}
              >
                <option value="private">Private server</option>
                <option value="retail">Retail (PlayOnline)</option>
              </select>
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
            <div className="form-field">
              <div className="form-field-label"><span className="form-field-name">Launch method</span></div>
              <select
                className="form-select"
                value={config.useXiloader ? 'xiloader' : 'ashita'}
                onChange={e => updateConfig('useXiloader', e.target.value === 'xiloader')}
              >
                <option value="ashita">Ashita (boot file from profile)</option>
                <option value="xiloader">xiloader (private server)</option>
              </select>
            </div>
            {config.serverHost && (
              <div className="home-conn-section">
                <div className="home-server-picker-wrap" ref={serverPickerRef}>
                  <div className="home-conn-host mono" onClick={() => setServerPickerOpen(o => !o)}>
                    <span>{config.serverHost}</span>
                    <span className="home-conn-host-caret">{serverPickerOpen ? '▴' : '▾'}</span>
                  </div>
                  {serverPickerOpen && (
                    <div className="home-server-picker">
                      {(config.favoriteServers || []).length === 0 ? (
                        <div className="home-server-picker-empty">
                          No favorites yet — star a server in the Servers tab
                        </div>
                      ) : (config.favoriteServers || []).map((s, i) => (
                        <div
                          key={i}
                          className={`home-server-picker-item${s.host === config.serverHost ? ' active' : ''}`}
                          onClick={() => {
                            updateConfig('serverHost', s.host);
                            if (s.port) updateConfig('serverPort', s.port);
                            setServerStatus(null);
                            setServerPickerOpen(false);
                          }}
                        >
                          <span className="home-server-picker-name">{s.name}</span>
                          <span className="home-server-picker-host mono">{s.host}{s.port ? ':' + s.port : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="home-conn-check-row">
                  <button className="btn btn-ghost home-conn-btn" onClick={checkServer} disabled={checkingServer}>
                    {checkingServer ? 'Checking...' : 'Check connection'}
                  </button>
                  <div className={`home-conn-status-box${!serverStatus ? '' : serverStatus.online ? ' online' : ' offline'}`}>
                    {!serverStatus ? '—' : serverStatus.online ? `Online (${serverStatus.latency}ms)` : 'Offline'}
                  </div>
                </div>
              </div>
            )}
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
            <div
              className="home-profile-display"
              role="button"
              tabIndex={0}
              aria-expanded={multiBoxOpen}
              onClick={() => setMultiBoxOpen(o => !o)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMultiBoxOpen(o => !o); } }}
            >
              <span className="home-multibox-title">Multi-Box Launch</span>
              <span className="home-profile-change">{multiBoxOpen ? '▲' : '▼'}</span>
            </div>
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

        {/* FFXI Files Updater */}
        {setupComplete && (
          <div className="home-panel-section home-panel-divider">
            <div className="home-panel-label home-panel-label-tight">FFXI Files Updater</div>
            <div className="form-field home-ffxiupd-field">
              <div className="form-field-label"><span className="form-field-name">Mirror URL</span></div>
              <input
                type="text"
                className="form-input"
                value={ffxiMirrorUrl}
                placeholder="Custom mirror link (optional, https)"
                onChange={e => setFfxiMirrorUrl(e.target.value)}
                disabled={ffxiUpdating}
                spellCheck={false}
              />
              <p className="form-field-desc">
                Downloads pre-patched FFXI files into your game folder. Leave blank for the default{' '}
                <a href="#vana-time" className="home-ffxiupd-link" onClick={e => { e.preventDefault(); api?.openExternal?.('https://vana-time.com/downloads'); }}>Vana-Time</a>{' '}
                mirror. Close FFXI before running.
              </p>
            </div>
            {ffxiUpdating && (
              <div className="home-install-progress">
                <div className="home-progress-bar home-progress-bar-tight">
                  <div className="home-progress-fill" style={{ width: `${ffxiDlPercent}%` }} />
                </div>
                <span className="home-progress-text">{ffxiDlDetail}</span>
              </div>
            )}
            {ffxiUpdaterStatus && !ffxiUpdating && (
              <div className={`home-ffxiupd-status ${ffxiUpdaterStatus.ok ? 'ok' : 'err'}`}>
                {ffxiUpdaterStatus.ok ? '✔ ' : '✖ '}{ffxiUpdaterStatus.msg}
              </div>
            )}
            <button
              className="btn btn-primary btn-sm home-full-btn"
              onClick={runFfxiUpdater}
              disabled={ffxiUpdating}
            >
              {ffxiUpdating ? `◌ Updating (${ffxiDlPercent}%)` : '⚡ Run FFXI Files Updater'}
            </button>
            <div className="home-contrib-credit">
              contributed by Demetrie
            </div>
          </div>
        )}

      </div>

      {/* Bottom-left utility corner */}
      {setupComplete && onShowWizard && (
        <div className="home-wizard-corner">
          <button className="btn btn-primary btn-sm" onClick={onShowWizard}>
            Re-run Setup Wizard
          </button>
        </div>
      )}
    </div>
  );
}

export default HomeTab;
