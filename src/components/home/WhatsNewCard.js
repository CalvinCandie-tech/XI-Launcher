import React from 'react';
import './HomePanels.css';

// One-time card after an update: a few plain-English lines of what changed, taken from the
// GitHub release notes. Dismissing it marks this version as seen.
function WhatsNewCard({ whatsNew, onDismiss, onOpenNotes }) {
  if (!whatsNew || !whatsNew.items?.length) return null;
  return (
    <div className="home-notice home-whatsnew" role="status">
      <div className="home-whatsnew-head">
        <span className="home-notice-title">What's new</span>
        <span className="pill pill-gold pill-xs">v{whatsNew.version}</span>
        <button className="home-notice-dismiss home-whatsnew-close" onClick={onDismiss} aria-label="Dismiss">✕</button>
      </div>
      <ul className="home-whatsnew-list">
        {whatsNew.items.map((item, i) => (
          <li key={i} className="home-whatsnew-item">
            <span className="home-whatsnew-tag">{item.category}</span>
            <div className="home-whatsnew-body">
              <span className="home-whatsnew-heading">{item.heading}</span>
              {item.detail && <span className="home-whatsnew-detail">{item.detail}</span>}
            </div>
          </li>
        ))}
      </ul>
      <div className="home-whatsnew-foot">
        {whatsNew.releaseUrl && (
          <button className="btn btn-ghost btn-sm" onClick={() => onOpenNotes(whatsNew.releaseUrl)}>
            Full release notes
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={onDismiss}>Got it</button>
      </div>
    </div>
  );
}

export default WhatsNewCard;
