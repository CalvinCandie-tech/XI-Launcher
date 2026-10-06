import { useState, useEffect, useRef, useCallback } from 'react';
import { initialProgress, reduceProgress } from './prereqUi';

const api = window.xiAPI;

// One shared instance (created in App) feeds the Home banner and the Settings Requirements section,
// so a run started in either shows in both. Everything degrades to "nothing known" without the
// Electron bridge (browser dev): status stays null and no banner or rows are shown.
//
//   status     null until the first check, then get-prereqs-status rows
//   checking   a check is in flight          installing   an install run is in flight
//   progress   per-row run state (prereqUi.reduceProgress) while installing
//   result     the last install-prerequisites result (null after a re-check)
//   dismissed  the Home banner was closed with "Not now" (this session only, never persisted)
export default function usePrereqs() {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    if (!api?.getPrereqsStatus || running.current) return;
    setChecking(true);
    setResult(null);
    try {
      setStatus(await api.getPrereqsStatus());
    } catch {
      // keep whatever rows we had; a failed check must never raise a banner
    }
    setChecking(false);
  }, []);

  // Startup check, a beat after the first paint so it can never delay anything on screen. Start
  // Game does not depend on it.
  useEffect(() => {
    const t = setTimeout(refresh, 800);
    return () => clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    if (!api?.onPrerequisitesProgress) return undefined;
    return api.onPrerequisitesProgress((percent, detail, info) => {
      setProgress((p) => (p ? reduceProgress(p, percent, detail, info) : p));
    });
  }, []);

  const install = useCallback(async (ids) => {
    if (!api?.installPrerequisites || running.current || !ids || ids.length === 0) return;
    running.current = true;
    setInstalling(true);
    setResult(null);
    setProgress(initialProgress(ids));
    try {
      const r = await api.installPrerequisites(ids);
      setResult(r);
      if (r?.status) setStatus(r.status);
    } catch (e) {
      setResult({ results: [], restartRecommended: false, cancelled: false, error: e.message || 'Installation failed', status: null });
    }
    running.current = false;
    setInstalling(false);
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { available: !!api?.getPrereqsStatus, status, checking, installing, progress, result, dismissed, refresh, install, dismiss };
}
