# Ashita v4 addon & plugin scan — 2026-10-02

How: GitHub repo search (`ashita v4`, `ashitav4`, `ashita4`, `ashita addon`, `ffxi ashita`, topics
`ashita*`) plus code search for the Ashita v4 addon signature (`ashita.events.register` +
`addon.name`). 342 repos found → 274 active since 2024, not archived, not already in the launcher
catalogue. The top ~35 were checked for layout, latest release, release assets and licence.
**Nothing was installed or run** — layout/releases only.

Launcher's Ashita: **4.3.1.2** (plugin interface **4.30**). Addons (Lua) aren't tied to the
interface version; plugins (DLLs) are.

## Official Ashita release vs. catalogue

`AshitaXI/Ashita-v4beta` ships 83 addons + 8 plugins. **Every one is already in the launcher
catalogue** (only `libs`, `.vscode`, `sdk` are missing — not addons). Nothing to add here.

## Strong candidates — addons

| Addon | Repo | ★ | Latest | Licence | What it does |
|---|---|---|---|---|---|
| Points | Shinzaku/Points | 25 | 2.3.0 (source; folder `points`) | none | EXP / CP / JP / merit rate tracking |
| SimpleLog | Spike2D/SimpleLog | 20 | 1.1 zip | MIT | Combat & message log parser (Windower SimpleLog port) |
| metrics | RaraProjects/metrics | 20 | 2026-09-02 zip | none | Damage/healing parser (has Horizon-specific code) |
| hush | clanofartisans/ashita-hush | 13 | 1.5.2 zip | Unlicense | Hides yells, teleport requests, spam |
| Porter | ThornyFFXI/Porter | 5 | v1.15 zip | MIT | Porter-moogle storage automation |
| ScentHound | ThornyFFXI/ScentHound | 4 | 1.07 zip | none | Tracks monster spawns with on-screen indicators |
| zonename | onimitch/ffxi-zonename | 8 | 2.3 zip | MIT | Shows zone/region name banner when zoning |
| mountmaster | onimitch/ffxi-mountmaster | 0 | 1.1 zip | MIT | Mount/dismount with one command |
| PetMe | m4thmatic/PetMe | 9 | v2.2.0 zip | none | Pet info (level, duration) — same author as ninjaTool |
| Auctioneer | loonsies/Auctioneer | 7 | 2.31 (source) | none | Auction house UI — same author as chains/boussole |
| trustme | loonsies/trustme | 4 | 1.3 (source) | none | Search your trusts |
| Timers | lenonk/Timers | 9 | v1.0.2 zip | none | Recast/buff/debuff timers (overlaps tTimers) |
| weatherchecker | montijin/weatherchecker | 0 | v1.0 zip | MIT | Upcoming zone weather **for LSB-based servers** |
| upcast | dewiniaid/ffxi-ashita-upcast | 3 | v1.2 zip | MIT | Spell upcast helper |
| QuestList | stefanmielke/FFXIQuestList | 2 | no release (source) | MIT | Quest list / walkthrough window |
| ZoneLines | SQLCommit/ZoneLines | 6 | v1.3.1 zip | MIT | Visualises zone lines |
| GMTools | SQLCommit/GMTools | 4 | v1.0.5 zip | MIT | **LSB GM command helper** — relevant for FFXI-Crystal admins |
| MiscAshita4 (bundle) | ThornyFFXI/MiscAshita4 | 16 | no release (source) | MIT | NoMount, SpellSelect, cleanup, cudgel, fishaid, nocombat, partybuffs, sellit, trigger |
| xitools (bundle) | mousseng/xitools | 30 | v0.26 .7z | GPL-3.0 | Collection of addons + plugins |

## Strong candidates — plugins (need a 4.30 build)

