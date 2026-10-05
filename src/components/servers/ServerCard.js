import React from 'react';

const api = window.xiAPI;

function StatusPill({ status }) {
  if (!status) return null;
  if (status.checking) return <span className="server-status checking">● Checking…</span>;
  if (status.online) return <span className="server-status online">● Online {status.latency}ms</span>;
  return <span className="server-status offline">● Offline</span>;
}

// One server on the Servers tab. Edit / Reset buttons only appear when the tab passes handlers.
function ServerCard({ server, status, favorite, onToggleFavorite, onReport, onEdit, onReset }) {
  const tags = server.tags || {};
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
        </div>
      )}

      <div className="server-card-tags">
        {tags.expansion && <span className="server-tag server-tag-exp">{tags.expansion}</span>}
        {tags.rates && <span className="server-tag">{tags.rates} rates</span>}
        {tags.moveSpeed && <span className="server-tag">{tags.moveSpeed}</span>}
        {tags.levelSync && <span className="server-tag server-tag-feature">Level Sync</span>}
        {tags.trusts && <span className="server-tag server-tag-feature">Trusts</span>}
        {tags.multiBox && <span className="server-tag server-tag-feature">Multi-Box</span>}
      </div>

      {server.note && <p className="server-card-note">{server.note}</p>}

      <div className="server-card-footer">
        {server.discord && <button className="btn btn-ghost btn-sm" onClick={() => open(server.discord)}>Discord</button>}
        {server.website && <button className="btn btn-ghost btn-sm" onClick={() => open(server.website)}>Website</button>}
        <span className="server-card-footer-spacer" />
        {onEdit && <button className="btn btn-ghost btn-sm" onClick={() => onEdit(server)} title="Change this server on this PC">✎ Edit</button>}
        {onReset && server.localEdit && (
          <button className="btn btn-ghost btn-sm" onClick={() => onReset(server)}>Reset to official</button>
        )}
        {onReset && server.custom && <button className="btn btn-ghost btn-sm" onClick={() => onReset(server)}>Remove</button>}
        {!server.custom && (
          <button className="link-btn server-card-report" onClick={() => onReport(server)} title="Wrong address or server closed? Tell the launcher team on GitHub">
            ⚑ Report problem
          </button>
        )}
      </div>
    </div>
  );
}

export default ServerCard;
