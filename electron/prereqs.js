// Prerequisite catalogue + detection for FFXI / Ashita: DirectX June 2010, VC++ x86 redists and
// .NET Framework 4.x. Everything here is x86 because FFXI and Ashita are 32-bit processes — that
// holds on 64-bit Windows too. Kept free of any `electron` import and of direct I/O: main.js
// injects readRegValue / fileExists / osInfo so the logic is unit-testable off Windows.
//
// Sources and the per-package research live in
// docs/superpowers/specs/2026-10-06-prereqs-design.md. Claims we could not confirm against a
// Microsoft Learn/Docs page or the Ashita docs are marked UNVERIFIED below.
//   Ashita list:  https://docs.ashitaxi.com/installation/requirements/
//   VC++ redists: https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files
//                 https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist
//   .NET:         https://learn.microsoft.com/en-us/dotnet/framework/migration-guide/how-to-determine-which-versions-are-installed
//                 https://learn.microsoft.com/en-us/dotnet/framework/get-started/system-requirements
//                 https://learn.microsoft.com/en-us/dotnet/framework/deployment/deployment-guide-for-developers
//   DirectX:      https://learn.microsoft.com/en-us/windows/win32/dxtecharts/directx-setup-for-game-developers
//   Exit codes:   https://learn.microsoft.com/en-us/windows/win32/msi/error-codes

const path = require('path');

// .NET Framework 4.5+ `Release` DWORD minimums (compare with >=, per the Learn table).
const NET_RELEASE = { v452: 379893, v48: 528040, v481: 533320 };

// First Windows 10 build that can install .NET 4.8.1 (20H2, "October 2020 Update"). The Learn
// system-requirements table lists 4.8.1 as installable from 20H2 up and built in from Win11 22H2.
const WIN10_20H2_BUILD = 19042;

// VC++ 2015-2022 x86 is binary-compatible within v14, but Ashita is built with VS2022 and Learn
// says the installed redist must be at least as new as the build tools. The v143 toolset starts at
// 14.30. UNVERIFIED: Ashita's docs only say "the latest package is required", no number.
const VC14_MIN = { major: 14, minor: 30 };

// Proof that the June 2010 redist ran. Each is shipped only by that redist (the Jun2010_*_43 cabs
// and Feb2010_X3DAudio) and none is an OS component on Windows 10/11. xinput1_3.dll is left out on
// purpose: Windows 10/11 ship their own, so it proves nothing.
const DX_JUN2010_DLLS = [
  'd3dx9_43.dll',
  'd3dx10_43.dll',
  'd3dx11_43.dll',
  'D3DCompiler_43.dll',
  'xaudio2_7.dll',
  'X3DAudio1_7.dll',
];

const VC_RUNTIMES = (vs) => `HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\${vs}\\VC\\Runtimes\\x86`;
const UNINSTALL = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const NDP_FULL = 'HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full';

// Exit codes: 3010 and 1641 mean success + restart needed (Windows Installer error-codes page);
// 1638 means a newer version is already installed, which satisfies the prerequisite (same page;
// for VC++ 2015 also Microsoft KB4092997). 5100 (.NET: machine does not meet requirements) and
// 1602 (user cancelled) are failures.
const OK = [0];
const OK_NEWER = [0, 1638];
const REBOOT = [3010, 1641];

