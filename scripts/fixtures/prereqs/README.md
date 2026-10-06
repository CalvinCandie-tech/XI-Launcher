# Prerequisites fake-mode fixtures (dev only)

Used with `XI_PREREQS_FAKE=<path to one of these .json files>` when running the **unpackaged** launcher
(`npm start`). The variable is ignored in a packaged build. With it set, `get-prereqs-status` and
`install-prerequisites` return this data and replay the scripted progress instead of touching the
network, the registry or UAC. See `electron/prereqFake.js` and the spec's "Phase 3 — as built".

```powershell
$env:XI_PREREQS_FAKE = 'Z:\The Vault\xi-launcher\scripts\fixtures\prereqs\required-missing.json'
npm start
```

## Format

```json
{
  "status": { "default": "installed", "overrides": { "directx-jun2010": "missing", "vc2012-x86": ["unknown", "detail text"] } },
  "install": {
    "events": [ { "delayMs": 700, "percent": 15, "detail": "…", "info": { "phase": "download", "id": "directx-jun2010", "fraction": 0.5 } } ],
    "result": { "results": [], "restartRecommended": false, "cancelled": false, "error": null, "status": { "default": "installed" } }
  }
}
```

- `status` — a full array of status rows, or the short form above against the real catalogue (names,
  categories and sizes come from `electron/prereqs.js`; superseded packages default to `covered`).
  Unknown ids are an error.
- `install` is optional (`all-ok` has none). `events` are played in order; `delayMs` is waited before each.
  `info.phase` is one of `download | signature | elevation | install | recheck | done` (see `prereqInstall.js`).
- `result.status`, when present, becomes the fake status afterwards (so Re-check and the banner agree).

| File | Shows |
|---|---|
| `required-missing.json` | DirectX + VC++ 2015-2022 missing; slow install that succeeds (~15 s) |
| `all-ok.json` | everything installed / covered; no banner |
| `mixed.json` | one recommended missing, one could-not-check, .NET 4.8.1 unsupported, covered rows; no banner |
| `restart-recommended.json` | install succeeds, VC++ 2015-2022 exits 3010 |
| `cancelled.json` | admin prompt declined, nothing installed |
| `partial-failure.json` | VC++ 2015-2022 fails (1603) and stays missing; the other two install |
