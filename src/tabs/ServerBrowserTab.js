import React, { useState, useEffect, useCallback } from 'react';
import './ServerBrowserTab.css';
import ServerCard from '../components/servers/ServerCard';
import ServerEditModal from '../components/servers/ServerEditModal';
import MovedServerBanner from '../components/MovedServerBanner';

const api = window.xiAPI;

// Favourites saved before servers had ids only carry a host.
const sameFav = (f, s) => (f.id ? f.id === s.id : f.host === s.host);

function sourceLabel(meta) {
  if (!meta) return '';
  if (meta.source === 'live') return `Live list${meta.updated ? ` · updated ${meta.updated}` : ''}`;
  if (meta.source === 'cache') {
    return `Offline copy${meta.fetchedAt ? ` from ${new Date(meta.fetchedAt).toLocaleDateString()}` : ''}`;
  }
  return 'Built-in copy (could not reach GitHub)';
}

function ServerBrowserTab({ config, updateConfig, movedServers = [], onApplyMove, onDismissMove }) {
  const [categories, setCategories] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState({});
  const [editing, setEditing] = useState(null); // null | { server } — server undefined = Add

  const favorites = config?.favoriteServers || [];
  const isFavorite = (s) => favorites.some(f => sameFav(f, s));
  const toggleFavorite = (s) => {
    if (!s.host) return;
    const next = isFavorite(s)
      ? favorites.filter(f => !sameFav(f, s))
      : [...favorites, { id: s.id, name: s.name, host: s.host, port: s.port || '' }];
    updateConfig('favoriteServers', next);
  };

  const load = useCallback(async () => {
    if (!api?.fetchServerList) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.fetchServerList();
      if (result?.success) {
        setCategories(result.categories);
        setMeta({ source: result.source, updated: result.updated, fetchedAt: result.fetchedAt });
      } else {
        setError(typeof result?.error === 'string' ? result.error : 'Failed to fetch server list');
      }
    } catch {
      setError('Failed to fetch server list');
    }
    setLoading(false);
  }, []);

  const checkAll = useCallback((cats) => {
    if (!api?.checkServerStatus) return;
    const servers = cats.flatMap(c => c.servers).filter(s => s.host);
    setStatus(Object.fromEntries(servers.map(s => [s.id, { checking: true }])));
    for (const s of servers) {
      api.checkServerStatus(s.host, s.port)
        .then(r => setStatus(prev => ({ ...prev, [s.id]: { online: !!r?.online, latency: r?.latency } })))
        .catch(() => setStatus(prev => ({ ...prev, [s.id]: { online: false } })));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { checkAll(categories); }, [categories, checkAll]);

  const handleReport = (s) => api?.openServerIssue('problem', { server: s });

  const handleSave = async (form, suggest) => {
    const res = await api.saveLocalServer(form);
    if (!res || res.error) return res?.error || 'Could not save the server.';
    const before = editing?.server;
    // Keep a favourite of this server pointing at the address the player just entered.
    if (before && form.host.trim()) {
      const next = favorites.map(f => (sameFav(f, before)
        ? { ...f, id: before.id, host: form.host.trim(), port: form.port.trim() }
        : f));
      if (next.some((f, i) => f !== favorites[i])) updateConfig('favoriteServers', next);
    }
    if (suggest) {
      const official = before?.official || (before && !before.custom ? { name: before.name, host: before.host, port: before.port } : undefined);
      const server = { ...(before || {}), ...form, id: res.id, official };
      const details = !before
        ? 'New server, added in XI Launcher.'
        : official?.host && form.host.trim() && official.host !== form.host.trim()
          ? `Address change: ${official.host} → ${form.host.trim()}`
          : `Updated details for ${form.name.trim()}.`;
      await api.openServerIssue('suggestion', { server, details });
    }
    setEditing(null);
    await load();
    return null;
  };

  const handleReset = async (s) => {
    await api.resetLocalServer(s.id);
    // A favourite that followed the local edit goes back to the official address.
    if (s.official?.host) {
      const next = favorites.map(f => (f.id === s.id ? { ...f, host: s.official.host, port: s.official.port || '' } : f));
      if (next.some((f, i) => f !== favorites[i])) updateConfig('favoriteServers', next);
    }
    await load();
  };

  const q = filter.trim().toLowerCase();
  const filteredCategories = categories.map(cat => ({
    ...cat,
    servers: cat.servers.filter(s =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      (s.tags?.expansion || '').toLowerCase().includes(q) ||
      (s.host || '').toLowerCase().includes(q)
    ),
  })).filter(cat => cat.servers.length > 0);

  const totalCount = categories.reduce((sum, c) => sum + c.servers.length, 0);

  return (
    <div className="server-browser">
      <div className="server-browser-toolbar panel">
        <div className="server-browser-toolbar-left">
          <span className="server-browser-title cinzel">Private Servers</span>
          <span className="pill pill-teal">{totalCount} servers</span>
          {meta && <span className={`server-browser-status${meta.source === 'live' ? '' : ' stale'}`}>{sourceLabel(meta)}</span>}
        </div>
        <div className="server-browser-toolbar-right">
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ server: undefined })}>
            + Add a server
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => checkAll(categories)} title="Check which servers are online">
            ↻ Check
          </button>
          <input
            type="text"
            placeholder="Search servers..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="server-browser-search"
          />
        </div>
      </div>

      <MovedServerBanner moves={movedServers} onApply={onApplyMove} onDismiss={onDismissMove} />

      {loading && <div className="server-browser-loading">Loading server list...</div>}
      {error && <div className="server-browser-error panel">{error}</div>}

      {!loading && !error && filteredCategories.map(cat => (
        <div key={cat.name} className="server-category">
          <div className="section-header">{cat.name}</div>
          <div className="server-cards">
            {cat.servers.map(server => (
              <ServerCard
                key={server.id}
                server={server}
                status={status[server.id]}
                favorite={isFavorite(server)}
                onToggleFavorite={toggleFavorite}
                onReport={handleReport}
                onEdit={(s) => setEditing({ server: s })}
                onReset={handleReset}
              />
            ))}
          </div>
        </div>
      ))}

      {editing && (
        <ServerEditModal server={editing.server} onSave={handleSave} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

export default ServerBrowserTab;
