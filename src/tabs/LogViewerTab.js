import React, { useState, useEffect, useCallback, useRef } from 'react';
import './LogViewerTab.css';

const api = window.xiAPI;

const LOG_LEVELS = {
  DEBUG: { color: 'var(--text-dim)', label: 'debug' },
  INFO: { color: 'var(--teal)', label: 'info' },
  WARN: { color: 'var(--gold)', label: 'warn' },
  ERROR: { color: 'var(--red)', label: 'error' },
  CRITICAL: { color: '#ff4444', label: 'critical' },
};

function parseLine(raw) {
  // Format: MM/DD/YYYY HH:MM:SS.mmm | LEVEL    | Source | Message
  const m = raw.match(/^(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s*\|\s*(\w+)\s*\|\s*(\S.*?)\s*\|\s*(.*)$/);
  if (!m) return { time: '', level: '', source: '', message: raw, raw };
  return { time: m[1], level: m[2].trim(), source: m[3].trim(), message: m[4], raw };
}

function LogViewerTab({ config }) {
  const [logFiles, setLogFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [lines, setLines] = useState([]);
  const [filteredLines, setFilteredLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [watching, setWatching] = useState(false);
  const logEndRef = useRef(null);
  const watchRef = useRef(null);

  const logsDir = config?.ashitaPath ? `${config.ashitaPath}/logs` : '';

  // Load list of log files
  const loadLogFiles = useCallback(async () => {
    if (!api || !logsDir) return;
    const res = await api.readDir(logsDir);
    if (res.exists && res.files) {
      const txts = res.files
        .filter(f => !f.isDirectory && f.name.endsWith('.txt'))
        .map(f => f.name)
        .sort()
        .reverse();
      setLogFiles(txts);
      if (txts.length > 0 && !selectedFile) {
        setSelectedFile(txts[0]);
      }
    }
    setLoading(false);
  }, [logsDir, selectedFile]);

  // Load selected log file
  const loadLog = useCallback(async () => {
    if (!api || !logsDir || !selectedFile) return;
    const filePath = `${logsDir}/${selectedFile}`;
    const res = await api.readFile(filePath);
    if (res.exists && res.content) {
      const parsed = res.content.split('\n').filter(l => l.trim()).map(parseLine);
      setLines(parsed);
    } else {
      setLines([]);
    }
  }, [logsDir, selectedFile]);

  useEffect(() => { loadLogFiles(); }, [loadLogFiles]);
  useEffect(() => { if (selectedFile) loadLog(); }, [selectedFile, loadLog]);

  // Filter lines
  useEffect(() => {
    let result = lines;
    if (levelFilter !== 'ALL') {
      result = result.filter(l => l.level === levelFilter);
    }
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(l => l.raw.toLowerCase().includes(s));
    }
    setFilteredLines(result);
  }, [lines, levelFilter, search]);

  // Auto-scroll — use 'auto' (instant) so rapid poll updates don't queue a long smooth-scroll animation.
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [filteredLines, autoScroll]);

  // Live watch (poll every 2s)
  useEffect(() => {
    if (watching) {
      watchRef.current = setInterval(() => { loadLog(); }, 2000);
    } else {
      if (watchRef.current) clearInterval(watchRef.current);
    }
    return () => { if (watchRef.current) clearInterval(watchRef.current); };
  }, [watching, loadLog]);

  const levelCounts = {};
  for (const l of lines) {
    levelCounts[l.level] = (levelCounts[l.level] || 0) + 1;
  }

  const getLevelStyle = (level) => {
    const info = LOG_LEVELS[level];
    return info ? { color: info.color } : {};
  };

  if (loading) return <div className="log-loading">Loading logs...</div>;

  return (
    <div className="log-viewer-tab">
      {/* Toolbar */}
      <div className="log-toolbar panel">
        <div className="log-toolbar-left">
          <select
            className="log-select"
            value={selectedFile}
            onChange={e => { setSelectedFile(e.target.value); setWatching(false); }}
          >
            {logFiles.length === 0 && <option value="">No log files</option>}
            {logFiles.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <button className="btn btn-sm" onClick={() => { loadLogFiles(); loadLog(); }} title="Refresh">↻ Refresh</button>
          <button className={`btn btn-sm ${watching ? 'btn-primary' : ''}`} onClick={() => setWatching(w => !w)} title="Auto-refresh every 2s">
            {watching ? '● Live' : '○ Live'}
          </button>
        </div>
        <div className="log-toolbar-right">
          <input
            className="log-search"
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="log-level-filters">
            <button
              className={`log-level-btn ${levelFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setLevelFilter('ALL')}
            >All ({lines.length})</button>
            {Object.entries(LOG_LEVELS).map(([key, val]) => (
              <button
                key={key}
                className={`log-level-btn ${levelFilter === key ? 'active' : ''}`}
                style={levelFilter === key ? { borderColor: val.color, color: val.color } : {}}
                onClick={() => setLevelFilter(levelFilter === key ? 'ALL' : key)}
              >{val.label} ({levelCounts[key] || 0})</button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="log-stats">
        <span>{filteredLines.length} / {lines.length} lines</span>
        <label className="log-autoscroll">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>

      {/* Log output */}
      <div className="log-output panel">
        {filteredLines.length === 0 ? (
          <div className="log-empty">{lines.length === 0 ? 'No log entries' : 'No matches for current filters'}</div>
        ) : (
          filteredLines.map((l, i) => (
            <div key={i} className="log-line">
              <span className="log-time">{l.time}</span>
              <span className="log-level" style={getLevelStyle(l.level)}>{l.level || '—'}</span>
              <span className="log-source" title={l.source}>{l.source}</span>
              <span className="log-message">{l.message}</span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* Open folder button */}
      <div className="log-footer">
        <button className="btn btn-sm" onClick={() => api && api.openFolder(logsDir)}>Open Logs Folder</button>
        <button className="btn btn-sm" onClick={() => { if (selectedFile && api) { api.openFolder(`${logsDir}/${selectedFile}`); } }}>Open in Editor</button>
      </div>
    </div>
  );
}

export default LogViewerTab;
