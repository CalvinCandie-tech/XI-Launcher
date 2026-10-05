import React from 'react';
import './HomePanels.css';

// Slim banners under the top bar: startup warnings and the launcher's own update
// (available / downloading / failed). They overlay the video, so the title never moves.
function NoticeBanner({
  startupWarnings, onDismissWarnings,
  updateInfo, updateDlStatus, updateDlProgress, updateDlError,
  onDownloadUpdate, onSkipVersion, onDismissUpdate, onDismissUpdateError,
}) {
  return (
    <>
      {startupWarnings.length > 0 && (
        <div className="home-notice home-notice-warn" role="alert">
          <span className="home-notice-icon" aria-hidden="true">⚠</span>
          <div className="home-notice-text">
            {startupWarnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
          <button className="home-notice-dismiss" onClick={onDismissWarnings} aria-label="Dismiss">✕</button>
        </div>
      )}

      {updateInfo && updateDlStatus === '' && (
        <div className="home-notice">
          <span className="home-notice-title">Update Available</span>
          <span className="pill pill-gold pill-xs">v{updateInfo.latest}</span>
          {updateInfo.releaseNotes && (
            <span className="home-notice-text home-notice-oneline" title={updateInfo.releaseNotes}>
              {updateInfo.releaseNotes.split('\n')[0]}
            </span>
          )}
          <div className="home-notice-actions">
            <button className="btn btn-primary btn-sm" onClick={onDownloadUpdate}>
              Download & Install
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onSkipVersion(updateInfo.latest)}>
              Skip this version
            </button>
          </div>
          <button className="home-notice-dismiss" onClick={onDismissUpdate} aria-label="Dismiss">✕</button>
        </div>
      )}

      {updateInfo && (updateDlStatus === 'downloading' || updateDlStatus === 'installing') && (
        <div className="home-notice">
          <span className="home-notice-title">
            {updateDlStatus === 'installing' ? 'Installing...' : 'Downloading update...'}
          </span>
          <span className="pill pill-gold pill-xs">v{updateInfo.latest}</span>
          <div className="home-notice-progress">
            <div className="home-progress-bar">
              <div className="home-progress-fill" style={{ width: `${updateDlProgress.percent}%` }} />
            </div>
            <span className="home-progress-text">{updateDlProgress.percent}%</span>
          </div>
          {updateDlProgress.detail && (
            <span className="home-notice-detail home-notice-oneline" title={updateDlProgress.detail}>{updateDlProgress.detail}</span>
          )}
        </div>
      )}

      {updateInfo && updateDlStatus === 'error' && (
        <div className="home-notice home-notice-error">
          <span className="home-notice-title">Update Failed</span>
          <span className="home-notice-text">{updateDlError}</span>
          <div className="home-notice-actions">
            <button className="btn btn-primary btn-sm" onClick={onDownloadUpdate}>
              Retry
            </button>
          </div>
          <button className="home-notice-dismiss" onClick={onDismissUpdateError} aria-label="Dismiss">✕</button>
        </div>
      )}
    </>
  );
}

export default NoticeBanner;
