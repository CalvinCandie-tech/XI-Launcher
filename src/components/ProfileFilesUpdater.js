import React, { useState, useEffect } from 'react';
import FilesUpdaterPanel from './home/FilesUpdaterPanel';
import { GAME_FILES_CHANGED_EVENT, announceGameFilesChange } from './GameFilesPicker';

const api = window.xiAPI;

// The FFXI Files Updater for one profile (Profiles → Game Files), next to where its game files
// are chosen. Same panel as the Home tile; main keeps one download at a time either way.
function ProfileFilesUpdater({ profileName }) {
  const [mirrorUrl, setMirrorUrl] = useState('');
  const [target, setTarget] = useState('');
  const [updating, setUpdating] = useState(false);
  const [percent, setPercent] = useState(0);
  const [detail, setDetail] = useState('');
  const [status, setStatus] = useState(null); // { ok: bool, msg: string }

  useEffect(() => {
    const refresh = async (loadLink) => {
      if (!api?.getProfileGameFiles || !profileName) return;
      const gf = await api.getProfileGameFiles(profileName);
      if (gf?.error) return;
      setTarget(gf.mode === 'sandbox' ? gf.folder : gf.installedFfxiPath);
      // Only on a profile switch — a game-files change mustn't wipe a link being typed.
      if (loadLink) setMirrorUrl(gf.updaterUrl || '');
    };
    refresh(true);
    setStatus(null);
    const onGameFilesChange = () => refresh(false);
    window.addEventListener(GAME_FILES_CHANGED_EVENT, onGameFilesChange);
    return () => window.removeEventListener(GAME_FILES_CHANGED_EVENT, onGameFilesChange);
  }, [profileName]);

  useEffect(() => {
    if (!api?.onFullClientProgress) return;
    return api.onFullClientProgress((pct, d) => { setPercent(pct); setDetail(d); });
  }, []);

  const run = async () => {
    if (!api?.downloadFullClient) return;
    setStatus(null);
    setUpdating(true);
    setDetail('Starting FFXI files update...');
    // Main saves the link to this profile.
    const result = await api.downloadFullClient(mirrorUrl, profileName);
    setUpdating(false);
    if (result.success) {
      setStatus({ ok: true, msg: result.message || 'FFXI files successfully updated!' });
      announceGameFilesChange();
    } else {
      setStatus({ ok: false, msg: result.error });
    }
  };

  return (
    <FilesUpdaterPanel
      activeProfile={profileName}
      mirrorUrl={mirrorUrl}
      onMirrorUrlChange={setMirrorUrl}
      updating={updating}
      percent={percent}
      detail={detail}
      status={status}
      target={target}
      onRun={run}
    />
  );
}

export default ProfileFilesUpdater;
