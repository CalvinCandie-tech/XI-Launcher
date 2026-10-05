import React from 'react';
import './HomePanels.css';

// Server tile drop-down: switch to a favourite server and check the connection.
function ServerPanel({ serverHost, serverPort, favoriteServers, serverStatus, checkingServer, onCheck, onPick }) {
  const favorites = favoriteServers || [];
  return (
    <div className="home-conn-section">
      <div className="home-conn-host mono">{serverHost}{serverPort ? ':' + serverPort : ''}</div>
      <div className="home-server-list">
        {favorites.length === 0 ? (
          <div className="home-server-picker-empty">
            No favorites yet — star a server in the Servers tab
          </div>
        ) : favorites.map((s, i) => (
          <div
            key={i}
            className={`home-server-picker-item${s.host === serverHost ? ' active' : ''}`}
            onClick={() => onPick(s)}
          >
            <span className="home-server-picker-name">{s.name}</span>
            <span className="home-server-picker-host mono">{s.host}{s.port ? ':' + s.port : ''}</span>
          </div>
        ))}
      </div>
      <div className="home-conn-check-row">
        <button className="btn btn-ghost home-conn-btn" onClick={onCheck} disabled={checkingServer}>
          {checkingServer ? 'Checking...' : 'Check connection'}
        </button>
        <div className={`home-conn-status-box${!serverStatus ? '' : serverStatus.online ? ' online' : ' offline'}`}>
          {!serverStatus ? '—' : serverStatus.online ? `Online (${serverStatus.latency}ms)` : 'Offline'}
        </div>
      </div>
    </div>
  );
}

export default ServerPanel;
