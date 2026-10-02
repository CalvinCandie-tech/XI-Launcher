import React, { useState, useEffect } from 'react';
import './ServerBrowserTab.css';

const api = window.xiAPI;

function ServerBrowserTab({ config, updateConfig }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const favorites = config?.favoriteServers || [];
  const isFavorite = (server) => favorites.some(f => f.host === server.address);
  const toggleFavorite = (server) => {
    if (!server.address) return;
    const entry = { name: server.name, host: server.address, port: server.port || '' };
    const next = isFavorite(server)
      ? favorites.filter(f => f.host !== server.address)
      : [...favorites, entry];
    updateConfig('favoriteServers', next);
  };

  useEffect(() => {
    if (!api?.fetchServerList) return;
    setLoading(true);
    api.fetchServerList().then(result => {
      if (result.success) {
        setCategories(result.categories);
      } else {
        setError(typeof result.error === 'string' ? result.error : 'Failed to fetch server list');
      }
      setLoading(false);
    }).catch(() => {
      setError('Failed to fetch server list');
      setLoading(false);
    });
  }, []);

  const filteredCategories = categories.map(cat => ({
    ...cat,
    servers: cat.servers.filter(s =>
      !filter || s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.expansion.toLowerCase().includes(filter.toLowerCase())
    )
  })).filter(cat => cat.servers.length > 0);

  const totalCount = categories.reduce((sum, c) => sum + c.servers.length, 0);

  return (
    <div className="server-browser">
      <div className="server-browser-toolbar panel">
        <div className="server-browser-toolbar-left">
          <span className="server-browser-title cinzel">Private Servers</span>
          <span className="pill pill-teal">{totalCount} servers</span>
        </div>
        <div className="server-browser-toolbar-right">
          <input
            type="text"
            placeholder="Search servers..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="server-browser-search"
          />
          <span className="server-browser-source">
            via <button className="link-btn" onClick={() => api?.openExternal('https://github.com/XiPrivateServers/Servers')}>XiPrivateServers</button>
          </span>
        </div>
      </div>

      {loading && <div className="server-browser-loading">Loading server list...</div>}
      {error && <div className="server-browser-error panel">{error}</div>}

      {!loading && !error && filteredCategories.map(cat => (
        <div key={cat.name} className="server-category">
          <div className="section-header">{cat.name}</div>
          <div className="server-cards">
            {cat.servers.map(server => (
              <div key={server.name} className={`server-card${isFavorite(server) ? ' favorited' : ''}`}>
                <div className="server-card-header">
                  <div className="server-card-name-wrap">
                    {server.website ? (
                      <button className="link-btn server-card-name" onClick={() => api?.openExternal(server.website)}>
                        {server.name}
                      </button>
                    ) : (
                      <span className="server-card-name">{server.name}</span>
                    )}
                    {server.address && (
                      <span className="server-card-address mono">
                        {server.address}{server.port ? ':' + server.port : ''}
                      </span>
                    )}
                  </div>
                  {server.address && (
                    <button
                      className={`server-fav-btn${isFavorite(server) ? ' favorited' : ''}`}
                      onClick={() => toggleFavorite(server)}
                      title={isFavorite(server) ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      {isFavorite(server) ? '★' : '☆'}
                    </button>
                  )}
                </div>

                <div className="server-card-tags">
                  {server.expansion && <span className="server-tag server-tag-exp">{server.expansion}</span>}
                  {server.rates && <span className="server-tag">{server.rates} rates</span>}
                  {server.moveSpeed && server.moveSpeed !== 'Retail' && <span className="server-tag">{server.moveSpeed}</span>}
                  {server.levelSync && <span className="server-tag server-tag-feature">Level Sync</span>}
                  {server.trusts && <span className="server-tag server-tag-feature">Trusts</span>}
                  {server.dualBox && server.dualBox !== 'No' && server.dualBox !== '?' && (
                    <span className="server-tag server-tag-feature">Multi-Box</span>
                  )}
                </div>

                {server.note && <p className="server-card-note">{server.note}</p>}

                <div className="server-card-footer">
                  {server.discord && (
                    <button className="btn btn-ghost btn-sm" onClick={() => api?.openExternal(server.discord)}>
                      Discord
                    </button>
                  )}
                  {server.website && (
                    <button className="btn btn-ghost btn-sm" onClick={() => api?.openExternal(server.website)}>
                      Website
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default ServerBrowserTab;
