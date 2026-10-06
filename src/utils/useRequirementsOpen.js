import { useState, useEffect, useRef } from 'react';
import { bannerPackages } from './prereqUi';

// Open / closed state of Settings -> Requirements. Lives in SettingsTab, not in the panel, because
// the panel unmounts whenever Settings shows its loading skeleton (Refresh, profile change).
//
// Collapsed by default. It opens by itself when something worth seeing starts: a REQUIRED package
// becomes missing / unknown, an install run begins (from anywhere), or the Home banner's "Details"
// is clicked (scrollNonce bumps). Only those starts open it, so a manual collapse sticks until the
// next one. Never persisted across launcher restarts.
export default function useRequirementsOpen(prereqs, scrollNonce) {
  const requiredMissing = !!prereqs && bannerPackages(prereqs.status).length > 0;
  const installing = !!prereqs && !!prereqs.installing;

  // Settings mounts on first visit, often after the status arrived or the nonce was bumped on Home.
  const [open, setOpen] = useState(() => requiredMissing || installing || scrollNonce > 0);
  const prev = useRef({ requiredMissing, installing, scrollNonce });

  useEffect(() => {
    const p = prev.current;
    if ((requiredMissing && !p.requiredMissing) || (installing && !p.installing) || scrollNonce !== p.scrollNonce) {
      setOpen(true);
    }
    prev.current = { requiredMissing, installing, scrollNonce };
  }, [requiredMissing, installing, scrollNonce]);

  return [open, setOpen];
}