// Registry reads use view '32' (= WOW6432Node on 64-bit Windows, the real hive on 32-bit) for
// everything an x86 installer writes. The .NET key is read in the process's native view, which is
// the path Learn documents.
const PACKAGES = [
  {
    id: 'directx-jun2010',
    name: 'DirectX End-User Runtime (June 2010)',
    category: 'required',
    installer: {
      kind: 'dx-sfx',
      url: 'https://download.microsoft.com/download/8/4/a/84a35bf1-dafe-4ae8-82af-ad2ae20b6b14/directx_Jun2010_redist.exe',
      sizeBytes: 100275120,
      versionless: false,
      // Win32 Cabinet Self-Extractor: /Q quiet, /T:<full path> work dir, /C extract only (usage
      // text read from the exe's own resources; UNVERIFIED on a Microsoft page). Then run
      // DXSETUP.exe /silent from there (documented on the DirectX Setup for Game Developers page).
      extractArgs: ['/Q', '/T:{dir}', '/C'],
      setupExe: 'DXSETUP.exe',
      args: ['/silent'],
    },
    exitCodes: { ok: OK, reboot: REBOOT }, // DXSETUP exit codes UNVERIFIED
    detect: { type: 'files', files: DX_JUN2010_DLLS },
  },
  {
    id: 'vc2015-2022-x86',
    name: 'Visual C++ 2015-2022 Redistributable (x86)',
    category: 'required',
    installer: {
      kind: 'exe',
      url: 'https://aka.ms/vs/17/release/vc_redist.x86.exe',
      sizeBytes: 13953392, // at 2026-10-06; the aka.ms permalink always serves the newest build
      versionless: true,
      args: ['/install', '/quiet', '/norestart'],
    },
    exitCodes: { ok: OK_NEWER, reboot: REBOOT },
    detect: { type: 'vcRuntimes', vs: '14.0', minMajor: VC14_MIN.major, minMinor: VC14_MIN.minor },
  },
  {
    id: 'net48',
    name: '.NET Framework 4.8',
    category: 'recommended',
    installer: {
      kind: 'exe',
      url: 'https://go.microsoft.com/fwlink/?linkid=2088631', // -> NDP48-x86-x64-AllOS-ENU.exe (offline)
      sizeBytes: 121346568,
      versionless: false,
      args: ['/q', '/norestart'],
    },
    exitCodes: { ok: OK, reboot: REBOOT },
    detect: { type: 'dotnetRelease', min: NET_RELEASE.v48, coveredAt: NET_RELEASE.v481, coveredBy: '.NET Framework 4.8.1' },
  },
  {
    id: 'vc2013-x86',
    name: 'Visual C++ 2013 Redistributable (x86)',
    category: 'recommended',
    installer: {
      kind: 'exe',
      url: 'https://aka.ms/highdpimfc2013x86enu', // -> download.visualstudio.microsoft.com/.../vcredist_x86.exe
      sizeBytes: 6510136,
      versionless: false,
      args: ['/install', '/quiet', '/norestart'], // UNVERIFIED for the 2013 bundle (Learn documents these for v14)
    },
    exitCodes: { ok: OK_NEWER, reboot: REBOOT },
    detect: { type: 'vcRuntimes', vs: '12.0' },
  },
  {
    id: 'vc2012-x86',
    name: 'Visual C++ 2012 Update 4 Redistributable (x86)',
    category: 'recommended',
    installer: {
      kind: 'exe',
      url: 'https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x86.exe',
      sizeBytes: 6554576,
      versionless: false,
      args: ['/install', '/quiet', '/norestart'], // UNVERIFIED for the 2012 bundle
    },
    exitCodes: { ok: OK_NEWER, reboot: REBOOT },
    detect: { type: 'vcRuntimes', vs: '11.0', minBld: 61030 }, // Update 4 = 11.0.61030
  },
  {
    id: 'vc2010-x86',
    name: 'Visual C++ 2010 SP1 Redistributable (x86)',
    category: 'recommended',
    installer: {
      kind: 'exe',
      url: 'https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe',
      sizeBytes: 8993744,
      versionless: false,
      // /q and /norestart are documented for this package family in security bulletin MS11-025
      // (KB2565063); the redist exe itself is UNVERIFIED.
      args: ['/q', '/norestart'],
    },
    exitCodes: { ok: OK_NEWER, reboot: REBOOT },
    // No Runtimes key exists for 10.0 (checked). The SP1 product code was read from the package's
    // own MSI (vc_red.msi) and matches the Uninstall key on a machine that has it installed.
    detect: { type: 'uninstallCodes', codes: ['{F0C3E5D1-1ADE-321E-8167-68EF0DE699A5}'] },
  },
  {
    id: 'vc2008-x86',
    name: 'Visual C++ 2008 SP1 Redistributable (x86)',
    category: 'recommended',
    installer: {
      kind: 'exe',
      url: 'https://download.microsoft.com/download/5/D/8/5D8C65CB-C849-4025-8E95-C3966CAFD8AE/vcredist_x86.exe',
      sizeBytes: 4483040,
      versionless: false,
      args: ['/q', '/norestart'], // MS11-025 documents these for KB2538243; the redist exe itself is UNVERIFIED
    },
    exitCodes: { ok: OK_NEWER, reboot: REBOOT },
    detect: {
      type: 'uninstallCodes',
      codes: [
        '{9BE518E6-ECC6-35A9-88E4-87755C07200F}', // 9.0.30729.6161 — read from the downloaded package's MSI
        '{9A25302D-30C0-39D9-BD6F-21E6EC160475}', // 9.0.30729.4148 SP1 — UNVERIFIED (from memory, not seen on any machine here)
        '{1F1C2DFC-2D24-3E06-BCB8-725134ADF989}', // 9.0.30729.17 SP1 RTM — UNVERIFIED
      ],
    },
  },
  {
    id: 'vc2005-x86',
    name: 'Visual C++ 2005 SP1 Redistributable (x86)',
    category: 'recommended',
    installer: {
      kind: 'exe',
      url: 'https://download.microsoft.com/download/8/b/4/8b42259f-5d70-43f4-ac2e-4b208fd8d66a/vcredist_x86.EXE',
      sizeBytes: 2710520,
      versionless: false,
      args: ['/q'], // Win32 Cabinet Self-Extractor quiet mode wrapping `msiexec /i vcredist.msi`; /norestart UNVERIFIED
    },
    exitCodes: { ok: OK_NEWER, reboot: REBOOT },
    // The RTM build (8.0.50727.42, {A49F249F-...}) is deliberately not listed: Ashita asks for SP1.
    detect: {
      type: 'uninstallCodes',
      codes: [
        '{710F4C1C-CC18-4C49-8CBF-51240C89A1A2}', // 8.0.61001 MFC security update — read from the downloaded package's MSI
        '{837B34E3-7C30-493C-8F6A-2B0F04E2912C}', // 8.0.59193 ATL security update — seen installed on a machine here
        '{7299052B-02A4-4627-81F2-1818DA5D550D}', // 8.0.50727.762 SP1 original — UNVERIFIED
      ],
    },
  },
  {
    id: 'net481',
    name: '.NET Framework 4.8.1',
    category: 'optional',
    installer: {
      kind: 'exe',
      url: 'https://go.microsoft.com/fwlink/?linkid=2203305', // -> NDP481-x86-x64-AllOS-ENU.exe (offline)
      sizeBytes: 77688504,
      versionless: false,
      args: ['/q', '/norestart'], // the Learn guide covers up to 4.8; 4.8.1 UNVERIFIED but same engine
    },
    exitCodes: { ok: OK, reboot: REBOOT },
    detect: { type: 'dotnetRelease', min: NET_RELEASE.v481 },
    osGate: { minBuild: WIN10_20H2_BUILD, reason: '.NET Framework 4.8.1 needs Windows 10 20H2 (build 19042) or newer' },
  },
  // 4.0 and 4.5.2 are in-place predecessors of 4.8: Learn describes 4.5.2 as an in-place update to
  // 4.0/4.5/4.5.1 and the 4.5.1–4.8 releases as in-place updates to 4.5. Nothing here is ever
  // installed — a machine without 4.8 should install 4.8.
  {
    id: 'net40',
    name: '.NET Framework 4.0',
    category: 'superseded',
    installer: null,
    detect: { type: 'dotnet40', coveredAt: NET_RELEASE.v48 },
  },
  {
    id: 'net452',
    name: '.NET Framework 4.5.2',
    category: 'superseded',
    installer: null,
    detect: { type: 'dotnetRelease', min: NET_RELEASE.v452, coveredAt: NET_RELEASE.v48, coveredBy: '.NET Framework 4.8' },
  },
];

