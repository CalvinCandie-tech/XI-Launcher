import React, { useState, useEffect, useCallback } from 'react';
import './LoaderPicker.css';

const api = window.xiAPI;

// Fired after a loader choice or install changes, so every mounted picker and the Home
// status check refresh (tabs stay mounted, so a change in one doesn't re-render the other).
export const LOADER_CHANGED_EVENT = 'xi-loader-changed';
const announceChange = () => window.dispatchEvent(new Event(LOADER_CHANGED_EVENT));

// Loader choice for one profile: the dropdown plus what it resolves to right now. The full
// layout (Profiles-tab popup) also lists every loader with Install / Check for update; the
// compact layout (Home tab) only offers Install when the chosen loader is missing.
function LoaderPicker({ profileName, compact = false, onChange }) {
  const [loaderList, setLoaderList] = useState([]);
  const [setting, setSetting] = useState({ loader: 'xiloader', loaderExePath: '' });
  const [resolved, setResolved] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(null); // id of the loader being installed/checked
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    if (!api?.listLoaders) return;
    try {
      setLoaderList(await api.listLoaders());
      if (!profileName) { setResolved(null); return; }
      const ps = (await api.loadProfileSettings(profileName)) || {};
      setSetting({ loader: ps.loader || 'xiloader', loaderExePath: ps.loaderExePath || '' });
      setResolved(await api.resolveLoader(profileName));
    } catch (e) {
      console.error('Failed to load loader settings', e);
    }
  }, [profileName]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    window.addEventListener(LOADER_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(LOADER_CHANGED_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    if (!api?.onXiloaderDownloadProgress) return;
    return api.onXiloaderDownloadProgress((percent) => setProgress(percent));
  }, []);

  const flashStatus = (text) => {
    setStatus(text);
    setTimeout(() => setStatus(''), 8000);
  };

  const save = async (loader, loaderExePath = '') => {
    if (!api || !profileName) return;
    try {
      const existing = (await api.loadProfileSettings(profileName)) || {};
      const next = { ...existing, loader };
      if (loader === 'custom') next.loaderExePath = loaderExePath;
      else delete next.loaderExePath;
      await api.saveProfileSettings(profileName, next);
      await refresh();
      if (onChange) onChange();
      announceChange();
      flashStatus(`Saved. "${profileName}" takes the new loader on its next launch.`);
    } catch (e) {
      setStatus(`Error: ${e.message || e}`);
    }
  };

  const browseCustom = async () => {
    if (!api?.browseLoaderExe) return;
    const picked = await api.browseLoaderExe(setting.loaderExePath || '');
    if (picked) await save('custom', picked);
  };

  const runAction = async (id, action) => {
    setBusy(id);
    setProgress(0);
    try {
      const result = action === 'install' ? await api.downloadLoader(id) : await api.checkLoaderUpdate(id);
      flashStatus(result.success
        ? (result.upToDate ? `Already up to date (v${result.currentVersion}).` : result.message)
        : result.error);
    } catch (e) {
      setStatus(`Failed: ${e.message || e}`);
    } finally {
      setBusy(null);
      await refresh();
      if (onChange) onChange();
      announceChange();
    }
  };

  if (!profileName) {
    return compact ? null : <p className="loader-picker-hint">Select a profile to choose its loader.</p>;
  }
  // Retail (PlayOnline) profiles don't boot through a loader.
  if (resolved?.isRetail) {
    return compact ? null : <p className="loader-picker-hint">"{profileName}" is a retail (PlayOnline) profile — it doesn't use a loader.</p>;
  }

  const select = (
    <select
      className="form-select"
      value={setting.loader}
      onChange={e => {
        const v = e.target.value;
        if (v === 'custom') browseCustom();
        else save(v);
      }}
    >
      {loaderList.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      <option value="custom">Custom exe…</option>
    </select>
  );

  const resolvedLine = resolved && (
    <p className={`loader-picker-resolved ${resolved.exists ? 'ok' : 'err'}`}>
      {resolved.exists ? '✓ ' : '⚠ '}{resolved.label}{resolved.exists ? '' : ' — not installed'}
    </p>
  );

  const statusLine = status && <p className="loader-picker-status">{status}</p>;

  if (compact) {
    const canInstall = resolved && !resolved.exists && resolved.id !== 'custom';
    return (
      <div className="form-field loader-picker loader-picker-compact">
        <div className="form-field-label"><span className="form-field-name">Loader</span></div>
        {select}
        <div className="loader-picker-compact-row">
          {resolvedLine}
          {canInstall && (
            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => runAction(resolved.id, 'install')}>
              {busy ? `${progress}%` : 'Install'}
            </button>
          )}
        </div>
        {statusLine}
      </div>
    );
  }

  return (
    <div className="loader-picker">
      <div className="form-field-label"><span className="form-field-name">Loader</span></div>
      <div className="form-control-row">
        {select}
        {setting.loader === 'custom' && (
          <button className="btn btn-sm btn-ghost" onClick={browseCustom}>Browse</button>
        )}
      </div>
      {setting.loader === 'custom' && setting.loaderExePath && (
        <p className="loader-picker-path mono">{setting.loaderExePath}</p>
      )}
      {resolvedLine}
      <div className="loader-picker-rows">
        {loaderList.map(l => (
          <div className="loader-picker-row" key={l.id}>
            <span className="loader-picker-row-name">{l.name}</span>
            <span className={`pill ${l.installed ? 'pill-green' : 'pill-red'}`}>
              {l.installed ? `Installed${l.tag ? ` ${l.tag}` : ''}` : 'Not installed'}
            </span>
            <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => runAction(l.id, l.installed ? 'update' : 'install')}>
              {busy === l.id ? `${progress}%` : (l.installed ? 'Check for update' : 'Install')}
            </button>
          </div>
        ))}
      </div>
      {statusLine}
    </div>
  );
}

export default LoaderPicker;
