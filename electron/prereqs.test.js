const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PACKAGES, NET_RELEASE, DX_JUN2010_DLLS, parseRegQueryValue, parseWindowsBuild, evaluatePrereqs, summarize,
} = require('./prereqs');

const VC14 = 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86';
const VC12 = 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\12.0\\VC\\Runtimes\\x86';
const VC11 = 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\11.0\\VC\\Runtimes\\x86';
const NDP = 'HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full';
const UNINSTALL = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const SYS_DIR = 'C:\\Windows\\SysWOW64';

const WIN11 = { build: 26200, is64BitOS: true, windir: 'C:\\Windows' };
const WIN10_2004 = { build: 19041, is64BitOS: true, windir: 'C:\\Windows' };

// regs: { 'KEY|name': value }. A value of Error makes that read throw. Anything absent reads null.
async function run({ regs = {}, files = [], osInfo = WIN11 } = {}) {
  const readRegValue = (key, name) => {
    const v = regs[`${key}|${name}`];
    if (v instanceof Error) throw v;
    return v === undefined ? null : v;
  };
  const present = new Set(files.map((f) => f.toLowerCase()));
  const fileExists = (p) => present.has(p.toLowerCase());
  const byId = Object.fromEntries((await evaluatePrereqs({ readRegValue, fileExists, osInfo })).map((r) => [r.id, r]));
  return byId;
}

const dxFiles = (dir = SYS_DIR) => DX_JUN2010_DLLS.map((f) => `${dir}\\${f}`);
const vc14 = (extra = {}) => ({
  [`${VC14}|Installed`]: 1, [`${VC14}|Version`]: 'v14.51.36247.00', [`${VC14}|Major`]: 14, [`${VC14}|Minor`]: 51, ...extra,
});

// --- VC++ 2015-2022 -------------------------------------------------------------------------

test('vc2015-2022: present and new enough is installed', async () => {
  const r = (await run({ regs: vc14() }))['vc2015-2022-x86'];
  assert.equal(r.status, 'installed');
  assert.match(r.detail, /v14\.51\.36247/);
});

test('vc2015-2022: key absent is missing', async () => {
  assert.equal((await run())['vc2015-2022-x86'].status, 'missing');
});

test('vc2015-2022: Installed=0 is missing', async () => {
  const r = (await run({ regs: vc14({ [`${VC14}|Installed`]: 0 }) }))['vc2015-2022-x86'];
  assert.equal(r.status, 'missing');
  assert.match(r.detail, /Installed=0/);
});

test('vc2015-2022: a 2015-era 14.0 build is below the 14.30 floor and counts as missing', async () => {
  const r = (await run({ regs: vc14({ [`${VC14}|Major`]: 14, [`${VC14}|Minor`]: 0, [`${VC14}|Version`]: 'v14.0.24215.00' }) }))['vc2015-2022-x86'];
  assert.equal(r.status, 'missing');
  assert.match(r.detail, /14\.30/);
});

test('vc2015-2022: exactly 14.30 passes', async () => {
  assert.equal((await run({ regs: vc14({ [`${VC14}|Minor`]: 30 }) }))['vc2015-2022-x86'].status, 'installed');
});

// --- VC++ 2012 / 2013 (Runtimes keys) ---------------------------------------------------------

test('vc2012: Update 4 build passes, an older build does not', async () => {
  const ok = { [`${VC11}|Installed`]: 1, [`${VC11}|Bld`]: 61030, [`${VC11}|Version`]: 'v11.0.61030.00' };
  assert.equal((await run({ regs: ok }))['vc2012-x86'].status, 'installed');
  const old = { ...ok, [`${VC11}|Bld`]: 60610 };
  assert.equal((await run({ regs: old }))['vc2012-x86'].status, 'missing');
});

test('vc2013: Installed=1 is enough', async () => {
  assert.equal((await run({ regs: { [`${VC12}|Installed`]: 1 } }))['vc2013-x86'].status, 'installed');
  assert.equal((await run())['vc2013-x86'].status, 'missing');
});

// --- VC++ 2005 / 2008 / 2010 (Uninstall product codes) --------------------------------------

test('vc2010: SP1 product code present is installed, absent is missing', async () => {
  const key = `${UNINSTALL}\\{F0C3E5D1-1ADE-321E-8167-68EF0DE699A5}|DisplayVersion`;
  assert.equal((await run({ regs: { [key]: '10.0.40219' } }))['vc2010-x86'].status, 'installed');
  assert.equal((await run())['vc2010-x86'].status, 'missing');
});

