import React from 'react';

// "REC" recommended-value pill shared by SettingsTab, DgVoodooTab and
// RegistryEditor. Lit gradient when the current value matches the
// recommendation, dim outline otherwise; clicking a dim pill applies the
// recommended value. Clicking a lit pill is a no-op so it never dirties
// the caller's pending-changes state.
function RecPill({ match, onApply }) {
  return (
    <button
      type="button"
      className={`pill-rec ${match ? '' : 'off'}`}
      title={match ? 'Using the recommended value' : 'Click to apply the recommended value'}
      onClick={() => { if (!match) onApply(); }}
    >
      Rec
    </button>
  );
}

export default RecPill;
