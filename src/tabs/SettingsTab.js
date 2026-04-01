import React, { useState, useEffect, useCallback } from 'react';
import './SettingsTab.css';

const api = window.xiAPI;

const REG_KEY_LABELS = {
  '0001': 'Screen Width',
  '0002': 'Screen Height',
  '0003': 'Background Width',
  '0004': 'Background Height',
  '0007': 'Display Mode',
  '0026': 'Sound Enabled',
  '0028': 'Texture Compression',
  '0029': 'Mip Maps',
  '0030': 'Bump Mapping',
  '0034': 'Environment Animation',
  '0039': 'Max Sounds',
  '0040': 'Gamma'
};

const REG_VALUE_LABELS = {
  '0007': { 0: 'Fullscreen', 1: 'Windowed' },
  '0026': { 0: 'Off', 1: 'On' },
  '0028': { 0: 'Compressed', 1: 'Uncompressed', 2: 'Uncompressed DXT' },
  '0029': { 0: 'Off', 1: 'On' },
  '0030': { 0: 'Off', 1: 'On' },
  '0034': { 0: 'Off', 1: 'Low', 2: 'High' },
  '0037': { 0: 'Off', 1: 'On' }  // Note: 0037 in Windows registry = Hardware Mouse, but in Ashita INI = UI width. Don't write this to profile INI.
};

function formatRegValue(key, value) {
  const labels = REG_VALUE_LABELS[key];
  if (labels && labels[value] !== undefined) return labels[value];
  return String(value);
}

const SCREEN_PRESETS = [
  { w: 640, h: 480, label: '640×480', ratio: '4:3', group: '4:3' },
  { w: 800, h: 600, label: '800×600', ratio: '4:3', group: '4:3' },
  { w: 1024, h: 768, label: '1024×768', ratio: '4:3', group: '4:3' },
  { w: 1280, h: 1024, label: '1280×1024', ratio: '4:3', group: '4:3' },
  { w: 1600, h: 1200, label: '1600×1200', ratio: '4:3', group: '4:3' },
  { w: 720, h: 480, label: '720×480', ratio: '16:9', group: '16:9' },
  { w: 1280, h: 720, label: '1280×720', ratio: 'HD', group: '16:9' },
  { w: 1920, h: 1080, label: '1920×1080', ratio: 'FHD', group: '16:9' },
  { w: 2560, h: 1440, label: '2560×1440', ratio: 'QHD', group: '16:9' },
  { w: 3840, h: 2160, label: '3840×2160', ratio: '4K', group: '16:9' },
  { w: 800, h: 480, label: '800×480', ratio: '16:10', group: '16:10' },
  { w: 1280, h: 768, label: '1280×768', ratio: '16:10', group: '16:10' },
  { w: 1440, h: 900, label: '1440×900', ratio: '16:10', group: '16:10' },
  { w: 1680, h: 1050, label: '1680×1050', ratio: '16:10', group: '16:10' },
  { w: 1920, h: 1200, label: '1920×1200', ratio: '16:10', group: '16:10' },
  { w: 2560, h: 1080, label: '2560×1080', ratio: 'UWFHD', group: 'Ultrawide' },
  { w: 3440, h: 1440, label: '3440×1440', ratio: 'UWQHD', group: 'Ultrawide' },
  { w: 3840, h: 1600, label: '3840×1600', ratio: 'UW4K', group: 'Ultrawide' },
  { w: 3840, h: 1080, label: '3840×1080', ratio: 'SUWFHD', group: 'Super Ultrawide' },
  { w: 5120, h: 1440, label: '5120×1440', ratio: 'SUWQHD', group: 'Super Ultrawide' },
  { w: 5120, h: 2160, label: '5120×2160', ratio: 'SUW4K', group: 'Super Ultrawide' }
];