// reg.exe prints `    Name    REG_DWORD    0x1`. Returns a number for DWORD/QWORD, the string for
// everything else, null when the value isn't in the output. Registry names are case-insensitive.
function parseRegQueryValue(stdout, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(stdout).match(new RegExp(`^\\s*${escaped}\\s+REG_(\\w+)\\s*(.*?)\\s*$`, 'im'));
  if (!m) return null;
  const type = m[1].toUpperCase();
  if (type === 'DWORD' || type === 'QWORD') {
    const n = Number(m[2]);
    return Number.isNaN(n) ? null : n;
  }
  return m[2];
}

// os.release() on Windows is "10.0.<build>". Windows 11 still reports major 10.
function parseWindowsBuild(release) {
  const m = String(release).match(/^\d+\.\d+\.(\d+)/);
  return m ? Number(m[1]) : NaN;
}

function result(pkg, status, detail) {
  return { id: pkg.id, name: pkg.name, category: pkg.category, status, detail };
}

// readRegValue(key, name, view) -> number | string | null (null = key or value absent); rejects/throws
// when the read itself failed. view is '32' for the x86 registry view, undefined for the native one.
// Both injected functions may be sync or async (the real ones shell out to reg.exe).
async function evaluateOne(pkg, io) {
  const { readRegValue, fileExists, osInfo } = io;
  const d = pkg.detect;

  const gateFails = () => {
    if (!pkg.osGate) return false;
    if (!Number.isFinite(osInfo.build)) throw new Error('Windows build number is unknown');
    return osInfo.build < pkg.osGate.minBuild;
  };
  const missing = (detail) => (gateFails()
    ? result(pkg, 'unsupported', pkg.osGate.reason)
    : result(pkg, 'missing', detail));

  if (d.type === 'files') {
    const dir = path.win32.join(osInfo.windir, osInfo.is64BitOS ? 'SysWOW64' : 'System32');
    const found = await Promise.all(d.files.map((f) => fileExists(path.win32.join(dir, f))));
    const absent = d.files.filter((f, i) => !found[i]);
    return absent.length === 0
      ? result(pkg, 'installed', `${d.files.length} of ${d.files.length} June 2010 DLLs present in ${dir}`)
      : missing(`Missing from ${dir}: ${absent.join(', ')}`);
  }

  if (d.type === 'vcRuntimes') {
    const key = VC_RUNTIMES(d.vs);
    const installed = await readRegValue(key, 'Installed', '32');
    if (installed === null) return missing(`${key} not found`);
    if (installed !== 1) return missing(`Installed=${installed}`);
    const version = await readRegValue(key, 'Version', '32');
    const shown = version || 'unknown version';
    if (d.minMajor !== undefined) {
      const major = await readRegValue(key, 'Major', '32');
      const minor = await readRegValue(key, 'Minor', '32');
      if (major === null || minor === null) return missing('Runtimes key has no Major/Minor');
      if (major < d.minMajor || (major === d.minMajor && minor < d.minMinor)) {
        return missing(`Found ${shown}, need ${d.minMajor}.${d.minMinor} or newer`);
      }
    }
    if (d.minBld !== undefined) {
      const bld = await readRegValue(key, 'Bld', '32');
      if (bld === null) return missing('Runtimes key has no Bld');
      if (bld < d.minBld) return missing(`Found ${shown}, need build ${d.minBld} or newer`);
    }
    return result(pkg, 'installed', shown);
  }

  if (d.type === 'uninstallCodes') {
    let failure = null;
    for (const code of d.codes) {
      try {
        const version = await readRegValue(`${UNINSTALL}\\${code}`, 'DisplayVersion', '32');
        if (version !== null) return result(pkg, 'installed', `${code} ${version}`);
      } catch (e) {
        failure = failure || e;
      }
    }
    if (failure) throw failure;
    return missing('No matching product code in Uninstall');
  }

  if (d.type === 'dotnetRelease') {
    const release = await readRegValue(NDP_FULL, 'Release');
    if (release === null) return missing(`${NDP_FULL}\\Release not found`);
    if (d.coveredAt !== undefined && release >= d.coveredAt) {
      return result(pkg, 'covered', `Covered by ${d.coveredBy} (Release ${release})`);
    }
    if (release >= d.min) return result(pkg, 'installed', `Release ${release}`);
    return missing(`Release ${release} is below ${d.min}`);
  }

  if (d.type === 'dotnet40') {
    const release = await readRegValue(NDP_FULL, 'Release');
    if (release !== null && release >= d.coveredAt) return result(pkg, 'covered', `Covered by .NET Framework 4.8 (Release ${release})`);
    const install = await readRegValue(NDP_FULL, 'Install');
    if (install === 1) return result(pkg, 'installed', release === null ? '4.0' : `Release ${release}`);
    return missing('.NET Framework 4.x not found');
  }

  throw new Error(`Unknown detect type: ${d.type}`);
}

// Never reports 'installed' for a package whose detection read failed. Packages are checked
// concurrently (each is independent); the result keeps PACKAGES order.
function evaluatePrereqs({ readRegValue, fileExists, osInfo }) {
  return Promise.all(PACKAGES.map(async (pkg) => {
    try {
      return await evaluateOne(pkg, { readRegValue, fileExists, osInfo });
    } catch (e) {
      return result(pkg, 'unknown', `Could not check: ${e && e.message ? e.message : e}`);
    }
  }));
}

// Drives the Home banner (required only) and the Requirements page. 'unsupported', 'covered' and
// 'superseded' never count as missing; read failures are reported separately so the UI can choose
// not to nag about them.
function summarize(results) {
  return {
    requiredMissing: results.filter((r) => r.category === 'required' && r.status === 'missing'),
    recommendedMissing: results.filter((r) => r.category === 'recommended' && r.status === 'missing'),
    unknown: results.filter((r) => r.status === 'unknown'),
  };
}

module.exports = {
  PACKAGES,
  NET_RELEASE,
  WIN10_20H2_BUILD,
  DX_JUN2010_DLLS,
  parseRegQueryValue,
  parseWindowsBuild,
  evaluatePrereqs,
  summarize,
};
