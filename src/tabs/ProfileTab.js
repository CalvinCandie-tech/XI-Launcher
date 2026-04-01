import React, { useState, useEffect, useCallback } from 'react';
import './ProfileTab.css';
import { DEFAULT_PROFILE_INI } from '../utils/profileTemplates';

const api = window.xiAPI;

function ProfileTab({ config, updateConfig }) {
  const [pathStatus, setPathStatus] = useState({ ashita: false, ffxi: false, xiloader: false });
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [profileContent, setProfileContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileType, setNewProfileType] = useState('private');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [autoDetectMsg, setAutoDetectMsg] = useState(null);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [buildTools, setBuildTools] = useState(null);
  const [buildStatus, setBuildStatus] = useState('idle'); // idle | checking | cloning | building | copying | done | error
  const [buildLog, setBuildLog] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('idle');
  const [downloadProgress, setDownloadProgress] = useState({ percent: 0, detail: '' });

  useEffect(() => {
    if (!api?.onXiloaderDownloadProgress) return;
    const unsub = api.onXiloaderDownloadProgress((percent, detail) => {
      setDownloadProgress({ percent, detail });
    });
    return unsub;
  }, []);

  const downloadXiloader = async () => {
    if (!api?.downloadXiloader) return;
    setDownloadStatus('downloading');
    setDownloadProgress({ percent: 0, detail: 'Starting...' });
    setBuildLog('');
    const result = await api.downloadXiloader(config.xiloaderPath);
    if (result.success) {
      setDownloadStatus('done');
      setBuildLog(result.message);
      checkPaths();
    } else {
      setDownloadStatus('error');
      setBuildLog(result.error);
    }
  };

  const checkPaths = useCallback(async () => {
    if (!api) return;
    const [ashita, ffxi, xiloader] = await Promise.all([
      api.pathExists(config.ashitaPath + '\\Ashita-cli.exe'),
      api.pathExists(config.ffxiPath),
      api.pathExists((config.xiloaderPath || '') + '\\xiloader.exe')
    ]);
    setPathStatus({ ashita, ffxi, xiloader });
  }, [config.ashitaPath, config.ffxiPath, config.xiloaderPath]);

  const loadProfiles = useCallback(async () => {
    if (!api) return;
    const list = await api.listProfiles(config.ashitaPath);
    setProfiles(list);
  }, [config.ashitaPath]);

  useEffect(() => { checkPaths(); }, [checkPaths]);
  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const handleBrowse = async (key, current) => {
    const result = await api.browseFolder(current);
    if (result) updateConfig(key, result);
  };

  const selectProfile = async (name) => {
    setSelectedProfile(name);
    setIsEditing(false);
    const result = await api.readProfile(config.ashitaPath, name);
    setProfileContent(result.content || '');
  };

  const activateProfile = (name) => {
    updateConfig('activeProfile', name);
  };

  const createProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    await api.saveProfile(config.ashitaPath, name, DEFAULT_PROFILE_INI(name, newProfileType, config.serverHost, config.serverPort, config.xiloaderPath, config.hairpin, config.loginUser, config.loginPass));
    setNewProfileName('');
    await loadProfiles();
    selectProfile(name);
  };

  const startEdit = () => {
    setEditContent(profileContent);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const saveEdit = async () => {
    await api.saveProfile(config.ashitaPath, selectedProfile, editContent);
    setProfileContent(editContent);
    setIsEditing(false);
  };

  const deleteProfile = async (name) => {
    const result = await api.deleteProfile(config.ashitaPath, name);
    if (result.success) {
      if (config.activeProfile === name) {
        updateConfig('activeProfile', null);
      }
      if (selectedProfile === name) {
        setSelectedProfile(null);
        setProfileContent('');
        setIsEditing(false);
      }
      setConfirmDelete(null);
      await loadProfiles();
    }
  };

  const openProfileFolder = () => {
    api.openFolder(config.ashitaPath + '\\config\\ashita');
  };

  const exportProfile = async (name) => {
    if (!api?.exportProfile) return;
    const result = await api.exportProfile(config.ashitaPath, name);
    if (result.success) {
      setBuildLog(result.message);
      setTimeout(() => setBuildLog(''), 4000);
    } else if (!result.cancelled) {
      setBuildLog(`Export failed: ${result.error}`);
    }
  };

  const importProfile = async () => {
    if (!api?.importProfile) return;
    const result = await api.importProfile(config.ashitaPath);
    if (result.success) {
      setBuildLog(result.message);
      await loadProfiles();
      selectProfile(result.name);
      setTimeout(() => setBuildLog(''), 4000);
    } else if (!result.cancelled) {
      setBuildLog(`Import failed: ${result.error}`);
    }
  };

  const checkTools = async () => {
    setBuildStatus('checking');
    setBuildLog('Checking for Git, CMake, and MSVC...');
    const tools = await api.checkBuildTools();
    setBuildTools(tools);
    if (!tools.git) {
      setBuildStatus('error');
      setBuildLog('Git is not installed. Install Git for Windows from git-scm.com');
      return false;
    }
    if (!tools.cmake) {
      setBuildStatus('error');
      setBuildLog('CMake is not installed. Install CMake from cmake.org or via Visual Studio Installer.');
      return false;
    }
    setBuildLog('Build tools found ✓');
    setBuildStatus('idle');
    return true;
  };

  const downloadAndBuild = async () => {
    if (!api) return;
    const destDir = config.xiloaderPath || 'C:\\xiloader';

    // Check tools first
    setBuildStatus('checking');
    setBuildLog('Checking build tools...');
    const tools = await api.checkBuildTools();
    setBuildTools(tools);
    if (!tools.git) {
      setBuildStatus('error');
      setBuildLog('Error: Git not found. Install Git for Windows from git-scm.com');
      return;
    }
    if (!tools.cmake) {
      setBuildStatus('error');
      setBuildLog('Error: CMake not found. Install from cmake.org or Visual Studio Installer.');
      return;
    }

    // Clone
    setBuildStatus('cloning');
    setBuildLog('Cloning xiloader from GitHub...');
    const cloneResult = await api.cloneXiloader(destDir);
    if (!cloneResult.success) {
      setBuildStatus('error');
      setBuildLog(`Error cloning: ${cloneResult.error}`);
      return;
    }
    setBuildLog(`${cloneResult.message}. Building (this may take a minute)...`);

    // Build
    setBuildStatus('building');
    const buildResult = await api.buildXiloader(cloneResult.repoDir);
    if (!buildResult.success) {
      setBuildStatus('error');
      setBuildLog(`Build failed: ${buildResult.error}`);
      return;
    }

    // Copy exe to xiloader path root
    setBuildStatus('copying');
    setBuildLog('Copying xiloader.exe...');
    const copyResult = await api.copyXiloader(buildResult.exePath, destDir);
    if (!copyResult.success) {
      setBuildStatus('error');
      setBuildLog(`Copy failed: ${copyResult.error}`);
      return;
    }

    updateConfig('xiloaderPath', destDir);
    setBuildStatus('done');
    setBuildLog(`xiloader.exe built and installed to ${destDir}`);
    checkPaths();
  };

  const autoDetectPaths = async () => {
    if (!api) return;
    setAutoDetecting(true);
    setAutoDetectMsg(null);
    const found = [];

    const runtime = api.getRuntimePaths ? await api.getRuntimePaths() : {};
    const ashitaCandidates = [
      runtime.defaultAshitaPath,
      'C:\\Ashita-v4', 'C:\\Ashita v4', 'C:\\Ashita-v4beta', 'C:\\Ashita',
      'D:\\Ashita-v4', 'D:\\Ashita', 'C:\\Games\\Ashita-v4', 'C:\\Games\\Ashita',
      'C:\\Program Files (x86)\\Ashita', 'C:\\Program Files\\Ashita'
    ].filter(Boolean);
    for (const p of ashitaCandidates) {
      if (await api.pathExists(p + '\\Ashita-cli.exe')) {
        updateConfig('ashitaPath', p);
        found.push(`Ashita v4 → ${p}`);
        break;
      }
    }

    const ffxiCandidates = [
      'C:\\Program Files (x86)\\PlayOnline\\SquareEnix\\FINAL FANTASY XI',
      'C:\\Program Files (x86)\\PlayOnline\\SquareEnix\\FinalFantasyXI',
      'D:\\Program Files (x86)\\PlayOnline\\SquareEnix\\FINAL FANTASY XI',
      'C:\\Games\\FINAL FANTASY XI', 'D:\\Games\\FINAL FANTASY XI'
    ];
    for (const p of ffxiCandidates) {
      if (await api.pathExists(p)) {
        updateConfig('ffxiPath', p);
        found.push(`FFXI → ${p}`);
        break;
      }
    }

    const ashitaPath = config.ashitaPath;
    const xiloaderCandidates = [
      runtime.defaultXiloaderPath,
      'C:\\xiloader', 'C:\\Ashita\\xiloader', 'D:\\xiloader',
      ashitaPath ? ashitaPath + '\\xiloader' : null
    ].filter(Boolean);
    for (const p of xiloaderCandidates) {
      if (await api.pathExists(p + '\\xiloader.exe')) {
        updateConfig('xiloaderPath', p);
        found.push(`xiloader → ${p}`);
        break;
      }
    }

    setAutoDetecting(false);
    if (found.length > 0) {
      setAutoDetectMsg({ success: true, text: `Found: ${found.join(', ')}` });
    } else {
      setAutoDetectMsg({ success: false, text: 'No paths found. Install Ashita v4 from the Home tab, or set paths manually using Browse.' });
    }
    setTimeout(() => setAutoDetectMsg(null), 6000);
    checkPaths();
  };

  return (
    <div className="profile-tab">
      <div className="section-header">Launch Profiles</div>
      <p className="profile-hint">
        Ashita uses <strong>profiles</strong> (INI files) to control which addons, plugins, and polplugins load when you start the game.
        Select a profile to make it active — the active profile is what gets used when you click Launch.
        You can also edit the raw INI if you need to tweak advanced settings.
      </p>
      <div className="profiles-layout">
        <div className="profiles-list panel">
          <div className="profiles-list-header">
            <span className="mono">{profiles.length} profile{profiles.length !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={importProfile} title="Import a .xiprofile file">↓ Import</button>
              <button className="btn btn-ghost btn-sm" onClick={loadProfiles}>↻ Refresh</button>
            </div>
          </div>
          {profiles.length === 0 && (
            <div className="profiles-empty">No profiles found in Ashita config directory.</div>
          )}
          {profiles.map(name => (
            <div
              key={name}
              className={`profile-row ${selectedProfile === name ? 'selected' : ''} ${config.activeProfile === name ? 'active' : ''}`}
              onClick={() => selectProfile(name)}
            >
              <span className="profile-row-name">
                {config.activeProfile === name && <span className="profile-active-icon">✦</span>}
                {name}
              </span>
              {config.activeProfile === name ? (
                <span className="pill pill-gold" style={{ fontSize: 10 }}>Active</span>
              ) : selectedProfile === name ? (
                <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); activateProfile(name); }}>
                  Set Active
                </button>
              ) : null}
            </div>
          ))}
          <div className="profiles-create">
            <div className="profiles-create-type">
              <button
                className={`btn btn-sm ${newProfileType === 'private' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setNewProfileType('private')}
                title="Uses Ashita bootloader to connect to a private server"
              >
                Private
              </button>
              <button
                className={`btn btn-sm ${newProfileType === 'retail' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setNewProfileType('retail')}
                title="Connects through PlayOnline for official servers"
              >
                Retail
              </button>
            </div>
            <input
              type="text"
              placeholder="New profile name..."
              value={newProfileName}
              onChange={e => setNewProfileName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createProfile()}
            />
            <button className="btn btn-primary btn-sm" onClick={createProfile} disabled={!newProfileName.trim()}>
              Create
            </button>
          </div>
        </div>

        <div className="profile-editor panel">
          {selectedProfile ? (
            <>
              <div className="profile-editor-header">
                <span className="mono" style={{ color: 'var(--gold)' }}>{selectedProfile}.ini</span>
                <div className="profile-editor-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => exportProfile(selectedProfile)} title="Export as .xiprofile">↑ Export</button>
                  <button className="btn btn-ghost btn-sm" onClick={openProfileFolder}>Open Folder</button>
                  {isEditing ? (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={startEdit}>Edit</button>
                      <button className="btn btn-ghost btn-sm btn-delete" onClick={() => setConfirmDelete(selectedProfile)}>Delete</button>
                    </>
                  )}
                </div>
              </div>
              <textarea
                className="profile-editor-textarea mono"
                value={isEditing ? editContent : profileContent}
                onChange={e => setEditContent(e.target.value)}
                readOnly={!isEditing}
                spellCheck={false}
              />
            </>
          ) : (
            <div className="profile-editor-empty">
              Select a profile to view its configuration.
            </div>
          )}
        </div>
      </div>

      <div className="section-header">Private Server Connection</div>
      <div className="panel server-panel">
        <div className="server-intro">
          <div className="server-intro-icon">⚡</div>
          <div className="server-intro-text">
            <p className="server-intro-title">Connect to a Private Server</p>
            <p className="server-intro-desc">
              These settings let you bypass PlayOnline and connect directly to a private server using <strong>xiloader</strong>.
              Enter the server address and your login credentials below, then use the <strong>"Launch via xiloader"</strong> button at the bottom.
              If you only play on retail, you can skip this section entirely.
            </p>
          </div>
        </div>

        <div className="server-group">
          <div className="server-group-label">Server Address</div>
          <div className="server-group-row">
            <div className="field-row server-field-host">
              <label>Hostname</label>
              <span className="field-hint">e.g. play.myserver.com or an IP address</span>
              <input
                type="text"
                value={config.serverHost || ''}
                placeholder="play.myserver.com"
                onChange={e => updateConfig('serverHost', e.target.value)}
              />
            </div>
            <div className="field-row server-field-port">
              <label>Port</label>
              <span className="field-hint">Default: 54231</span>
              <input
                type="text"
                value={config.serverPort || ''}
                placeholder="54231"
                onChange={e => updateConfig('serverPort', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="server-group">
          <div className="server-group-label">Login Credentials</div>
          <div className="server-group-row">
            <div className="field-row">
              <label>Username</label>
              <span className="field-hint">Your account name on the private server</span>
              <input
                type="text"
                value={config.loginUser || ''}
                placeholder="Enter username"
                onChange={e => updateConfig('loginUser', e.target.value)}
              />
            </div>
            <div className="field-row">
              <label>Password</label>
              <span className="field-hint">Your account password</span>
              <input
                type="password"
                value={config.loginPass || ''}
                placeholder="Enter password"
                onChange={e => updateConfig('loginPass', e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button
              className={`btn btn-sm ${config.hairpin ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => updateConfig('hairpin', !config.hairpin)}
            >
              {config.hairpin ? '✓ Hairpin Enabled' : 'Hairpin Off'}
            </button>
            <span className="field-hint" style={{ margin: 0 }}>Use --hairpin flag for NAT loopback connections</span>
          </div>
          <div className="credential-warning">
            🔒 Credentials are stored locally on this device only. They are not sent anywhere except to the server you connect to.
          </div>
        </div>

        {config.serverHost && (
          <div className="server-summary">
            <span className="server-summary-label">Ready to connect to</span>
            <span className="server-summary-value mono">{config.serverHost}{config.serverPort ? `:${config.serverPort}` : ':54231'}</span>
            {config.loginUser && <span className="server-summary-user">as <strong>{config.loginUser}</strong></span>}
          </div>
        )}

        {config.activeProfile && (
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={async () => {
              if (!api || !config.activeProfile) return;
              const result = await api.readProfile(config.ashitaPath, config.activeProfile);
              if (!result.content) return;
              const lines = result.content.split('\n');
              const updated = lines.map(line => {
                const trimmed = line.replace(/\s/g, '');
                if (trimmed.startsWith('file=') && config.xiloaderPath) {
                  const xiloaderExe = config.xiloaderPath.replace(/\//g, '\\\\') + '\\\\xiloader.exe';
                  return `file         = ${xiloaderExe}`;
                }
                if (trimmed.startsWith('command=') && config.serverHost) {
                  const args = ['--server', config.serverHost];
                  if (config.serverPort) args.push('--port', config.serverPort);
                  if (config.loginUser) args.push('--user', config.loginUser);
                  if (config.loginPass) args.push('--pass', config.loginPass);
                  if (config.hairpin) args.push('--hairpin');
                  return `command      = ${args.join(' ')}`;
                }
                return line;
              });
              await api.saveProfile(config.ashitaPath, config.activeProfile, updated.join('\n'));
              if (selectedProfile === config.activeProfile) {
                const refreshed = await api.readProfile(config.ashitaPath, config.activeProfile);
                setProfileContent(refreshed.content || '');
              }
              setBuildLog(`Profile "${config.activeProfile}" updated with server settings`);
              setTimeout(() => setBuildLog(''), 4000);
            }}
          >
            Apply to Profile: {config.activeProfile}
          </button>
        )}
      </div>

      <div className="section-header">Installation Paths</div>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p className="profile-hint" style={{ margin: 0 }}>Tell the launcher where your game files live. Each path is checked automatically — a green "Found" badge means you're set.</p>
          <button className="btn btn-primary btn-sm" onClick={autoDetectPaths} disabled={autoDetecting} style={{ flexShrink: 0, marginLeft: 16 }}>
            {autoDetecting ? '◌ Scanning...' : '⟳ Auto-Detect'}
          </button>
        </div>
        {autoDetectMsg && (
          <div style={{
            padding: '8px 14px',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
            background: autoDetectMsg.success ? 'rgba(72, 184, 104, 0.1)' : 'rgba(200, 146, 42, 0.1)',
            border: `1px solid ${autoDetectMsg.success ? 'rgba(72, 184, 104, 0.2)' : 'rgba(200, 146, 42, 0.2)'}`,
            color: autoDetectMsg.success ? 'var(--green)' : 'var(--gold)'
          }}>
            {autoDetectMsg.text}
          </div>
        )}
        <PathRow
          label="Ashita v4 Path"
          hint="The folder containing Ashita-cli.exe — the v4 injection framework that loads addons and plugins"
          value={config.ashitaPath}
          found={pathStatus.ashita}
          onBrowse={() => handleBrowse('ashitaPath', config.ashitaPath)}
          onChange={(v) => updateConfig('ashitaPath', v)}
          onBlur={checkPaths}
        />
        <PathRow
          label="FFXI Install Path"
          hint="Your Final Fantasy XI game installation folder (where the game's ROM and DAT files live)"
          value={config.ffxiPath}
          found={pathStatus.ffxi}
          onBrowse={() => handleBrowse('ffxiPath', config.ffxiPath)}
          onChange={(v) => updateConfig('ffxiPath', v)}
          onBlur={checkPaths}
        />
        <PathRow
          label="xiloader Path"
          hint="Optional — only needed for private servers. Points to the folder containing xiloader.exe"
          value={config.xiloaderPath}
          found={pathStatus.xiloader}
          onBrowse={() => handleBrowse('xiloaderPath', config.xiloaderPath)}
          onChange={(v) => updateConfig('xiloaderPath', v)}
          onBlur={checkPaths}
        />
      </div>

      <div className="section-header">Get xiloader</div>
      <div className="panel xiloader-build-panel">
        <div className="xiloader-build-info">
          <p>
            <strong>xiloader</strong> lets you bypass PlayOnline and connect directly to a private server.
            You can download a pre-built version or build from source.
          </p>
        </div>
        <div className="xiloader-build-actions">
          <div className="xiloader-build-dest">
            <label>Install to:</label>
            <span className="mono">{config.xiloaderPath || 'C:\\xiloader'}</span>
          </div>
          <div className="xiloader-build-buttons">
            {pathStatus.xiloader && buildStatus === 'idle' && downloadStatus === 'idle' && (
              <span className="pill pill-green">xiloader.exe already exists</span>
            )}
            <button
              className="btn btn-primary"
              onClick={downloadXiloader}
              disabled={downloadStatus === 'downloading' || buildStatus === 'cloning' || buildStatus === 'building'}
            >
              {downloadStatus === 'downloading' ? '◌ Downloading...' : '↓ Download Pre-built'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={downloadAndBuild}
              disabled={buildStatus === 'cloning' || buildStatus === 'building' || buildStatus === 'copying' || buildStatus === 'checking' || downloadStatus === 'downloading'}
              title="Requires Git, CMake, and Visual Studio C++ build tools"
            >
              {buildStatus === 'checking' ? '◌ Checking tools...' :
               buildStatus === 'cloning' ? '◌ Cloning...' :
               buildStatus === 'building' ? '◌ Building...' :
               buildStatus === 'copying' ? '◌ Installing...' :
               '🔧 Build from Source'}
            </button>
          </div>
        </div>
        {downloadStatus === 'downloading' && (
          <div style={{ marginTop: 8 }}>
            <div className="home-progress-bar" style={{ marginBottom: 4, height: 5, background: 'var(--bg-deepest)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${downloadProgress.percent}%`, height: '100%', background: 'linear-gradient(90deg, var(--teal), var(--gold))', borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: "'Share Tech Mono', monospace" }}>{downloadProgress.detail}</span>
          </div>
        )}
        {buildLog && (
          <div className={`xiloader-build-log ${(buildStatus === 'error' || downloadStatus === 'error') ? 'error' : (buildStatus === 'done' || downloadStatus === 'done') ? 'success' : ''}`}>
            {buildLog}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="profile-delete-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="profile-delete-dialog" onClick={e => e.stopPropagation()}>
            <h3>Delete Profile</h3>
            <p>
              Are you sure you want to delete <strong>{confirmDelete}</strong>?
              This will permanently remove the profile INI file. This cannot be undone.
            </p>
            {config.activeProfile === confirmDelete && (
              <div className="profile-delete-warning">
                This is your currently active profile. Deleting it will clear your active selection.
              </div>
            )}
            <div className="profile-delete-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteProfile(confirmDelete)}>Delete Profile</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PathRow({ label, hint, value, found, onBrowse, onChange, onBlur }) {
  return (
    <div className="path-row">
      <div className="path-label-group">
        <label className="path-label">{label}</label>
        {hint && <span className="path-hint">{hint}</span>}
      </div>
      <input
        type="text"
        className="path-input"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <button className="btn btn-ghost btn-sm" onClick={onBrowse}>Browse</button>
      <span className={`pill ${found ? 'pill-green' : 'pill-red'}`}>
        {found ? 'Found' : 'Not Found'}
      </span>
    </div>
  );
}

export default ProfileTab;