test('vc2008: any listed SP1 product code counts', async () => {
  const key = `${UNINSTALL}\\{9A25302D-30C0-39D9-BD6F-21E6EC160475}|DisplayVersion`;
  assert.equal((await run({ regs: { [key]: '9.0.30729.4148' } }))['vc2008-x86'].status, 'installed');
});

test('vc2005: the RTM build (8.0.50727.42) is not SP1 and does not count', async () => {
  const rtm = `${UNINSTALL}\\{A49F249F-0C91-497F-86DF-B2585E8E76B7}|DisplayVersion`;
  assert.equal((await run({ regs: { [rtm]: '8.0.50727.42' } }))['vc2005-x86'].status, 'missing');
  const sp1 = `${UNINSTALL}\\{837B34E3-7C30-493C-8F6A-2B0F04E2912C}|DisplayVersion`;
  assert.equal((await run({ regs: { [sp1]: '8.0.59193' } }))['vc2005-x86'].status, 'installed');
});

test('uninstall codes: one code erroring does not hide another that is present', async () => {
  const codes = PACKAGES.find((p) => p.id === 'vc2008-x86').detect.codes;
  const regs = {
    [`${UNINSTALL}\\${codes[0]}|DisplayVersion`]: new Error('boom'),
    [`${UNINSTALL}\\${codes[1]}|DisplayVersion`]: '9.0.30729.4148',
  };
  assert.equal((await run({ regs }))['vc2008-x86'].status, 'installed');
});

test('uninstall codes: an error with nothing found is unknown, not missing', async () => {
  const codes = PACKAGES.find((p) => p.id === 'vc2008-x86').detect.codes;
  const r = (await run({ regs: { [`${UNINSTALL}\\${codes[2]}|DisplayVersion`]: new Error('access denied') } }))['vc2008-x86'];
  assert.equal(r.status, 'unknown');
});

// --- .NET Framework ---------------------------------------------------------------------------

test('.NET: Release below 4.8 leaves 4.8 missing and 4.8.1 missing', async () => {
  const r = await run({ regs: { [`${NDP}|Release`]: NET_RELEASE.v48 - 1, [`${NDP}|Install`]: 1 } });
  assert.equal(r.net48.status, 'missing');
  assert.equal(r.net481.status, 'missing');
});

test('.NET: Release exactly 4.8 installs 4.8, leaves 4.8.1 missing, covers 4.0 and 4.5.2', async () => {
  const r = await run({ regs: { [`${NDP}|Release`]: NET_RELEASE.v48, [`${NDP}|Install`]: 1 } });
  assert.equal(r.net48.status, 'installed');
  assert.equal(r.net481.status, 'missing');
  assert.equal(r.net452.status, 'covered');
  assert.equal(r.net40.status, 'covered');
});

test('.NET: Release at 4.8.1 installs 4.8.1 and covers 4.8, 4.5.2 and 4.0', async () => {
  const r = await run({ regs: { [`${NDP}|Release`]: NET_RELEASE.v481, [`${NDP}|Install`]: 1 } });
  assert.equal(r.net481.status, 'installed');
  assert.equal(r.net48.status, 'covered');
  assert.equal(r.net452.status, 'covered');
  assert.equal(r.net40.status, 'covered');
});

test('.NET: the Release value seen on Windows 11 25H2 (533509) counts as 4.8.1', async () => {
  assert.equal((await run({ regs: { [`${NDP}|Release`]: 533509 } })).net481.status, 'installed');
});

test('.NET: 4.5.2 alone is installed itself, leaves 4.8 missing, and is not covered', async () => {
  const r = await run({ regs: { [`${NDP}|Release`]: NET_RELEASE.v452, [`${NDP}|Install`]: 1 } });
  assert.equal(r.net452.status, 'installed');
  assert.equal(r.net40.status, 'installed');
  assert.equal(r.net48.status, 'missing');
});

test('.NET: a plain 4.0 install (Install=1, no Release) is 4.0 installed and nothing newer', async () => {
  const r = await run({ regs: { [`${NDP}|Install`]: 1 } });
  assert.equal(r.net40.status, 'installed');
  assert.equal(r.net452.status, 'missing');
  assert.equal(r.net48.status, 'missing');
});