| Plugin | Repo | ★ | Latest | 4.30 build? | What it does |
|---|---|---|---|---|---|
| Lootwhore | ThornyFFXI/Lootwhore | 9 | 1.18c | ✅ `Interface.4.30.zip` | Rule-based auto lot/pass |
| Stylist | ThornyFFXI/Stylist | 8 | 1.17b | ✅ | Appearance overrides (lockstyle-like) |
| Packer | ThornyFFXI/Packer | 4 | 1.15b | ✅ | Gear/inventory packing (pairs with LuAshitacast) |
| PacketFlow | ThornyFFXI/PacketFlow | 12 | binaries in repo folders | ✅ folder `Ashita 4 - 4.3x` | Packet-flow / responsiveness fix |
| SpectralFix | KraturLabs/SpectralFix | 3 | v1.03 | ✅ (4.16 + 4.30 zips) | Smooths the jagged aura glow on avatars/trusts/mounts |
| TrueFPS | SQLCommit/TrueFPS | 5 | v1.1 | ✅ | Normal game speed at custom frame rate |
| ChatHistoryPlus | SQLCommit/ChatHistoryPlus | 3 | v1.2 | ✅ | Raises chat history beyond 1000 lines |
| ChatLogFix / TrueFont | SQLCommit/* | 2–3 | — | ✅ (per description) | Fuller chat log / TrueType game text |
| Nameplate | Shirk/Nameplate | 14 | v0.5.1.0d | ❓ check | Fixes nameplate rendering defects |
| FrameFix | rockerudon/FrameFix | 3 | v1.2.0 (`FrameFix.dll`) | ❓ check | 60 FPS with corrected animation timing |
| Deeps | relliko/Deeps | 22 | v2.0 | ❓ — fork `davisdane2/Deeps-ashitav4beta` says "updated for SDK 4.30" | Damage meter |

## Notes on what's already in the catalogue

- **HitPoints** — catalogue uses `ThornyFFXI/HitPoints`, which is a fork of `tirem/HitPoints`
  (original has an MIT `2.1` release). Fork is the more recently pushed one; fine as is.
- **TreasurePool** — catalogue uses `ShiyoKozuki/TreasurePool` (Mar 2026). An independent
  `Zaldas/TreasurePool` (v2.7, Sep 2026) adds lot/pass buttons and drop timers — worth comparing.
- **XIPivot** (`HealsCodes/XIPivot`) is already covered by the launcher's XIPivot tab.

## Deliberately left out

- **Gear profiles / personal configs** — LuAshitacast profile repos, config dumps.
- **Server-specific** — HorizonXI / CatsEyeXI / PhoenixXI-only addons (goldilox, AVHelper,
  CraftGuard, Horizonguide, DynaSea, PhoenixFishTrack, …). `whereisdi` uses retail-only data.
- **Ashita v3 / Windower only** — Ashita-Yield, MountMuzzle, PartyBuffs fork, ProjectTako/ffxi-addons.
- **Launchers / managers, not addons** — ashita-manager, Ashita_v4_manager_beta, Ashita-Utility-Tool, addonmgr.
- **Automation / bots** (likely against server rules) — cureplease, autoassist, AutoRA, gambler,
  jobhelper, ArcaneAutomata, Pandabot, ashita_farmer, autopath.
- **Unvetted new repos** — many 0-star repos created Jul–Sep 2026 (e.g. TreeFidyDad/*, lluistfc/*,
  IXTLIA/*, EflfK/*, `llogical/AI-Made-Ashita-Addons`) — some look AI-generated; review individually
  before trusting.

## Outcome (added to the launcher, 2026-10-02)

Added **25 addons** and **8 plugins** (PacketFlow and ScentHound later removed at the user's request); every one was installed through the launcher's real
`install-addon` IPC into a throwaway Ashita folder and checked on disk (addon folder +
`<name>.lua`; plugin DLL directly in `plugins/`). Plugin DLLs were checked for the embedded
interface constant: all 9 new plugins are **4.30** builds.

- Addons: hush, mountmaster, cudgel, fishaid, nomount, nocombat, weatherchecker, questlist,
  simplelog, metrics, deeps (v2 is a Lua addon), timers, upcast, SpellSelect, Points, zonename,
  partybuffs, trigger, cleanup, zonelines, Auctioneer, Porter, sellit, PetMe, trustme.
- Plugins: Lootwhore, Stylist, Packer, SpectralFix, TrueFPS, ChatHistoryPlus,
  ChatLogFix, TrueFont.
- **Not added:** GMTools (user's call), xitools (HorizonXI-only installer, overwrites Ashita's
  `addons/libs/imgui.lua`), Nameplate (release notes: requires interface 416), FrameFix (DLL
  embeds interface 4.16).

Installer fixes made along the way:
- Plugins were copied to `plugins/<Name>/…`, which Ashita never loads. DLLs now go straight
  into `plugins/` (manifest-tracked); FindAll now uses the `ashitaRoot` layout.
- Release picking now also understands `Ashita-4.30`-style names (SpectralFix was getting the
  4.16 build).

Found during testing, not fixed: the existing **EquipViewer** entry (`ProjectTako/EquipViewer`)
ships a **4.16** DLL — it won't load on Ashita 4.3.x.
