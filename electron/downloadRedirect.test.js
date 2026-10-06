const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRedirect } = require('./downloadRedirect');

const FROM = 'https://aka.ms/vs/17/release/vc_redist.x86.exe';

test('redirect: an absolute https target is accepted unchanged', () => {
  const target = 'https://download.visualstudio.microsoft.com/download/pr/bd1c8d9d/VC_redist.x86.exe';
  assert.deepEqual(resolveRedirect(target, FROM), { url: target });
});

test('redirect: a relative target is resolved against the URL it came from', () => {
  assert.deepEqual(resolveRedirect('/download/file.exe', FROM), { url: 'https://aka.ms/download/file.exe' });
  assert.deepEqual(resolveRedirect('file.exe?x=1', 'https://example.com/a/b/c.zip'), { url: 'https://example.com/a/b/file.exe?x=1' });
  assert.deepEqual(resolveRedirect('//cdn.example.com/f.zip', FROM), { url: 'https://cdn.example.com/f.zip' });
});

test('redirect: http is refused, and the error names the protocol but never the URL', () => {
  const r = resolveRedirect('http://captive.portal/login?token=SECRET', FROM);
  assert.equal(r.url, undefined);
  assert.match(r.error, /non-https/);
  assert.ok(!r.error.includes('SECRET') && !r.error.includes('captive.portal'));
});

test('redirect: other schemes are refused', () => {
  for (const loc of ['ftp://example.com/f.zip', 'file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'data:text/plain,hi']) {
    assert.match(resolveRedirect(loc, FROM).error, /non-https|invalid/, loc);
  }
});

test('redirect: garbage is an error, never a throw', () => {
  for (const loc of ['http://', 'https://', 'https://exa mple.com/', '', '   ', undefined, null, {}, 42]) {
    assert.doesNotThrow(() => resolveRedirect(loc, FROM), String(loc));
    assert.ok(resolveRedirect(loc, FROM).error, `${String(loc)} should be an error`);
  }
});