test('.NET: 4.8.1 on a Windows 10 build older than 20H2 is unsupported, not missing', async () => {
  const r = await run({ osInfo: WIN10_2004, regs: { [`${NDP}|Release`]: NET_RELEASE.v48 } });
  assert.equal(r.net481.status, 'unsupported');
  assert.match(r.net481.detail, /20H2/);
});

test('.NET: 4.8.1 exactly at build 19042 (20H2) is offered', async () => {
  const r = await run({ osInfo: { ...WIN11, build: 19042 }, regs: { [`${NDP}|Release`]: NET_RELEASE.v48 } });
  assert.equal(r.net481.status, 'missing');
});

test('.NET: an unparseable Windows build makes the gated package unknown', async () => {
  const r = await run({ osInfo: { ...WIN11, build: NaN }, regs: { [`${NDP}|Release`]: NET_RELEASE.v48 } });
  assert.equal(r.net481.status, 'unknown');
});

// --- DirectX June 2010 ------------------------------------------------------------------------

test('directx: every June 2010 DLL present is installed', async () => {
  assert.equal((await run({ files: dxFiles() }))['directx-jun2010'].status, 'installed');
});

test('directx: one DLL missing is missing and the detail names it', async () => {
  const r = (await run({ files: dxFiles().filter((f) => !f.endsWith('xaudio2_7.dll')) }))['directx-jun2010'];
  assert.equal(r.status, 'missing');
  assert.match(r.detail, /xaudio2_7\.dll/);
});

test('directx: 64-bit Windows looks in SysWOW64, 32-bit Windows in System32', async () => {
  assert.equal((await run({ files: dxFiles('C:\\Windows\\System32') }))['directx-jun2010'].status, 'missing');
  const os32 = { build: 19045, is64BitOS: false, windir: 'C:\\Windows' };
  assert.equal((await run({ osInfo: os32, files: dxFiles('C:\\Windows\\System32') }))['directx-jun2010'].status, 'installed');
});

test('directx: xinput1_3.dll is not part of the proof set (Windows ships its own)', async () => {
  assert.ok(!DX_JUN2010_DLLS.some((f) => /xinput/i.test(f)));
});

// --- error handling ---------------------------------------------------------------------------

test('a registry read that throws is unknown, never installed', async () => {
  const r = (await run({ regs: { [`${VC14}|Installed`]: new Error('reg.exe timed out') } }))['vc2015-2022-x86'];
  assert.equal(r.status, 'unknown');
  assert.match(r.detail, /timed out/);
});

test('a throwing read only affects its own package', async () => {
  const r = await run({ regs: { [`${NDP}|Release`]: new Error('nope'), ...vc14() }, files: dxFiles() });
  assert.equal(r.net48.status, 'unknown');
  assert.equal(r['vc2015-2022-x86'].status, 'installed');
  assert.equal(r['directx-jun2010'].status, 'installed');
});

test('async injected I/O works, and a rejected read is unknown', async () => {
  const out = await evaluatePrereqs({
    readRegValue: async (key, name) => {
      if (key === NDP) throw new Error('reg.exe exited 2');
      return `${key}|${name}` === `${VC14}|Installed` ? 1 : null;
    },
    fileExists: async () => true,
    osInfo: WIN11,
  });
  const byId = Object.fromEntries(out.map((r) => [r.id, r]));
  assert.equal(byId.net48.status, 'unknown');
  assert.equal(byId['directx-jun2010'].status, 'installed');
  assert.equal(byId['vc2015-2022-x86'].status, 'missing'); // Installed=1 but no Major/Minor to prove 14.30+
});

test('a fileExists that throws is unknown', async () => {
  const out = await evaluatePrereqs({
    readRegValue: () => null,
    fileExists: () => { throw new Error('EPERM'); },
    osInfo: WIN11,
  });
  assert.equal(out.find((r) => r.id === 'directx-jun2010').status, 'unknown');
});

// --- summarize --------------------------------------------------------------------------------

test('summarize: splits required from recommended and ignores optional/superseded/covered/unsupported', async () => {
  const results = await evaluatePrereqs({
    readRegValue: () => null, // nothing installed anywhere
    fileExists: () => false,
    osInfo: WIN10_2004,
  });
  const s = summarize(results);
  assert.deepEqual(s.requiredMissing.map((r) => r.id).sort(), ['directx-jun2010', 'vc2015-2022-x86']);
  assert.deepEqual(s.recommendedMissing.map((r) => r.id).sort(),
    ['net48', 'vc2005-x86', 'vc2008-x86', 'vc2010-x86', 'vc2012-x86', 'vc2013-x86']);
  assert.ok(!s.requiredMissing.concat(s.recommendedMissing).some((r) => ['net481', 'net40', 'net452'].includes(r.id)));
});

