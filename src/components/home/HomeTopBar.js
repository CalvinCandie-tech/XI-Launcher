import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './HomeTopBar.css';

const MIN_TILE_WIDTH = 130;
const TILE_GAP = 6;
const PANEL_WIDTH = 340;
const EDGE = 12; // gap kept between a drop-down and the window edge

// Tiles per row: as many as fit at MIN_TILE_WIDTH, but only in balanced rows, so six tiles go
// 6 across → 3 × 2 → 2 × 3 instead of leaving one tile alone on a second row.
const columnsFor = (count, width) => {
  for (const rows of [1, 2, 3]) {
    const cols = Math.ceil(count / rows);
    if ((width - (cols - 1) * TILE_GAP) / cols >= MIN_TILE_WIDTH) return cols;
  }
  return 1;
};

// The Home tab's top bar: one summary tile per control, each dropping its full controls down
// underneath it. One drop-down is open at a time; it closes on ✕, the same tile, a click
// anywhere else, or Esc. It's portalled to <body> (position: fixed) so the scrolling content
// area can't clip it, and kept inside the window wherever its tile has wrapped to.
//
// tiles: [{ id, label, summary, title?, warn?, readOnly?, panelWidth?, render: (close) => node }]
function HomeTopBar({ tiles }) {
  const [openId, setOpenId] = useState(null);
  const [cols, setCols] = useState(tiles.length);
  const [pos, setPos] = useState(null);
  const barRef = useRef(null);
  const panelRef = useRef(null);
  const tileRefs = useRef({});

  const openTile = tiles.find(t => t.id === openId && !t.readOnly);
  const close = useCallback(() => setOpenId(null), []);

  // A tile can disappear while open (e.g. Multi-box when profiles are removed).
  useEffect(() => {
    if (openId && !openTile) setOpenId(null);
  }, [openId, openTile]);

  const panelWidth = openTile?.panelWidth || PANEL_WIDTH;
  const place = useCallback(() => {
    const tile = openId && tileRefs.current[openId];
    if (!tile) { setPos(null); return; }
    const r = tile.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(panelWidth, vw - EDGE * 2);
    // Open from the tile's left edge; tiles near the right edge open aligned to their right edge.
    let left = r.left + width > vw - EDGE ? r.right - width : r.left;
    left = Math.max(EDGE, Math.min(left, vw - EDGE - width));
    const top = r.bottom + 6;
    const next = { top, left, width, maxHeight: Math.max(160, vh - top - EDGE) };
    // Only re-render when it actually moved.
    setPos(prev => (prev && Object.keys(next).every(k => prev[k] === next[k]) ? prev : next));
  }, [openId, panelWidth]);

  useLayoutEffect(() => { place(); }, [place]);

  // While open, follow the tile every frame — it can move without the bar resizing (tab rows
  // animating as they wrap, a notice appearing). place() only re-renders when it moved.
  useEffect(() => {
    if (!openId) return;
    let frame;
    const follow = () => { place(); frame = requestAnimationFrame(follow); };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [openId, place]);

  // Re-flow the tiles whenever the bar resizes.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => setCols(columnsFor(tiles.length, bar.clientWidth - 12)); // minus the bar's padding
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [tiles.length]);

  useEffect(() => {
    if (!openId) return;
    const onMouseDown = (e) => {
      // Clicks on the tiles are handled by the tiles themselves (toggle / switch).
      if (barRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpenId(null);
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      tileRefs.current[openId]?.focus();
      setOpenId(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openId]);

  return (
    <>
      <div className="home-topbar" ref={barRef} style={{ '--cols': cols }}>
        {tiles.map(tile => {
          const body = (
            <>
              <span className="home-tile-label">{tile.label}</span>
              <span className="home-tile-summary">{tile.summary}</span>
            </>
          );
          const cls = `home-tile${tile.warn ? ' warn' : ''}`;
          if (tile.readOnly) {
            return <div key={tile.id} className={`${cls} readonly`} title={tile.title}>{body}</div>;
          }
          const open = openId === tile.id;
          return (
            <button
              key={tile.id}
              type="button"
              ref={el => { tileRefs.current[tile.id] = el; }}
              className={`${cls}${open ? ' open' : ''}`}
              title={tile.title}
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : tile.id)}
            >
              {body}
              <span className="home-tile-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
            </button>
          );
        })}
      </div>
      {openTile && pos && createPortal(
        <div
          className="home-dropdown"
          ref={panelRef}
          role="dialog"
          aria-label={openTile.label}
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
        >
          <div className="home-dropdown-head">
            <span className="home-dropdown-title">{openTile.label}</span>
            <button type="button" className="home-dropdown-close" onClick={close} aria-label="Close">✕</button>
          </div>
          <div className="home-dropdown-body">{openTile.render(close)}</div>
        </div>,
        document.body
      )}
    </>
  );
}

export default HomeTopBar;
