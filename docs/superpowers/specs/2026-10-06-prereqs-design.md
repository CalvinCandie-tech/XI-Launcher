# Prerequisites checker — design (Phase 1: research + detection)

**Date:** 2026-10-06
**Status:** Phase 1 built (`electron/prereqs.js`, read-only IPC `get-prereqs-status`). Phase 2 built (`electron/prereqInstall.js`, IPC `install-prerequisites`; see "Phase 2 — as built"). Phase 3 is guidance only.
**Branch:** `feature/prereqs` (off `master` e5cb555)

## Read this first: a v1 installer already exists

`master` already ships a one-click installer from the 2026-07-12 spec
(`docs/superpowers/specs/2026-07-12-prerequisite-runtime-installer-design.md`): the `install-prerequisites`
IPC in `electron/main.js`, a `PREREQUISITES` array, buttons in SetupWizard and SettingsTab. It differs from
this design:

- No detection — it relies on each installer skipping itself.
- Five packages only: VC++ 2010/2012/2013/2015-2022 and .NET **4.5.2**. No DirectX June 2010, no VC++ 2005/2008, no .NET 4.8/4.8.1.
- SHA256-pinned. The 2015-2022 pin (`F0BAB33A…`) is an old build; the permalink now serves a different file (`0C09F261…`, see below).
- .NET 4.5.2 is installed on every machine, including Windows 10/11, where Microsoft's own page lists support only up to Windows 8.1 and Server 2012 R2.

Phase 2 should **replace** that handler's data and gating with the catalogue in `prereqs.js`, not add a second
installer next to it. Phase 1 does not touch it. The hashes of the 2010, 2012, 2013 and 4.5.2 files downloaded
for this research match the v1 pins, which corroborates both.

## Scope of this phase

Pure catalogue + detection + one read-only IPC. No downloads, no installers run, no UI, no elevation.

## Ground rules

- Everything is **x86**: FFXI and Ashita are 32-bit processes. This holds on 64-bit Windows, where x86 redists register under `WOW6432Node` and the 32-bit DLLs live in `SysWOW64`. Learn: "if you have a 32-bit application running on a 64-bit OS, the 32-bit versions of the DLLs will work".
- Ashita's list is the source of the package set: <https://docs.ashitaxi.com/installation/requirements/> (read 2026-10-06).
- Source discipline: every URL, switch, exit code and key cites a Microsoft Learn/Docs page, the Ashita docs, or was observed directly (marked **observed**). Anything else is **UNVERIFIED**.

## Which Ashita link is which version

The docs label the five optional VC++ links 2005 SP1, 2008 SP1, 2010 SP1, 2012 Update 4, 2013, in that order. Cross-checked against Learn's "latest supported VC++ redistributable downloads" page and each file's version info:

