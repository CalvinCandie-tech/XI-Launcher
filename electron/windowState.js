// Remembering the launcher window's size and position between launches. Pure, so it can be
// unit tested with `npm run test:electron`; main.js feeds it the saved state and the screens'
// work areas (screen.getAllDisplays()).

const DEFAULT_SIZE = { width: 1200, height: 800 };
const MIN_SIZE = { width: 760, height: 560 };

// How much of the window's top edge must be on a screen for its saved position to be reused —
// enough to grab the title bar and drag it.
const MIN_VISIBLE_WIDTH = 100;
const TITLE_BAR_HEIGHT = 40;

const toInt = (v) => (Number.isFinite(v) ? Math.round(v) : null);

// The bounds to open the window with: { width, height, maximized } plus x/y when the saved
// position is still on a connected screen (otherwise Electron centres it). A saved size is
// kept within the minimum and within the screen it opens on.
function restoreWindowState(saved, workAreas) {
  const s = saved && typeof saved === 'object' ? saved : {};
  let width = Math.max(MIN_SIZE.width, toInt(s.width) ?? DEFAULT_SIZE.width);
  let height = Math.max(MIN_SIZE.height, toInt(s.height) ?? DEFAULT_SIZE.height);
  const maximized = s.maximized === true;
  const x = toInt(s.x);
  const y = toInt(s.y);

  const area = x === null || y === null ? null : workAreas.find(a => {
    const visibleWidth = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
    return visibleWidth >= MIN_VISIBLE_WIDTH && y >= a.y && y <= a.y + a.height - TITLE_BAR_HEIGHT;
  });
  const fitTo = area || workAreas[0];
  if (fitTo) {
    width = Math.max(MIN_SIZE.width, Math.min(width, fitTo.width));
    height = Math.max(MIN_SIZE.height, Math.min(height, fitTo.height));
  }
  return area ? { x, y, width, height, maximized } : { width, height, maximized };
}

module.exports = { DEFAULT_SIZE, MIN_SIZE, restoreWindowState };