const BG_PRESETS = [
  { w: 512, h: 512, label: '512×512', group: 'Standard' },
  { w: 640, h: 480, label: '640×480', group: 'Standard' },
  { w: 800, h: 600, label: '800×600', group: 'Standard' },
  { w: 1024, h: 768, label: '1024×768', group: 'Standard' },
  { w: 1280, h: 720, label: '1280×720', group: 'Standard' },
  { w: 1280, h: 1024, label: '1280×1024', group: 'Standard' },
  { w: 1920, h: 1080, label: '1920×1080', group: 'Standard' },
  { w: 2560, h: 1440, label: '2560×1440 (2× AA)', group: 'Standard' },
  { w: 3840, h: 2160, label: '3840×2160 (4× AA)', group: 'Standard' },
  { w: 2560, h: 1080, label: '2560×1080', group: 'Ultrawide' },
  { w: 3440, h: 1440, label: '3440×1440', group: 'Ultrawide' },
  { w: 3840, h: 1600, label: '3840×1600', group: 'Ultrawide' },
  { w: 5120, h: 2160, label: '5120×2160 (2× AA)', group: 'Ultrawide' },
  { w: 6880, h: 2880, label: '6880×2880 (4× AA)', group: 'Ultrawide' },
  { w: 3840, h: 1080, label: '3840×1080', group: 'Super Ultrawide' },
  { w: 5120, h: 1440, label: '5120×1440', group: 'Super Ultrawide' },
  { w: 7680, h: 2160, label: '7680×2160 (2× AA)', group: 'Super Ultrawide' },
  { w: 10240, h: 2880, label: '10240×2880 (4× AA)', group: 'Super Ultrawide' }
];

const RECOMMENDED_PRESETS = [
  {
    name: 'Low (Performance)',
    desc: 'Minimal settings for older hardware',
    values: { '0001': 800, '0002': 600, '0003': 800, '0004': 600, '0028': 0, '0029': 0, '0030': 0, '0034': 0, '0037': 0 }
  },
  {
    name: '1080p Balanced',
    desc: 'Standard 1080p with good quality textures',
    values: { '0001': 1920, '0002': 1080, '0003': 1920, '0004': 1080, '0028': 2, '0029': 1, '0030': 1, '0034': 2, '0037': 1 }
  },
  {
    name: '1080p + 4K Oversample',
    desc: 'Renders at 4K, displays at 1080p for natural AA',
    recommended: true,
    values: { '0001': 1920, '0002': 1080, '0003': 3840, '0004': 2160, '0028': 2, '0029': 1, '0030': 1, '0034': 2, '0037': 1 }
  },
  {
    name: '2K (1440p)',
    desc: '2K with matched render resolution, all quality on',
    values: { '0001': 2560, '0002': 1440, '0003': 2560, '0004': 1440, '0028': 2, '0029': 1, '0030': 1, '0034': 2, '0037': 1 }
  },
  {
    name: '2K + 4K Oversample',
    desc: 'Renders at 4K, displays at 1440p — sharp with AA',
    recommended: true,
    values: { '0001': 2560, '0002': 1440, '0003': 3840, '0004': 2160, '0028': 2, '0029': 1, '0030': 1, '0034': 2, '0037': 1 }
  },
  {
    name: '4K Native',
    desc: 'True 4K at 3840×2160, maximum clarity',
    values: { '0001': 3840, '0002': 2160, '0003': 3840, '0004': 2160, '0028': 2, '0029': 1, '0030': 1, '0034': 2, '0037': 1 }
  },
  {
    name: 'Ultrawide 1080p',
    desc: '2560×1080 ultrawide with matched render',
    values: { '0001': 2560, '0002': 1080, '0003': 2560, '0004': 1080, '0028': 2, '0029': 1, '0030': 1, '0034': 2, '0037': 1 }
  },
  {
    name: 'Ultrawide 1440p',
    desc: '3440×1440 ultrawide with 2× AA oversample',
    recommended: true,
    values: { '0001': 3440, '0002': 1440, '0003': 6880, '0004': 2880, '0028': 2, '0029': 1, '0030': 1, '0034': 2, '0037': 1 }
  },
  {
    name: 'Super Ultrawide 1080p',
    desc: '3840×1080 super ultrawide with matched render',
    values: { '0001': 3840, '0002': 1080, '0003': 3840, '0004': 1080, '0028': 2, '0029': 1, '0030': 1, '0034': 2, '0037': 1 }
  },
  {
    name: 'Super Ultrawide 1440p',
    desc: '5120×1440 super ultrawide with 2× AA oversample',
    recommended: true,
    values: { '0001': 5120, '0002': 1440, '0003': 10240, '0004': 2880, '0028': 2, '0029': 1, '0030': 1, '0034': 2, '0037': 1 }
  }
];

