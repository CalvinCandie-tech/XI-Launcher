// Profile-name rules shared by Profiles → Create and Profiles → Clone. Pure, so electron/profileNames.test.js
// covers it. CommonJS like prereqUi.js so the node test runner can load it.
//
// A profile is config\boot\<name>.ini and Windows filenames ignore case, so "test" and "Test" are the
// same profile as far as the disk is concerned.

const MAX_PROFILE_NAME_LENGTH = 60;

// '' when `name` (already trimmed, non-empty) can be created, else the message to show.
function validateProfileName(name, existingProfiles) {
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\x00-\x1f]|\.\./.test(name)) {
    return 'Profile name cannot contain \\ / : * ? " < > | or ".."';
  }
  if (name === '.' || name === '..') {
    return 'Profile name cannot be "." or ".."';
  }
  if (name.length > MAX_PROFILE_NAME_LENGTH) {
    return `Profile name is too long (max ${MAX_PROFILE_NAME_LENGTH} characters)`;
  }
  if (existingProfiles.some(p => p.toLowerCase() === name.toLowerCase())) {
    return `A profile named "${name}" already exists`;
  }
  return '';
}

// "<name> (Copy)", then "<name> (Copy 2)", ... — the first one not already taken (case-insensitively).
// The base name is cut short when needed so the whole name stays within the length limit.
function uniqueCloneName(name, existingProfiles) {
  const taken = new Set(existingProfiles.map(p => p.toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (Copy)' : ` (Copy ${n})`;
    const candidate = name.slice(0, MAX_PROFILE_NAME_LENGTH - suffix.length).trimEnd() + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

module.exports = { MAX_PROFILE_NAME_LENGTH, validateProfileName, uniqueCloneName };
