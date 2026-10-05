import React, { useState, useEffect, useCallback } from 'react';
import './GameFilesPicker.css';

const api = window.xiAPI;

// Fired after a profile's game files change, so the Home picker, the FFXI Files Updater's
// target line and the Profiles tab stay in step (tabs stay mounted).
export const GAME_FILES_CHANGED_EVENT = 'xi-game-files-changed';
export const announceGameFilesChange = () => window.dispatchEvent(new Event(GAME_FILES_CHANGED_EVENT));

// Per-profile choice of game files: the installed FFXI (PlayOnline), or the profile's own
// sandboxed copy in a folder the player picks — run through Ashita's Sandbox plugin, no
// install needed. Main saves the choice and writes the ini (electron/sandbox.js).
// inDropdown: shown in the Home tab's Game files drop-down, which already has its own heading
// and sits beside the Files updater tile. updaterName: where the Files Updater is, when the
// picker is shown somewhere else (the Home setup card has it right below).
function GameFilesPicker({ profileName, ffxiPath, inDropdown = false, updaterName }) {
  const [status, setStatus] = useState(null);
  const [pendingSandbox, setPendingSandbox] = useState(false); // chose "Sandboxed copy", no folder yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showInfo, setShowInfo] = useState(false);

  const refresh = useCallback(async () => {
    if (!api?.getProfileGameFiles || !profileName) { setStatus(null); return; }
    const result = await api.getProfileGameFiles(profileName);
    setStatus(result?.error ? null : result);
    setPendingSandbox(false);
    setError('');
  }, [profileName]);

  // ffxiPath is the installed game's folder, so re-check when it changes too.
  useEffect(() => { refresh(); }, [refresh, ffxiPath]);

  useEffect(() => {
    window.addEventListener(GAME_FILES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(GAME_FILES_CHANGED_EVENT, refresh);
  }, [refresh]);

  if (!profileName || !status) return null;

  const apply = async (mode, folder, createFolder = false) => {
    setBusy(true);
    setError('');
    const result = await api.setProfileGameFiles(profileName, mode, folder, createFolder);
    setBusy(false);
    if (result?.error) {
      setError(result.error);
      if (mode === 'sandbox') setPendingSandbox(true);
      return;
    }
    setStatus(result);
    setPendingSandbox(false);
    announceGameFilesChange();
  };

  const chooseSandbox = () => {
    if (status.lastSandboxFolder) apply('sandbox', status.lastSandboxFolder);
    else setPendingSandbox(true);
  };

  const browse = async () => {
    const picked = await api.browseFolder(status.folder || status.lastSandboxFolder || '');
    if (picked) apply('sandbox', picked);
  };

  const mode = pendingSandbox ? 'sandbox' : status.mode;
  const radioName = `game-files-${profileName}`;
  const updater = updaterName || (inDropdown ? 'the Files updater tile' : 'the FFXI Files Updater on the Home tab');

  return (
    <div className={`form-field game-files ${inDropdown ? 'in-dropdown' : ''}`}>
      <div className="game-files-label">
        {!inDropdown && <span className="form-field-name">Game files</span>}
        <button
          type="button"
          className={`game-files-info ${showInfo ? 'open' : ''}`}
          aria-label="What are game files?"
          aria-expanded={showInfo}
          onClick={() => setShowInfo(v => !v)}
        >ⓘ{inDropdown && <span className="game-files-info-text">What's the difference?</span>}</button>
      </div>
      {showInfo && (
        <div className="game-files-explain">
          <strong>Installed FFXI</strong> plays the game you installed with the official PlayOnline
          installer (its folder is set in Profiles → Installation Paths).<br />
          <strong>Sandboxed copy</strong> gives this profile its own game folder — handy when a
          server ships its own client. The FFXI Files Updater downloads into that folder and
          Ashita's Sandbox plugin runs the game from it, with nothing to install.
        </div>
      )}

      <label className={`game-files-option ${mode === 'installed' ? 'selected' : ''}`}>
        <input type="radio" name={radioName} checked={mode === 'installed'} onChange={() => apply('installed')} disabled={busy} />
        <span>Installed FFXI <span className="game-files-sub">(PlayOnline)</span></span>
      </label>
      {mode === 'installed' && (
        <div className="game-files-detail">
          <span className="mono game-files-path">{status.installedFfxiPath || 'No FFXI folder set'}</span>
          {!status.filesFound ? (
            <span className="game-files-note err">⚠ No game files here — set your FFXI folder in Profiles → Installation Paths.</span>
          ) : status.registered ? (
            <span className="game-files-note ok">✔ Installed with PlayOnline</span>
          ) : (
            <span className="game-files-note err">⚠ Windows doesn't list FFXI as installed here. If you downloaded these files instead of installing, choose Sandboxed copy.</span>
          )}
        </div>
      )}

      <label className={`game-files-option ${mode === 'sandbox' ? 'selected' : ''}`}>
        <input type="radio" name={radioName} checked={mode === 'sandbox'} onChange={chooseSandbox} disabled={busy} />
        <span>Sandboxed copy <span className="game-files-sub">(this profile's own folder)</span></span>
      </label>
      {mode === 'sandbox' && pendingSandbox && (
        <div className="game-files-detail">
          <span className="game-files-note">Where should this profile's game files go? Suggested:</span>
          <span className="mono game-files-path">{status.suggestedFolder}</span>
          <div className="game-files-actions">
            <button className="btn btn-primary btn-sm" onClick={() => apply('sandbox', status.suggestedFolder, true)} disabled={busy}>
              Use this folder
            </button>
            <button className="btn btn-ghost btn-sm" onClick={browse} disabled={busy}>Choose another…</button>
          </div>
          <span className="game-files-note">It starts empty — {updater} fills it.</span>
        </div>
      )}
      {mode === 'sandbox' && !pendingSandbox && (
        <div className="game-files-detail">
          <div className="game-files-folder-row">
            <span className="mono game-files-path">{status.folder}</span>
            <button className="btn btn-ghost btn-sm" onClick={browse} disabled={busy}>Change</button>
          </div>
          {status.filesFound ? (
            <span className="game-files-note ok">✔ Game files found</span>
          ) : status.folderFound === false ? (
            <>
              <span className="game-files-note err">⚠ This folder doesn't exist any more — it was deleted or its drive isn't plugged in.</span>
              <div className="game-files-actions">
                <button className="btn btn-primary btn-sm" onClick={() => apply('sandbox', status.folder, true)} disabled={busy}>
                  Recreate it
                </button>
              </div>
              <span className="game-files-note">Then run {updater} to download the game files into it.</span>
            </>
          ) : (
            <span className="game-files-note err">⚠ No game files here yet — run {updater} to download them.</span>
          )}
        </div>
      )}

      {error && <p className="game-files-note err">{error}</p>}
    </div>
  );
}

export default GameFilesPicker;
