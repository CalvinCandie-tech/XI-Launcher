import React from 'react';
import './HomePanels.css';
import { shouldShowBanner, bannerPackages, bannerText, describeRun } from '../../utils/prereqUi';

// Home notice for a missing REQUIRED package (DirectX, VC++ 2015-2022). It never blocks Start Game
// and does not claim the game will not start. "Not now" hides it for this session only. A successful
// install refreshes the status, so the banner simply disappears.
function PrereqBanner({ prereqs, onShowDetails }) {
  const { status, installing, progress, result, dismissed, install, dismiss } = prereqs;
  if (!shouldShowBanner(status, dismissed)) return null;

  const ids = bannerPackages(status).map((e) => e.id);
  const runLine = !installing ? describeRun(result) : null;

  return (
    <div className="home-notice" role="status">
      <span className="home-notice-title">Requirements</span>
      <span className="home-notice-text">{bannerText(status)}</span>
      {!installing && (
        <div className="home-notice-actions">
          <button className="btn btn-primary btn-sm" onClick={() => install(ids)}>Install now</button>
          <button className="btn btn-ghost btn-sm" onClick={onShowDetails}>Details</button>
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>Not now</button>
        </div>
      )}
      {installing && progress && (
        <div className="home-notice-progress">
          <div className="home-progress-bar">
            <div className="home-progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <span className="home-progress-text">{progress.percent}%</span>
        </div>
      )}
      {installing && progress && progress.detail && (
        <span className="home-notice-detail home-notice-oneline" title={progress.detail}>{progress.detail}</span>
      )}
      {runLine && (
        <span className={`home-notice-detail prereq-banner-result prereq-banner-result-${runLine.tone}`}>{runLine.text}</span>
      )}
    </div>
  );
}

export default PrereqBanner;
