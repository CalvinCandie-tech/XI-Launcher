import React from 'react';
import './CollapsibleSection.css';
import './RequirementsPanel.css';
import {
  groupPrereqs, canInstall, selectInstallAllIds, totalDownloadBytes, formatBytes, requirementsSummary,
  pillFor, rowRunning, resultForRow, describeRowResult, describeRun,
} from '../utils/prereqUi';

const GROUPS = [
  { key: 'required', title: 'Required', note: 'Ashita lists these as required.' },
  { key: 'recommended', title: 'Recommended', note: 'Older runtimes some addons, plugins and tools still use.' },
  { key: 'optional', title: 'Optional', note: 'Not needed for most setups.' },
  { key: 'covered', title: 'Covered', note: 'Already provided by a newer version.' },
];

function RunningCell({ run }) {
  return (
    <span className="req-run">
      <span className="req-run-label">{run.label}</span>
      <span className="req-bar">
        <span
          className={`req-bar-fill${run.fraction == null ? ' req-bar-indeterminate' : ''}`}
          style={run.fraction == null ? undefined : { width: `${Math.round(run.fraction * 100)}%` }}
        />
      </span>
    </span>
  );
}

function Row({ entry, prereqs }) {
  const { installing, progress, result, install } = prereqs;
  const pill = pillFor(entry);
  const run = installing ? rowRunning(progress, entry.id) : null;
  const done = !installing && result ? resultForRow(result, entry.id, entry.category) : null;
  const doneLabel = done ? describeRowResult(done) : null;
  const greyed = entry.status === 'covered' || entry.status === 'unsupported' || entry.category === 'superseded';

  return (
    <div className={`req-row${greyed ? ' req-row-grey' : ''}`}>
      <div className="req-row-main">
        <span className="req-row-name">{entry.name}</span>
        {entry.detail && <span className="req-row-detail" title={entry.detail}>{entry.detail}</span>}
        {done && done.state === 'failed' && done.message && <span className="req-row-fail">{done.message}</span>}
      </div>
      <span className={`pill pill-sm req-pill ${pill.tone === 'dim' ? 'req-pill-dim' : `pill-${pill.tone}`}`}>{pill.label}</span>
      <div className="req-row-action">
        {run && <RunningCell run={run} />}
        {!run && doneLabel && <span className={`req-result req-result-${doneLabel.tone}`}>{doneLabel.label}</span>}
        {!run && !doneLabel && canInstall(entry) && (
          <button className="btn btn-primary btn-sm" disabled={installing} onClick={() => install([entry.id])}>Install</button>
        )}
      </div>
    </div>
  );
}

// The Requirements section of the Settings tab: every catalogue item with status, per-row Install,
// "Install all missing" and a re-check. Driven by the shared usePrereqs() instance. A collapsible section:
// the header always shows a one-line status; `open` / `onToggle` come from useRequirementsOpen (SettingsTab).
function RequirementsPanel({ prereqs, open, onToggle }) {
  const { available, status, checking, installing, progress, result, refresh, install } = prereqs;
  const groups = groupPrereqs(status);
  const missingIds = selectInstallAllIds(status);
  const runLine = !installing ? describeRun(result) : null;
  const summary = requirementsSummary({ available, status, checking, installing });

  return (
    <div id="section-requirements">
      <button
        type="button"
        className="section-header req-toggle"
        aria-expanded={open}
        aria-controls="requirements-body"
        onClick={onToggle}
      >
        <span className="req-toggle-title">Requirements</span>
        <span className={`req-toggle-summary req-toggle-summary-${summary.tone}`} title={summary.text}>{summary.text}</span>
        <span className={`collapse-chevron ${open ? 'open' : ''}`} aria-hidden="true">&#9660;</span>
      </button>
      <div className="panel req-panel" id="requirements-body" hidden={!open}>
        <p className="settings-hint settings-hint-compact">
          DirectX, Visual C++ runtimes and .NET Framework used by FFXI, PlayOnline, Ashita and Windower. Anything already
          installed is detected and left alone. Nothing here blocks Start Game.
        </p>

        {!available && <p className="settings-hint settings-hint-compact">Requirement checks are only available in the desktop launcher.</p>}
        {available && !status && (
          <p className="settings-hint settings-hint-compact">{checking ? 'Checking this PC…' : 'Not checked yet.'}</p>
        )}

        {available && (
          <div className="req-toolbar">
            <button className="btn btn-primary" disabled={installing || checking || missingIds.length === 0} onClick={() => install(missingIds)}>
              {installing ? 'Installing…' : missingIds.length === 0 ? 'Nothing to install' : `Install all missing (${missingIds.length})`}
            </button>
            <button className="btn btn-ghost" disabled={installing || checking} onClick={refresh}>
              {checking ? 'Checking…' : '↻ Re-check'}
            </button>
            {missingIds.length > 0 && !installing && (
              <span className="req-toolbar-note">
                About {formatBytes(totalDownloadBytes(status, missingIds))} to download · one Windows admin prompt will appear.
              </span>
            )}
          </div>
        )}

        {installing && progress && (
          <div className="req-overall" aria-live="polite">
            <div className="req-bar req-bar-big"><span className="req-bar-fill" style={{ width: `${progress.percent}%` }} /></div>
            <span className="req-overall-text">{progress.percent}% · {progress.detail}</span>
          </div>
        )}

        {runLine && <p className={`req-runline req-runline-${runLine.tone}`}>{runLine.text}</p>}
        {!installing && result && result.restartRecommended && (
          <p className="req-runline req-runline-warn">Restart recommended — Windows asked for a restart to finish the install. You can keep using your PC until then.</p>
        )}

        {status && GROUPS.map(({ key, title, note }) => groups[key].length > 0 && (
          <div className="req-group" key={key}>
            <div className="req-group-title">{title}<span className="req-group-note"> — {note}</span></div>
            {groups[key].map((entry) => <Row key={entry.id} entry={entry} prereqs={prereqs} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default RequirementsPanel;
