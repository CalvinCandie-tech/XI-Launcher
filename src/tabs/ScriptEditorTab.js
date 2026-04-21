import React, { useState, useEffect, useCallback } from 'react';
import './ScriptEditorTab.css';

const api = window.xiAPI;

const SYNTAX_COLORS = {
  comment: 'var(--text-dim)',
  load: 'var(--teal)',
  addon: 'var(--green)',
  bind: 'var(--gold)',
  alias: '#c89ae0',
  wait: 'var(--red)',
  command: 'var(--text-secondary)',
};

function highlightLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) return { color: SYNTAX_COLORS.comment, label: 'comment' };
  if (trimmed.match(/^\/load\s/i)) return { color: SYNTAX_COLORS.load, label: 'plugin' };
  if (trimmed.match(/^\/addon\s+load\s/i)) return { color: SYNTAX_COLORS.addon, label: 'addon' };
  if (trimmed.match(/^\/addon\s/i)) return { color: SYNTAX_COLORS.addon, label: 'addon' };
  if (trimmed.match(/^\/bind\s/i)) return { color: SYNTAX_COLORS.bind, label: 'keybind' };
  if (trimmed.match(/^\/unbind\s/i)) return { color: SYNTAX_COLORS.bind, label: 'keybind' };
  if (trimmed.match(/^\/alias\s/i)) return { color: SYNTAX_COLORS.alias, label: 'alias' };
  if (trimmed.match(/^\/wait\s?/i)) return { color: SYNTAX_COLORS.wait, label: 'wait' };
  if (trimmed.match(/^\/include\s/i)) return { color: SYNTAX_COLORS.load, label: 'include' };
  if (trimmed.startsWith('/')) return { color: SYNTAX_COLORS.command, label: 'command' };
  return { color: 'var(--text-dim)', label: '' };
}

