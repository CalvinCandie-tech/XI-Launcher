import React from 'react';
import './HomePanels.css';

// The profile list — switch the active profile, or jump to the Profiles tab.
// Used in the Profile tile's drop-down and in the setup card.
function ProfileSwitcher({ profiles, activeProfile, gameFilesTag, onSelect, onManage }) {
  return (
    <div className="home-profile-list" role="listbox">
      {profiles.map(name => (
        <div
          key={name}
          role="option"
          aria-selected={activeProfile === name}
          className={`home-profile-option ${activeProfile === name ? 'active' : ''}`}
          onClick={() => onSelect(name)}
        >
          {activeProfile === name && <span className="home-profile-active-dot">✦</span>}
          <span>{name}</span>
          {gameFilesTag(name)}
        </div>
      ))}
      <div role="option" aria-selected={false} className="home-profile-option home-profile-manage" onClick={onManage}>
        ⚙ Manage Profiles...
      </div>
    </div>
  );
}

export default ProfileSwitcher;
