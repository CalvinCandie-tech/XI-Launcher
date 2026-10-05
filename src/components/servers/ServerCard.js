import React from 'react';

const api = window.xiAPI;

function StatusPill({ status }) {
  if (!status) return null;
  if (status.checking) return <span className="server-status checking">● Checking…</span>;
  if (status.online) return <span className="server-status online">● Online {status.latency}ms</span>;
  return <span className="server-status offline">● Offline</span>;
}

function Fact({ label, value }) {
  return (
    <span className={`server-fact${value === '?' ? ' unknown' : ''}`}>
      <span className="server-fact-label">{label}</span> {value}
    </span>
  );
}

function Flag({ label, value }) {
  const state = value === true ? 'yes' : value === false ? 'no' : 'unknown';
  const mark = value === true ? '✓' : value === false ? '✗' : '?';
  return <span className={`server-flag ${state}`}>{mark} {label}</span>;
}

// One server on the Servers tab. Every card shows the same six facts in the same order (? when
// unknown). Edit / Reset only appear when the tab passes handlers.
function ServerCard({ server, status, favorite, onToggleFavorite, onReport, onEdit, onReset }) {
  const card = server.card || {};
  const open = (url) => api?.openExternal(url);
  const officialHost = server.official?.host;

  return (
    <div className={`server-card${favorite ? ' favorited' : ''}`}>
      <div className="server-card-header">
        <div className="server-card-name-wrap">
          {server.website ? (
            <button className="link-btn server-card-name" onClick={() => open(server.website)}>{server.name}</button>
          ) : (
            <span className="server-card-name">{server.name}</span>
          )}
          {server.host && (
            <span className="server-card-address mono">{server.host}{server.port ? ':' + server.port : ''}</span>
          )}
        </div>
        <div className="server-card-header-right">
          {server.host && <StatusPill status={status} />}
          {onEdit && (
            <button className="server-fav-btn server-card-edit" onClick={() => onEdit(server)} title="Edit this server on this PC" aria-label="Edit">
              ✎
            </button>
          )}
          {server.host && (
            <button
              className={`server-fav-btn${favorite ? ' favorited' : ''}`}
              onClick={() => onToggleFavorite(server)}
              title={favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              {favorite ? '★' : '☆'}
            </button>
          )}
        </div>
      </div>

      {server.localEdit && (
        <div className="server-card-local">
          Your edit{officialHost && officialHost !== server.host ? ` · official address: ${officialHost}` : ''}
          {onReset && (
            <>
              {' · '}
              <button className="link-btn server-card-reset" onClick={() => onReset(server)}>Reset to official</button>
            </>
          )}
        </div>
      )}

      <div className="server-card-facts">
        <span className={`server-tag server-tag-exp${card.expansion === '?' ? ' unknown' : ''}`}>{card.expansion || '?'}</span>
        <Fact label="EXP" value={card.exp || '?'} />
        <Fact label="Speed" value={card.speed || '?'} />
      </div>
      <div className="server-card-flags">
        <Flag label="Trusts" value={card.trusts} />
        <Flag label="Level Sync" value={card.levelSync} />
        <Flag label="Multi-Box" value={card.multiBox} />
      </div>

      {server.note && <p className="server-card-note">{server.note}</p>}

      <div className="server-card-footer">
        {server.discord && <button className="btn btn-ghost btn-sm" onClick={() => open(server.discord)}>Discord</button>}
        {server.website && <button className="btn btn-ghost btn-sm" onClick={() => open(server.website)}>Website</button>}
        <span className="server-card-footer-spacer" />
        {onReset && server.custom && <button className="btn btn-ghost btn-sm" onClick={() => onReset(server)}>Remove</button>}
        {!server.custom && (
          <button className="btn btn-sm server-card-report" onClick={() => onReport(server)} title="Wrong address or server closed? Tell the launcher team on GitHub">
            ⚑ Report problem
          </button>
        )}
      </div>
    </div>
  );
}

export default ServerCard;
