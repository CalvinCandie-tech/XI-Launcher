import React, { useState, useEffect, useCallback } from 'react';
import './XIPivotTab.css';

const api = window.xiAPI;

const HD_PACKS = [
  { name: 'XiView', desc: 'HD UI overhaul — status icons, fonts, GUI elements, and menu skins for modern resolutions', url: 'https://github.com/KenshiDRK/XiView' },
  { name: 'FFXI-Vision', desc: 'Overhauled in-game map files with cleaner, more detailed zone maps', url: 'https://github.com/Drauku/FFXI-Vision' },
  { name: 'Remapster', desc: 'Hand-drawn, detailed zone maps — cities, dungeons, open world, and more. Available in 1024 or 2048 resolution', url: 'https://github.com/AkadenTK/remapster_maps', releaseAsset: true },
  { name: 'AshenbubsHD', desc: 'Massive HD upscale project — 232,000+ textures covering armor, enemies, NPCs, magic effects, and more', url: 'https://github.com/Exarie/AshenbubsHD-Beta' },
  { name: 'LoFi-FFXI', desc: 'Lo-fi music replacements for FFXI — chill, relaxed versions of in-game BGM tracks', url: 'https://github.com/CatsAndBoats/LoFi-FFXI' }
];

function XIPivotTab({ config, onSettingsSaved }) {
  const [pivotConfig, setPivotConfig] = useState({
    exists: false, rootPath: '', overlays: [], cacheEnabled: false, cacheSize: 1024, cacheMaxAge: 600
  });
  const [dllExists, setDllExists] = useState(false);
  const [newOverlay, setNewOverlay] = useState('');
  const [installStatus, setInstallStatus] = useState('idle'); // idle | installing | done | error
  const [installMsg, setInstallMsg] = useState('');
  const [laaStatus, setLaaStatus] = useState({ exists: false, patched: false, error: null });
  const [laaWorking, setLaaWorking] = useState(false);
  const [laaMsg, setLaaMsg] = useState({ text: '', type: '' }); // type: success | error
  const [polExePath, setPolExePath] = useState('');

  const checkLAA = useCallback(async () => {
    if (!api || !config.ffxiPath) return;
    // pol.exe can be in several places relative to the FFXI install
    const candidates = [
      config.ffxiPath + '\\pol.exe',
      config.ffxiPath + '\\..\\PlayOnlineViewer\\pol.exe',
      config.ffxiPath + '\\..\\..\\PlayOnlineViewer\\pol.exe',
      'C:\\Program Files (x86)\\PlayOnline\\SquareEnix\\PlayOnlineViewer\\pol.exe',
      'C:\\Ashita\\ffxi-bootmod\\pol.exe'
    ];
    for (const candidate of candidates) {
      const exists = await api.pathExists(candidate);
      if (exists) {
        setPolExePath(candidate);
        const result = await api.checkLAA(candidate);
        setLaaStatus(result);
        return;
      }
    }
    setPolExePath('');
    setLaaStatus({ exists: false, patched: false });
  }, [config.ffxiPath]);

  const load = useCallback(async () => {
    if (!api) return;
    const [cfg, dll] = await Promise.all([
      api.readXIPivotConfig(config.ashitaPath),
      api.pathExists(config.ashitaPath + '\\polplugins\\pivot.dll')
    ]);
    setPivotConfig(cfg);
    setDllExists(dll);
  }, [config.ashitaPath]);

  useEffect(() => { checkLAA(); }, [checkLAA]);

  useEffect(() => { load(); }, [load]);

  const installXIPivot = async () => {
    setInstallStatus('installing');
    setInstallMsg('Downloading XIPivot from GitHub...');
    const result = await api.installXIPivot(config.ashitaPath);
    if (result.success) {
      setInstallStatus('done');
      setInstallMsg(result.message);
      await load(); // Refresh status
    } else {
      setInstallStatus('error');
      setInstallMsg(result.error);
    }
  };

  const toggleLAA = async () => {
    if (laaWorking) return;
    const enabling = !laaStatus.patched;
    setLaaWorking(true);
    setLaaMsg({ text: '', type: '' });
    const result = await api.setLAA(polExePath, enabling);
    if (result.success) {
      setLaaStatus(prev => ({ ...prev, patched: result.patched }));
      setLaaMsg({
        text: enabling
          ? '✓ pol.exe has been patched — FFXI can now use up to 4 GB of RAM. The change takes effect next time you launch the game.'
          : '✓ pol.exe has been reverted to the default 2 GB memory limit.',
        type: 'success'
      });
    } else {
      setLaaMsg({ text: '✕ ' + result.error, type: 'error' });
    }
    setLaaWorking(false);
  };

  const saveConfig = async (updates) => {
    const newCfg = { ...pivotConfig, ...updates };
    setPivotConfig(newCfg);
    await api.writeXIPivotConfig(config.ashitaPath, newCfg);
    if (onSettingsSaved) onSettingsSaved();
  };

  const addOverlay = async () => {
    const name = newOverlay.trim();
    if (!name || pivotConfig.overlays.includes(name)) return;
    await saveConfig({ overlays: [...pivotConfig.overlays, name] });
    setNewOverlay('');
  };

  const removeOverlay = async (idx) => {
    const overlays = pivotConfig.overlays.filter((_, i) => i !== idx);
    await saveConfig({ overlays });
  };

  const moveOverlay = async (idx, dir) => {
    const overlays = [...pivotConfig.overlays];
    const target = idx + dir;
    if (target < 0 || target >= overlays.length) return;
    [overlays[idx], overlays[target]] = [overlays[target], overlays[idx]];
    await saveConfig({ overlays });
  };

  const browseOverlay = async () => {
    const result = await api.browseFolder(pivotConfig.rootPath || config.ashitaPath);
    if (result) {
      const parts = result.replace(/\\/g, '/').split('/');
      setNewOverlay(parts[parts.length - 1]);
    }
  };

  const browseRoot = async () => {
    const result = await api.browseFolder(pivotConfig.rootPath || config.ashitaPath);
    if (result) await saveConfig({ rootPath: result });
  };

  const [hdPackStatus, setHdPackStatus] = useState({}); // { packName: { status, message, percent } }
  const [remapsterRes, setRemapsterRes] = useState('2048');

  useEffect(() => {
    if (!api?.onHDPackProgress) return;
    const cleanup = api.onHDPackProgress((packName, phase, percent, detail) => {
      setHdPackStatus(prev => ({ ...prev, [packName]: { status: 'installing', message: detail, percent } }));
    });
    return cleanup;
  }, []);

  const installHDPack = async (pack) => {
    if (hdPackStatus[pack.name]?.status === 'installing') return;
    setHdPackStatus(prev => ({ ...prev, [pack.name]: { status: 'installing', message: 'Starting download...', percent: 0 } }));

    let result;
    if (pack.releaseAsset) {
      result = await api.installHDPackRelease(config.ashitaPath, pack.name, pack.url, remapsterRes);
    } else {
      result = await api.installHDPack(config.ashitaPath, pack.name, pack.url);
    }
    if (result.success) {
      if (!pivotConfig.overlays.includes(pack.name)) {
        await saveConfig({ overlays: [...pivotConfig.overlays, pack.name] });
      }
      setHdPackStatus(prev => ({ ...prev, [pack.name]: { status: 'done', message: result.message, percent: 100 } }));
    } else {
      setHdPackStatus(prev => ({ ...prev, [pack.name]: { status: 'error', message: result.error, percent: 0 } }));
    }
  };

  return (
    <div className="xipivot-tab">
      <div className="panel xipivot-status-bar">
        <div className="xipivot-status-items">
          <span className={`pill ${dllExists ? 'pill-green' : 'pill-red'}`}>
            pivot.dll {dllExists ? 'Found' : 'Not Found'}
          </span>
          <span className={`pill ${pivotConfig.exists ? 'pill-green' : 'pill-red'}`}>
            pivot.ini {pivotConfig.exists ? 'Found' : 'Not Found'}
          </span>
          <span className="pill pill-teal">{pivotConfig.overlays.length} overlay{pivotConfig.overlays.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {!dllExists && (
        <div className="panel xipivot-install-panel">
          <div className="xipivot-install-info">
            <strong>XIPivot is not installed</strong>
            <p>XIPivot is a polplugin that lets you load HD texture packs and DAT mods without modifying your game files. Click below to automatically download and install it from GitHub.</p>
          </div>
          <div className="xipivot-install-actions">
            <button
              className="btn btn-teal"
              onClick={installXIPivot}
              disabled={installStatus === 'installing'}
            >
              {installStatus === 'installing' ? '◌ Downloading...' : '⚡ Install XIPivot Automatically'}
            </button>
          </div>
          {installMsg && (
            <div className={`xiloader-build-log ${installStatus === 'error' ? 'error' : installStatus === 'done' ? 'success' : ''}`}>
              {installMsg}
            </div>
          )}
        </div>
      )}

      <div className="section-header">DATs Root Path</div>
      <div className="panel">
        <p className="xipivot-hint">The root directory where overlay folders are stored. Default is <code className="mono">{config.ashitaPath}\polplugins\DATs</code>.</p>
        <div className="xipivot-path-row">
          <input
            type="text"
            value={pivotConfig.rootPath || ''}
            onChange={e => setPivotConfig(prev => ({ ...prev, rootPath: e.target.value }))}
            onBlur={e => saveConfig({ rootPath: e.target.value })}
            style={{ flex: 1 }}
            placeholder={config.ashitaPath}
          />
          <button className="btn btn-ghost btn-sm" onClick={browseRoot}>Browse</button>
        </div>
      </div>

      <div className="section-header">Active Overlays</div>
      <div className="panel">
        <p className="xipivot-hint">Top = highest priority. Changes after launch may not affect already-loaded DATs.</p>
        {pivotConfig.overlays.length === 0 ? (
          <div className="xipivot-empty">No overlays configured. Add one below.</div>
        ) : (
          <div className="xipivot-overlay-list">
            {pivotConfig.overlays.map((name, idx) => (
              <div key={idx} className="xipivot-overlay-row">
                <span className="xipivot-overlay-num">{idx + 1}</span>
                <span className="xipivot-overlay-name mono">{name}</span>
                <div className="xipivot-overlay-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => moveOverlay(idx, -1)} disabled={idx === 0}>▲</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => moveOverlay(idx, 1)} disabled={idx === pivotConfig.overlays.length - 1}>▼</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeOverlay(idx)} style={{ color: 'var(--red)' }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="xipivot-add-row">
          <input
            type="text"
            value={newOverlay}
            onChange={e => setNewOverlay(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addOverlay()}
            placeholder="Overlay folder name..."
            style={{ flex: 1 }}
          />
          <button className="btn btn-ghost btn-sm" onClick={browseOverlay}>Browse</button>
          <button className="btn btn-primary btn-sm" onClick={addOverlay} disabled={!newOverlay.trim()}>Add</button>
        </div>
      </div>

      <div className="section-header">Memory Cache</div>
      <div className="panel">
        <p className="xipivot-hint">
          The memory cache keeps recently loaded DAT files in RAM so they don't need to be re-read from disk.
          This speeds up zone transitions and model loading, especially on HDDs.
          {laaStatus.patched ? (
            <> You have the <strong style={{ color: 'var(--green)' }}>4 GB patch</strong> applied, so you have more room to work with —
            but FFXI still shares that memory with addons, plugins, and the game itself. A cache size of 512–1024 MB is a good range.</>
          ) : (
            <> Be careful with large HD packs — FFXI is a 32-bit game limited to <strong style={{ color: 'var(--red)' }}>2 GB RAM</strong> by default,
            so setting this too high can cause crashes. Apply the <strong>4 GB RAM Patch</strong> below to double the available memory.</>
          )}
        </p>
        <div className="setting-row" style={{ borderBottom: pivotConfig.cacheEnabled ? '1px solid var(--border)' : 'none' }}>
          <div className="setting-info">
            <span className="setting-name">Enable Cache</span>
            <span className="setting-hint-inline">
              Recommended: <strong style={{ color: 'var(--green)' }}>ON</strong> if you use any HD texture packs or experience slow zone transitions.
              When enabled, XIPivot stores DAT files it has already loaded in RAM so the game doesn't re-read them from disk every time.
              This makes repeated zone-ins, model loads, and menu opens noticeably faster — especially on mechanical hard drives (HDDs).
              If you're on an SSD with no HD packs, you can leave this off.
            </span>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={pivotConfig.cacheEnabled} onChange={e => saveConfig({ cacheEnabled: e.target.checked })} />
            <span className="toggle-slider" />
          </label>
        </div>
        {pivotConfig.cacheEnabled && (
          <>
            <div className="cache-setting-block">
              <span className="setting-name">Cache Size (MB)</span>
              <span className="setting-hint-inline" style={{ marginBottom: 6 }}>
                {laaStatus.patched
                  ? <>With the <strong style={{ color: 'var(--green)' }}>4 GB patch</strong> applied, you can safely go higher.
                    Recommended: <strong>512 MB</strong> for 1–2 small overlays, <strong>768–1024 MB</strong> for multiple HD packs like AshenbubsHD.
                    Don't exceed 1536 MB — the game, addons, and plugins also need room in the 4 GB address space.</>
                  : <>Without the 4 GB patch, FFXI is capped at 2 GB total RAM.
                    Recommended: <strong>256 MB</strong> for light use, <strong>512 MB max</strong> to stay safe.
                    Going higher risks out-of-memory crashes, especially with multiple addons loaded.
                    Apply the <strong>4 GB RAM Patch</strong> below to unlock more headroom.</>
                }
              </span>
              <div className="cache-options">
                {[
                  { value: 128, label: '128 MB', tag: 'Minimal' },
                  { value: 256, label: '256 MB', tag: 'Light' },
                  { value: 512, label: '512 MB', tag: 'Recommended' },
                  { value: 768, label: '768 MB', tag: 'HD Packs' },
                  { value: 1024, label: '1024 MB', tag: 'Multiple HD' },
                  { value: 1536, label: '1536 MB', tag: 'Heavy Use' },
                  { value: 2048, label: '2048 MB', tag: 'Maximum' }
                ].map(opt => (
                  <button
                    key={opt.value}
                    className={`cache-option-btn ${pivotConfig.cacheSize === opt.value ? 'active' : ''}`}
                    onClick={() => saveConfig({ cacheSize: opt.value })}
                  >
                    <span className="cache-option-value mono">{opt.label}</span>
                    <span className="cache-option-tag">{opt.tag}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="cache-setting-block" style={{ borderBottom: 'none' }}>
              <span className="setting-name">Max Age</span>
              <span className="setting-hint-inline" style={{ marginBottom: 6 }}>
                How long an unused DAT stays in the cache before it gets removed to free up RAM.
                Recommended: <strong>10 min</strong> for most players. Lower to <strong>2–5 min</strong> if you're tight on memory,
                or increase to <strong>30–60 min</strong> if you revisit the same zones frequently and have RAM to spare.
              </span>
              <div className="cache-options">
                {[
                  { value: 60, label: '1 min', tag: 'Low Memory' },
                  { value: 120, label: '2 min', tag: 'Conservative' },
                  { value: 300, label: '5 min', tag: 'Light Use' },
                  { value: 600, label: '10 min', tag: 'Recommended' },
                  { value: 900, label: '15 min', tag: 'Extended' },
                  { value: 1800, label: '30 min', tag: 'Long Sessions' },
                  { value: 3600, label: '1 hour', tag: 'Maximum' }
                ].map(opt => (
                  <button
                    key={opt.value}
                    className={`cache-option-btn ${pivotConfig.cacheMaxAge === opt.value ? 'active' : ''}`}
                    onClick={() => saveConfig({ cacheMaxAge: opt.value })}
                  >
                    <span className="cache-option-value mono">{opt.label}</span>
                    <span className="cache-option-tag">{opt.tag}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="section-header">4GB RAM Patch (Large Address Aware)</div>
      <div className="panel laa-panel">
        <div className="laa-content">
          <div className="laa-info">
            <p className="xipivot-hint" style={{ marginBottom: 8 }}>
              FFXI's <code className="mono">pol.exe</code> is a 32-bit application limited to <strong>2 GB of RAM</strong> by default.
              This patch flips a flag in the executable's header that tells 64-bit Windows to allow the process to use <strong>up to 4 GB</strong> instead.
              This is highly recommended if you use HD texture packs — more textures means more memory, and hitting the 2 GB limit causes crashes.
            </p>
            <p className="xipivot-hint" style={{ marginBottom: 0, fontSize: 12 }}>
              The patch modifies a single byte in <code className="mono">pol.exe</code>. It's safe, reversible, and widely used by the FFXI community.
              Game updates may replace the file, so you may need to re-apply after a version update.
            </p>
          </div>
          <div className="laa-controls">
            {!config.ffxiPath ? (
              <span className="pill pill-red">Set FFXI path in Profiles first</span>
            ) : !laaStatus.exists ? (
              <span className="pill pill-red">pol.exe not found — check your FFXI install path</span>
            ) : (
              <>
                <span className={`pill ${laaStatus.patched ? 'pill-green' : 'pill-red'}`}>
                  {laaStatus.patched ? '4 GB Enabled' : '2 GB (Default)'}
                </span>
                <button
                  className={`btn ${laaStatus.patched ? 'btn-ghost' : 'btn-primary'} btn-sm`}
                  onClick={toggleLAA}
                  disabled={laaWorking}
                >
                  {laaWorking ? '◌ Working...' : laaStatus.patched ? 'Unpatch (Revert to 2 GB)' : '⚡ Patch pol.exe for 4 GB'}
                </button>
              </>
            )}
            {laaStatus.error && (
              <span className="pill pill-red" style={{ fontSize: 11 }}>{laaStatus.error}</span>
            )}
          </div>
          {laaMsg.text && (
            <div className={`laa-feedback ${laaMsg.type}`}>
              {laaMsg.text}
            </div>
          )}
          {polExePath && laaStatus.exists && (
            <div className="laa-path mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
              {polExePath}
            </div>
          )}
        </div>
      </div>

      <div className="section-header">Popular HD Mod Packs</div>
      <p className="xipivot-hint">
        Click "Install" to automatically download the mod from GitHub and set it up as an XIPivot overlay.
        The files will be extracted to your DATs folder and registered in your config. Some packs are large and may take a minute to download.
      </p>
      <div className="hdpacks-grid">
        {HD_PACKS.map(pack => {
          const added = pivotConfig.overlays.includes(pack.name);
          const ps = hdPackStatus[pack.name];
          const isInstalling = ps?.status === 'installing';
          return (
            <div key={pack.name} className={`panel hdpack-card ${added ? 'hdpack-installed' : ''}`}>
              <h3 className="hdpack-name cinzel">{pack.name}</h3>
              <p className="hdpack-desc">{pack.desc}</p>
              {pack.releaseAsset && (
                <div className="hdpack-resolution">
                  <span className="hdpack-res-label">Resolution:</span>
                  <button className={`btn btn-sm ${remapsterRes === '1024' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setRemapsterRes('1024')}>1024</button>
                  <button className={`btn btn-sm ${remapsterRes === '2048' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setRemapsterRes('2048')}>2048</button>
                </div>
              )}
              <div className="hdpack-actions">
                <button
                  className={`btn ${added ? 'btn-ghost' : 'btn-primary'} btn-sm`}
                  onClick={() => installHDPack(pack)}
                  disabled={isInstalling || (added && ps?.status === 'done')}
                >
                  {isInstalling ? '◌ Downloading...' : added && ps?.status === 'done' ? '✓ Installed' : added ? '↻ Reinstall' : '⚡ Install'}
                </button>
                {pack.url && (
                  <button
                    className="btn btn-ghost btn-sm hdpack-link"
                    onClick={() => api.openExternal(pack.url)}
                  >
                    View on GitHub ↗
                  </button>
                )}
              </div>
              {ps && (
                <div className="hdpack-progress-area">
                  {ps.status === 'installing' && (
                    <div className="hdpack-progress-bar">
                      <div className="hdpack-progress-fill" style={{ width: `${ps.percent || 0}%` }} />
                    </div>
                  )}
                  <div className={`hdpack-status-msg ${ps.status === 'error' ? 'error' : ps.status === 'done' ? 'success' : ''}`}>
                    {ps.message}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="section-header">XIPivot Profile Setup</div>
      <div className="panel">
        <p className="xipivot-hint">XIPivot is a <strong>polplugin</strong>, not a regular addon or plugin. Add these lines to your Ashita profile INI:</p>
        <pre className="xipivot-code mono">{`[ashita.polplugins]
pivot`}</pre>
        <p className="xipivot-hint" style={{ marginTop: 12 }}>
          This tells Ashita to load the pivot polplugin at POL startup. The plugin reads its config from <code className="mono">config/pivot/pivot.ini</code>.
        </p>
      </div>
    </div>
  );
}

export default XIPivotTab;
