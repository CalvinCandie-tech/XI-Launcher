import React, { useState, useEffect, useCallback } from 'react';
import './PluginsTab.css';

const api = window.xiAPI;

const PLUGIN_CATALOGUE = [
  // Core — ship with Ashita, almost always needed
  { name: 'addons', desc: 'Core addon engine — required for any Lua addon to work. Must be loaded before any /addon load commands.', category: 'Core', required: true },
  { name: 'thirdparty', desc: 'Enables third-party memory reads used by many addons for player/target/party data. Required by most UI addons.', category: 'Core', required: true },
  // Built-in — ship with Ashita
  { name: 'screenshot', desc: 'Capture screenshots with the Print Screen key. Saves to Ashita\'s screenshots folder.', category: 'Built-in' },
  { name: 'hardwaremouse', desc: 'Forces the hardware mouse cursor. Can help with mouse lag on some systems.', category: 'Built-in' },
  { name: 'minimap', desc: 'Adds a movable minimap overlay showing your position, party members, and NPCs.', category: 'Built-in' },
  { name: 'toon', desc: 'Applies cel-shading / toon rendering to the game for a stylized look.', category: 'Built-in' },
  { name: 'winefix', desc: 'Compatibility fixes for running FFXI under Wine/Proton on Linux. Not needed on Windows.', category: 'Built-in' },
  // Community — downloaded separately
  { name: 'XICamera', desc: 'Unlocks extended camera distance and zoom controls beyond the default limits.', category: 'Community', repo: 'Hokuten85/XICamera', useRelease: true },
  { name: 'FindAll', desc: 'Instant inventory search across all characters and storage. Much faster than the built-in /find.', category: 'Community', repo: 'ThornyFFXI/FindAll', useRelease: true },
  { name: 'EquipViewer', desc: 'Overlays your currently equipped gear on screen in a translucent window.', category: 'Community', repo: 'ProjectTako/EquipViewer', subdir: 'plugins' },
];

