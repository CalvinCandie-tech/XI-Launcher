import React, { useState, useEffect } from 'react';
import './LaunchBar.css';

function LaunchBar({ config, isLaunching, launchLog, onLaunch }) {
  const [showXiloader, setShowXiloader] = useState(() => !!config?.useXiloader);

  const lastTime = config?.lastLaunched
    ? new Date(config.lastLaunched).toLocaleString()
    : null;

  const isError = launchLog?.startsWith('Error');

  return (
    <div className="launchbar">
      <div className="launchbar-left">
        {config?.activeProfile ? (
          <span className="launchbar-profile cinzel">{config.activeProfile}</span>
        ) : (
          <span className="launchbar-warning">⚠ No profile selected</span>
        )}
        {lastTime && <span className="launchbar-time">Last: {lastTime}</span>}
        {launchLog && (
          <span className={`pill ${isError ? 'pill-red' : 'pill-green'}`}>
            {launchLog}
          </span>
        )}
      </div>
      <div className="launchbar-right">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowXiloader(!showXiloader)}
        >
          ⚙ xiloader {showXiloader ? '▲' : '▼'}
        </button>
        {showXiloader && (
          <button
            className="btn btn-teal"
            disabled={isLaunching}
            onClick={() => onLaunch(true)}
            title="Bypasses PlayOnline and connects directly to a private server using xiloader.exe"
          >
            {isLaunching ? '◌ Launching...' : '⚡ Launch via xiloader'}
          </button>
        )}
        <button
          className="btn btn-primary"
          disabled={isLaunching || !config?.activeProfile}
          onClick={() => onLaunch(false)}
          title="Starts the game through Ashita using your active profile — goes through PlayOnline login"
        >
          {isLaunching ? '◌ Launching...' : '✦ Launch via Ashita'}
        </button>
      </div>
    </div>
  );
}

export default LaunchBar;