function ScriptEditorTab({ config }) {
  const [scriptName, setScriptName] = useState('default.txt');
  const [scriptContent, setScriptContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [scriptList, setScriptList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');
  const [view, setView] = useState('visual'); // visual | keybinds | aliases | raw
  const [newBindKey, setNewBindKey] = useState('');
  const [newBindMods, setNewBindMods] = useState({ alt: false, ctrl: false, shift: false, win: false, apps: false });
  const [newBindCmd, setNewBindCmd] = useState('');
  const [newAliasName, setNewAliasName] = useState('');
  const [newAliasCmd, setNewAliasCmd] = useState('');

  // Load script list and current script
  const loadScripts = useCallback(async () => {
    if (!api || !config?.ashitaPath) return;
    setLoading(true);

    // Get script name from profile
    if (config?.activeProfile) {
      const profile = await api.readProfile(config.ashitaPath, config.activeProfile);
      if (profile.exists) {
        for (const line of profile.content.split('\n')) {
          const m = line.match(/^\s*script\s*=\s*(.+)/i);
          if (m && m[1].trim()) { setScriptName(m[1].trim()); break; }
        }
      }
    }

    // List all scripts
    const scriptsDir = config.ashitaPath + '\\scripts';
    const dirResult = await api.readDir(scriptsDir);
    if (dirResult?.entries) {
      setScriptList(dirResult.entries.filter(e => e.endsWith('.txt')).sort());
    }

    setLoading(false);
  }, [config?.ashitaPath, config?.activeProfile]);

  // Load script content
  const loadContent = useCallback(async () => {
    if (!api || !config?.ashitaPath || !scriptName) return;
    const scriptPath = config.ashitaPath + '\\scripts\\' + scriptName;
    const result = await api.readFile(scriptPath);
    const content = result?.content || '';
    setScriptContent(content);
    setOriginalContent(content);
  }, [config?.ashitaPath, scriptName]);

  useEffect(() => { loadScripts(); }, [loadScripts]);
  useEffect(() => { loadContent(); }, [loadContent]);

  const hasChanges = scriptContent !== originalContent;

  const saveScript = async () => {
    if (!api || !config?.ashitaPath) return;
    setSaveStatus('saving');
    try {
      const scriptPath = config.ashitaPath + '\\scripts\\' + scriptName;
      await api.writeFile(scriptPath, scriptContent);
      setOriginalContent(scriptContent);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (e) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 8000);
    }
  };

  const revert = () => {
    setScriptContent(originalContent);
  };

  // Parse lines into sections for visual view
  const lines = scriptContent.split('\n');
  const sections = [];
  let currentSection = { title: 'Script', lines: [], startIdx: 0 };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // Detect section comment blocks (lines of #### or similar)
    if (trimmed.match(/^#{5,}$/)) {
      // Check if next non-empty line is a comment (section title)
      if (idx + 1 < lines.length) {
        const nextLine = lines[idx + 1]?.trim();
        if (nextLine?.startsWith('#') && !nextLine.match(/^#{5,}$/)) {
          if (currentSection.lines.length > 0) {
            sections.push(currentSection);
          }
          currentSection = { title: nextLine.replace(/^#\s*/, ''), lines: [], startIdx: idx };
          return;
        }
      }
    }
    currentSection.lines.push({ text: line, idx });
  });
  if (currentSection.lines.length > 0) sections.push(currentSection);

  // Parse keybinds from script
  const keybinds = lines.map((line, idx) => {
    const m = line.trim().match(/^\/bind\s+([!^@#+$]*)([\w]+)\s+(?:(down|up)\s+)?(.+)/i);
    if (!m) return null;
    const modStr = m[1];
    return {
      idx,
      mods: {
        alt: modStr.includes('!'),
        ctrl: modStr.includes('^'),
        shift: modStr.includes('+'),
        win: modStr.includes('@'),
        apps: modStr.includes('#'),
      },
      key: m[2],
      event: m[3] || 'down',
      command: m[4],
      raw: line.trim()
    };
  }).filter(Boolean);

  // Parse aliases from script
  const aliases = lines.map((line, idx) => {
    const m = line.trim().match(/^\/alias\s+add\s+\/(\S+)\s+(.+)/i);
    if (!m) return null;
    return { idx, trigger: m[1], command: m[2], raw: line.trim() };
  }).filter(Boolean);

  const removeLine = (idx) => {
    const newLines = [...lines];
    newLines.splice(idx, 1);
    setScriptContent(newLines.join('\n'));
  };

  const addKeybind = () => {
    if (!newBindKey.trim() || !newBindCmd.trim()) return;
    let modStr = '';
    if (newBindMods.alt) modStr += '!';
    if (newBindMods.ctrl) modStr += '^';
    if (newBindMods.shift) modStr += '+';
    if (newBindMods.win) modStr += '@';
    if (newBindMods.apps) modStr += '#';
    const bindLine = `/bind ${modStr}${newBindKey.trim()} ${newBindCmd.trim()}`;
    setScriptContent(prev => prev + '\n' + bindLine);
    setNewBindKey('');
    setNewBindMods({ alt: false, ctrl: false, shift: false, win: false, apps: false });
    setNewBindCmd('');
  };

  const addAlias = () => {
    if (!newAliasName.trim() || !newAliasCmd.trim()) return;
    const aliasLine = `/alias add /${newAliasName.trim()} ${newAliasCmd.trim()}`;
    setScriptContent(prev => prev + '\n' + aliasLine);
    setNewAliasName('');
    setNewAliasCmd('');
  };

  const modLabel = (mods) => {
    const parts = [];
    if (mods.ctrl) parts.push('Ctrl');
    if (mods.alt) parts.push('Alt');
    if (mods.shift) parts.push('Shift');
    if (mods.win) parts.push('Win');
    if (mods.apps) parts.push('Apps');
    return parts.join(' + ');
  };

  if (loading) return <div className="script-loading">Loading scripts...</div>;

  return (
    <div className="script-editor-tab">
      <div className="panel script-toolbar">
        <div className="script-toolbar-left">
          <select
            value={scriptName}
            onChange={e => {
              // Guard against silently discarding unsaved edits when the user
              // switches scripts — the loader below overwrites scriptContent.
              if (hasChanges && !window.confirm('You have unsaved changes in the current script. Switch without saving?')) {
                return;
              }
              setScriptName(e.target.value);
            }}
            className="script-select"
          >
            {scriptList.map(s => (
              <option key={s} value={s}>{s}{s === scriptName ? ' (active)' : ''}</option>
            ))}
          </select>
          <div className="script-view-toggle">
            <button className={`btn btn-sm ${view === 'visual' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('visual')}>Visual</button>
            <button className={`btn btn-sm ${view === 'keybinds' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('keybinds')}>Keybinds ({keybinds.length})</button>
            <button className={`btn btn-sm ${view === 'aliases' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('aliases')}>Aliases ({aliases.length})</button>
            <button className={`btn btn-sm ${view === 'raw' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('raw')}>Raw</button>
          </div>
        </div>
        <div className="script-toolbar-right">
          {saveStatus === 'saved' && <span className="pill pill-green">Saved</span>}
          {saveStatus === 'error' && <span className="pill pill-red">Error saving</span>}
          {hasChanges && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={revert}>Revert</button>
              <button className="btn btn-primary btn-sm" onClick={saveScript}>Save Script</button>
            </>
          )}
        </div>
      </div>

      <div className="script-info panel">
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Profile: {config?.activeProfile || 'None'} | Script: {scriptName} | {lines.length} lines
        </span>
        <div className="script-legend">
          {Object.entries(SYNTAX_COLORS).map(([key, color]) => (
            <span key={key} className="script-legend-item">
              <span className="script-legend-dot" style={{ background: color }} />
              {key}
            </span>
          ))}
        </div>
      </div>

      {view === 'keybinds' ? (
        <div className="script-visual">
          <div className="panel">
            <p className="script-hint">
              Keybinds map keyboard shortcuts to commands. Modifiers: <code className="mono">!</code>=Alt, <code className="mono">^</code>=Ctrl, <code className="mono">+</code>=Shift, <code className="mono">@</code>=Win, <code className="mono">#</code>=Apps.
            </p>
            {keybinds.length === 0 ? (
              <div className="script-empty">No keybinds in this script.</div>
            ) : (
              <div className="keybind-table">
                <div className="keybind-header">
                  <span className="keybind-col-mods">Modifiers</span>
                  <span className="keybind-col-key">Key</span>
                  <span className="keybind-col-cmd">Command</span>
                  <span className="keybind-col-del" />
                </div>
                {keybinds.map(bind => (
                  <div key={bind.idx} className="keybind-row">
                    <span className="keybind-col-mods">
                      {modLabel(bind.mods) || <span style={{ color: 'var(--text-dim)' }}>none</span>}
                    </span>
                    <span className="keybind-col-key mono">{bind.key}</span>
                    <span className="keybind-col-cmd mono">{bind.command}</span>
                    <button className="script-line-del" style={{ opacity: 1 }} onClick={() => removeLine(bind.idx)} title="Remove keybind">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="keybind-add">
              <span className="section-header" style={{ margin: '12px 0 8px', fontSize: 13 }}>Add Keybind</span>
              <div className="keybind-add-row">
                <div className="keybind-mod-toggles">
                  {[['alt', 'Alt'], ['ctrl', 'Ctrl'], ['shift', 'Shift'], ['win', 'Win'], ['apps', 'Apps']].map(([key, label]) => (
                    <button
                      key={key}
                      className={`btn btn-sm ${newBindMods[key] ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setNewBindMods(prev => ({ ...prev, [key]: !prev[key] }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={newBindKey}
                  onChange={e => setNewBindKey(e.target.value)}
                  placeholder="Key (e.g. F12, insert)"
                  className="keybind-input-key mono"
                />
                <input
                  type="text"
                  value={newBindCmd}
                  onChange={e => setNewBindCmd(e.target.value)}
                  placeholder="Command (e.g. /fps)"
                  className="keybind-input-cmd mono"
                  onKeyDown={e => e.key === 'Enter' && addKeybind()}
                />
                <button className="btn btn-primary btn-sm" onClick={addKeybind} disabled={!newBindKey.trim() || !newBindCmd.trim()}>Add</button>
              </div>
            </div>
          </div>
        </div>
      ) : view === 'aliases' ? (
        <div className="script-visual">
          <div className="panel">
            <p className="script-hint">
              Aliases create shortcut commands. Type <code className="mono">/trigger</code> in-game and it executes the mapped command.
            </p>
            {aliases.length === 0 ? (
              <div className="script-empty">No aliases in this script.</div>
            ) : (
              <div className="keybind-table">
                <div className="keybind-header">
                  <span className="keybind-col-key">Trigger</span>
                  <span className="keybind-col-cmd">Command</span>
                  <span className="keybind-col-del" />
                </div>
                {aliases.map(alias => (
                  <div key={alias.idx} className="keybind-row">
                    <span className="keybind-col-key mono">/{alias.trigger}</span>
                    <span className="keybind-col-cmd mono">{alias.command}</span>
                    <button className="script-line-del" style={{ opacity: 1 }} onClick={() => removeLine(alias.idx)} title="Remove alias">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="keybind-add">
              <span className="section-header" style={{ margin: '12px 0 8px', fontSize: 13 }}>Add Alias</span>
              <div className="keybind-add-row">
                <div className="alias-trigger-wrap">
                  <span className="alias-slash mono">/</span>
                  <input
                    type="text"
                    value={newAliasName}
                    onChange={e => setNewAliasName(e.target.value)}
                    placeholder="trigger"
                    className="keybind-input-key mono"
                  />
                </div>
                <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>→</span>
                <input
                  type="text"
                  value={newAliasCmd}
                  onChange={e => setNewAliasCmd(e.target.value)}
                  placeholder="Command (e.g. /ma 'Cure IV' <me>)"
                  className="keybind-input-cmd mono"
                  style={{ flex: 2 }}
                  onKeyDown={e => e.key === 'Enter' && addAlias()}
                />
                <button className="btn btn-primary btn-sm" onClick={addAlias} disabled={!newAliasName.trim() || !newAliasCmd.trim()}>Add</button>
              </div>
            </div>
          </div>
        </div>
      ) : view === 'raw' ? (
        <div className="panel script-raw-panel">
          <textarea
            className="script-raw-editor mono"
            value={scriptContent}
            onChange={e => setScriptContent(e.target.value)}
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="script-visual">
          {sections.map((section, sIdx) => (
            <div key={sIdx} className="panel script-section">
              <div className="script-section-header">
                <span className="script-section-title cinzel">{section.title}</span>
                <span className="script-section-count mono">{section.lines.filter(l => l.text.trim() && !l.text.trim().startsWith('#')).length} commands</span>
              </div>
              <div className="script-lines">
                {section.lines.map(({ text, idx }) => {
                  const trimmed = text.trim();
                  if (!trimmed) return null;
                  if (trimmed.match(/^#{3,}$/)) return null; // Skip separator lines
                  const hl = highlightLine(text);
                  return (
                    <div key={idx} className="script-line">
                      <span className="script-line-num mono">{idx + 1}</span>
                      {hl.label && <span className="script-line-tag" style={{ color: hl.color, borderColor: hl.color + '40' }}>{hl.label}</span>}
                      <span className="script-line-text mono" style={{ color: hl.color }}>{text}</span>
                      <button
                        className="script-line-del"
                        onClick={() => {
                          const newLines = [...lines];
                          newLines.splice(idx, 1);
                          setScriptContent(newLines.join('\n'));
                        }}
                        title="Remove line"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="panel script-add-panel">
            <span className="section-header" style={{ margin: '0 0 8px' }}>Add Command</span>
            <div className="script-add-row">
              <input
                type="text"
                placeholder="e.g. /bind F12 /fps"
                className="script-add-input mono"
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    setScriptContent(prev => prev + '\n' + e.target.value.trim());
                    e.target.value = '';
                  }
                }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={e => {
                  const input = e.target.parentNode.querySelector('input');
                  if (input.value.trim()) {
                    setScriptContent(prev => prev + '\n' + input.value.trim());
                    input.value = '';
                  }
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {hasChanges && (
        <div className="script-sticky-bar">
          <span>Unsaved changes</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={revert}>Revert</button>
            <button className="btn btn-primary" onClick={saveScript}>Save Script</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ScriptEditorTab;
