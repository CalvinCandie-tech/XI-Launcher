import React, { useState, useEffect, useRef, useCallback } from 'react';
import './HomeTab.css';
import { DEFAULT_PROFILE_INI } from '../utils/profileTemplates';
import LoaderPicker, { LOADER_CHANGED_EVENT } from '../components/LoaderPicker';
import GameFilesPicker, { GAME_FILES_CHANGED_EVENT, announceGameFilesChange } from '../components/GameFilesPicker';
import HomeTopBar from '../components/home/HomeTopBar';
import ProfileSwitcher from '../components/home/ProfileSwitcher';
import ServerPanel from '../components/home/ServerPanel';
import FilesUpdaterPanel from '../components/home/FilesUpdaterPanel';
import MultiBoxPanel from '../components/home/MultiBoxPanel';
import SetupCard from '../components/home/SetupCard';
import NoticeBanner from '../components/home/NoticeBanner';
import MovedServerBanner from '../components/MovedServerBanner';
import PrereqBanner from '../components/home/PrereqBanner';

const api = window.xiAPI;

function HomeTab({ config, updateConfig, onNavigate, onLaunch, isLaunching, launchLog, updateInfo, onSkipVersion, onDismissUpdate, onShowWizard, prereqs, onShowRequirements, movedServers, onApplyMove, onDismissMove }) {
  const [status, setStatus] = useState({ ashita: false, ffxi: false, xiloader: false, profileCount: 0 });
  const [loaderInfo, setLoaderInfo] = useState(null); // resolveLoader() for the active profile
  const [startupWarnings, setStartupWarnings] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [profileType, setProfileType] = useState('private');
  const [ashitaInstalling, setAshitaInstalling] = useState(false);
  const [ashitaProgress, setAshitaProgress] = useState({ percent: 0, detail: '' });
  const [ashitaError, setAshitaError] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [multiBoxProfiles, setMultiBoxProfiles] = useState([]);
  const [multiBoxLaunching, setMultiBoxLaunching] = useState(false);
  const [multiBoxLog, setMultiBoxLog] = useState('');
  const [serverStatus, setServerStatus] = useState(null); // { online, latency }
  const [updateDlStatus, setUpdateDlStatus] = useState(''); // '' | 'downloading' | 'installing' | 'error'
  const [updateDlProgress, setUpdateDlProgress] = useState({ percent: 0, detail: '' });
  const [updateDlError, setUpdateDlError] = useState('');
  const [loaderChangeCount, setLoaderChangeCount] = useState(0); // re-runs the readiness check
  const topRef = useRef(null);
  const noticesRef = useRef(null);

  useEffect(() => {
    const bump = () => setLoaderChangeCount(n => n + 1);
    window.addEventListener(LOADER_CHANGED_EVENT, bump);
    return () => window.removeEventListener(LOADER_CHANGED_EVENT, bump);
  }, []);

  // ── 📥 FFXI Files Updater (Vana Portal mirror or custom URL) ──
  const [ffxiDlPercent, setFfxiDlPercent] = useState(0);
  const [ffxiDlDetail, setFfxiDlDetail] = useState('');
  const [ffxiUpdating, setFfxiUpdating] = useState(false);
  const [ffxiMirrorUrl, setFfxiMirrorUrl] = useState('');
  const [ffxiUpdaterStatus, setFfxiUpdaterStatus] = useState(null); // { ok: bool, msg: string }

  useEffect(() => {
    if (!api?.onFullClientProgress) return;
    return api.onFullClientProgress((pct, detail) => {
      setFfxiDlPercent(pct);
      setFfxiDlDetail(detail);
    });
  }, []);

  // The updater installs into the active profile's game files (shown so players know where)
  // from that profile's own link — each sandboxed copy keeps the server it came from.
  // The same lookup feeds the Game files tile's summary.
  const [updaterTarget, setUpdaterTarget] = useState('');
  const [gameFiles, setGameFiles] = useState(null);
  useEffect(() => {
    const refresh = async (loadLink) => {
      if (!api?.getProfileGameFiles || !config.activeProfile) {
        setUpdaterTarget(config.ffxiPath || '');
        setGameFiles(null);
        if (loadLink && api?.storeGet) setFfxiMirrorUrl((await api.storeGet('ffxiUpdaterUrl')) || '');
        return;
      }
      const gf = await api.getProfileGameFiles(config.activeProfile);
      if (gf?.error) { setUpdaterTarget(config.ffxiPath || ''); setGameFiles(null); return; }
      setGameFiles(gf);
      setUpdaterTarget(gf.mode === 'sandbox' ? gf.folder : gf.installedFfxiPath);
      // Only on a profile switch — a game-files change mustn't wipe a link being typed.
      if (loadLink) setFfxiMirrorUrl(gf.updaterUrl || '');
    };
    refresh(true);
    const onGameFilesChange = () => refresh(false);
    window.addEventListener(GAME_FILES_CHANGED_EVENT, onGameFilesChange);
    return () => window.removeEventListener(GAME_FILES_CHANGED_EVENT, onGameFilesChange);
  }, [config.activeProfile, config.ffxiPath]);

  // Tags in the profile list so players can see which profiles play a sandboxed copy.
  const [gameFilesModes, setGameFilesModes] = useState({});
  useEffect(() => {
    if (!api?.getGameFilesModes) return;
    const refresh = async () => setGameFilesModes((await api.getGameFilesModes(profiles)) || {});
    refresh();
    window.addEventListener(GAME_FILES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(GAME_FILES_CHANGED_EVENT, refresh);
  }, [profiles]);
  const gameFilesTag = (name) => gameFilesModes[name] ? (
    <span className={`home-profile-tag ${gameFilesModes[name] === 'sandbox' ? 'sandbox' : ''}`}>
      {gameFilesModes[name] === 'sandbox' ? 'sandboxed' : 'installed'}
    </span>
  ) : null;

  const runFfxiUpdater = async () => {
    if (!api?.downloadFullClient) return;
    setFfxiUpdaterStatus(null);
    setFfxiUpdating(true);
    setFfxiDlDetail('Starting FFXI files update...');
    // Main saves the link to the active profile.
    const result = await api.downloadFullClient(ffxiMirrorUrl, config.activeProfile);
    setFfxiUpdating(false);
    if (result.success) {
      setFfxiUpdaterStatus({ ok: true, msg: result.message || 'FFXI files successfully updated!' });
      announceGameFilesChange(); // "no game files here yet" notes are now stale
    } else {
      setFfxiUpdaterStatus({ ok: false, msg: result.error });
    }
  };

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
    setAshitaError('');
    setAshitaProgress({ percent: 0, detail: 'Starting...' });
    try {
      const result = await api.installAshitaV4(config.ashitaPath);
      if (result.success) {
        const ashita = await api.pathExists(config.ashitaPath + '\\Ashita-cli.exe');
        setStatus(prev => ({ ...prev, ashita }));
      } else {
        setAshitaError(result.error || 'Ashita v4 install failed.');
      }
    } catch (e) {
      console.error('Failed to install Ashita v4:', e);
      setAshitaError(e.message || 'Ashita v4 install failed.');
    } finally {
      setAshitaInstalling(false);
    }
  };

  useEffect(() => {
    if (!api) return;
    const check = async () => {
      const [ashita, ffxi, loader, profiles] = await Promise.all([
        api.pathExists(config.ashitaPath + '\\Ashita-cli.exe'),
        api.pathExists(config.ffxiPath),
        api.resolveLoader(config.activeProfile),
        api.listProfiles(config.ashitaPath)
      ]);
      // A retail profile doesn't use a loader, so never flag one as missing for it.
      const loaderOk = !loader || loader.isRetail || loader.exists;
      setStatus({ ashita, ffxi, xiloader: loaderOk, loaderName: loader?.name || 'xiloader', profileCount: profiles.length });
      setLoaderInfo(loader || {});
      setProfiles(profiles);
    };
    check();
  }, [config.ashitaPath, config.ffxiPath, config.xiloaderPath, config.activeProfile, loaderChangeCount]);

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

  // Server status — one check when Home opens and whenever the profile or server changes,
  // plus the manual button. Never polled: probing the LSB login port with a TCP
  // connect+destroy shows up in the connect server log as "stream truncated / Failed to
  // handshake" for every probe (auth_session sees EOF mid-handshake).
  const [checkingServer, setCheckingServer] = useState(false);
  const serverCheckId = useRef(0); // only the latest check may report, so a switch mid-check can't show the old server's result
  const checkServer = useCallback(async () => {
    if (!api?.checkServerStatus || !config.serverHost) return;
    const id = ++serverCheckId.current;
    setCheckingServer(true);
    try {
      const result = await api.checkServerStatus(config.serverHost, config.serverPort);
      if (id === serverCheckId.current) setServerStatus(result);
    } catch (e) {
      if (id === serverCheckId.current) setServerStatus({ online: false, error: e.message || 'Check failed' });
    } finally {
      if (id === serverCheckId.current) setCheckingServer(false);
    }
  }, [config.serverHost, config.serverPort]);
  // Retail profiles don't use the private server (null until the first readiness check).
  const isRetail = loaderInfo ? !!loaderInfo.isRetail : null;
  useEffect(() => {
    setServerStatus(null);
    if (isRetail === false) checkServer();
  }, [checkServer, config.activeProfile, isRetail]);

  const pickServer = async (s) => {
    updateConfig('serverHost', s.host);
    if (s.port) updateConfig('serverPort', s.port);
    // Launches connect to the profile ini's --server, so change it there too.
    if (config.activeProfile && api?.setProfileServer) {
      const res = await api.setProfileServer(config.activeProfile, s.host);
      if (res?.error) console.error('Failed to update profile server:', res.error);
    }
  };

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

  // The Sidebar's music note sits just under the top bar (and any notice), so tell it how
  // far down that reaches.
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      const top = topRef.current;
      if (!top) return;
      const noticesH = noticesRef.current?.offsetHeight || 0;
      root.style.setProperty('--home-top-h', `${top.offsetTop + top.offsetHeight + (noticesH ? noticesH + 8 : 0)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (topRef.current) ro.observe(topRef.current);
    if (noticesRef.current) ro.observe(noticesRef.current);
    return () => { ro.disconnect(); root.style.removeProperty('--home-top-h'); };
  }, []);

  // A profile playing its own sandboxed copy doesn't need an installed FFXI — e.g. a launcher on a
  // thumb drive, used on a PC that never had the game installed.
  const readiness = {
    ...status,
    ffxi: status.ffxi || (gameFiles?.mode === 'sandbox' && !!gameFiles.filesFound),
  };
  const setupComplete = readiness.ashita && readiness.ffxi && config.activeProfile;
  const stepsComplete = [readiness.ashita, readiness.ffxi, !!config.activeProfile].filter(Boolean).length;

  const profileSwitcher = (close) => (
    <ProfileSwitcher
      profiles={profiles}
      activeProfile={config.activeProfile}
      gameFilesTag={gameFilesTag}
      onSelect={name => { updateConfig('activeProfile', name); if (close) close(); }}
      onManage={() => { if (close) close(); onNavigate('profiles'); }}
    />
  );

  const ok = <span className="home-tile-ok">✓</span>;
  const gameFilesOk = !!gameFiles && gameFiles.filesFound && (gameFiles.mode === 'sandbox' || gameFiles.registered);
  const serverTile = () => {
    const host = config.serverHost;
    if (isRetail) {
      return { id: 'server', label: 'Server', readOnly: true, summary: 'Retail (PlayOnline)', title: 'Retail profiles connect through PlayOnline' };
    }
    let summary = <><span className="home-tile-dim">◌</span> {host} · <span className="home-tile-dim">checking</span></>;
    let title = `${host}${config.serverPort ? ':' + config.serverPort : ''}`;
    if (serverStatus && !checkingServer) {
      summary = serverStatus.online
        ? <><span className="home-tile-online">●</span> {host} · <span className="home-tile-online">Online {serverStatus.latency} ms</span></>
        : <>⚠ {host} · Offline</>;
      title += serverStatus.online ? ` — Online (${serverStatus.latency} ms)` : ' — Offline';
    }
    return {
      id: 'server', label: 'Server', summary, title,
      warn: !!serverStatus && !serverStatus.online && !checkingServer,
      render: () => (
        <ServerPanel
          serverHost={host}
          serverPort={config.serverPort}
          favoriteServers={config.favoriteServers}
          serverStatus={serverStatus}
          checkingServer={checkingServer}
          onCheck={checkServer}
          onPick={pickServer}
        />
      ),
    };
  };

  const filesUpdaterPanel = (
    <FilesUpdaterPanel
      activeProfile={config.activeProfile}
      mirrorUrl={ffxiMirrorUrl}
      onMirrorUrlChange={setFfxiMirrorUrl}
      updating={ffxiUpdating}
      percent={ffxiDlPercent}
      detail={ffxiDlDetail}
      status={ffxiUpdaterStatus}
      target={updaterTarget}
      onRun={runFfxiUpdater}
    />
  );

  // The top bar (with its Game files and Files updater tiles) waits for setup, so a profile
  // whose game files are missing gets both in the setup card — otherwise a sandboxed copy
  // that was deleted, or a new one on a PC without FFXI, could never be filled.
  const gameFilesFix = config.activeProfile && !readiness.ffxi && (
    <div className="home-setup-gamefiles">
      <GameFilesPicker
        profileName={config.activeProfile}
        ffxiPath={config.ffxiPath}
        updaterName="the FFXI Files Updater below"
      />
      {gameFiles?.mode === 'sandbox' && filesUpdaterPanel}
    </div>
  );

  const tiles = !setupComplete ? [] : [
    {
      id: 'profile',
      label: 'Profile',
      summary: <><span className="mono">{config.activeProfile}</span>{gameFilesTag(config.activeProfile)}</>,
      title: config.activeProfile,
      render: close => profileSwitcher(close),
    },
    isRetail ? {
      id: 'loader', label: 'Loader', readOnly: true, summary: 'Retail (PlayOnline)', title: "Retail profiles don't use a loader",
    } : {
      id: 'loader',
      label: 'Loader',
      summary: status.xiloader ? <>{status.loaderName} {ok}</> : '⚠ not installed',
      title: loaderInfo?.label || status.loaderName,
      warn: !status.xiloader,
      render: () => <LoaderPicker compact profileName={config.activeProfile} />,
    },
    {
      id: 'gamefiles',
      label: 'Game files',
      summary: gameFiles
        ? <>{gameFiles.mode === 'sandbox' ? 'Sandboxed' : 'Installed'} {gameFilesOk ? ok : '⚠'}</>
        : <span className="home-tile-dim">—</span>,
      title: updaterTarget,
      warn: !!gameFiles && !gameFilesOk,
      panelWidth: 380,
      render: () => <GameFilesPicker profileName={config.activeProfile} ffxiPath={config.ffxiPath} inDropdown />,
    },
    config.serverHost && serverTile(),
    {
      id: 'updater',
      label: 'Files updater',
      summary: ffxiUpdating ? `⚡ ${ffxiDlPercent}%` : '⚡ Run',
      title: ffxiUpdating ? ffxiDlDetail : 'FFXI Files Updater',
      panelWidth: 380,
      render: () => filesUpdaterPanel,
    },
    profiles.length > 1 && {
      id: 'multibox',
      label: 'Multi-box',
      summary: `${multiBoxProfiles.length} selected`,
      render: () => (
        <MultiBoxPanel
          profiles={profiles}
          activeProfile={config.activeProfile}
          selected={multiBoxProfiles}
          onToggle={toggleMultiBoxProfile}
          launching={multiBoxLaunching}
          log={multiBoxLog}
          onLaunch={launchMultiBox}
        />
      ),
    },
  ].filter(Boolean);

  return (
    <div className="home-tab">
      <div className="home-top" ref={topRef}>
        {setupComplete && <HomeTopBar tiles={tiles} />}
        <div className="home-notices" ref={noticesRef}>
          <NoticeBanner
            startupWarnings={startupWarnings}
            onDismissWarnings={() => setStartupWarnings([])}
            updateInfo={updateInfo}
            updateDlStatus={updateDlStatus}
            updateDlProgress={updateDlProgress}
            updateDlError={updateDlError}
            onDownloadUpdate={handleDownloadUpdate}
            onSkipVersion={onSkipVersion}
            onDismissUpdate={() => { setUpdateDlStatus(''); setUpdateDlProgress({ percent: 0, detail: '' }); setUpdateDlError(''); onDismissUpdate(); }}
            onDismissUpdateError={() => { setUpdateDlStatus(''); setUpdateDlError(''); }}
          />
          {prereqs && <PrereqBanner prereqs={prereqs} onShowDetails={onShowRequirements} />}
          <MovedServerBanner moves={movedServers} onApply={onApplyMove} onDismiss={onDismissMove} />
        </div>
      </div>

      {/* Middle — video shows through; scrolls on short windows rather than hiding Start Game */}
      <div className="home-middle">
        <div className="home-branding">
          <img className="home-crystal-img" src="./crystal.svg" alt="Crystal" />
          <h1 className="home-title cinzel">XI Launcher</h1>
          <p className="home-subtitle">Final Fantasy XI</p>
          {setupComplete ? (
            <div className="home-hero-launch">
              <button
                className="btn btn-primary home-start-btn"
                disabled={isLaunching || !config.activeProfile}
                onClick={() => onLaunch(false)}
              >
                {isLaunching ? '◌ Launching...' : '✦ Start Game'}
              </button>
              {launchLog && (
                <span className={`home-launch-msg ${launchLog.startsWith('Error') ? 'home-launch-error' : 'home-launch-ok'}`}>
                  {launchLog}
                </span>
              )}
            </div>
          ) : (
            <SetupCard
              status={readiness}
              stepsComplete={stepsComplete}
              activeProfile={config.activeProfile}
              profiles={profiles}
              profileSwitcher={profileSwitcher()}
              onNavigate={onNavigate}
              gameFiles={gameFiles}
              gameFilesFix={gameFilesFix}
              ashitaInstalling={ashitaInstalling}
              ashitaProgress={ashitaProgress}
              ashitaError={ashitaError}
              onInstallAshita={installAshitaV4}
              profileType={profileType}
              onProfileTypeChange={setProfileType}
              newName={newName}
              onNewNameChange={setNewName}
              creating={creating}
              onCreate={createAndActivate}
            />
          )}
        </div>
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
