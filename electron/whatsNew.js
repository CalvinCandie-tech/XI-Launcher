'use strict';

// "What's new" card shown once after an update. The text comes from the GitHub release body
// (`### Category: Heading` sections, as written for every release) so there is no second
// changelog to keep in step.

const MAX_ITEMS = 5;
const MAX_DETAIL = 140;

function stripMarkdown(text) {
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(text) {
  const clean = stripMarkdown(text);
  if (!clean) return '';
  const end = clean.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? clean : clean.slice(0, end + 1);
  if (sentence.length <= MAX_DETAIL) return sentence;
  const cut = sentence.slice(0, MAX_DETAIL - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).replace(/[\s,;:–—-]+$/, '') + '…';
}

// Release body → [{ category, heading, detail }]. Sections run from one `###` line to the next;
// the first prose line under a heading becomes its detail. The trailing **Download:** block and
// anything after a `---` rule is not a change and is ignored.
function summarizeReleaseNotes(body, max = MAX_ITEMS) {
  const items = [];
  let current = null;
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(\*\*download:?\*\*|---+$)/i.test(line)) break;
    const h = line.match(/^#{2,3}\s+(.+)$/);
    if (h) {
      const title = stripMarkdown(h[1]);
      const split = title.match(/^([A-Za-z][A-Za-z ]{0,18}):\s*(.+)$/);
      current = { category: split ? split[1] : '', heading: split ? split[2] : title, detail: '' };
      items.push(current);
    } else if (current && !current.detail && line) {
      current.detail = firstSentence(line);
    }
    if (items.length > max) break;
  }
  return items.slice(0, max);
}

// What to do with the card at startup.
//   'show'   — the launcher was updated since the last version the player saw
//   'record' — first run (fresh install) or no stored version on a brand-new profile: remember the
//              current version without showing anything
//   'none'   — already seen, or a downgrade
function planWhatsNew({ lastSeen, current, freshInstall }) {
  if (!lastSeen) return freshInstall ? 'record' : 'show';
  const order = String(current).localeCompare(String(lastSeen), undefined, { numeric: true });
  return order > 0 ? 'show' : 'none';
}

module.exports = { summarizeReleaseNotes, planWhatsNew, stripMarkdown };