test('summarize: a fully provisioned machine has nothing missing', async () => {
  const regs = {
    ...vc14(),
    [`${VC12}|Installed`]: 1,
    [`${VC11}|Installed`]: 1, [`${VC11}|Bld`]: 61030,
    [`${NDP}|Release`]: NET_RELEASE.v481, [`${NDP}|Install`]: 1,
  };
  for (const id of ['vc2010-x86', 'vc2008-x86', 'vc2005-x86']) {
    regs[`${UNINSTALL}\\${PACKAGES.find((p) => p.id === id).detect.codes[0]}|DisplayVersion`] = '1.0';
  }
  const s = summarize(await evaluatePrereqs({
    readRegValue: (key, name) => (`${key}|${name}` in regs ? regs[`${key}|${name}`] : null),
    fileExists: () => true,
    osInfo: WIN11,
  }));
  assert.deepEqual(s, { requiredMissing: [], recommendedMissing: [], unknown: [] });
});

test('summarize: unknown results are reported separately and never counted as missing', async () => {
  const results = await evaluatePrereqs({
    readRegValue: () => { throw new Error('reg failed'); },
    fileExists: () => true,
    osInfo: WIN11,
  });
  const s = summarize(results);
  assert.equal(s.requiredMissing.length, 0);
  assert.ok(s.unknown.length > 0);
});

// --- helpers + catalogue ----------------------------------------------------------------------

test('parseRegQueryValue: DWORD hex, SZ string, case-insensitive name, absent value', async () => {
  const out = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86',
    '    Version    REG_SZ    v14.51.36247.00',
    '    Installed    REG_DWORD    0x1',
    '    Minor    REG_DWORD    0x33',
    '',
  ].join('\r\n');
  assert.equal(parseRegQueryValue(out, 'Installed'), 1);
  assert.equal(parseRegQueryValue(out, 'minor'), 51);
  assert.equal(parseRegQueryValue(out, 'Version'), 'v14.51.36247.00');
  assert.equal(parseRegQueryValue(out, 'Bld'), null);
  assert.equal(parseRegQueryValue('', 'Installed'), null);
});

test('parseRegQueryValue: Release in hex (0x82405 = 533509) and a name with regex characters', async () => {
  assert.equal(parseRegQueryValue('    Release    REG_DWORD    0x82405\r\n', 'Release'), 533509);
  assert.equal(parseRegQueryValue('    a.b    REG_SZ    x\r\n', 'a.b'), 'x');
  assert.equal(parseRegQueryValue('    aXb    REG_SZ    x\r\n', 'a.b'), null);
});

test('parseWindowsBuild reads the third field of os.release()', async () => {
  assert.equal(parseWindowsBuild('10.0.26200'), 26200);
  assert.equal(parseWindowsBuild('10.0.19045'), 19045);
  assert.ok(Number.isNaN(parseWindowsBuild('garbage')));
});

test('catalogue: unique ids, valid categories, and an installer for everything installable', async () => {
  const ids = PACKAGES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(PACKAGES.length, 11);
  for (const p of PACKAGES) {
    assert.ok(['required', 'recommended', 'optional', 'superseded'].includes(p.category), p.id);
    if (p.category === 'superseded') {
      assert.equal(p.installer, null, `${p.id} must never be installed`);
    } else {
      assert.match(p.installer.url, /^https:\/\/(download\.microsoft\.com|aka\.ms|go\.microsoft\.com|download\.visualstudio\.microsoft\.com)\//, p.id);
      assert.ok(p.installer.sizeBytes > 0, p.id);
    }
  }
});

test('catalogue: only DirectX and VC++ 2015-2022 are required, and 1638 is a success only for VC++', async () => {
  assert.deepEqual(PACKAGES.filter((p) => p.category === 'required').map((p) => p.id), ['directx-jun2010', 'vc2015-2022-x86']);
  for (const p of PACKAGES.filter((q) => q.installer)) {
    assert.equal(p.exitCodes.ok.includes(1638), p.id.startsWith('vc'), p.id);
    assert.ok(p.exitCodes.reboot.includes(3010), p.id);
  }
});
