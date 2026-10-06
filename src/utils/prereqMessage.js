// One-line summary of an install-prerequisites result for the Setup Wizard and Settings buttons.
// result: { results: [{ name, state, exitCode, message }], restartRecommended, cancelled, error }
// Returns { tone: 'success' | 'error' | 'info', text, retry }.
export function describePrereqInstall(result) {
  if (!result) return { tone: 'error', text: 'Installation did not return a result.', retry: true };
  if (result.error) return { tone: 'error', text: result.error, retry: true };
  if (result.cancelled) {
    return { tone: 'info', text: 'Cancelled — nothing was installed. Click again when you are ready to approve the administrator prompt.', retry: true };
  }

  const results = result.results || [];
  const installed = results.filter((r) => r.state === 'installed' || r.state === 'restart');
  const failed = results.filter((r) => r.state === 'failed');

  if (failed.length > 0) {
    const names = failed.map((r) => `${r.name} — ${r.message}`).join('; ');
    return { tone: 'error', text: `${installed.length ? `Installed ${installed.length}. ` : ''}Could not install: ${names}.`, retry: true };
  }
  if (installed.length === 0) return { tone: 'success', text: '✓ Nothing to install — everything is already present.', retry: false };

  const restart = result.restartRecommended ? ' A restart is recommended to finish the install.' : '';
  return { tone: 'success', text: `✓ Installed ${installed.length} component${installed.length === 1 ? '' : 's'}.${restart}`, retry: false };
}