| Ashita label | Link | Verified as |
|---|---|---|
| 2005 SP1 | `details.aspx?id=26347` | "VC++ 2005 SP1 Redistributable Package **MFC Security Update**" (KB2538242). Page lists x86 2.6 MB; its x86 link is `…/8/b/4/8b42259f-…/vcredist_x86.EXE` (read from the page's embedded links) |
| 2008 SP1 | `…/5/D/8/5D8C65CB-…/vcredist_x86.exe` | Learn lists 9.0.30729.5677 |
| 2010 SP1 | `…/1/6/5/165255E7-…/vcredist_x86.exe` | Learn lists 10.0.40219.325 |
| 2012 U4 | `…/1/6/B/16B06F60-…/VSU_4/vcredist_x86.exe` | Learn lists 11.0.61030.0 |
| 2013 | `aka.ms/highdpimfc2013x86enu` | Learn lists 12.0.40664.0 |

## Package table

All URLs were followed with `curl -sIL` to the final Microsoft-hosted file (200 OK). Sizes are `Content-Length`.
"Versionless" = the URL's content changes over time. Signature column: `Get-AuthenticodeSignature` on a downloaded copy, never run — all 13 files (incl. both .NET web stubs) were **Valid**, signer `CN=Microsoft Corporation`.

| id | Display name | Category | Final URL | Size | Versionless? |
|---|---|---|---|---|---|
| `directx-jun2010` | DirectX End-User Runtime (June 2010) | **required** | `https://download.microsoft.com/download/8/4/a/84a35bf1-dafe-4ae8-82af-ad2ae20b6b14/directx_Jun2010_redist.exe` (from `details.aspx?id=8109`) | 100,275,120 | no |
| `vc2015-2022-x86` | VC++ 2015-2022 x86 | **required** | `https://aka.ms/vs/17/release/vc_redist.x86.exe` → `download.visualstudio.microsoft.com/download/pr/<guid>/<SHA256>/VC_redist.x86.exe` | 13,953,392 | **yes** (redirect target embeds its own SHA256 and changes with each release; `Last-Modified` 2026-08-28) |
| `net48` | .NET Framework 4.8 (offline) | recommended | `https://go.microsoft.com/fwlink/?linkid=2088631` → `download.microsoft.com/download/f/3/a/f3a6af84-…/NDP48-x86-x64-AllOS-ENU.exe` | 121,346,568 | no (fwlink alias; target fixed) |
| `vc2013-x86` | VC++ 2013 x86 | recommended | `https://aka.ms/highdpimfc2013x86enu` → `download.visualstudio.microsoft.com/download/pr/10912113/5da66dde…/vcredist_x86.exe` | 6,510,136 | no (`Last-Modified` 2017-07-12) |
| `vc2012-x86` | VC++ 2012 Update 4 x86 | recommended | `https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x86.exe` | 6,554,576 | no |
| `vc2010-x86` | VC++ 2010 SP1 x86 | recommended | `https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe` | 8,993,744 | no |
| `vc2008-x86` | VC++ 2008 SP1 x86 | recommended | `https://download.microsoft.com/download/5/D/8/5D8C65CB-C849-4025-8E95-C3966CAFD8AE/vcredist_x86.exe` | 4,483,040 | no |
| `vc2005-x86` | VC++ 2005 SP1 x86 | recommended | `https://download.microsoft.com/download/8/b/4/8b42259f-5d70-43f4-ac2e-4b208fd8d66a/vcredist_x86.EXE` | 2,710,520 | no |
| `net481` | .NET Framework 4.8.1 (offline) | optional | `https://go.microsoft.com/fwlink/?linkid=2203305` → `download.microsoft.com/download/4/b/2/cd00d4ed-…/NDP481-x86-x64-AllOS-ENU.exe` | 77,688,504 | no |
| `net40` | .NET Framework 4.0 | superseded | (not offered) `…/9/5/a/95a9616b-…/dotNetFx40_Full_x86_x64.exe`, 50,449,456 B | — | no |
| `net452` | .NET Framework 4.5.2 | superseded | (not offered) `…/e/2/1/e21644b5-…/NDP452-KB2901907-x86-x64-AllOS-ENU.exe`, 69,999,448 B | — | no |

Web installers exist for 4.8 (`linkid=2085155`, 1.4 MB) and 4.8.1 (`linkid=2203304`, 1.4 MB); both signed and valid. Offline is preferred for Phase 2 so the signature check covers the real payload.

Download total if everything is missing: required 114.2 MB; plus old VC++ 29.2 MB = 143.5 MB; plus .NET 4.8 offline = 264.8 MB. On Windows 10 1903+ and Windows 11 the .NET package is already present, so the realistic worst case is about 143 MB.

| id | Silent args | OK exit codes | Detection | OS gate |
|---|---|---|---|---|
| `directx-jun2010` | extract `directx_Jun2010_redist.exe /Q /T:<dir> /C`, then `<dir>\DXSETUP.exe /silent` | 0 (DXSETUP codes UNVERIFIED); 3010 = restart | all 6 DLLs present in `SysWOW64` (64-bit) / `System32` (32-bit): `d3dx9_43`, `d3dx10_43`, `d3dx11_43`, `D3DCompiler_43`, `xaudio2_7`, `X3DAudio1_7` | none |
| `vc2015-2022-x86` | `/install /quiet /norestart` | 0, **1638** (newer present), 3010/1641 = restart | `HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x86` (32-bit view): `Installed=1` and `Major.Minor ≥ 14.30` | none |
| `net48` | `/q /norestart` (passive: `/passive /norestart`) | 0; 3010/1641 = restart; 5100 = requirements not met; 1602 = cancelled | `HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full` `Release ≥ 528040`; ≥ 533320 → "covered" by 4.8.1 | built in on Win10 1903+; Win11 |
| `vc2013-x86` | `/install /quiet /norestart` | 0, 1638, 3010/1641 | `…\VisualStudio\12.0\VC\Runtimes\x86` `Installed=1` | none |
| `vc2012-x86` | `/install /quiet /norestart` | 0, 1638, 3010/1641 | `…\VisualStudio\11.0\VC\Runtimes\x86` `Installed=1`, `Bld ≥ 61030` (Update 4) | none |
| `vc2010-x86` | `/q /norestart` | 0, 1638, 3010/1641 | `Uninstall\{F0C3E5D1-1ADE-321E-8167-68EF0DE699A5}` `DisplayVersion` exists | none |
| `vc2008-x86` | `/q /norestart` | 0, 1638, 3010/1641 | any of 3 product codes under `Uninstall` (only `{9BE518E6-…}` is verified) | none |
| `vc2005-x86` | `/q` | 0, 1638, 3010/1641 | any of 3 SP1 product codes under `Uninstall` (RTM `{A49F249F-…}` deliberately excluded) | none |
| `net481` | `/q /norestart` | as `net48` | `Release ≥ 533320` | Windows 10 20H2 (build 19042) or newer |
| `net40` / `net452` | never installed | — | `Release ≥ 528040` → **covered**; else own check (`Install=1` / `Release ≥ 379893`) | n/a |

## Findings

### Detection
- **VC++ 2015-2022** — Learn documents the version in `HKLM\SOFTWARE\Wow6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\{x86|x64|arm64}` ("check under Wow6432Node only if you use Regedit to view the x86 package on x64"). Reading with `reg query /reg:32` gives the same key on 64-bit and the real key on 32-bit. **Observed** on this machine: `Installed=1`, `Major=14`, `Minor=51` (`v14.51.36247.00`); the 64-bit-view path is absent.
- **Minimum version** — Ashita says only "the latest package is required". We enforce **14.30+** because Ashita is built with VS2022 (Ashita docs) and Learn says the installed redist must be at least as recent as the build tools; v143 starts at 14.30. The exact floor is **UNVERIFIED** (an inference from two sources, not a stated number).
- **VC++ 2012/2013** — `…\11.0\…` and `…\12.0\…` `Runtimes\x86` keys exist (**observed**: `Installed=1`, `Bld=61030`, `Version v11.0.61030.00` / `v12.0.40664.00`). Not documented on Learn; **UNVERIFIED** by docs. Two 2013 builds (12.0.30501 and 12.0.40664) were both registered on this machine, so any 12.0.x counts.
- **VC++ 2005/2008/2010** — no `Runtimes` key exists for 8.0/9.0/10.0 (**observed**: absent). Detection uses `Uninstall\{ProductCode}`. Product codes were read from each downloaded package's own MSI (7-Zip extract + `WindowsInstaller.Installer` read-only open, nothing executed):
  - 2005 MFC update → `{710F4C1C-CC18-4C49-8CBF-51240C89A1A2}` 8.0.61001
  - 2008 → `{9BE518E6-ECC6-35A9-88E4-87755C07200F}` 9.0.30729.6161 (the exe's file version says 5677; the MSI inside says 6161)
  - 2010 → `{F0C3E5D1-1ADE-321E-8167-68EF0DE699A5}` 10.0.40219 (the KB2565063 patch inside updates files without changing the code)

  Several variants of 2005 and 2008 exist in the wild (this machine has three 2005 entries: RTM 8.0.50727.42, 59193, 61001). "Installed" = any **SP1-era** code. The two 2008 codes and the original 2005 SP1 code besides the ones above are **UNVERIFIED** (from memory, not seen here). A wrong or missing code only produces a false "missing", and the Phase 2 install is a harmless upgrade.
- **.NET** — Learn "How to: determine which versions are installed": compare `Release` with `>=`; 4.5.2 = 379893, 4.8 = 528040, 4.8.1 = 533320 (Win11 22H2/23H2) / 533325 (others); Windows 11 2025 Update reports **533509**. Observed 533509 here.
- **DirectX June 2010** — no registry flag. The redist is a Win32 cabinet self-extractor holding `DXSETUP.exe` plus `Jun2010_*_43` cabs (listed with 7-Zip, not run). Proof set choice:
  - The six listed DLLs come only from this redist (cabs `Jun2010_d3dx9_43`, `_d3dx10_43`, `_d3dx11_43`, `_D3DCompiler_43`, `_XAudio`, `Feb2010_X3DAudio`) and none is an OS component on Windows 10/11. All six were **observed** present here.
  - `xinput1_3.dll` is excluded: this machine's copy is `10.0.26200.1`, i.e. Windows ships its own, so it proves nothing.
  - Requiring all six (not any one) guards against a game having dropped a lone `d3dx9_43.dll`.
  - Tension: Learn's DirectX setup page says *not* to test file existence — "just run dxsetup"; it is idempotent and fast. So file presence is only our "should we nag" signal; Phase 2's DirectX install is always safe to run.
- **What FFXI/Ashita actually import** (string scan of every `.dll`/`.exe` in the Ashita folder and the FFXI install): `FFXiMain.dll` imports `d3d8`, `dinput8`, `dsound` (all OS components, DirectX 8). `Ashita.dll` imports `d3d8`, `dinput8`, `xinput1_3`. No June-2010-only DLL appears. Ashita's docs still list the redist as required (third-party addons/plugins may use D3DX), and the owner's decision is REQUIRED, so it stays required. Worth knowing before tuning banner wording.
- **Read errors** — `reg.exe` exits 1 for both "not found" and other failures. The adapter treats exit 1 as absent and everything else (timeout kill, spawn failure, other exit codes) as a failed read → `unknown`. Access-denied is not distinguishable from not-found without parsing the localized message; HKLM reads of these keys need no elevation, so accepted.

### .NET
- **In-place** (Learn deployment guide, 4.5.2 download page): "4.5.1 through 4.8 are in-place updates to 4.5"; "4.5.2 is a highly compatible, in-place update to 4, 4.5 and 4.5.1" → 4.0 and 4.5.2 are **covered** by 4.8, so no separate install. 4.8.1's in-place status is not stated in that guide (it stops at 4.8) — **UNVERIFIED**, but 4.8.1 reports through the same `v4\Full\Release` key.
- **"Old installers refuse when a newer 4.x is present"** — **UNVERIFIED**; installers were not run. What Learn does state: the 4.0 page lists Windows 7 and older, the 4.5.2 page Windows 8.1/Server 2012 R2 and older. Neither is a supported install target on Windows 10/11.
- **4.8 is built into Windows 10 1903+** and Windows 11 (Learn system requirements table). Confirmed.
- **4.8.1 OS gate — corrected from the planner's expectation.** Learn's table lists 4.8.1 as installable from **Windows 10 20H2 (build 19042)** up (20H2, 21H1, 21H2, 22H2) and built in from Windows 11 22H2. Not 21H2. Windows 10 2004 and older: 4.8 only. The `dotnet.microsoft.com` 4.8.1 page is client-rendered and gave no text to cross-check.
- Switches: Learn deployment guide documents `/q`, `/passive`, `/norestart`, `/showrmui`; return codes `0`, `1602` (user cancelled), `1603` (fatal), `1641`/`3010` (restart required, "indicates success"), `5100` (computer does not meet system requirements), "the same for all versions of the installer" (guide covers up to 4.8).

### Exit codes
Windows Installer error codes (Learn, `win32/msi/error-codes`): `1602` user cancelled, `1603` fatal, `1618` another install running, `1638` another version already installed ("can't continue"), `1641` restart initiated — success, `3010` restart required — success. `1638` for VC++ 2015 also matches Microsoft KB4092997. Satisfied = `0`, `1638` (VC++ only), `3010`, `1641`. The .NET installer's code for "newer already installed" is **UNVERIFIED**.

### Silent switches
- 2015-2022: `/install /quiet /norestart` (Learn, `redistributing-visual-cpp-files`; `/passive` also documented).
- 2010/2008/2005: `/q`, `/norestart` are documented for these package families in security bulletin MS11-025 (KB2538242 2005, KB2538243 2008, KB2565063 2010). Applied to the redist exes themselves: **UNVERIFIED**. The 2005 exe is a cabinet self-extractor running `msiexec /i vcredist.msi` (strings read from the binary), and the 2008 `install.exe` contains `/q`, `/qb`, `/qb!`. `/norestart` for 2005 UNVERIFIED.
- 2012/2013: `/install /quiet /norestart` — the Burn-bootstrapper convention Learn documents for v14; **UNVERIFIED** for these two builds. (The v1 installer uses `/quiet` alone.)
- DirectX: `dxsetup.exe /silent` is documented by Learn ("DirectX Installation for Game Developers"). Extraction: the redist's embedded usage text reads `/Q` quiet, `/T:<full path>` working folder, `/C` extract only when combined with `/T` — read from the exe's resources, **UNVERIFIED** on a Microsoft page. After a `/T /C` extraction, `DXSETUP.exe` is run from that folder.

### Authenticode
Every file reports `Valid`, signer `CN=Microsoft Corporation`, **timestamped**, but many signing certificates have since expired (notAfter 2011–2025) and issuers differ (`Microsoft Code Signing PCA` / `… PCA 2011`). Phase 2's check must be: `Status -eq 'Valid'` **and** signer subject `CN=Microsoft Corporation`. Not issuer, not certificate expiry.

### Unavailable
None. Every package has a working Microsoft-hosted URL. The `details.aspx` pages answer 403 to plain `curl`; they were read through a browser and Firecrawl.

## Verified vs UNVERIFIED (summary)

**Verified** (Learn/Ashita/direct observation): Ashita package list and version mapping; every final URL and size; 2015-2022 `/install /quiet /norestart` and the `Wow6432Node` key; .NET `Release` thresholds; 4.8.1 per-OS table; .NET return codes and the in-place statement for 4.0–4.8; MSI codes 1602/1603/1638/1641/3010; `dxsetup.exe /silent`; Authenticode on all 13 files; product codes of 2005/2008/2010 (from the packages' MSIs); this machine's state.

**UNVERIFIED** (marked the same way in `prereqs.js`): the 14.30 floor; 2012/2013 `Runtimes` keys and switches; `/q /norestart` on the 2005/2008/2010 exes; the two extra 2008 codes and the original 2005 SP1 code; DXSETUP exit codes; `/Q /T: /C` against a Microsoft page; 4.8.1 in-place claim; ".NET old installer refuses on newer"; the 4.8.1 exit code when already present.

## This machine (Windows 11 25H2, build 26200, 64-bit)

Read-only checks (`reg query`, file existence), matching the live IPC output: DirectX 6/6 DLLs present; VC++ 2015-2022 v14.51.36247 installed; .NET `Release` 533509 → 4.8.1 installed, 4.8/4.5.2/4.0 covered; VC++ 2013 v12.0.40664, 2012 v11.0.61030, 2010 10.0.40219 installed; 2005 installed (8.0.61001); **2008 absent** (no 9.0 entries anywhere — a real "missing" case). The "required missing" and "Installed=0" cases cannot be reproduced here; the unit tests cover them with fakes.

## Phase 2 — as built

The v1 installer is **replaced**, not joined: its `PREREQUISITES` array, SHA-256 pins, `sha256File`, `buildPrereqInnerScript` and `classifyPrereqResults` are gone from `main.js`. The package data now comes only from the `prereqs.js` catalogue.

### Files
- `electron/prereqInstall.js` — no `electron` import. Pure: `planInstall`, `buildInstallScript`, `buildElevationScript`, `buildSignatureScript`, `classifyExitCode`, `evaluateSignature`, `parseSubjectCN`, `isUacDeclined`. Plus `createPrereqInstaller(deps)`, an orchestrator whose every side effect is injected (unit-tested with fakes).
- `electron/main.js` — the glue only: real adapters (`downloadFile`, `checkDiskSpace`, `runPowerShellFile`, temp dir, log file). `runPowerShellFile` now rejects with `err.exitCode`.
- `electron/preload.js` — `installPrerequisites(ids?)`.
- `src/utils/prereqMessage.js` — `describePrereqInstall(result)`, the one-line summary the existing buttons show. Phase 3 can replace it.

### IPC
- **`install-prerequisites`** (name kept: the SetupWizard and Settings buttons already call it). `window.xiAPI.installPrerequisites(ids?)`. No ids = every `required` + `recommended` package that is missing. Ids may be any catalogue id; an unknown id returns `error` (nothing is downloaded).
- **Never rejects.** Returns:

```
{
  results: [{ id, name, state, exitCode, message }],  // one per package that was planned
  restartRecommended: boolean,   // any state === 'restart'
  cancelled: boolean,            // UAC prompt declined
  error: string | null,          // whole-run failure: unknown id, no disk space, already running, ...
  status: [...] | null           // FRESH evaluatePrereqs() output, always re-run at the end
}
```
- `state` is `installed` | `restart` | `failed` | `cancelled`. `exitCode` is `null` when the installer never ran (download or signature failure, cancel). Packages that were installed/covered/unsupported are not in `results` — read them from `status`.
- A second call while one is running returns `{ results: [], cancelled: false, restartRecommended: false, error: 'An installation is already running. Wait for it to finish.', status: null }`.
- **Progress event** `prerequisites-progress` (unchanged name), `(percent, detail)`; percent is 0–100 and throttled (≤ 4/s plus the phase boundaries): 0–60 downloads (equal slice per package), 60–65 signatures, 65–95 installs (live from the script's progress log), 95–100 re-detect, final `100` with detail `Done` or `Cancelled`.
- **Log**: `%APPDATA%\xi-launcher\logs\prereqs-install.log` (`app.getPath('userData')/logs`), appended, one ISO-timestamped line per event: `START` (requested ids, plan, OS build), `DOWNLOAD <id> <url>`, `SIGNATURE <id> status=… subject=… -> accepted|REJECTED`, `EXIT <id> code=… -> state`, `STATUS …`, `END`.

### Flow
1. `evaluate` → `planInstall` (skips installed / covered / unsupported; `unknown` is installed; order DirectX → VC++ 2005…2015-2022 → .NET). All .NET ids (4.0, 4.5.2, 4.8, 4.8.1) collapse into one install: **4.8.1 if build ≥ 19042, else 4.8** (unknown build → 4.8). 4.0 / 4.5.2 are never installed.
2. Disk check on the temp drive: Σ `sizeBytes` (DirectX counted twice for the extraction) + the shared 256 MB margin.
3. Download each package (`downloadFile`: redirects, stall timers, retry) into `mkdtemp(%TEMP%\xi-launcher-prereqs-)`. A failed download fails only that package.
4. **Authenticode, still non-elevated**, one PowerShell call for all files: `Status == Valid` **and** signer CN exactly `Microsoft Corporation`. A rejected file is never run and is not in the elevated script. If the check itself cannot run, nothing is run.
5. `install.ps1` (UTF-8 BOM) is run by a small wrapper: `Start-Process powershell -Verb RunAs -Wait` — **one UAC prompt**. Declined (Win32 1223, wrapper `exit 1223`) → `cancelled: true`, per-package `state: 'cancelled'`, no error text, retry allowed.
6. The elevated script runs every installer in order, never stops on a failure, and rewrites `results.json` (`[{id, exitCode, startedAt, endedAt, error}]`, UTF-8 no BOM) after each package. DirectX: `directx_Jun2010_redist.exe /Q /T:<dir> /C`, then `<dir>\DXSETUP.exe /silent`; `<dir>` is `%SystemRoot%\Temp\xi-launcher-dx-<id>` (**no spaces**, because the self-extractor's `/T:` handling of a quoted path with spaces is unverified) and is deleted by the script.
7. Exit codes are classified from the catalogue: `ok` → `installed` (0; 1638 only where the catalogue lists it, i.e. VC++), `reboot` (3010, 1641) → `restart`, everything else → `failed` with the code (1602, 1603, 1618 and 5100 have plain-language text). A script-level error (installer would not start) is appended to the message.
8. Re-run detection and return it as `status`. The temp folder is removed in a `finally`. Detection, not the exit code, is the source of truth.

### Verified in this phase
- 231/231 `npm run test:electron` (195 + 36 new). The generated script ran in PowerShell 5.1 against fake installers exiting 0 / 1603 / 3010, an installer file that does not exist, and a fake DirectX self-extractor, in a folder whose name has a space, an apostrophe and a curly quote. It carried on after each failure, wrote valid BOM-less JSON (also for a single result), ran DXSETUP with `/silent` and removed the extract dir. The signature script returned `Valid` / `CN=Microsoft…` for a signed binary and rejected an unsigned file.
- Live in the running launcher: `get-prereqs-status` → the real `planInstall` with all required + recommended ids gives exactly `[vc2008-x86]` on this machine; the IPC returns the `error` shape for an unknown id and an empty `results` + fresh `status` for already-covered ids; the log file is written; no temp folder is left behind.
- **NOT OBSERVED** (owner declined the live install): a real download, the real signature call on a Microsoft installer through the launcher, the UAC prompt (declined and accepted), a real installer exit code, the `prerequisites-progress` stream during a download, and the re-detect after a real install.

### What replaced the guesses in "Open questions"
- Overlap with v1: resolved (replaced).
- Elevation: one prompt; a declined prompt is `cancelled`, not an error.
- Reboots: 3010 / 1641 → `restartRecommended`, never forced.
- The old flow passed the elevated `.ps1` path to `Start-Process -ArgumentList` unquoted, which breaks for a temp path with a space (this machine's profile has one). The new wrapper quotes it.
- Redirect hosts are **not** restricted in `downloadFile`; the signature gate is the integrity check, and every URL comes from the catalogue.

### Known gaps / for Phase 3
- **TOCTOU**: the installers and `install.ps1` sit in the user's temp folder between the signature check (and the UAC click) and execution, so a same-user process could swap them. The owner decision was "verify before elevation"; re-verifying inside the elevated script is the cheap hardening if it is wanted.
- The 10 MB–265 MB download has no cancel. The 30-minute timeout on the elevated run kills only the wrapper, not an installer already running.
- `describePrereqInstall` is the minimal message; per-package rows, per-package install buttons and the Requirements page are Phase 3 and can read `results` + `status` directly.

## Phase 3 UI (guidance, not built)

- **Home banner only when a REQUIRED item is `missing`** (`summarize().requiredMissing`). Text names the item(s) and links to the Requirements page. `unknown` and `unsupported` never trigger it.
- **Requirements page** lists every catalogue item with status (`installed`, `covered`, `missing`, `unsupported`, `unknown`), detail text, an **Install** button per missing item and an **Install all missing** button. `superseded` items show as "covered by .NET 4.8" and have no button.
- **Never blocks Start Game.** The banner is dismissible; nothing gates launch.

## Open questions and risks for Phase 2

- ~~**Overlap with the shipped v1 installer**~~ — resolved in Phase 2 (replaced; the buttons call the new flow).
- **DirectPlay** — Ashita's requirements page also says Windows 8+ may need the DirectPlay optional feature enabled. Not in the owner's list and not detected here; enabling it needs a different mechanism (DISM). Worth a decision.
- **DirectX as REQUIRED** — see the import scan above. Ashita lists it as required, so it stays, but the banner should not claim the game will crash without it.
- **Elevation** — one UAC prompt; a declined prompt must be a calm, retryable state.
- **Reboots** — 3010/1641 are success; surface "restart recommended" without forcing one.
- **Antivirus / SmartScreen** — launcher-spawned elevated installers from `%TEMP%` can be flagged. The signature check helps diagnosis but not the block itself.
- **Disk / bandwidth** — 143.5 MB typical worst case, 264.8 MB with .NET 4.8 offline.
- **Versionless 2015-2022 URL** — fine under a signature gate; `sizeBytes` in the catalogue is informational only and will drift.
- **Locale** — installers are the ENU builds; the 2005/2008/2010 detection and the `reg.exe` exit-code approach are locale-independent, the `reg.exe` error text is not and is not used.