function SettingsTab({ config, onSettingsSaved }) {
  const [regValues, setRegValues] = useState({});
  const [regPath, setRegPath] = useState(null);
  const [pendingWrites, setPendingWrites] = useState({});
  const [loading, setLoading] = useState(true);
  const [applyStatus, setApplyStatus] = useState(''); // '' | 'saving' | 'success' | 'error'
  const [applyMessage, setApplyMessage] = useState('');
  const [hasBackup, setHasBackup] = useState(false);
  const [backupTime, setBackupTime] = useState(null);
  const [gpuInfo, setGpuInfo] = useState(null);
  const [gpuDetecting, setGpuDetecting] = useState(false);

  const loadRegistry = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    const result = await api.readRegistry();
    setRegValues(result.values || {});
    setRegPath(result.regPath);
    setPendingWrites({});
    setLoading(false);
  }, []);

  useEffect(() => { loadRegistry(); }, [loadRegistry]);

  useEffect(() => {
    if (!api?.getRegistryBackup) return;
    api.getRegistryBackup().then(backup => {
      if (backup) {
        setHasBackup(true);
        setBackupTime(backup.timestamp);
      }
    });
  }, []);

  const detectGPU = async () => {
    if (!api?.detectGPU) return;
    setGpuDetecting(true);
    const result = await api.detectGPU();
    setGpuDetecting(false);
    if (result.success) setGpuInfo(result);
  };

  useEffect(() => {
    if (api?.detectGPU) detectGPU();
  // eslint-disable-next-line
  }, []);

  const undoRegistry = async () => {
    if (!api?.restoreRegistryBackup) return;
    setApplyStatus('saving');
    setApplyMessage('Restoring previous registry values...');
    const result = await api.restoreRegistryBackup();
    if (result.success) {
      setApplyStatus('success');
      setApplyMessage(`Restored ${result.count} registry values to previous state.`);
      await loadRegistry();
    } else {
      setApplyStatus('error');
      setApplyMessage(result.error || 'Failed to restore registry backup.');
    }
    setTimeout(() => { setApplyStatus(''); setApplyMessage(''); }, 4000);
  };

  const getValue = (key) => {
    if (key in pendingWrites) return pendingWrites[key];
    return regValues[key] ?? 0;
  };

  const setPending = (key, value) => {
    setPendingWrites(prev => ({ ...prev, [key]: value }));
  };

  const [showConfirm, setShowConfirm] = useState(false);

  const requestApply = () => {
    setShowConfirm(true);
  };

  const applyChanges = async () => {
    setShowConfirm(false);
    const targetPath = regPath || 'HKLM\\SOFTWARE\\PlayOnlineUS\\SquareEnix\\FinalFantasyXI';
    setApplyStatus('saving');
    setApplyMessage('Writing to registry...');

    const entries = Object.entries(pendingWrites).map(([key, value]) => ({ key, value }));
    const result = await api.writeRegistryBatch(targetPath, entries);

    if (!result.success) {
      setApplyStatus('error');
      setApplyMessage(result.error || 'Failed to write registry. Try running as Administrator.');
    } else {
      setApplyStatus('success');
      const msg = result.fallback
        ? `${result.count} setting(s) saved to user registry (HKCU).`
        : `${result.count} setting(s) saved successfully.`;
      setApplyMessage(msg);
      if (!regPath) setRegPath(result.fallback || targetPath);
    }
    // Update 0001/0002 in the active profile for the aspect addon
    if (config?.activeProfile && config?.ashitaPath && api) {
      try {
        const profile = await api.readProfile(config.ashitaPath, config.activeProfile);
        if (profile.exists && (pendingWrites['0001'] !== undefined || pendingWrites['0002'] !== undefined)) {
          const lines = profile.content.split('\n');
          const regIdx = lines.findIndex(l => l.trim() === '[ffxi.registry]');
          if (regIdx !== -1) {
            let nextIdx = lines.length;
            for (let i = regIdx + 1; i < lines.length; i++) {
              if (lines[i].trim().startsWith('[')) { nextIdx = i; break; }
            }
            const regEntries = {};
            for (let i = regIdx + 1; i < nextIdx; i++) {
              const match = lines[i].match(/^(\S+)\s*=\s*(.+)/);
              if (match) regEntries[match[1].trim()] = match[2].trim();
            }
            if (pendingWrites['0001'] !== undefined) regEntries['0001'] = String(pendingWrites['0001']);
            if (pendingWrites['0002'] !== undefined) regEntries['0002'] = String(pendingWrites['0002']);
            const before = lines.slice(0, regIdx + 1);
            const after = lines.slice(nextIdx);
            const regLines = Object.entries(regEntries).map(([k, v]) => `${k} = ${v}`);
            const newContent = [...before, ...regLines, '', ...after].join('\n');
            await api.saveProfile(config.ashitaPath, config.activeProfile, newContent);
          }
        }
      } catch {}
    }

    await loadRegistry();
    setHasBackup(true);
    setBackupTime(new Date().toISOString());
    if (onSettingsSaved) onSettingsSaved();
    setTimeout(() => { setApplyStatus(''); setApplyMessage(''); }, 4000);
  };

  const applyPreset = (preset) => {
    const newPending = { ...pendingWrites };
    for (const [k, v] of Object.entries(preset.values)) {
      newPending[k] = v;
    }
    setPendingWrites(newPending);
  };

  const setScreenRes = (w, h) => {
    setPending('0001', w);
    setPending('0002', h);
    // Auto-adjust background resolution to maintain matching aspect ratio
    const currentBgW = getValue('0003');
    const currentBgH = getValue('0004');
    const currentBgRatio = currentBgH > 0 ? (currentBgW / currentBgH).toFixed(2) : 0;
    const newScreenRatio = h > 0 ? (w / h).toFixed(2) : 0;
    if (Math.abs(currentBgRatio - newScreenRatio) > 0.05) {
      setPending('0003', w * 2);
      setPending('0004', h * 2);
    }
  };

  const setBgRes = (w, h) => {
    setPending('0003', w);
    setPending('0004', h);
  };

  const pendingCount = Object.keys(pendingWrites).length;
  const screenW = getValue('0001');
  const screenH = getValue('0002');
  const bgW = getValue('0003');
  const bgH = getValue('0004');

  // Detect aspect ratio mismatch between screen and background resolution
  const screenRatio = screenH > 0 ? (screenW / screenH).toFixed(2) : 0;
  const bgRatio = bgH > 0 ? (bgW / bgH).toFixed(2) : 0;
  const aspectMismatch = screenH > 0 && bgH > 0 && Math.abs(screenRatio - bgRatio) > 0.05;

  if (loading) return <div className="settings-loading">Loading registry...</div>;

  return (
    <div className="settings-tab">
      <div className="settings-header-bar panel">
        <div className="settings-header-left">
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {regPath || 'No registry path found'}
          </span>
          <span className={`pill ${regPath ? 'pill-green' : 'pill-red'}`}>
            {regPath ? 'Connected' : 'Not Found'}
          </span>
        </div>
        <div className="settings-header-right">
          {hasBackup && (
            <button className="btn btn-ghost btn-sm" onClick={undoRegistry} title={backupTime ? `Backup from ${new Date(backupTime).toLocaleString()}` : 'Undo last registry change'}>
              ↩ Undo Last Change
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={loadRegistry}>↻ Refresh</button>
          {pendingCount > 0 && (
            <button className="btn btn-primary" onClick={requestApply}>
              Apply {pendingCount} Change{pendingCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      <div className="settings-warning panel">
        ⚠ These settings modify the Windows Registry (FFXI configuration). Changes are only written when you click Apply.
      </div>

      {aspectMismatch && (
        <div className="panel" style={{ padding: '12px 18px', marginBottom: 16, background: 'rgba(231, 76, 60, 0.1)', border: '1px solid rgba(231, 76, 60, 0.3)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ color: '#e74c3c', fontWeight: 700, fontSize: 14 }}>⚠ Aspect Ratio Mismatch</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
            Your screen resolution ({screenW}x{screenH}) and background resolution ({bgW}x{bgH}) have different aspect ratios.
            This will cause the game to render a <strong>split/duplicated image</strong>. The background resolution must match the screen's aspect ratio.
          </p>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              // Auto-fix: scale background to 2x screen resolution with matching aspect ratio
              setPending('0003', screenW * 2);
              setPending('0004', screenH * 2);
            }}
          >
            Fix: Set background to {screenW * 2}x{screenH * 2} (2x oversample)
          </button>
        </div>
      )}

      {gpuInfo && (
        <div className="panel" style={{ marginBottom: 16, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="section-header" style={{ margin: 0 }}>Detected GPU</span>
            <button className="btn btn-ghost btn-sm" onClick={detectGPU} disabled={gpuDetecting}>↻ Re-scan</button>
          </div>
          {gpuInfo.gpus?.map((gpu, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <span className="mono" style={{ color: 'var(--teal)', fontSize: 13 }}>{gpu.name}</span>
              <span className="pill pill-teal" style={{ fontSize: 10 }}>{gpu.vram} MB VRAM</span>
            </div>
          ))}
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
            {gpuInfo.recommendation}
          </p>
        </div>
      )}

      <div className="section-header">Recommended Presets</div>
      <p className="settings-hint" style={{ marginBottom: 12 }}>Quick-apply a full configuration. You can fine-tune individual settings below.</p>
      <div className="presets-grid">
        {RECOMMENDED_PRESETS.map(preset => {
          const isActive = Object.entries(preset.values).every(([k, v]) => (regValues[k] ?? 0) === v);
          return (
            <div key={preset.name} className={`preset-card panel ${isActive ? 'preset-active' : ''}`} onClick={() => applyPreset(preset)}>
              <div className="preset-card-header">
                <h3 className={`preset-name cinzel ${isActive ? 'gold' : ''}`}>{preset.name}</h3>
                {isActive && <span className="pill pill-gold" style={{ fontSize: 10 }}>Active</span>}
              </div>
              <p className="preset-desc">{preset.desc}</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>
                {isActive ? '✓ Selected' : 'Apply Preset'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="section-header">Screen (Overlay) Resolution</div>
      <div className="panel">
        <p className="settings-hint">The resolution of the 2D overlay (UI, menus, text). This is what your monitor displays.</p>
        {['4:3', '16:9', '16:10', 'Ultrawide', 'Super Ultrawide'].map(group => {
          const presets = SCREEN_PRESETS.filter(p => p.group === group);
          return (
            <div key={group} className="res-group">
              <span className="res-group-label">{group}</span>
              <div className="res-presets">
                {presets.map(p => (
                  <button
                    key={p.label}
                    className={`res-preset-btn ${screenW === p.w && screenH === p.h ? 'active' : ''}`}
                    onClick={() => setScreenRes(p.w, p.h)}
                  >
                    <span className="res-preset-label">{p.label}</span>
                    <span className="res-preset-ratio">{p.ratio}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="res-custom">
          <label>Custom:</label>
          <input type="number" value={screenW} onChange={e => setPending('0001', parseInt(e.target.value) || 0)} style={{ width: 80 }} />
          <span>×</span>
          <input type="number" value={screenH} onChange={e => setPending('0002', parseInt(e.target.value) || 0)} style={{ width: 80 }} />
        </div>
      </div>

      <div className="section-header">Display Mode</div>
      <div className="panel">
        <p className="settings-hint">Controls how FFXI is displayed on your screen. For borderless windowed, use Ashita's built-in borderless plugin in the Addons tab.</p>
        <div className="dgv-option-row">
          {[
            { value: 0, label: 'Fullscreen', desc: 'Exclusive fullscreen — best performance but alt-tab can cause issues' },
            { value: 1, label: 'Windowed', desc: 'Runs in a resizable window with a title bar — use with Ashita borderless plugin for best results' }
          ].map(opt => (
            <button
              key={opt.value}
              className={`cache-option-btn ${getValue('0007') === opt.value ? 'active' : ''}`}
              onClick={() => setPending('0007', opt.value)}
            >
              <span className="cache-option-value">{opt.label}</span>
              <span className="cache-option-tag">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="section-header">Background (3D Render) Resolution</div>
      <div className="panel">
        <p className="settings-hint">
          The resolution 3D geometry is rendered at before scaling. Setting higher than screen res creates oversampling AA — the biggest visual improvement. Recommended: 2× screen res.
        </p>
        {['Standard', 'Ultrawide', 'Super Ultrawide'].map(group => {
          const presets = BG_PRESETS.filter(p => p.group === group);
          return (
            <div key={group} className="res-group">
              <span className="res-group-label">{group}</span>
              <div className="res-presets">
                {presets.map(p => (
                  <button
                    key={p.label}
                    className={`res-preset-btn ${bgW === p.w && bgH === p.h ? 'active' : ''}`}
                    onClick={() => setBgRes(p.w, p.h)}
                  >
                    <span className="res-preset-label">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="res-custom">
          <label>Custom:</label>
          <input type="number" value={bgW} onChange={e => setPending('0003', parseInt(e.target.value) || 0)} style={{ width: 80 }} />
          <span>×</span>
          <input type="number" value={bgH} onChange={e => setPending('0004', parseInt(e.target.value) || 0)} style={{ width: 80 }} />
        </div>
      </div>

      <div className="section-header">Graphics Quality</div>
      <div className="panel">
        <p className="settings-hint">These settings control how FFXI renders textures and effects. Uncompressed textures look sharper, mip maps reduce shimmer on distant surfaces, and bump mapping adds depth to walls and terrain.</p>
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-name">Texture Compression</span>
            <span className="setting-hint-inline">Compressed = smaller/faster, Uncompressed DXT = best quality with minimal performance cost</span>
          </div>
          <select value={getValue('0028')} onChange={e => setPending('0028', parseInt(e.target.value))}>
            <option value={0}>Compressed</option>
            <option value={1}>Uncompressed</option>
            <option value={2}>Uncompressed DXT</option>
          </select>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-name">Mip Maps</span>
            <span className="setting-hint-inline">Reduces texture shimmer at distance</span>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={getValue('0029') === 1} onChange={e => setPending('0029', e.target.checked ? 1 : 0)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-name">Bump Mapping</span>
            <span className="setting-hint-inline">Adds surface depth to textures</span>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={getValue('0030') === 1} onChange={e => setPending('0030', e.target.checked ? 1 : 0)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-name">Environment Animation</span>
            <span className="setting-hint-inline">Controls animated effects like swaying trees, flowing water, and weather particles</span>
          </div>
          <select value={getValue('0034')} onChange={e => setPending('0034', parseInt(e.target.value))}>
            <option value={0}>Off</option>
            <option value={1}>Low</option>
            <option value={2}>High</option>
          </select>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-name">Gamma</span>
            <span className="setting-hint-inline">Adjusts overall screen brightness — increase if the game looks too dark</span>
          </div>
          <div className="setting-range-group">
            <input type="range" min={0} max={100} value={getValue('0040')} onChange={e => setPending('0040', parseInt(e.target.value))} />
            <span className="mono" style={{ fontSize: 12, minWidth: 30, textAlign: 'right' }}>{getValue('0040')}</span>
          </div>
        </div>
      </div>

      <div className="section-header">Audio</div>
      <div className="panel">
        <p className="settings-hint">Controls FFXI's sound system. Disabling sound can improve performance on low-end hardware. The simultaneous sounds slider controls how many sound effects can play at once — higher values sound richer in busy battles but use more CPU.</p>
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-name">Sound Enabled</span>
            <span className="setting-hint-inline">Master toggle for all in-game audio including music, SFX, and ambient sounds</span>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={getValue('0026') === 1} onChange={e => setPending('0026', e.target.checked ? 1 : 0)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-name">Max Simultaneous Sounds</span>
            <span className="setting-hint-inline">How many sound effects can play at the same time — 20–32 is a good balance</span>
          </div>
          <div className="setting-range-group">
            <input type="range" min={8} max={64} step={4} value={getValue('0039')} onChange={e => setPending('0039', parseInt(e.target.value))} />
            <span className="mono" style={{ fontSize: 12, minWidth: 30, textAlign: 'right' }}>{getValue('0039')}</span>
          </div>
        </div>
      </div>

      {(pendingCount > 0 || applyStatus) && (
        <div className="settings-sticky-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {pendingCount > 0 && <span>{pendingCount} pending change{pendingCount !== 1 ? 's' : ''}</span>}
            {applyMessage && (
              <span className={`pill ${applyStatus === 'success' ? 'pill-green' : applyStatus === 'error' ? 'pill-red' : 'pill-gold'}`}>
                {applyMessage}
              </span>
            )}
          </div>
          {pendingCount > 0 && (
            <button className="btn btn-primary" onClick={requestApply} disabled={applyStatus === 'saving'}>
              {applyStatus === 'saving' ? '◌ Saving...' : `Apply ${pendingCount} Change${pendingCount !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}

      {showConfirm && (
        <div className="settings-confirm-overlay" onClick={() => setShowConfirm(false)}>
          <div className="settings-confirm-dialog" onClick={e => e.stopPropagation()}>
            <h3 className="cinzel">Apply Registry Changes?</h3>
            <p>This will write <strong>{pendingCount} setting{pendingCount !== 1 ? 's' : ''}</strong> to the Windows Registry. A single admin prompt may appear.</p>
            <div className="settings-confirm-preview">
              {Object.entries(pendingWrites).map(([key, value]) => (
                <div key={key} className="settings-confirm-row">
                  <span className="confirm-label">{REG_KEY_LABELS[key] || key}</span>
                  <span className="confirm-arrow">→</span>
                  <span className="confirm-value mono">{formatRegValue(key, value)}</span>
                </div>
              ))}
            </div>
            <div className="settings-confirm-actions">
              <button className="btn btn-ghost" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyChanges}>Yes, Apply All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsTab;
