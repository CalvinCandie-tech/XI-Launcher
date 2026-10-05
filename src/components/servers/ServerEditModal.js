import React, { useState } from 'react';
import Modal from '../Modal';

// Add a server (server undefined) or edit one. Saves on this PC straight away; ticking
// "Suggest to everyone" also opens a prefilled GitHub issue for the launcher team.
function ServerEditModal({ server, onSave, onClose }) {
  const isAdd = !server;
  const showCategory = isAdd || !!server?.custom;
  const [form, setForm] = useState({
    id: server?.id || '',
    name: server?.name || '',
    host: server?.host || '',
    port: server?.port || '',
    website: server?.website || '',
    discord: server?.discord || '',
    category: server?.custom ? server.suggestedCategory || '' : '',
  });
  const [suggest, setSuggest] = useState(isAdd);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const err = await onSave(form, suggest);
    setSaving(false);
    if (err) setError(err);
  };

  const field = (key, label, placeholder = '') => (
    <label className="form-field">
      <span className="form-field-name">{label}</span>
      <input type="text" className="form-input" value={form[key]} onChange={set(key)} placeholder={placeholder} />
    </label>
  );

  return (
    <Modal onClose={onClose} ariaLabel={isAdd ? 'Add a server' : `Edit ${server.name}`}>
      <form className="server-edit panel" onSubmit={submit}>
        <h3 className="cinzel modal-title">{isAdd ? 'Add a server' : `Edit ${server.name}`}</h3>
        <p className="modal-desc">
          {isAdd
            ? 'Saved on this PC straight away. It appears under "My servers".'
            : 'Your changes apply on this PC straight away. "Reset to official" undoes them.'}
        </p>
        <div className="form-grid">
          {field('name', 'Name')}
          {field('host', 'Address', 'login.example.com')}
          {field('port', 'Port (only used for the Online check)', '54231')}
          {field('website', 'Website', 'https://')}
          {field('discord', 'Discord', 'https://discord.gg/')}
          {showCategory && field('category', 'Category (for the suggestion)', '75 - Custom Content')}
        </div>
        <div className="server-edit-suggest">
          <label className="toggle">
            <input type="checkbox" checked={suggest} onChange={e => setSuggest(e.target.checked)} aria-label="Suggest to everyone" />
            <span className="toggle-slider" />
          </label>
          <span>
            <span className="form-field-name">Suggest to everyone</span>
            <span className="server-edit-suggest-desc">Opens a GitHub issue for the launcher team (needs a GitHub account)</span>
          </span>
        </div>
        {error && <div className="server-edit-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default ServerEditModal;