function PluginsTab({ config }) {
  const [installedPlugins, setInstalledPlugins] = useState([]);
  const [enabledPlugins, setEnabledPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installStatus, setInstallStatus] = useState({});

  // Load installed plugins from the plugins directory
  const loadInstalled = useCallback(async () => {
    if (!api || !config?.ashitaPath) return;
    const result = await api.getPlugins(config.ashitaPath);
    setInstalledPlugins(result.plugins || []);
  }, [config?.ashitaPath]);

  // Load enabled plugins from the script file
  const loadEnabled = useCallback(async () => {
    if (!api || !config?.activeProfile || !config?.ashitaPath) return;
    const profile = await api.readProfile(config.ashitaPath, config.activeProfile);
    if (!profile.exists) return;

    // Find script name from profile
    let scriptName = 'default.txt';
    for (const line of profile.content.split('\n')) {
      const m = line.match(/^\s*script\s*=\s*(.+)/i);
      if (m && m[1].trim()) { scriptName = m[1].trim(); break; }
    }

    const scriptPath = config.ashitaPath + '\\scripts\\' + scriptName;
    const scriptResult = await api.readFile(scriptPath);
    if (scriptResult?.content) {
      const enabled = [];
      for (const line of scriptResult.content.split('\n')) {
        const m = line.trim().match(/^\/load\s+(\S+)/i);
        if (m) enabled.push(m[1].toLowerCase());
      }
      setEnabledPlugins(enabled);
    }
  }, [config?.ashitaPath, config?.activeProfile]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadInstalled(), loadEnabled()]);
      setLoading(false);
    };
    init();
  }, [loadInstalled, loadEnabled]);

  // Toggle a plugin's /load line in the script
  const togglePlugin = async (pluginName) => {
    if (!config?.activeProfile || !config?.ashitaPath) return;
    const lower = pluginName.toLowerCase();
    const entry = PLUGIN_CATALOGUE.find(p => p.name.toLowerCase() === lower);
    if (entry?.required) return;
    const isEnabled = enabledPlugins.includes(lower);
    const newEnabled = isEnabled
      ? enabledPlugins.filter(p => p !== lower)
      : [...enabledPlugins, lower];
    setEnabledPlugins(newEnabled);
    await savePluginsToScript(newEnabled);
  };

  const savePluginsToScript = async (enabled) => {
    try {
      if (!config?.activeProfile || !config?.ashitaPath) return;
      const profile = await api.readProfile(config.ashitaPath, config.activeProfile);
      if (!profile.exists) return;

      let scriptName = 'default.txt';
      for (const line of profile.content.split('\n')) {
        const m = line.match(/^\s*script\s*=\s*(.+)/i);
        if (m && m[1].trim()) { scriptName = m[1].trim(); break; }
      }

      const scriptPath = config.ashitaPath + '\\scripts\\' + scriptName;
      const scriptResult = await api.readFile(scriptPath);
      let scriptLines;

      if (scriptResult?.content) {
        scriptLines = scriptResult.content.split('\n');
      } else {
        scriptLines = ['# Ashita v4 Script - Managed by Xi Launcher', ''];
      }

      // Remove all existing /load lines
      const filtered = scriptLines.filter(l => !l.trim().toLowerCase().match(/^\/load\s+\S+/));

      // Find insert point — before any /addon load, /wait, /bind, or /alias
      let insertIdx = filtered.length;
      for (let i = 0; i < filtered.length; i++) {
        const trimmed = filtered[i].trim().toLowerCase();
        if (trimmed.startsWith('/addon') || trimmed.startsWith('/wait') || trimmed.startsWith('/bind') || trimmed.startsWith('/alias')) {
          insertIdx = i;
          break;
        }
      }

      // Ensure required plugins are always present and first
      const required = ['thirdparty', 'addons'];
      const ordered = [...required.filter(r => !enabled.includes(r)), ...enabled];
      const unique = [...new Set(ordered)];

      // Insert /load lines
      const loadLines = unique.map(p => '/load ' + p);
      if (loadLines.length > 0) {
        filtered.splice(insertIdx, 0, ...loadLines, '');
      }

      // Clean up consecutive blank lines
      const cleaned = filtered.filter((line, i, arr) => !(line.trim() === '' && i > 0 && arr[i - 1].trim() === ''));

      await api.writeFile(scriptPath, cleaned.join('\n'));
    } catch (e) {
      console.error('Failed to save plugins to script:', e);
    }
  };

  const installPlugin = async (plugin) => {
    if (!plugin.repo || installStatus[plugin.name]?.installing) return;
    setInstallStatus(prev => ({ ...prev, [plugin.name]: { installing: true, message: 'Downloading...' } }));

    const result = await api.installAddon(config.ashitaPath, plugin.name, plugin.repo, plugin.subdir, plugin.useRelease, null, true);
    if (result.success) {
      setInstallStatus(prev => ({ ...prev, [plugin.name]: { installing: false, message: result.message, success: true } }));
      await loadInstalled();
    } else {
      setInstallStatus(prev => ({ ...prev, [plugin.name]: { installing: false, message: result.error, success: false } }));
    }
  };

  const isInstalled = (name) => installedPlugins.some(p => p.name.toLowerCase() === name.toLowerCase());
  const isEnabled = (name) => enabledPlugins.includes(name.toLowerCase());

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  if (loading) return (
    <div className="plugins-tab plugins-tab-loading">
      <div className="skeleton skeleton-row plugins-skeleton-row" />
      <div className="plugins-skeleton-grid">
        {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton skeleton-card" />)}
      </div>
    </div>
  );

  const categories = ['Core', 'Built-in', 'Community'];
  const allFilters = ['All', ...categories];

  const filteredCatalogue = PLUGIN_CATALOGUE.filter(p => {
    if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="plugins-tab">
      <div className="panel plugins-status-bar">
        <div className="plugins-status-items">
          <span className="pill pill-teal">{installedPlugins.length} installed</span>
          <span className="pill pill-green">{enabledPlugins.length} enabled</span>
          <span className="mono plugins-profile-label">
            Profile: {config?.activeProfile || 'None'}
          </span>
          <div className="plugins-filters">
            {allFilters.map(f => (
              <button
                key={f}
                className={`plugins-filter-pill ${categoryFilter === f ? 'active' : ''}`}
                onClick={() => setCategoryFilter(f)}
              >
                {f}
                <span className="plugins-filter-count">
                  {f === 'All' ? PLUGIN_CATALOGUE.length : PLUGIN_CATALOGUE.filter(p => p.category === f).length}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="plugins-search-wrapper">
          <input
            type="text"
            placeholder="Search plugins..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="plugins-search"
          />
          <button className="btn btn-ghost btn-sm" onClick={() => { loadInstalled(); loadEnabled(); }}>&#8635; Refresh</button>
        </div>
      </div>

      <div className="plugins-warning panel">
        Plugins are DLL modules loaded via <code className="mono">/load</code> in your script. Core plugins (addons, thirdparty) are required for most functionality. Changes take effect next launch.
      </div>

      {categories.map(cat => {
        const plugins = filteredCatalogue.filter(p => p.category === cat);
        if (plugins.length === 0) return null;
        return (
          <div key={cat}>
            <div className="section-header">{cat} Plugins</div>
            <div className="plugins-grid">
              {plugins.map(plugin => {
                const installed = isInstalled(plugin.name);
                const enabled = isEnabled(plugin.name);
                const status = installStatus[plugin.name];
                return (
                  <div key={plugin.name} className={`plugin-card panel ${enabled ? 'plugin-enabled' : ''}`}>
                    <div className="plugin-card-header">
                      <span className="plugin-name mono">{plugin.name}</span>
                      <div className="plugin-tags">
                        {installed && <span className="pill pill-green pill-sm">Installed</span>}
                        {!installed && plugin.category !== 'Community' && <span className="pill pill-green pill-sm">Built-in</span>}
                        {!installed && plugin.category === 'Community' && <span className="pill pill-red pill-sm">Not Installed</span>}
                        {plugin.required && <span className="pill pill-gold pill-sm">Required</span>}
                      </div>
                    </div>
                    <p className="plugin-desc">{plugin.desc}</p>
                    <div className="plugin-card-footer">
                      <div className="plugin-card-footer-left">
                        {installed && (
                          <label className={`toggle ${plugin.required ? 'toggle-locked' : ''}`} title={plugin.required ? 'This plugin is required and cannot be disabled' : ''}>
                            <input
                              type="checkbox"
                              checked={enabled || plugin.required}
                              onChange={() => togglePlugin(plugin.name)}
                              disabled={plugin.required}
                              aria-label={`Toggle ${plugin.name}`}
                            />
                            <span className="toggle-slider" />
                          </label>
                        )}
                        <span className="plugin-status-label">{enabled ? 'Enabled' : installed ? 'Disabled' : ''}</span>
                      </div>
                      {plugin.repo && !installed && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => installPlugin(plugin)}
                          disabled={status?.installing}
                        >
                          {status?.installing ? '◌ Installing...' : 'Install'}
                        </button>
                      )}
                      {plugin.repo && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => api.openExternal(`https://github.com/${plugin.repo}`)}
                        >
                          GitHub ↗
                        </button>
                      )}
                    </div>
                    {status?.message && !status.installing && (
                      <div className={`plugin-status-msg ${status.success ? 'success' : 'error'}`}>
                        {status.message}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Show unlisted installed plugins in Built-in section */}
            {cat === 'Built-in' && installedPlugins
              .filter(p => !PLUGIN_CATALOGUE.some(c => c.name.toLowerCase() === p.name.toLowerCase()) && p.name !== 'sdk')
              .map(plugin => {
                const enabled = isEnabled(plugin.name);
                return (
                  <div key={plugin.name} className="plugins-grid plugins-grid-unlisted">
                    <div className={`plugin-card panel ${enabled ? 'plugin-enabled' : ''}`}>
                      <div className="plugin-card-header">
                        <span className="plugin-name mono">{plugin.name}</span>
                        <span className="pill pill-teal pill-sm">Detected</span>
                      </div>
                      <p className="plugin-desc">Plugin found in your plugins folder.</p>
                      <div className="plugin-card-footer">
                        <div className="plugin-card-footer-left">
                          <label className="toggle">
                            <input type="checkbox" checked={enabled} onChange={() => togglePlugin(plugin.name)} aria-label={`Toggle ${plugin.name}`} />
                            <span className="toggle-slider" />
                          </label>
                          <span className="plugin-status-label">{enabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

export default PluginsTab;
