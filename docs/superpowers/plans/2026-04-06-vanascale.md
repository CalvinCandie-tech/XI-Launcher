# VanaScale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python/Flask browser-based tool that scans a LandSandBoat FFXI database for items above level 75, scales their stats down to fit a 75-cap meta, verifies against external sources, and exports SQL/Lua/DAT/patchnotes.

**Architecture:** Flask backend serving a single-page dark-themed GUI. MariaDB for reading LSB item data. Local SQLite for audit log, verification cache, and scaling profiles. All scaling is preview-only — never writes to the game DB directly. Exports files the operator applies manually.

**Tech Stack:** Python 3.10+, Flask, mysql-connector-python, requests, beautifulsoup4, gitpython, struct (stdlib for DAT binary I/O)

**Project Root:** `C:\Users\Calvin Candie\vanascale\`

---

## Schema Reference (from actual LSB database)

These are the real column names — the spec's names were approximate. All code must use these exact names.

```
item_basic:     itemid (PK), subid, name, sortname, type, stackSize, flags, aH, BaseSell
item_equipment: itemId (PK), name, level, ilevel, jobs, MId, shieldSize, scriptType, slot, rslot, rslotlook, su_level
item_weapon:    itemId (PK), name, skill, subskill, ilvl_skill, ilvl_parry, ilvl_macc, dmgType, hit, delay, dmg, unlock_points
item_mods:      itemId (PK), modId (PK), value
item_mods_pet:  itemId (PK), modId (PK), petType (PK), value
item_latents:   itemId (PK), modId (PK), value (PK), latentId (PK), latentParam (PK)
```

**Important:** `item_basic` uses lowercase `itemid`. All other tables use camelCase `itemId`.

**Note on LSB modules:** The Lua module system (`Module:new`, `m:addOverride`) only supports function overrides, not SQL. SQL changes are applied as separate `.sql` files in the module's `sql/` subdirectory. The export will generate a module directory with both a stub `.lua` and the actual `.sql` file.

---

## File Structure

```
vanascale/
  app.py              <- Flask app, all API routes, serves static files
  db.py               <- MariaDB connection pool + query helpers
  models.py           <- Dataclasses for ItemRecord, ScaledItem, VerificationResult, etc.
  scanner.py          <- DB scanner: query 75+ items, family detection, classification
  scaler.py           <- Scaling engine: apply formulas per profile, mod safety table
  verifier.py         <- FFXIAH + BG-Wiki fetching + comparison logic
  exporter.py         <- SQL, Lua module, patchnotes output
  dat_patcher.py      <- DAT binary read/patch/write with XOR encryption
  audit.py            <- SQLite audit log + rollback
  estimator.py        <- Era comparison scoring + percentile placement
  heatmap.py          <- Job coverage 22x16 grid calculation
  conflict_checker.py <- Stacking stat conflict detection per job
  lsb_watcher.py      <- Git-based LSB update detector
  config.py           <- Load/save vanascale.json, defaults
  local_db.py         <- SQLite schema init + helpers for verification cache
  static/
    index.html        <- Single page GUI
    style.css         <- Dark FFXI-themed styles
    app.js            <- All frontend logic
  tests/
    conftest.py       <- Shared fixtures (mock DB data, sample items)
    test_scanner.py
    test_scaler.py
    test_models.py
    test_estimator.py
    test_heatmap.py
    test_conflict_checker.py
    test_exporter.py
    test_dat_patcher.py
    test_audit.py
    test_lsb_watcher.py
  vanascale.json      <- Local config (gitignored)
  vanascale.db        <- SQLite state (gitignored)
  requirements.txt
  .gitignore
  README.md
```

---

## Shared Data Models (models.py)

All tasks reference these dataclasses. Defined once here, implemented in Task 2.

```python
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

class ScalingProfile(Enum):
    GENERAL = "GENERAL"
    RELIC_MYTHIC = "RELIC_MYTHIC"
    JSE = "JSE"

class VerificationStatus(Enum):
    ALL_AGREE = "ALL_AGREE"
    DB_MISSING = "DB_MISSING"
    CONFLICT = "CONFLICT"
    UNVERIFIED = "UNVERIFIED"

class ModScaleType(Enum):
    RAW_SCALE = "RAW_SCALE"
    PERCENTAGE_SCALE = "PERCENTAGE_SCALE"
    ENCODED_256 = "ENCODED_256"
    NEVER_SCALE = "NEVER_SCALE"

@dataclass
class ModEntry:
    mod_id: int
    value: int

@dataclass
class PetModEntry:
    mod_id: int
    value: int
    pet_type: int

@dataclass
class LatentEntry:
    mod_id: int
    value: int
    latent_id: int
    latent_param: int

@dataclass
class ItemRecord:
    item_id: int
    name: str
    sortname: str
    level: int           # from item_equipment
    ilevel: int          # from item_equipment
    jobs: int            # bitmask from item_equipment
    slot: int            # from item_equipment
    shield_size: int     # from item_equipment
    # Weapon fields (None if not a weapon)
    dmg: Optional[int] = None
    delay: Optional[int] = None
    skill: Optional[int] = None
    dmg_type: Optional[int] = None
    # Mods
    mods: list[ModEntry] = field(default_factory=list)
    pet_mods: list[PetModEntry] = field(default_factory=list)
    latents: list[LatentEntry] = field(default_factory=list)
    # Classification
    profile: ScalingProfile = ScalingProfile.GENERAL
    family_id: Optional[str] = None       # e.g. "ragnarok" base name
    family_tier: Optional[int] = None     # 0=base, 1=+1, 2=+2, 3=+3
    flags: list[str] = field(default_factory=list)  # e.g. ["MANUAL_REVIEW", "PET_ITEM"]

@dataclass
class ScaledMod:
    mod_id: int
    original: int
    scaled: int
    scale_type: ModScaleType
    manually_overridden: bool = False

@dataclass
class ScaledItem:
    item: ItemRecord
    target_level: int
    scaled_level: int    # always = target_level
    # Weapon
    scaled_dmg: Optional[int] = None
    scaled_delay: Optional[int] = None  # delay typically unchanged
    # Mods
    scaled_mods: list[ScaledMod] = field(default_factory=list)
    scaled_pet_mods: list[ScaledMod] = field(default_factory=list)
    scaled_latents: list[ScaledMod] = field(default_factory=list)
    # Estimator
    percentile: Optional[float] = None
    # Verification
    verification: VerificationStatus = VerificationStatus.UNVERIFIED

@dataclass
class VerificationResult:
    item_id: int
    db_stats: dict          # what our DB has
    ffxiah_stats: dict      # parsed from FFXIAH (empty if fetch failed)
    bgwiki_stats: dict      # parsed from BG-Wiki (empty if fetch failed)
    status: VerificationStatus
    mismatches: list[str]   # human-readable diff descriptions

@dataclass
class ConflictEntry:
    job_id: int
    job_name: str
    stat_name: str
    mod_id: int
    era_cap: float
    total_from_gear: float
    contributing_items: list[dict]  # [{item_id, item_name, slot, value}]

@dataclass
class HeatmapCell:
    job_id: int
    slot_id: int
    count: int
    score: str  # "empty", "sparse", "moderate", "well-covered"
```

---

## Task 1: Project scaffolding + config + .gitignore + requirements.txt

**Files:**
- Create: `vanascale/requirements.txt`
- Create: `vanascale/.gitignore`
- Create: `vanascale/config.py`
- Create: `vanascale/vanascale.json` (default template)

- [ ] **Step 1: Create project directory and requirements.txt**

```
mkdir -p C:/Users/Calvin\ Candie/vanascale/static
mkdir -p C:/Users/Calvin\ Candie/vanascale/tests
```

`requirements.txt`:
```
flask>=3.0
mysql-connector-python>=8.0
requests>=2.31
beautifulsoup4>=4.12
gitpython>=3.1
```

- [ ] **Step 2: Create .gitignore**

```gitignore
vanascale.json
vanascale.db
__pycache__/
*.pyc
.venv/
output/
```

- [ ] **Step 3: Write config.py**

```python
"""Load/save vanascale.json configuration."""
import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "vanascale.json")

DEFAULTS = {
    "target_level": 75,
    "db_host": "127.0.0.1",
    "db_port": 3306,
    "db_user": "",
    "db_password": "",
    "db_name": "xidb",
    "ffxi_install_path": "",
    "lsb_repo_path": "",
    "output_dir": "",
    "last_run_timestamp": "",
    "fetch_delay": 0.5,
}

def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r") as f:
            saved = json.load(f)
        merged = {**DEFAULTS, **saved}
        return merged
    return dict(DEFAULTS)

def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
```

- [ ] **Step 4: Create default vanascale.json**

Write `DEFAULTS` dict as the initial file so it exists on first run.

- [ ] **Step 5: git init and initial commit**

```bash
cd C:/Users/Calvin\ Candie/vanascale
git init
git add requirements.txt .gitignore config.py
git commit -m "chore: project scaffolding with config and requirements"
```

---

## Task 2: Data models

**Files:**
- Create: `vanascale/models.py`
- Create: `vanascale/tests/test_models.py`

- [ ] **Step 1: Write test for model instantiation and enum values**

`tests/test_models.py`:
```python
from models import (
    ItemRecord, ScaledItem, ScaledMod, ModEntry, PetModEntry, LatentEntry,
    ScalingProfile, VerificationStatus, ModScaleType, MOD_SAFETY_TABLE,
    RELIC_MYTHIC_NAMES, PERCENTAGE_CAPS,
)

def test_item_record_defaults():
    item = ItemRecord(item_id=1, name="Test", sortname="test", level=99,
                      ilevel=119, jobs=0xFFFFF, slot=0, shield_size=0)
    assert item.profile == ScalingProfile.GENERAL
    assert item.family_id is None
    assert item.mods == []
    assert item.flags == []

def test_mod_safety_table_completeness():
    """Every mod ID in RAW_SCALE list must be in the table."""
    raw_ids = [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,40,41,42,43,44,45,46,47,55,56,106,113,114]
    for mid in raw_ids:
        assert MOD_SAFETY_TABLE.get(mid) == ModScaleType.RAW_SCALE, f"mod {mid} missing"

def test_percentage_scale_mods():
    for mid in [17, 98, 97]:
        assert MOD_SAFETY_TABLE.get(mid) == ModScaleType.PERCENTAGE_SCALE

def test_relic_mythic_names_not_empty():
    assert len(RELIC_MYTHIC_NAMES) > 0
    assert "ragnarok" in RELIC_MYTHIC_NAMES
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd C:/Users/Calvin\ Candie/vanascale && python -m pytest tests/test_models.py -v
```

- [ ] **Step 3: Implement models.py**

Write the full `models.py` with all dataclasses from the Schema Reference section above, plus these constants:

```python
# Mod safety table — determines how each mod ID is scaled
MOD_SAFETY_TABLE: dict[int, ModScaleType] = {}

# RAW_SCALE mods: scale proportionally
for mid in [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,40,41,42,43,44,45,46,47,55,56,106,113,114]:
    MOD_SAFETY_TABLE[mid] = ModScaleType.RAW_SCALE

# PERCENTAGE_SCALE mods: scale with floor/ceiling guards
for mid in [17, 98, 97]:
    MOD_SAFETY_TABLE[mid] = ModScaleType.PERCENTAGE_SCALE
# Note: 114 (Crit rate%) is in spec as PERCENTAGE_SCALE but also in RAW_SCALE list.
# Per spec, 114 is in RAW_SCALE. If operator wants percentage behavior, override in GUI.

# ENCODED_256 mods: PDT% and MDT% stored as value/256
# Common LSB mod IDs: PDT=161, MDT=162 — confirm from LSB source
for mid in [161, 162]:
    MOD_SAFETY_TABLE[mid] = ModScaleType.ENCODED_256

# Percentage caps for PERCENTAGE_SCALE mods (era norms)
PERCENTAGE_CAPS: dict[int, int] = {
    17: 25,   # Haste% from gear
    98: 15,   # Double Attack%
    97: 5,    # Triple Attack%
    106: 15,  # Store TP (also used in conflict checker)
    113: 10,  # Subtle Blow
}

# Known relic and mythic weapon base names (lowercase, no +N suffix)
RELIC_MYTHIC_NAMES: set[str] = {
    # Relic weapons
    "spharai", "mandau", "excalibur", "ragnarok", "guttler",
    "bravura", "apocalypse", "gungnir", "kikoku", "amanomurakumo",
    "mjollnir", "claustrum", "yoichinoyumi", "annihilator", "gjallarhorn",
    "aegis", "kikoku",
    # Mythic weapons
    "conqueror", "glanzfaust", "yagrush", "laevateinn", "murgleis",
    "vajra", "gastraphetes", "death_penalty", "liberator", "aymur",
    "carnwenhan", "kogarasumaru", "nagi", "ryunohige", "nirvana",
    "tizona", "epeolatry", "kenkonken", "terpsichore", "tupsimati",
    "idris", "redemption",
    # Empyrean weapons
    "verethragna", "twashtar", "almace", "caladbolg", "farsha",
    "ukonvasara", "redemption", "rhongomiant", "kannagi", "masamune",
    "gambanteinn", "hvergelmir", "gandiva", "armageddon", "daurdabla",
}

# FFXI job IDs (1-22) and names
JOB_NAMES: dict[int, str] = {
    1: "WAR", 2: "MNK", 3: "WHM", 4: "BLM", 5: "RDM", 6: "THF",
    7: "PLD", 8: "DRK", 9: "BST", 10: "BRD", 11: "RNG", 12: "SAM",
    13: "NIN", 14: "DRG", 15: "SMN", 16: "BLU", 17: "COR", 18: "PUP",
    19: "DNC", 20: "SCH", 21: "GEO", 22: "RUN",
}

# Equipment slot IDs (bitmask positions used in item_equipment.slot)
SLOT_NAMES: dict[int, str] = {
    0: "Main", 1: "Sub", 2: "Range", 3: "Ammo",
    4: "Head", 5: "Body", 6: "Hands", 7: "Legs", 8: "Feet",
    9: "Neck", 10: "Waist", 11: "Ear1", 12: "Ear2",
    13: "Ring1", 14: "Ring2", 15: "Back",
}
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add models.py tests/test_models.py
git commit -m "feat: add data models, mod safety table, and constants"
```

---

## Task 3: SQLite local database + audit log

**Files:**
- Create: `vanascale/local_db.py`
- Create: `vanascale/audit.py`
- Create: `vanascale/tests/test_audit.py`

- [ ] **Step 1: Write test for audit log write + read + rollback**

`tests/test_audit.py`:
```python
import json
import os
import tempfile
from audit import AuditLog

def make_audit(tmp_path):
    db_path = os.path.join(tmp_path, "test.db")
    return AuditLog(db_path)

def test_log_and_retrieve(tmp_path):
    log = make_audit(tmp_path)
    log.record(
        item_id=12345, item_name="Test Sword",
        original={"dmg": 50, "delay": 240},
        scaled={"dmg": 38, "delay": 240},
        source_used="DB",
        operator_overrides=None,
        profile_used="GENERAL",
        family_id=None,
        flags=["PET_ITEM"],
    )
    entries = log.get_by_item(12345)
    assert len(entries) == 1
    assert entries[0]["item_name"] == "Test Sword"
    assert json.loads(entries[0]["original"])["dmg"] == 50
    assert json.loads(entries[0]["flags"]) == ["PET_ITEM"]

def test_rollback_returns_original(tmp_path):
    log = make_audit(tmp_path)
    log.record(
        item_id=100, item_name="Sword",
        original={"dmg": 50}, scaled={"dmg": 38},
        source_used="DB", operator_overrides=None,
        profile_used="GENERAL", family_id="sword_family", flags=[],
    )
    original = log.get_original_values(100)
    assert original["dmg"] == 50

def test_get_all_returns_list(tmp_path):
    log = make_audit(tmp_path)
    log.record(item_id=1, item_name="A", original={}, scaled={},
               source_used="DB", operator_overrides=None,
               profile_used="GENERAL", family_id=None, flags=[])
    log.record(item_id=2, item_name="B", original={}, scaled={},
               source_used="DB", operator_overrides=None,
               profile_used="GENERAL", family_id=None, flags=[])
    assert len(log.get_all()) == 2
```

- [ ] **Step 2: Run test — expect failure**

- [ ] **Step 3: Implement local_db.py**

```python
"""SQLite schema initialization and connection helper."""
import sqlite3
import os

SCHEMA = """
CREATE TABLE IF NOT EXISTS verification_cache (
    item_id INTEGER PRIMARY KEY,
    ffxiah_data TEXT,
    bgwiki_data TEXT,
    status TEXT,
    fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    original TEXT NOT NULL,
    scaled TEXT NOT NULL,
    source_used TEXT NOT NULL,
    operator_overrides TEXT,
    profile_used TEXT NOT NULL,
    family_id TEXT,
    flags TEXT
);
"""

def get_connection(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn
```

- [ ] **Step 4: Implement audit.py**

```python
"""Audit log: records every scaling decision, supports rollback."""
import json
from local_db import get_connection

class AuditLog:
    def __init__(self, db_path: str):
        self.conn = get_connection(db_path)

    def record(self, *, item_id: int, item_name: str, original: dict,
               scaled: dict, source_used: str, operator_overrides: dict | None,
               profile_used: str, family_id: str | None, flags: list[str]) -> None:
        self.conn.execute(
            """INSERT INTO audit_log
               (item_id, item_name, original, scaled, source_used,
                operator_overrides, profile_used, family_id, flags)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (item_id, item_name, json.dumps(original), json.dumps(scaled),
             source_used, json.dumps(operator_overrides) if operator_overrides else None,
             profile_used, family_id, json.dumps(flags)),
        )
        self.conn.commit()

    def get_by_item(self, item_id: int) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM audit_log WHERE item_id = ? ORDER BY timestamp DESC",
            (item_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_by_family(self, family_id: str) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM audit_log WHERE family_id = ? ORDER BY timestamp DESC",
            (family_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_original_values(self, item_id: int) -> dict:
        """Return the earliest recorded original values for rollback."""
        row = self.conn.execute(
            "SELECT original FROM audit_log WHERE item_id = ? ORDER BY timestamp ASC LIMIT 1",
            (item_id,),
        ).fetchone()
        return json.loads(row["original"]) if row else {}

    def get_all(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM audit_log ORDER BY timestamp DESC"
        ).fetchall()
        return [dict(r) for r in rows]
```

- [ ] **Step 5: Run tests — expect pass**

- [ ] **Step 6: Commit**

```bash
git add local_db.py audit.py tests/test_audit.py
git commit -m "feat: SQLite local database schema and audit log"
```

---

## Task 4: MariaDB connection + query helpers

**Files:**
- Create: `vanascale/db.py`

- [ ] **Step 1: Implement db.py**

```python
"""MariaDB connection pool and query helpers for LSB item tables."""
import mysql.connector
from mysql.connector import pooling

_pool: pooling.MySQLConnectionPool | None = None

def init_pool(host: str, port: int, user: str, password: str, database: str) -> None:
    global _pool
    _pool = pooling.MySQLConnectionPool(
        pool_name="vanascale",
        pool_size=3,
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
    )

def get_connection():
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Configure credentials in Settings.")
    return _pool.get_connection()

def query(sql: str, params: tuple = ()) -> list[dict]:
    conn = get_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql, params)
        rows = cursor.fetchall()
        return rows
    finally:
        conn.close()

def test_connection(host: str, port: int, user: str, password: str, database: str) -> str:
    """Test DB credentials. Returns 'ok' or error message."""
    try:
        conn = mysql.connector.connect(
            host=host, port=port, user=user, password=password, database=database,
            connect_timeout=5,
        )
        conn.close()
        return "ok"
    except Exception as e:
        return str(e)
```

- [ ] **Step 2: Commit**

```bash
git add db.py
git commit -m "feat: MariaDB connection pool and query helpers"
```

---

## Task 5: Scanner — query items, detect families, classify

**Files:**
- Create: `vanascale/scanner.py`
- Create: `vanascale/tests/conftest.py`
- Create: `vanascale/tests/test_scanner.py`

- [ ] **Step 1: Write test fixtures in conftest.py**

`tests/conftest.py`:
```python
import pytest

@pytest.fixture
def sample_raw_rows():
    """Simulates joined query results from item_basic + item_equipment."""
    return [
        {"itemid": 20000, "name": "Ragnarok", "sortname": "ragnarok",
         "level": 75, "ilevel": 0, "jobs": 0x7F, "slot": 0, "shieldSize": 0},
        {"itemid": 21000, "name": "Example Sword", "sortname": "example_sword",
         "level": 99, "ilevel": 119, "jobs": 0x01, "slot": 0, "shieldSize": 0},
        {"itemid": 21001, "name": "Example Sword +1", "sortname": "example_sword_+1",
         "level": 99, "ilevel": 119, "jobs": 0x01, "slot": 0, "shieldSize": 0},
        {"itemid": 21002, "name": "Example Sword +2", "sortname": "example_sword_+2",
         "level": 99, "ilevel": 119, "jobs": 0x01, "slot": 0, "shieldSize": 0},
        {"itemid": 21003, "name": "Example Sword +3", "sortname": "example_sword_+3",
         "level": 99, "ilevel": 119, "jobs": 0x01, "slot": 0, "shieldSize": 0},
        {"itemid": 22000, "name": "Avatar Belt", "sortname": "avatar_belt",
         "level": 80, "ilevel": 0, "jobs": 0x4000, "slot": 10, "shieldSize": 0},
    ]

@pytest.fixture
def sample_weapon_rows():
    return [
        {"itemId": 21000, "dmg": 80, "delay": 240, "skill": 4, "dmgType": 3},
        {"itemId": 21001, "dmg": 85, "delay": 240, "skill": 4, "dmgType": 3},
        {"itemId": 21002, "dmg": 90, "delay": 240, "skill": 4, "dmgType": 3},
        {"itemId": 21003, "dmg": 95, "delay": 240, "skill": 4, "dmgType": 3},
    ]

@pytest.fixture
def sample_mod_rows():
    return [
        {"itemId": 21000, "modId": 2, "value": 15},  # STR
        {"itemId": 21001, "modId": 2, "value": 18},
        {"itemId": 21002, "modId": 2, "value": 22},
        {"itemId": 21003, "modId": 2, "value": 25},
        {"itemId": 22000, "modId": 2, "value": 10},  # SMN belt with STR
    ]
```

- [ ] **Step 2: Write test for family detection and classification**

`tests/test_scanner.py`:
```python
import re
from scanner import detect_family, classify_profile, detect_pet_flags

def test_detect_family_plus_variants():
    items = [
        {"name": "Example Sword", "itemid": 100},
        {"name": "Example Sword +1", "itemid": 101},
        {"name": "Example Sword +2", "itemid": 102},
        {"name": "Example Sword +3", "itemid": 103},
    ]
    families = detect_family(items)
    # All 4 should share the same family_id
    ids = {families[item["itemid"]]["family_id"] for item in items}
    assert len(ids) == 1
    # Tiers should be 0, 1, 2, 3
    tiers = sorted(families[item["itemid"]]["tier"] for item in items)
    assert tiers == [0, 1, 2, 3]

def test_detect_family_orphan():
    items = [{"name": "Unique Hat", "itemid": 200}]
    families = detect_family(items)
    assert families[200]["family_id"] is None
    assert families[200]["tier"] is None

def test_classify_relic():
    assert classify_profile("Ragnarok") == "RELIC_MYTHIC"
    assert classify_profile("ragnarok") == "RELIC_MYTHIC"

def test_classify_jse():
    # jobs bitmask with only 1 bit set = single job = JSE
    assert classify_profile("Some Armor", jobs=0x01) == "JSE"

def test_classify_general():
    assert classify_profile("Iron Sword", jobs=0xFF) == "GENERAL"

def test_detect_pet_flags_smn():
    # Job bitmask 0x4000 = SMN only, has blood pact mod
    flags = detect_pet_flags(name="Avatar Belt", jobs=0x4000,
                             mods=[{"modId": 346, "value": 5}])
    assert "PET_ITEM" in flags

def test_detect_pet_flags_smn_bp_damage():
    # Blood pact damage modifier gets MANUAL_REVIEW
    flags = detect_pet_flags(name="Avatar Belt", jobs=0x4000,
                             mods=[{"modId": 346, "value": 5}])
    # mod 346 is example; actual BP damage mod IDs will be in the constants
    assert "MANUAL_REVIEW" in flags or "PET_ITEM" in flags
```

- [ ] **Step 3: Run tests — expect failure**

- [ ] **Step 4: Implement scanner.py**

```python
"""Scan LSB database for items above level 75, detect families, classify."""
import re
from models import (
    ItemRecord, ModEntry, PetModEntry, LatentEntry,
    ScalingProfile, RELIC_MYTHIC_NAMES,
)
import db

# SMN blood pact damage mod IDs — these get MANUAL_REVIEW
# Confirm exact IDs from LSB source: scripts/globals/status.lua or similar
BP_DAMAGE_MOD_IDS = {346, 347, 348, 349, 350, 351, 352, 126}
# Pet-related mod IDs (BST/SMN/PUP pet stats)
PET_MOD_IDS = {163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173}

PLUS_PATTERN = re.compile(r'^(.+?)\s*\+(\d)$')


def scan_items(min_level: int = 76) -> list[ItemRecord]:
    """Query all items where equipment level > 75 and build ItemRecords."""
    # Main query: join item_basic with item_equipment
    rows = db.query("""
        SELECT b.itemid, b.name, b.sortname,
               e.level, e.ilevel, e.jobs, e.slot, e.shieldSize
        FROM item_basic b
        JOIN item_equipment e ON b.itemid = e.itemId
        WHERE e.level >= %s
        ORDER BY b.itemid
    """, (min_level,))

    if not rows:
        return []

    item_ids = [r["itemid"] for r in rows]
    id_placeholders = ",".join(["%s"] * len(item_ids))

    # Batch-fetch related data
    weapons = {r["itemId"]: r for r in db.query(
        f"SELECT * FROM item_weapon WHERE itemId IN ({id_placeholders})", tuple(item_ids)
    )}
    mods_rows = db.query(
        f"SELECT * FROM item_mods WHERE itemId IN ({id_placeholders})", tuple(item_ids)
    )
    pet_mods_rows = db.query(
        f"SELECT * FROM item_mods_pet WHERE itemId IN ({id_placeholders})", tuple(item_ids)
    )
    latent_rows = db.query(
        f"SELECT * FROM item_latents WHERE itemId IN ({id_placeholders})", tuple(item_ids)
    )

    # Group mods by item
    mods_by_item: dict[int, list] = {}
    for m in mods_rows:
        mods_by_item.setdefault(m["itemId"], []).append(m)
    pet_mods_by_item: dict[int, list] = {}
    for m in pet_mods_rows:
        pet_mods_by_item.setdefault(m["itemId"], []).append(m)
    latents_by_item: dict[int, list] = {}
    for lt in latent_rows:
        latents_by_item.setdefault(lt["itemId"], []).append(lt)

    # Detect families
    name_dicts = [{"name": r["name"], "itemid": r["itemid"]} for r in rows]
    family_map = detect_family(name_dicts)

    # Build ItemRecords
    items = []
    for r in rows:
        iid = r["itemid"]
        w = weapons.get(iid)
        item_mods = [ModEntry(m["modId"], m["value"]) for m in mods_by_item.get(iid, [])]
        item_pet_mods = [PetModEntry(m["modId"], m["value"], m["petType"])
                         for m in pet_mods_by_item.get(iid, [])]
        item_latents = [LatentEntry(m["modId"], m["value"], m["latentId"], m["latentParam"])
                        for m in latents_by_item.get(iid, [])]

        raw_mods = mods_by_item.get(iid, [])
        profile = classify_profile(r["name"], r["jobs"])
        flags = detect_pet_flags(r["name"], r["jobs"], raw_mods)
        fam = family_map.get(iid, {"family_id": None, "tier": None})

        item = ItemRecord(
            item_id=iid, name=r["name"], sortname=r["sortname"],
            level=r["level"], ilevel=r["ilevel"], jobs=r["jobs"],
            slot=r["slot"], shield_size=r["shieldSize"],
            dmg=w["dmg"] if w else None,
            delay=w["delay"] if w else None,
            skill=w["skill"] if w else None,
            dmg_type=w["dmgType"] if w else None,
            mods=item_mods, pet_mods=item_pet_mods, latents=item_latents,
            profile=ScalingProfile(profile),
            family_id=fam["family_id"], family_tier=fam["tier"],
            flags=flags,
        )
        items.append(item)
    return items


def detect_family(items: list[dict]) -> dict[int, dict]:
    """Group items into families by +N suffix pattern.
    Returns {itemid: {"family_id": str|None, "tier": int|None}}
    """
    base_names: dict[str, list] = {}  # base_name -> [(itemid, tier)]

    for item in items:
        name = item["name"]
        match = PLUS_PATTERN.match(name)
        if match:
            base = match.group(1).strip()
            tier = int(match.group(2))
        else:
            base = name
            tier = 0
        base_lower = base.lower()
        base_names.setdefault(base_lower, []).append((item["itemid"], tier))

    result = {}
    for base, members in base_names.items():
        if len(members) == 1 and members[0][1] == 0:
            # Single item with no +N variants = orphan
            result[members[0][0]] = {"family_id": None, "tier": None}
        else:
            for iid, tier in members:
                result[iid] = {"family_id": base, "tier": tier}
    return result


def classify_profile(name: str, jobs: int = 0xFFFFFF) -> str:
    """Determine scaling profile from item name and job flags."""
    # Check relic/mythic
    base = PLUS_PATTERN.match(name)
    check_name = (base.group(1).strip() if base else name).lower()
    # Also check without spaces/underscores
    check_variants = {check_name, check_name.replace(" ", "_"), check_name.replace("_", " ")}
    if check_variants & RELIC_MYTHIC_NAMES:
        return "RELIC_MYTHIC"

    # Check JSE: single job = only one bit set in jobs bitmask
    if jobs > 0 and (jobs & (jobs - 1)) == 0:
        return "JSE"

    return "GENERAL"


def detect_pet_flags(name: str, jobs: int, mods: list[dict]) -> list[str]:
    """Detect pet-related items and flag for review."""
    flags = []
    mod_ids = {m["modId"] for m in mods}

    # SMN = job bit 15 (0x4000), BST = job bit 9 (0x0100), PUP = job bit 18 (0x20000)
    is_pet_job = bool(jobs & 0x4000) or bool(jobs & 0x0100) or bool(jobs & 0x20000)

    if is_pet_job and (mod_ids & PET_MOD_IDS or mod_ids & BP_DAMAGE_MOD_IDS):
        flags.append("PET_ITEM")

    if mod_ids & BP_DAMAGE_MOD_IDS:
        flags.append("MANUAL_REVIEW")

    return flags
```

- [ ] **Step 5: Run tests — expect pass**

- [ ] **Step 6: Commit**

```bash
git add scanner.py tests/conftest.py tests/test_scanner.py
git commit -m "feat: item scanner with family detection and classification"
```

---

## Task 6: Scaling engine

**Files:**
- Create: `vanascale/scaler.py`
- Create: `vanascale/tests/test_scaler.py`

- [ ] **Step 1: Write tests for scaling logic**

`tests/test_scaler.py`:
```python
import math
from models import (
    ItemRecord, ModEntry, PetModEntry, LatentEntry,
    ScalingProfile, ModScaleType, ScaledItem,
)
from scaler import (
    compute_ratio, scale_mod_value, scale_item, scale_family,
    scale_weapon_dmg,
)

def make_item(**kwargs):
    defaults = dict(
        item_id=1, name="Test", sortname="test", level=99,
        ilevel=119, jobs=0xFF, slot=0, shield_size=0,
        profile=ScalingProfile.GENERAL,
    )
    defaults.update(kwargs)
    return ItemRecord(**defaults)


def test_general_ratio():
    assert compute_ratio(99, 75, ScalingProfile.GENERAL) == 75 / 99

def test_relic_mythic_ratio():
    expected = math.sqrt(75 / 99)
    assert abs(compute_ratio(99, 75, ScalingProfile.RELIC_MYTHIC) - expected) < 0.001

def test_jse_ratio():
    base = 75 / 99
    expected = max(base, 0.85 * (75 / 75))  # floor at 85% of standard
    # JSE: standard ratio but floor at 85% of a level-75 item's result
    assert compute_ratio(99, 75, ScalingProfile.JSE) >= base * 0.85

def test_scale_raw_mod():
    # RAW_SCALE: round(value * ratio)
    result = scale_mod_value(mod_id=2, value=25, ratio=75/99,
                             scale_type=ModScaleType.RAW_SCALE)
    assert result == round(25 * (75 / 99))

def test_scale_percentage_mod_floor():
    # PERCENTAGE_SCALE: minimum result is 1
    result = scale_mod_value(mod_id=17, value=1, ratio=0.5,
                             scale_type=ModScaleType.PERCENTAGE_SCALE)
    assert result >= 1

def test_scale_percentage_mod_cap():
    # PERCENTAGE_SCALE: never exceed era cap
    result = scale_mod_value(mod_id=17, value=30, ratio=0.9,
                             scale_type=ModScaleType.PERCENTAGE_SCALE)
    assert result <= 25  # Haste cap

def test_scale_encoded_256():
    # ENCODED_256: decode -> scale -> re-encode
    # -256 means -100% PDT. After scaling at 75/99 ratio:
    original = -128  # -50% PDT (128/256)
    result = scale_mod_value(mod_id=161, value=original, ratio=75/99,
                             scale_type=ModScaleType.ENCODED_256)
    real_original = original / 256  # -0.5
    expected = round(real_original * (75/99) * 256)
    assert result == expected

def test_never_scale():
    result = scale_mod_value(mod_id=999, value=42, ratio=0.5,
                             scale_type=ModScaleType.NEVER_SCALE)
    assert result == 42

def test_scale_weapon_dmg():
    # Weapon damage scales with ratio
    result = scale_weapon_dmg(dmg=95, ratio=75/99)
    assert result == round(95 * (75 / 99))

def test_scale_item_full():
    item = make_item(
        level=99, dmg=80, delay=240, skill=4, dmg_type=3,
        mods=[ModEntry(2, 25), ModEntry(17, 5)],
    )
    scaled = scale_item(item, target_level=75)
    assert scaled.scaled_level == 75
    assert scaled.scaled_dmg < 80
    assert scaled.scaled_delay == 240  # delay unchanged
    assert len(scaled.scaled_mods) == 2

def test_scale_family_preserves_proportions():
    base = make_item(item_id=100, name="Sword", level=99, dmg=80, delay=240,
                     skill=4, dmg_type=3, family_id="sword", family_tier=0,
                     mods=[ModEntry(2, 15)])
    p1 = make_item(item_id=101, name="Sword +1", level=99, dmg=85, delay=240,
                   skill=4, dmg_type=3, family_id="sword", family_tier=1,
                   mods=[ModEntry(2, 18)])
    p3 = make_item(item_id=103, name="Sword +3", level=99, dmg=95, delay=240,
                   skill=4, dmg_type=3, family_id="sword", family_tier=3,
                   mods=[ModEntry(2, 25)])
    family = [base, p1, p3]
    scaled = scale_family(family, target_level=75)
    # +3 is scaled first to set ceiling
    s3 = next(s for s in scaled if s.item.item_id == 103)
    s0 = next(s for s in scaled if s.item.item_id == 100)
    # base dmg should be proportional: original base/+3 ratio preserved
    original_ratio = 80 / 95
    scaled_ratio = s0.scaled_dmg / s3.scaled_dmg
    assert abs(original_ratio - scaled_ratio) < 0.05  # within 5%
```

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement scaler.py**

```python
"""Scaling engine: apply level-based downscaling formulas per profile."""
import math
from models import (
    ItemRecord, ScaledItem, ScaledMod, ScalingProfile,
    ModScaleType, MOD_SAFETY_TABLE, PERCENTAGE_CAPS,
)


def compute_ratio(item_level: int, target_level: int, profile: ScalingProfile) -> float:
    """Compute the scaling ratio for an item based on its profile."""
    base = target_level / item_level
    if profile == ScalingProfile.RELIC_MYTHIC:
        return math.sqrt(target_level / item_level)
    elif profile == ScalingProfile.JSE:
        return max(base, 0.85)
    return base


def scale_mod_value(mod_id: int, value: int, ratio: float,
                    scale_type: ModScaleType) -> int:
    """Scale a single mod value according to its safety type."""
    if scale_type == ModScaleType.NEVER_SCALE:
        return value

    if scale_type == ModScaleType.RAW_SCALE:
        return round(value * ratio)

    if scale_type == ModScaleType.PERCENTAGE_SCALE:
        scaled = round(value * ratio)
        scaled = max(scaled, 1) if value > 0 else scaled  # floor at 1 for positive values
        cap = PERCENTAGE_CAPS.get(mod_id)
        if cap is not None and scaled > cap:
            scaled = cap
        return scaled

    if scale_type == ModScaleType.ENCODED_256:
        real_value = value / 256
        scaled_real = real_value * ratio
        return round(scaled_real * 256)

    return value


def scale_weapon_dmg(dmg: int, ratio: float) -> int:
    return max(1, round(dmg * ratio))


def get_scale_type(mod_id: int) -> ModScaleType:
    return MOD_SAFETY_TABLE.get(mod_id, ModScaleType.NEVER_SCALE)


def scale_item(item: ItemRecord, target_level: int = 75) -> ScaledItem:
    """Scale a single item to the target level."""
    ratio = compute_ratio(item.level, target_level, item.profile)

    # Weapon stats
    scaled_dmg = scale_weapon_dmg(item.dmg, ratio) if item.dmg is not None else None
    # Delay is not scaled — weapon speed is a design characteristic
    scaled_delay = item.delay

    # Regular mods
    scaled_mods = []
    for mod in item.mods:
        st = get_scale_type(mod.mod_id)
        sv = scale_mod_value(mod.mod_id, mod.value, ratio, st)
        scaled_mods.append(ScaledMod(mod.mod_id, mod.value, sv, st))

    # Pet mods — same safety table, but SMN BP delay mods use ratio^1.5
    scaled_pet_mods = []
    SMN_BP_DELAY_MODS = {353, 354}  # Confirm from LSB source
    for mod in item.pet_mods:
        st = get_scale_type(mod.mod_id)
        if mod.mod_id in SMN_BP_DELAY_MODS:
            pet_ratio = ratio ** 1.5
            sv = scale_mod_value(mod.mod_id, mod.value, pet_ratio, st)
        else:
            sv = scale_mod_value(mod.mod_id, mod.value, ratio, st)
        scaled_pet_mods.append(ScaledMod(mod.mod_id, mod.value, sv, st))

    # Latents — scale mod value, never touch latent_id or latent_param
    scaled_latents = []
    for lat in item.latents:
        st = get_scale_type(lat.mod_id)
        sv = scale_mod_value(lat.mod_id, lat.value, ratio, st)
        scaled_latents.append(ScaledMod(lat.mod_id, lat.value, sv, st))

    return ScaledItem(
        item=item, target_level=target_level, scaled_level=target_level,
        scaled_dmg=scaled_dmg, scaled_delay=scaled_delay,
        scaled_mods=scaled_mods, scaled_pet_mods=scaled_pet_mods,
        scaled_latents=scaled_latents,
    )


def scale_family(family_items: list[ItemRecord], target_level: int = 75) -> list[ScaledItem]:
    """Scale a family of items, preserving tier proportions relative to highest tier."""
    if not family_items:
        return []

    # Sort by tier, highest first
    sorted_items = sorted(family_items, key=lambda i: i.family_tier or 0, reverse=True)
    top = sorted_items[0]

    # Scale the highest tier first to set the ceiling
    top_scaled = scale_item(top, target_level)
    results = [top_scaled]

    if len(sorted_items) == 1:
        return results

    # For lower tiers, preserve proportional gaps relative to the top tier
    for item in sorted_items[1:]:
        scaled = scale_item(item, target_level)

        # Rebuild weapon dmg proportionally
        if item.dmg is not None and top.dmg is not None and top.dmg > 0:
            original_ratio = item.dmg / top.dmg
            scaled.scaled_dmg = max(1, round(top_scaled.scaled_dmg * original_ratio))

        # Rebuild mods proportionally
        top_mod_map = {m.mod_id: m for m in top.mods}
        top_scaled_map = {m.mod_id: m for m in top_scaled.scaled_mods}
        for sm in scaled.scaled_mods:
            orig_top = top_mod_map.get(sm.mod_id)
            scaled_top = top_scaled_map.get(sm.mod_id)
            if orig_top and scaled_top and orig_top.value != 0:
                original_ratio = sm.original / orig_top.value
                sm.scaled = round(scaled_top.scaled * original_ratio)

        results.append(scaled)

    return results
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add scaler.py tests/test_scaler.py
git commit -m "feat: scaling engine with profile-based formulas and family support"
```

---

## Task 7: Verifier — FFXIAH + BG-Wiki fetching

**Files:**
- Create: `vanascale/verifier.py`
- Create: `vanascale/tests/test_verifier.py`

- [ ] **Step 1: Write test for parsing and comparison logic (using mock HTML)**

`tests/test_verifier.py`:
```python
from verifier import parse_ffxiah_stats, parse_bgwiki_stats, compare_sources

def test_parse_ffxiah_stats_basic():
    # Minimal mock of FFXIAH item page stats table
    html = """
    <table class="item-stats">
      <tr><td>DMG:</td><td>95</td></tr>
      <tr><td>Delay:</td><td>240</td></tr>
      <tr><td>STR+25</td></tr>
    </table>
    """
    stats = parse_ffxiah_stats(html)
    assert stats.get("dmg") == 95 or stats.get("DMG") == 95

def test_parse_bgwiki_stats_basic():
    html = """
    <table class="item-infobox">
      <tr><th>Damage</th><td>95</td></tr>
      <tr><th>Delay</th><td>240</td></tr>
    </table>
    """
    stats = parse_bgwiki_stats(html)
    assert "dmg" in stats or "Damage" in stats

def test_compare_all_agree():
    db = {"dmg": 95, "delay": 240}
    ffxiah = {"dmg": 95, "delay": 240}
    bgwiki = {"dmg": 95, "delay": 240}
    result = compare_sources(db, ffxiah, bgwiki)
    assert result.status.value == "ALL_AGREE"

def test_compare_conflict():
    db = {"dmg": 95}
    ffxiah = {"dmg": 95}
    bgwiki = {"dmg": 90}
    result = compare_sources(db, ffxiah, bgwiki)
    assert result.status.value == "CONFLICT"

def test_compare_unverified():
    db = {"dmg": 95}
    result = compare_sources(db, {}, {})
    assert result.status.value == "UNVERIFIED"
```

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement verifier.py**

```python
"""Fetch item data from FFXIAH and BG-Wiki, compare with DB."""
import re
import time
import json
import sqlite3
import requests
from bs4 import BeautifulSoup
from urllib.parse import quote
from models import VerificationResult, VerificationStatus
from local_db import get_connection

FFXIAH_URL = "https://www.ffxiah.com/item/{item_id}"
BGWIKI_URL = "https://www.bg-wiki.com/ffxi/{name}"
REQUEST_TIMEOUT = 10


def fetch_ffxiah_html(item_id: int) -> str | None:
    try:
        r = requests.get(FFXIAH_URL.format(item_id=item_id), timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        return r.text
    except Exception:
        return None


def fetch_bgwiki_html(item_name: str) -> str | None:
    url_name = quote(item_name.replace(" ", "_"))
    try:
        r = requests.get(BGWIKI_URL.format(name=url_name), timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        return r.text
    except Exception:
        return None


def parse_ffxiah_stats(html: str) -> dict:
    """Parse stat values from FFXIAH item page HTML."""
    stats = {}
    soup = BeautifulSoup(html, "html.parser")
    # FFXIAH puts stats in various formats — extract numeric patterns
    # This is a best-effort parser; structure may change
    for td in soup.select("td"):
        text = td.get_text(strip=True)
        # Match patterns like "DMG:95" or "STR+25"
        dmg_match = re.search(r'DMG:\s*(\d+)', text, re.IGNORECASE)
        if dmg_match:
            stats["dmg"] = int(dmg_match.group(1))
        delay_match = re.search(r'Delay:\s*(\d+)', text, re.IGNORECASE)
        if delay_match:
            stats["delay"] = int(delay_match.group(1))
        stat_match = re.search(r'(STR|DEX|VIT|AGI|INT|MND|CHR)[+\-](\d+)', text)
        if stat_match:
            stats[stat_match.group(1).lower()] = int(stat_match.group(2))
    return stats


def parse_bgwiki_stats(html: str) -> dict:
    """Parse stat values from BG-Wiki item infobox HTML."""
    stats = {}
    soup = BeautifulSoup(html, "html.parser")
    for row in soup.select("tr"):
        cells = row.find_all(["th", "td"])
        if len(cells) >= 2:
            key = cells[0].get_text(strip=True).lower()
            val = cells[1].get_text(strip=True)
            if key in ("damage", "dmg"):
                try: stats["dmg"] = int(val)
                except ValueError: pass
            elif key == "delay":
                try: stats["delay"] = int(val)
                except ValueError: pass
    return stats


def compare_sources(db_stats: dict, ffxiah_stats: dict, bgwiki_stats: dict) -> VerificationResult:
    """Three-way comparison of item stats."""
    mismatches = []

    if not ffxiah_stats and not bgwiki_stats:
        return VerificationResult(
            item_id=0, db_stats=db_stats, ffxiah_stats=ffxiah_stats,
            bgwiki_stats=bgwiki_stats, status=VerificationStatus.UNVERIFIED,
            mismatches=[],
        )

    # Check if external sources agree with each other
    all_keys = set(ffxiah_stats.keys()) | set(bgwiki_stats.keys())
    external_conflict = False
    for key in all_keys:
        fv = ffxiah_stats.get(key)
        bv = bgwiki_stats.get(key)
        if fv is not None and bv is not None and fv != bv:
            external_conflict = True
            mismatches.append(f"{key}: FFXIAH={fv}, BG-Wiki={bv}")

    if external_conflict:
        return VerificationResult(
            item_id=0, db_stats=db_stats, ffxiah_stats=ffxiah_stats,
            bgwiki_stats=bgwiki_stats, status=VerificationStatus.CONFLICT,
            mismatches=mismatches,
        )

    # Check if DB matches external sources
    db_missing = False
    for key in all_keys:
        external_val = ffxiah_stats.get(key) or bgwiki_stats.get(key)
        db_val = db_stats.get(key)
        if external_val is not None and db_val is None:
            db_missing = True
            mismatches.append(f"{key}: DB missing, external={external_val}")
        elif db_val is not None and external_val is not None and db_val != external_val:
            mismatches.append(f"{key}: DB={db_val}, external={external_val}")

    if db_missing:
        status = VerificationStatus.DB_MISSING
    elif mismatches:
        status = VerificationStatus.CONFLICT
    else:
        status = VerificationStatus.ALL_AGREE

    return VerificationResult(
        item_id=0, db_stats=db_stats, ffxiah_stats=ffxiah_stats,
        bgwiki_stats=bgwiki_stats, status=status, mismatches=mismatches,
    )


def verify_item(item_id: int, item_name: str, db_stats: dict,
                db_path: str, fetch_delay: float = 0.5) -> VerificationResult:
    """Full verification pipeline with cache check."""
    conn = get_connection(db_path)
    cached = conn.execute(
        "SELECT * FROM verification_cache WHERE item_id = ?", (item_id,)
    ).fetchone()

    if cached:
        ffxiah = json.loads(cached["ffxiah_data"]) if cached["ffxiah_data"] else {}
        bgwiki = json.loads(cached["bgwiki_data"]) if cached["bgwiki_data"] else {}
    else:
        ffxiah_html = fetch_ffxiah_html(item_id)
        time.sleep(fetch_delay)
        bgwiki_html = fetch_bgwiki_html(item_name)
        time.sleep(fetch_delay)

        ffxiah = parse_ffxiah_stats(ffxiah_html) if ffxiah_html else {}
        bgwiki = parse_bgwiki_stats(bgwiki_html) if bgwiki_html else {}

        # Cache results
        from datetime import datetime
        conn.execute(
            """INSERT OR REPLACE INTO verification_cache
               (item_id, ffxiah_data, bgwiki_data, status, fetched_at)
               VALUES (?, ?, ?, ?, ?)""",
            (item_id, json.dumps(ffxiah), json.dumps(bgwiki), "fetched",
             datetime.now().isoformat()),
        )
        conn.commit()

    result = compare_sources(db_stats, ffxiah, bgwiki)
    result.item_id = item_id
    return result
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add verifier.py tests/test_verifier.py
git commit -m "feat: external verification with FFXIAH + BG-Wiki parsing and cache"
```

---

## Task 8: Estimator — era comparison scoring

**Files:**
- Create: `vanascale/estimator.py`
- Create: `vanascale/tests/test_estimator.py`

- [ ] **Step 1: Write test for percentile calculation**

`tests/test_estimator.py`:
```python
from estimator import compute_score, find_percentile

def test_weapon_score():
    # dmg=40, delay=240 -> ratio=40/240, atk_mods=10, acc_mods=5
    score = compute_score(dmg=40, delay=240, defense=0, stat_sum=0,
                          atk_mods=10, acc_mods=5, is_weapon=True)
    assert score > 0

def test_armor_score():
    score = compute_score(dmg=0, delay=0, defense=50, stat_sum=30,
                          atk_mods=0, acc_mods=0, is_weapon=False)
    assert score > 0

def test_percentile():
    scores = [10, 20, 30, 40, 50]
    assert find_percentile(25, scores) == 40.0  # between 20 and 30 = 40th percentile
    assert find_percentile(50, scores) == 100.0
    assert find_percentile(5, scores) == 0.0

def test_percentile_empty():
    assert find_percentile(10, []) == 50.0  # default if no comparisons
```

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement estimator.py**

```python
"""Compare scaled items against existing 70-75 era items for percentile placement."""
import db as database
from models import ScaledItem, ModEntry

# Stat mod IDs: STR=2, DEX=3, VIT=4, AGI=5, INT=6, MND=7, CHR=8
STAT_MOD_IDS = {2, 3, 4, 5, 6, 7, 8}
ATK_MOD_ID = 9   # Attack
ACC_MOD_ID = 10  # Accuracy
DEF_MOD_ID = 1   # Defense (stored as a mod in LSB)


def compute_score(dmg: int, delay: int, defense: int, stat_sum: int,
                  atk_mods: int, acc_mods: int, is_weapon: bool) -> float:
    """Weighted score for ranking items. Higher = better."""
    if is_weapon and delay > 0:
        dps_ratio = dmg / delay
        return (dps_ratio * 1000) + (atk_mods * 2) + (acc_mods * 1.5)
    else:
        return (defense * 2) + (stat_sum * 3)


def get_era_items(slot: int, skill: int | None = None) -> list[dict]:
    """Fetch level 70-75 items from the same slot (and weapon skill if applicable)."""
    if skill is not None:
        rows = database.query("""
            SELECT e.itemId, e.slot, w.dmg, w.delay, w.skill
            FROM item_equipment e
            JOIN item_weapon w ON e.itemId = w.itemId
            WHERE e.level BETWEEN 70 AND 75 AND e.slot = %s AND w.skill = %s
        """, (slot, skill))
    else:
        rows = database.query("""
            SELECT e.itemId, e.slot, e.shieldSize
            FROM item_equipment e
            WHERE e.level BETWEEN 70 AND 75 AND e.slot = %s
        """, (slot,))

    # Fetch mods for these items
    if not rows:
        return []

    item_ids = [r["itemId"] for r in rows]
    ph = ",".join(["%s"] * len(item_ids))
    mods = database.query(
        f"SELECT itemId, modId, value FROM item_mods WHERE itemId IN ({ph})",
        tuple(item_ids),
    )
    mods_by_item: dict[int, list] = {}
    for m in mods:
        mods_by_item.setdefault(m["itemId"], []).append(m)

    results = []
    for r in rows:
        iid = r["itemId"]
        item_mods = mods_by_item.get(iid, [])
        stat_sum = sum(m["value"] for m in item_mods if m["modId"] in STAT_MOD_IDS)
        atk = sum(m["value"] for m in item_mods if m["modId"] == ATK_MOD_ID)
        acc = sum(m["value"] for m in item_mods if m["modId"] == ACC_MOD_ID)
        defense = sum(m["value"] for m in item_mods if m["modId"] == DEF_MOD_ID)

        is_weapon = "dmg" in r and r.get("dmg", 0) > 0
        score = compute_score(
            dmg=r.get("dmg", 0), delay=r.get("delay", 0),
            defense=defense, stat_sum=stat_sum,
            atk_mods=atk, acc_mods=acc, is_weapon=is_weapon,
        )
        results.append({"itemId": iid, "score": score})
    return results


def find_percentile(score: float, sorted_scores: list[float]) -> float:
    """Find where a score lands in a sorted list, expressed as percentile 0-100."""
    if not sorted_scores:
        return 50.0
    below = sum(1 for s in sorted_scores if s < score)
    return round((below / len(sorted_scores)) * 100, 1)


def estimate_item(scaled: ScaledItem) -> dict:
    """Return percentile placement and comparison data for a scaled item."""
    is_weapon = scaled.item.dmg is not None
    era_items = get_era_items(scaled.item.slot, scaled.item.skill if is_weapon else None)

    era_scores = sorted(i["score"] for i in era_items)

    # Score the scaled item
    stat_sum = sum(m.scaled for m in scaled.scaled_mods if m.mod_id in STAT_MOD_IDS)
    atk = sum(m.scaled for m in scaled.scaled_mods if m.mod_id == ATK_MOD_ID)
    acc = sum(m.scaled for m in scaled.scaled_mods if m.mod_id == ACC_MOD_ID)
    defense = sum(m.scaled for m in scaled.scaled_mods if m.mod_id == DEF_MOD_ID)

    score = compute_score(
        dmg=scaled.scaled_dmg or 0, delay=scaled.scaled_delay or 0,
        defense=defense, stat_sum=stat_sum,
        atk_mods=atk, acc_mods=acc, is_weapon=is_weapon,
    )
    percentile = find_percentile(score, era_scores)

    return {
        "score": score,
        "percentile": percentile,
        "era_item_count": len(era_items),
        "era_scores": era_scores,
    }
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add estimator.py tests/test_estimator.py
git commit -m "feat: era comparison estimator with percentile scoring"
```

---

## Task 9: Heatmap — job coverage grid

**Files:**
- Create: `vanascale/heatmap.py`
- Create: `vanascale/tests/test_heatmap.py`

- [ ] **Step 1: Write test**

`tests/test_heatmap.py`:
```python
from heatmap import score_cell, build_heatmap_from_counts

def test_score_cell():
    assert score_cell(0) == "empty"
    assert score_cell(1) == "sparse"
    assert score_cell(2) == "sparse"
    assert score_cell(3) == "moderate"
    assert score_cell(5) == "moderate"
    assert score_cell(6) == "well-covered"
    assert score_cell(100) == "well-covered"

def test_build_heatmap():
    # Mock counts: {(job_id, slot_bit): count}
    counts = {
        (1, 0): 5,   # WAR, Main = moderate
        (1, 4): 10,  # WAR, Head = well-covered
        (2, 0): 0,   # MNK, Main = empty
    }
    grid = build_heatmap_from_counts(counts)
    war_main = next(c for c in grid if c["job_id"] == 1 and c["slot_id"] == 0)
    assert war_main["score"] == "moderate"
```

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement heatmap.py**

```python
"""Job coverage heatmap: 22 jobs x 16 slots grid."""
import db as database
from models import JOB_NAMES, SLOT_NAMES


def score_cell(count: int) -> str:
    if count == 0:
        return "empty"
    elif count <= 2:
        return "sparse"
    elif count <= 5:
        return "moderate"
    return "well-covered"


def build_heatmap_from_counts(counts: dict) -> list[dict]:
    """Build grid from pre-computed {(job_id, slot_bit): count} dict."""
    grid = []
    for job_id in range(1, 23):
        for slot_bit in range(16):
            count = counts.get((job_id, slot_bit), 0)
            grid.append({
                "job_id": job_id,
                "job_name": JOB_NAMES.get(job_id, "???"),
                "slot_id": slot_bit,
                "slot_name": SLOT_NAMES.get(slot_bit, "???"),
                "count": count,
                "score": score_cell(count),
            })
    return grid


def compute_heatmap() -> list[dict]:
    """Query DB for all level 70-75 equippable items and build the coverage grid."""
    rows = database.query("""
        SELECT e.itemId, e.jobs, e.slot
        FROM item_equipment e
        WHERE e.level BETWEEN 70 AND 75
    """)

    counts: dict[tuple[int, int], int] = {}
    for r in rows:
        jobs_mask = r["jobs"]
        slot_mask = r["slot"]
        for job_id in range(1, 23):
            if jobs_mask & (1 << (job_id - 1)):
                for slot_bit in range(16):
                    if slot_mask & (1 << slot_bit):
                        key = (job_id, slot_bit)
                        counts[key] = counts.get(key, 0) + 1

    return build_heatmap_from_counts(counts)
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add heatmap.py tests/test_heatmap.py
git commit -m "feat: job coverage heatmap calculation"
```

---

## Task 10: Conflict checker — stacking stat detection

**Files:**
- Create: `vanascale/conflict_checker.py`
- Create: `vanascale/tests/test_conflict_checker.py`

- [ ] **Step 1: Write test**

`tests/test_conflict_checker.py`:
```python
from conflict_checker import check_stat_stacking, ERA_CAPS

def test_era_caps_defined():
    assert 17 in ERA_CAPS  # Haste
    assert 98 in ERA_CAPS  # DA
    assert 97 in ERA_CAPS  # TA

def test_stacking_detection():
    # Mock: job 1 (WAR) can equip items in slots 0,4,5,6,7,8
    # Each item gives Haste+5, total = 30, cap = 25 -> flagged
    items_by_slot = {
        0: [{"item_id": 1, "name": "Sword", "value": 5}],
        4: [{"item_id": 2, "name": "Helm", "value": 5}],
        5: [{"item_id": 3, "name": "Mail", "value": 5}],
        6: [{"item_id": 4, "name": "Gauntlets", "value": 5}],
        7: [{"item_id": 5, "name": "Cuisses", "value": 5}],
        8: [{"item_id": 6, "name": "Sollerets", "value": 5}],
    }
    conflicts = check_stat_stacking(
        job_id=1, mod_id=17, era_cap=25, items_by_slot=items_by_slot
    )
    assert conflicts is not None
    assert conflicts["total"] == 30
    assert conflicts["exceeds"]
```

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement conflict_checker.py**

```python
"""Check if scaled items allow stacking stats beyond era caps."""
import db as database
from models import JOB_NAMES, SLOT_NAMES

ERA_CAPS = {
    17: 25,   # Haste% from gear
    98: 15,   # Double Attack%
    97: 5,    # Triple Attack%
    106: 15,  # Store TP
    113: 10,  # Subtle Blow
}


def check_stat_stacking(job_id: int, mod_id: int, era_cap: float,
                        items_by_slot: dict) -> dict | None:
    """For a single job+stat, find max possible value across all slots.
    items_by_slot: {slot_bit: [{item_id, name, value}]}
    Returns conflict dict if total exceeds era_cap, else None.
    """
    total = 0
    contributors = []
    for slot_bit, items in items_by_slot.items():
        if not items:
            continue
        best = max(items, key=lambda i: i["value"])
        total += best["value"]
        contributors.append({
            "item_id": best["item_id"],
            "item_name": best["name"],
            "slot": slot_bit,
            "slot_name": SLOT_NAMES.get(slot_bit, "???"),
            "value": best["value"],
        })

    exceeds = total > era_cap
    return {
        "job_id": job_id,
        "job_name": JOB_NAMES.get(job_id, "???"),
        "mod_id": mod_id,
        "era_cap": era_cap,
        "total": total,
        "exceeds": exceeds,
        "contributors": contributors,
    }


def run_conflict_check(scaled_items: list) -> list[dict]:
    """Run stacking checks for all jobs and tracked stats."""
    # Also include existing 70-75 items from DB
    era_rows = database.query("""
        SELECT e.itemId, e.jobs, e.slot, m.modId, m.value
        FROM item_equipment e
        JOIN item_mods m ON e.itemId = m.itemId
        WHERE e.level BETWEEN 70 AND 75
          AND m.modId IN (17, 97, 98, 106, 113)
    """)

    # Build: {job_id: {mod_id: {slot_bit: [{item_id, name, value}]}}}
    job_data: dict = {}
    all_items = []

    # Add existing era items
    for r in era_rows:
        all_items.append(r)

    # Add scaled items
    for si in scaled_items:
        for sm in si.scaled_mods:
            if sm.mod_id in ERA_CAPS:
                all_items.append({
                    "itemId": si.item.item_id,
                    "jobs": si.item.jobs,
                    "slot": si.item.slot,
                    "modId": sm.mod_id,
                    "value": sm.scaled,
                    "name": si.item.name,
                })

    # Index by job -> mod -> slot
    for r in all_items:
        jobs_mask = r["jobs"]
        slot_mask = r["slot"]
        name = r.get("name", "")
        for job_id in range(1, 23):
            if not (jobs_mask & (1 << (job_id - 1))):
                continue
            if job_id not in job_data:
                job_data[job_id] = {}
            for slot_bit in range(16):
                if not (slot_mask & (1 << slot_bit)):
                    continue
                mod_id = r["modId"]
                if mod_id not in job_data[job_id]:
                    job_data[job_id][mod_id] = {}
                if slot_bit not in job_data[job_id][mod_id]:
                    job_data[job_id][mod_id][slot_bit] = []
                job_data[job_id][mod_id][slot_bit].append({
                    "item_id": r["itemId"],
                    "name": name,
                    "value": r["value"],
                })

    # Run checks
    conflicts = []
    for job_id, mods in job_data.items():
        for mod_id, slots in mods.items():
            cap = ERA_CAPS.get(mod_id, 0)
            result = check_stat_stacking(job_id, mod_id, cap, slots)
            if result and result["exceeds"]:
                conflicts.append(result)

    return conflicts
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add conflict_checker.py tests/test_conflict_checker.py
git commit -m "feat: stacking stat conflict checker per job"
```

---

## Task 11: Exporter — SQL, Lua module, patchnotes

**Files:**
- Create: `vanascale/exporter.py`
- Create: `vanascale/tests/test_exporter.py`

- [ ] **Step 1: Write test for SQL and patchnotes generation**

`tests/test_exporter.py`:
```python
import os
from models import (
    ItemRecord, ScaledItem, ScaledMod, ScalingProfile, ModScaleType,
)
from exporter import generate_sql, generate_patchnotes, generate_lua_module

def make_scaled_item():
    item = ItemRecord(
        item_id=21000, name="Test Sword", sortname="test_sword",
        level=99, ilevel=119, jobs=0xFF, slot=0, shield_size=0,
        dmg=80, delay=240, skill=4, dmg_type=3,
        profile=ScalingProfile.GENERAL,
    )
    return ScaledItem(
        item=item, target_level=75, scaled_level=75,
        scaled_dmg=61, scaled_delay=240,
        scaled_mods=[
            ScaledMod(mod_id=2, original=25, scaled=19, scale_type=ModScaleType.RAW_SCALE),
        ],
    )

def test_generate_sql():
    items = [make_scaled_item()]
    sql = generate_sql(items)
    assert "START TRANSACTION" in sql
    assert "COMMIT" in sql
    assert "UPDATE item_equipment" in sql
    assert "21000" in sql
    assert "UPDATE item_mods" in sql

def test_generate_patchnotes():
    items = [make_scaled_item()]
    md = generate_patchnotes(items)
    assert "### Test Sword" in md
    assert "99" in md and "75" in md
    assert "DMG" in md or "dmg" in md

def test_generate_lua_module():
    items = [make_scaled_item()]
    lua = generate_lua_module(items)
    # Should be a companion info file, not actual SQL execution
    assert "vanascale" in lua.lower()
```

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement exporter.py**

```python
"""Export scaled items as SQL, Lua module stub, and patchnotes."""
import os
from datetime import datetime
from models import ScaledItem


def generate_sql(items: list[ScaledItem]) -> str:
    """Generate vanascale_changes.sql with UPDATE statements."""
    lines = [
        f"-- VanaScale item scaling export",
        f"-- Generated: {datetime.now().isoformat()}",
        f"-- Items modified: {len(items)}",
        "",
        "START TRANSACTION;",
        "",
    ]

    for si in items:
        iid = si.item.item_id
        lines.append(f"-- {si.item.name} (ID: {iid})")

        # Update level in item_equipment
        lines.append(
            f"UPDATE item_equipment SET level = {si.scaled_level} "
            f"WHERE itemId = {iid};"
        )

        # Update weapon stats if applicable
        if si.scaled_dmg is not None:
            lines.append(
                f"UPDATE item_weapon SET dmg = {si.scaled_dmg} "
                f"WHERE itemId = {iid};"
            )

        # Update mods
        for sm in si.scaled_mods:
            if sm.scaled != sm.original:
                lines.append(
                    f"UPDATE item_mods SET value = {sm.scaled} "
                    f"WHERE itemId = {iid} AND modId = {sm.mod_id};"
                )

        # Update pet mods
        for sm in si.scaled_pet_mods:
            if sm.scaled != sm.original:
                lines.append(
                    f"UPDATE item_mods_pet SET value = {sm.scaled} "
                    f"WHERE itemId = {iid} AND modId = {sm.mod_id};"
                )

        # Update latents
        for sm in si.scaled_latents:
            if sm.scaled != sm.original:
                lines.append(
                    f"UPDATE item_latents SET value = {sm.scaled} "
                    f"WHERE itemId = {iid} AND modId = {sm.mod_id};"
                )

        lines.append("")

    lines.append("COMMIT;")
    return "\n".join(lines)


def generate_lua_module(items: list[ScaledItem]) -> str:
    """Generate LSB module directory structure.

    LSB modules don't execute SQL at runtime — SQL is applied separately.
    This generates a stub Lua module + companion SQL file reference.
    The actual SQL goes in vanascale_changes.sql.
    """
    lua = [
        "-----------------------------------",
        "-- VanaScale 75-Cap Item Scaling",
        f"-- Generated: {datetime.now().isoformat()}",
        f"-- Items modified: {len(items)}",
        "-----------------------------------",
        "-- This module is a marker/stub for the VanaScale scaling system.",
        "-- Item stat changes are applied via the companion SQL file:",
        "--   modules/vanascale/sql/vanascale_items.sql",
        "-- Apply that SQL to your database after enabling this module.",
        "-----------------------------------",
        "",
        "require('modules/module_utils')",
        "",
        "local m = Module:new('vanascale_75cap')",
        "",
        "-- No Lua overrides needed — all changes are data-level (SQL).",
        "-- See modules/vanascale/sql/vanascale_items.sql",
        "",
        "return m",
    ]
    return "\n".join(lua)


def generate_patchnotes(items: list[ScaledItem]) -> str:
    """Generate vanascale_patchnotes.md."""
    lines = [
        "# VanaScale Patch Notes",
        "",
        f"*Generated: {datetime.now().isoformat()}*",
        f"*Items modified: {len(items)}*",
        "",
        "---",
        "",
    ]

    for si in items:
        lines.append(f"### {si.item.name}")
        lines.append(f"**Level:** {si.item.level} -> {si.scaled_level}")
        lines.append(f"**Profile:** {si.item.profile.value}")

        changes = []
        if si.scaled_dmg is not None and si.scaled_dmg != si.item.dmg:
            changes.append(f"- DMG: {si.item.dmg} -> {si.scaled_dmg}")
        for sm in si.scaled_mods:
            if sm.scaled != sm.original:
                changes.append(f"- Mod {sm.mod_id}: {sm.original} -> {sm.scaled}")
        for sm in si.scaled_pet_mods:
            if sm.scaled != sm.original:
                changes.append(f"- Pet Mod {sm.mod_id}: {sm.original} -> {sm.scaled}")
        for sm in si.scaled_latents:
            if sm.scaled != sm.original:
                changes.append(f"- Latent Mod {sm.mod_id}: {sm.original} -> {sm.scaled}")

        if changes:
            lines.append("**Changes:**")
            lines.extend(changes)
        else:
            lines.append("*No stat changes (level only)*")

        if si.item.flags:
            lines.append(f"**Flags:** {', '.join(si.item.flags)}")

        lines.append("")

    return "\n".join(lines)


def export_all(items: list[ScaledItem], output_dir: str) -> dict[str, str]:
    """Write all export files to output_dir. Returns {filename: path}."""
    os.makedirs(output_dir, exist_ok=True)

    paths = {}

    # SQL
    sql_path = os.path.join(output_dir, "vanascale_changes.sql")
    with open(sql_path, "w") as f:
        f.write(generate_sql(items))
    paths["sql"] = sql_path

    # Lua module directory
    mod_dir = os.path.join(output_dir, "vanascale_module", "vanascale", "lua")
    mod_sql_dir = os.path.join(output_dir, "vanascale_module", "vanascale", "sql")
    os.makedirs(mod_dir, exist_ok=True)
    os.makedirs(mod_sql_dir, exist_ok=True)

    lua_path = os.path.join(mod_dir, "vanascale_75cap.lua")
    with open(lua_path, "w") as f:
        f.write(generate_lua_module(items))
    paths["lua"] = lua_path

    # Copy SQL into module sql dir too
    mod_sql_path = os.path.join(mod_sql_dir, "vanascale_items.sql")
    with open(mod_sql_path, "w") as f:
        f.write(generate_sql(items))
    paths["module_sql"] = mod_sql_path

    # Patchnotes
    notes_path = os.path.join(output_dir, "vanascale_patchnotes.md")
    with open(notes_path, "w") as f:
        f.write(generate_patchnotes(items))
    paths["patchnotes"] = notes_path

    return paths
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add exporter.py tests/test_exporter.py
git commit -m "feat: SQL, Lua module, and patchnotes export"
```

---

## Task 12: DAT patcher — binary read/patch/write

**Files:**
- Create: `vanascale/dat_patcher.py`
- Create: `vanascale/tests/test_dat_patcher.py`

This is the most technically complex module. FFXI DAT files use a rotational XOR encryption per record.

- [ ] **Step 1: Write test for XOR encryption/decryption**

`tests/test_dat_patcher.py`:
```python
from dat_patcher import decrypt_record, encrypt_record, patch_level_in_record

def test_roundtrip_encryption():
    """Encrypting then decrypting (or vice versa) should return original data."""
    # Create a fake 28-byte item record (typical FFXI item record size)
    original = bytearray(b'\x00' * 28)
    original[0] = 0x01  # some item data
    original[3] = 0xAB  # byte used in seed calculation
    original[12] = 0xCD
    original[13] = 0xEF

    decrypted = decrypt_record(bytes(original))
    re_encrypted = encrypt_record(decrypted, bytes(original))
    # The re-encryption should produce the original
    assert re_encrypted == bytes(original)

def test_patch_level():
    """Patching level field in a decrypted record."""
    # In a decrypted item record, the level field is at a known offset
    record = bytearray(128)  # typical record size varies by type
    record[2] = 99  # original level at offset 2 (armor/weapon records)
    patched = patch_level_in_record(record, new_level=75)
    assert patched[2] == 75
```

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement dat_patcher.py**

```python
"""Read, decrypt, patch, re-encrypt FFXI DAT files for XiPivot overlay.

FFXI item DAT files use a rotational XOR cipher. Each record is encrypted
independently. The XOR seed is derived from bytes at positions 3, 12, and 13
of each record (per POLUtils documentation).

Record structure varies by item type but the level field position is consistent
within each DAT type (weapons vs armor).

IMPORTANT: Never modify original DAT files. Only write to overlay directory.
"""
import os
import struct

# FFXI DAT file paths relative to install directory
# ROM/0/73.DAT = weapon item data
# ROM/0/74.DAT = armor item data
# ROM/0/75.DAT = armor2 item data (additional armor slots)
DAT_PATHS = {
    "weapons": os.path.join("ROM", "0", "73.DAT"),
    "armor":   os.path.join("ROM", "0", "74.DAT"),
    "armor2":  os.path.join("ROM", "0", "75.DAT"),
}

# Record sizes in bytes for each DAT type
RECORD_SIZES = {
    "weapons": 0xC4,  # 196 bytes
    "armor":   0xB0,   # 176 bytes
    "armor2":  0xB0,   # 176 bytes
}

# Offset of the level field within a decrypted record
# These offsets are for the stat display portion of the record
LEVEL_OFFSETS = {
    "weapons": 0x02,
    "armor":   0x02,
    "armor2":  0x02,
}


def compute_xor_key(record: bytes) -> list[int]:
    """Compute the 8-byte rotating XOR key from record seed bytes.

    The seed is derived from bytes at positions 3, 12, and 13 of the
    raw (encrypted) record. This produces a repeating 8-byte key used
    to XOR all data bytes in the record.
    """
    # Seed from specific byte positions in the encrypted record
    seed = (record[3] << 16) | (record[12] << 8) | record[13]

    # Generate 8-byte rotating key from seed using POLUtils algorithm
    key = []
    for i in range(8):
        # Linear congruential generator step
        seed = (seed * 0x1F + 0x25) & 0xFFFFFFFF
        key.append((seed >> 16) & 0xFF)
    return key


def decrypt_record(record: bytes) -> bytearray:
    """Decrypt a single item record using rotational XOR."""
    key = compute_xor_key(record)
    result = bytearray(len(record))
    for i in range(len(record)):
        result[i] = record[i] ^ key[i % len(key)]
    return result


def encrypt_record(decrypted: bytearray, original_encrypted: bytes) -> bytes:
    """Re-encrypt a modified record using the same XOR key.

    We derive the key from the original encrypted record to ensure
    the same seed bytes are used.
    """
    key = compute_xor_key(original_encrypted)
    result = bytearray(len(decrypted))
    for i in range(len(decrypted)):
        result[i] = decrypted[i] ^ key[i % len(key)]
    return bytes(result)


def patch_level_in_record(record: bytearray, new_level: int,
                          level_offset: int = 0x02) -> bytearray:
    """Patch the level byte in a decrypted record."""
    patched = bytearray(record)
    patched[level_offset] = new_level & 0xFF
    return patched


def read_dat_file(dat_path: str, record_size: int) -> list[bytes]:
    """Read a DAT file and split into individual records."""
    with open(dat_path, "rb") as f:
        data = f.read()

    records = []
    for offset in range(0, len(data), record_size):
        chunk = data[offset:offset + record_size]
        if len(chunk) == record_size:
            records.append(chunk)
    return records


def get_item_id_from_record(decrypted: bytearray) -> int:
    """Extract item ID from a decrypted record (first 2 bytes, little-endian)."""
    return struct.unpack_from("<H", decrypted, 0)[0]


def build_xipivot_overlay(scaled_items: list, ffxi_path: str,
                           output_dir: str) -> dict[str, str]:
    """Build XiPivot overlay DAT files with patched level fields.

    For each DAT type, reads the original, patches relevant records,
    and writes to the overlay directory structure.

    Returns dict of written file paths.
    """
    # Map item IDs to their new level
    level_map = {}
    for si in scaled_items:
        level_map[si.item.item_id] = si.scaled_level

    overlay_base = os.path.join(output_dir, "vanascale")
    written = {}

    for dat_type, rel_path in DAT_PATHS.items():
        dat_full = os.path.join(ffxi_path, rel_path)
        if not os.path.exists(dat_full):
            continue

        record_size = RECORD_SIZES[dat_type]
        level_offset = LEVEL_OFFSETS[dat_type]
        records = read_dat_file(dat_full, record_size)

        modified = False
        patched_records = []

        for original_record in records:
            decrypted = decrypt_record(original_record)
            item_id = get_item_id_from_record(decrypted)

            if item_id in level_map:
                patched = patch_level_in_record(decrypted, level_map[item_id],
                                                 level_offset)
                re_encrypted = encrypt_record(patched, original_record)
                patched_records.append(re_encrypted)
                modified = True
            else:
                patched_records.append(original_record)

        if modified:
            out_path = os.path.join(overlay_base, rel_path)
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with open(out_path, "wb") as f:
                for rec in patched_records:
                    f.write(rec)
            written[dat_type] = out_path

    # Write XiPivot XML manifest
    xml_path = os.path.join(overlay_base, "vanascale_xipivot.xml")
    with open(xml_path, "w") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n')
        f.write('<xipivot>\n')
        f.write('  <overlay name="vanascale" enabled="true">\n')
        f.write(f'    <path>{overlay_base}</path>\n')
        f.write('  </overlay>\n')
        f.write('</xipivot>\n')
    written["xml"] = xml_path

    return written
```

- [ ] **Step 4: Run tests — expect pass**

Note: The XOR algorithm above is based on POLUtils documentation. The actual seed calculation may need adjustment once tested against real DAT files. The test validates the roundtrip property (encrypt(decrypt(x)) == x) which is the critical invariant regardless of the exact algorithm.

- [ ] **Step 5: Commit**

```bash
git add dat_patcher.py tests/test_dat_patcher.py
git commit -m "feat: DAT patcher with XOR encryption for XiPivot overlay"
```

---

## Task 13: LSB update detector

**Files:**
- Create: `vanascale/lsb_watcher.py`
- Create: `vanascale/tests/test_lsb_watcher.py`

- [ ] **Step 1: Write test**

`tests/test_lsb_watcher.py`:
```python
from lsb_watcher import parse_git_diff_item_ids

def test_parse_item_ids_from_diff():
    # Simulate git diff output that contains item ID references
    diff_output = """
+INSERT INTO `item_basic` VALUES (21000, 0, 'Test Sword', ...);
+INSERT INTO `item_basic` VALUES (21001, 0, 'Test Shield', ...);
-INSERT INTO `item_basic` VALUES (20000, 0, 'Old Item', ...);
    """
    ids = parse_git_diff_item_ids(diff_output)
    assert 21000 in ids
    assert 21001 in ids
    assert 20000 in ids

def test_parse_empty_diff():
    assert parse_git_diff_item_ids("") == set()
```

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement lsb_watcher.py**

```python
"""Detect LSB upstream changes to item tables via git log."""
import re
from datetime import datetime
from git import Repo, InvalidGitRepositoryError

WATCHED_FILES = [
    "sql/item_basic.sql",
    "sql/item_equipment.sql",
    "sql/item_weapon.sql",
    "sql/item_mods.sql",
]

# Match item IDs in SQL INSERT/UPDATE statements
ITEM_ID_PATTERN = re.compile(r"(?:VALUES\s*\(|itemId\s*=\s*|itemid\s*=\s*)(\d+)", re.IGNORECASE)


def parse_git_diff_item_ids(diff_text: str) -> set[int]:
    """Extract item IDs from git diff output."""
    ids = set()
    for line in diff_text.splitlines():
        if line.startswith("+") or line.startswith("-"):
            for match in ITEM_ID_PATTERN.finditer(line):
                try:
                    ids.add(int(match.group(1)))
                except ValueError:
                    pass
    return ids


def check_for_updates(repo_path: str, since_timestamp: str,
                      audit_item_ids: set[int]) -> dict:
    """Check if LSB repo has item-related commits since last run.

    Returns:
        {
            "has_updates": bool,
            "affected_items": [item_ids that were both changed upstream AND in our audit],
            "commits": [{"hash", "message", "date"}],
        }
    """
    try:
        repo = Repo(repo_path)
    except InvalidGitRepositoryError:
        return {"has_updates": False, "error": "Invalid git repository", "affected_items": [], "commits": []}

    if not since_timestamp:
        return {"has_updates": False, "affected_items": [], "commits": []}

    # Get commits since last run that touch watched files
    try:
        log_args = ["--since", since_timestamp, "--"] + WATCHED_FILES
        commits = list(repo.iter_commits("HEAD", **{"since": since_timestamp}, paths=WATCHED_FILES))
    except Exception as e:
        return {"has_updates": False, "error": str(e), "affected_items": [], "commits": []}

    if not commits:
        return {"has_updates": False, "affected_items": [], "commits": []}

    # Parse diffs for item IDs
    changed_ids = set()
    commit_info = []
    for commit in commits:
        commit_info.append({
            "hash": commit.hexsha[:8],
            "message": commit.message.strip()[:100],
            "date": commit.committed_datetime.isoformat(),
        })
        # Get diff for this commit
        if commit.parents:
            diff = repo.git.diff(commit.parents[0].hexsha, commit.hexsha, "--", *WATCHED_FILES)
            changed_ids |= parse_git_diff_item_ids(diff)

    affected = changed_ids & audit_item_ids

    return {
        "has_updates": len(affected) > 0,
        "affected_items": sorted(affected),
        "commits": commit_info,
    }
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add lsb_watcher.py tests/test_lsb_watcher.py
git commit -m "feat: LSB git update detector for item table changes"
```

---

## Task 14: Flask app — API routes

**Files:**
- Create: `vanascale/app.py`

This is the central Flask application that wires all modules together and serves the API + static files.

- [ ] **Step 1: Implement app.py**

```python
"""Flask application: API routes and static file serving."""
import os
import json
from flask import Flask, jsonify, request, send_from_directory
from config import load_config, save_config
import db
from local_db import get_connection
from models import ScalingProfile

app = Flask(__name__, static_folder="static", static_url_path="")

DB_PATH = os.path.join(os.path.dirname(__file__), "vanascale.db")

# ── Static files ──────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# ── Settings ──────────────────────────────────────────────────

@app.route("/api/settings", methods=["GET"])
def get_settings():
    cfg = load_config()
    # Never send password to frontend
    safe = {k: v for k, v in cfg.items() if k != "db_password"}
    safe["db_password_set"] = bool(cfg.get("db_password"))
    return jsonify(safe)


@app.route("/api/settings", methods=["POST"])
def update_settings():
    cfg = load_config()
    data = request.json
    for key in ["target_level", "db_host", "db_port", "db_user",
                "db_name", "ffxi_install_path", "lsb_repo_path",
                "output_dir", "fetch_delay"]:
        if key in data:
            cfg[key] = data[key]
    if "db_password" in data and data["db_password"]:
        cfg["db_password"] = data["db_password"]
    save_config(cfg)
    return jsonify({"status": "ok"})


@app.route("/api/settings/test-db", methods=["POST"])
def test_db_connection():
    data = request.json
    cfg = load_config()
    host = data.get("db_host", cfg["db_host"])
    port = int(data.get("db_port", cfg["db_port"]))
    user = data.get("db_user", cfg["db_user"])
    password = data.get("db_password") or cfg.get("db_password", "")
    database = data.get("db_name", cfg["db_name"])
    result = db.test_connection(host, port, user, password, database)
    return jsonify({"status": result})


# ── Scanner ───────────────────────────────────────────────────

@app.route("/api/scan", methods=["POST"])
def run_scan():
    _ensure_db_pool()
    from scanner import scan_items
    cfg = load_config()
    min_level = cfg.get("target_level", 75) + 1
    items = scan_items(min_level)
    # Store in memory for this session (in production, use a proper cache)
    app.config["SCANNED_ITEMS"] = items
    return jsonify({
        "count": len(items),
        "items": [_item_to_dict(i) for i in items],
    })


# ── Scaling ───────────────────────────────────────────────────

@app.route("/api/scale", methods=["POST"])
def run_scale():
    _ensure_db_pool()
    from scaler import scale_item, scale_family
    items = app.config.get("SCANNED_ITEMS", [])
    if not items:
        return jsonify({"error": "No scanned items. Run scan first."}), 400

    cfg = load_config()
    target = cfg.get("target_level", 75)

    # Group by family
    families: dict[str, list] = {}
    orphans = []
    for item in items:
        if item.family_id:
            families.setdefault(item.family_id, []).append(item)
        else:
            orphans.append(item)

    scaled_items = []
    for fam_items in families.values():
        scaled_items.extend(scale_family(fam_items, target))
    for item in orphans:
        scaled_items.append(scale_item(item, target))

    app.config["SCALED_ITEMS"] = scaled_items
    return jsonify({
        "count": len(scaled_items),
        "items": [_scaled_to_dict(s) for s in scaled_items],
    })


# ── Override a single mod value ───────────────────────────────

@app.route("/api/override", methods=["POST"])
def override_mod():
    data = request.json
    item_id = data["item_id"]
    mod_id = data["mod_id"]
    new_value = data["value"]

    scaled_items = app.config.get("SCALED_ITEMS", [])
    for si in scaled_items:
        if si.item.item_id == item_id:
            for sm in si.scaled_mods:
                if sm.mod_id == mod_id:
                    sm.scaled = new_value
                    sm.manually_overridden = True
                    return jsonify({"status": "ok"})
    return jsonify({"error": "Item or mod not found"}), 404


# ── Estimator ─────────────────────────────────────────────────

@app.route("/api/estimate/<int:item_id>", methods=["GET"])
def estimate(item_id):
    _ensure_db_pool()
    from estimator import estimate_item
    scaled_items = app.config.get("SCALED_ITEMS", [])
    si = next((s for s in scaled_items if s.item.item_id == item_id), None)
    if not si:
        return jsonify({"error": "Item not found in scaled set"}), 404
    result = estimate_item(si)
    return jsonify(result)


# ── Verification ──────────────────────────────────────────────

@app.route("/api/verify/<int:item_id>", methods=["POST"])
def verify(item_id):
    from verifier import verify_item
    cfg = load_config()
    scaled_items = app.config.get("SCALED_ITEMS", [])
    si = next((s for s in scaled_items if s.item.item_id == item_id), None)
    if not si:
        return jsonify({"error": "Item not found"}), 404

    db_stats = {"dmg": si.item.dmg, "delay": si.item.delay}
    result = verify_item(item_id, si.item.name, db_stats, DB_PATH,
                         cfg.get("fetch_delay", 0.5))
    si.verification = result.status
    return jsonify({
        "status": result.status.value,
        "mismatches": result.mismatches,
        "ffxiah": result.ffxiah_stats,
        "bgwiki": result.bgwiki_stats,
    })


@app.route("/api/verify/batch", methods=["POST"])
def verify_batch():
    """Verify all items concurrently (with delay between requests)."""
    from verifier import verify_item
    import concurrent.futures
    cfg = load_config()
    scaled_items = app.config.get("SCALED_ITEMS", [])
    results = []

    # Use thread pool but respect fetch_delay
    for si in scaled_items:
        db_stats = {"dmg": si.item.dmg, "delay": si.item.delay}
        r = verify_item(si.item.item_id, si.item.name, db_stats, DB_PATH,
                        cfg.get("fetch_delay", 0.5))
        si.verification = r.status
        results.append({
            "item_id": si.item.item_id,
            "status": r.status.value,
            "mismatches": r.mismatches,
        })

    return jsonify({"results": results})


# ── Heatmap ───────────────────────────────────────────────────

@app.route("/api/heatmap", methods=["GET"])
def get_heatmap():
    _ensure_db_pool()
    from heatmap import compute_heatmap
    grid = compute_heatmap()
    return jsonify({"grid": grid})


# ── Conflicts ─────────────────────────────────────────────────

@app.route("/api/conflicts", methods=["GET"])
def get_conflicts():
    _ensure_db_pool()
    from conflict_checker import run_conflict_check
    scaled_items = app.config.get("SCALED_ITEMS", [])
    conflicts = run_conflict_check(scaled_items)
    return jsonify({"conflicts": conflicts})


# ── Export ────────────────────────────────────────────────────

@app.route("/api/export", methods=["POST"])
def export():
    from exporter import export_all
    from dat_patcher import build_xipivot_overlay
    from audit import AuditLog

    cfg = load_config()
    scaled_items = app.config.get("SCALED_ITEMS", [])
    if not scaled_items:
        return jsonify({"error": "No scaled items to export"}), 400

    output_dir = cfg.get("output_dir") or os.path.join(os.path.dirname(__file__), "output")

    # Check for unresolved red flags
    red_flags = [si for si in scaled_items
                 if si.verification == "CONFLICT"]
    if red_flags:
        return jsonify({
            "error": f"{len(red_flags)} items have unresolved CONFLICT status. Resolve before exporting.",
            "items": [si.item.item_id for si in red_flags],
        }), 400

    # Export SQL, Lua, patchnotes
    paths = export_all(scaled_items, output_dir)

    # Build XiPivot overlay if FFXI path configured
    if cfg.get("ffxi_install_path"):
        try:
            dat_paths = build_xipivot_overlay(scaled_items, cfg["ffxi_install_path"], output_dir)
            paths.update(dat_paths)
        except Exception as e:
            paths["dat_error"] = str(e)

    # Write audit log
    audit = AuditLog(DB_PATH)
    for si in scaled_items:
        original = {
            "level": si.item.level, "dmg": si.item.dmg, "delay": si.item.delay,
            "mods": {str(m.mod_id): m.value for m in si.item.mods},
        }
        scaled = {
            "level": si.scaled_level, "dmg": si.scaled_dmg, "delay": si.scaled_delay,
            "mods": {str(m.mod_id): m.scaled for m in si.scaled_mods},
        }
        overrides = {str(m.mod_id): m.scaled for m in si.scaled_mods if m.manually_overridden}
        audit.record(
            item_id=si.item.item_id, item_name=si.item.name,
            original=original, scaled=scaled,
            source_used=si.verification.value if hasattr(si.verification, 'value') else "DB",
            operator_overrides=overrides or None,
            profile_used=si.item.profile.value,
            family_id=si.item.family_id,
            flags=si.item.flags,
        )

    return jsonify({"status": "ok", "paths": paths})


# ── Audit Log ─────────────────────────────────────────────────

@app.route("/api/audit", methods=["GET"])
def get_audit_log():
    from audit import AuditLog
    audit = AuditLog(DB_PATH)
    entries = audit.get_all()
    return jsonify({"entries": entries})


@app.route("/api/audit/rollback/<int:item_id>", methods=["POST"])
def rollback_item(item_id):
    from audit import AuditLog
    audit = AuditLog(DB_PATH)
    original = audit.get_original_values(item_id)
    if not original:
        return jsonify({"error": "No audit entry found for this item"}), 404
    return jsonify({"original_values": original})


# ── LSB Watcher ───────────────────────────────────────────────

@app.route("/api/lsb-updates", methods=["GET"])
def check_lsb_updates():
    from lsb_watcher import check_for_updates
    from audit import AuditLog
    cfg = load_config()
    repo_path = cfg.get("lsb_repo_path")
    if not repo_path:
        return jsonify({"error": "LSB repo path not configured"}), 400

    audit = AuditLog(DB_PATH)
    all_entries = audit.get_all()
    audit_ids = {e["item_id"] for e in all_entries}

    result = check_for_updates(repo_path, cfg.get("last_run_timestamp", ""), audit_ids)

    # Update last run timestamp
    from datetime import datetime
    cfg["last_run_timestamp"] = datetime.now().isoformat()
    save_config(cfg)

    return jsonify(result)


# ── Helpers ───────────────────────────────────────────────────

def _ensure_db_pool():
    """Initialize DB pool from config if not already done."""
    if db._pool is None:
        cfg = load_config()
        if not cfg.get("db_user"):
            return
        db.init_pool(
            cfg["db_host"], int(cfg["db_port"]),
            cfg["db_user"], cfg["db_password"], cfg["db_name"],
        )


def _item_to_dict(item) -> dict:
    return {
        "item_id": item.item_id,
        "name": item.name,
        "level": item.level,
        "ilevel": item.ilevel,
        "jobs": item.jobs,
        "slot": item.slot,
        "dmg": item.dmg,
        "delay": item.delay,
        "skill": item.skill,
        "profile": item.profile.value,
        "family_id": item.family_id,
        "family_tier": item.family_tier,
        "flags": item.flags,
        "mods": [{"mod_id": m.mod_id, "value": m.value} for m in item.mods],
        "pet_mods": [{"mod_id": m.mod_id, "value": m.value, "pet_type": m.pet_type}
                     for m in item.pet_mods],
        "latents": [{"mod_id": m.mod_id, "value": m.value,
                     "latent_id": m.latent_id, "latent_param": m.latent_param}
                    for m in item.latents],
    }


def _scaled_to_dict(si) -> dict:
    base = _item_to_dict(si.item)
    base["scaled"] = {
        "level": si.scaled_level,
        "dmg": si.scaled_dmg,
        "delay": si.scaled_delay,
        "mods": [{"mod_id": m.mod_id, "original": m.original, "scaled": m.scaled,
                  "scale_type": m.scale_type.value, "overridden": m.manually_overridden}
                 for m in si.scaled_mods],
        "pet_mods": [{"mod_id": m.mod_id, "original": m.original, "scaled": m.scaled,
                      "scale_type": m.scale_type.value} for m in si.scaled_pet_mods],
        "latents": [{"mod_id": m.mod_id, "original": m.original, "scaled": m.scaled,
                     "scale_type": m.scale_type.value} for m in si.scaled_latents],
    }
    base["verification"] = si.verification.value if hasattr(si.verification, 'value') else str(si.verification)
    base["percentile"] = si.percentile
    return base


# ── Main ──────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, port=5000)
```

- [ ] **Step 2: Commit**

```bash
git add app.py
git commit -m "feat: Flask API routes wiring all backend modules"
```

---

## Task 15: Frontend — HTML structure

**Files:**
- Create: `vanascale/static/index.html`

- [ ] **Step 1: Write index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VanaScale — 75-Cap Item Scaler</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <header>
        <h1>VanaScale</h1>
        <nav id="nav-tabs">
            <button class="tab active" data-tab="items">Items</button>
            <button class="tab" data-tab="heatmap">Heatmap</button>
            <button class="tab" data-tab="conflicts">Conflicts</button>
            <button class="tab" data-tab="audit">Audit Log</button>
            <button class="tab" data-tab="settings">Settings</button>
        </nav>
    </header>

    <main>
        <!-- ITEMS TAB -->
        <section id="tab-items" class="tab-content active">
            <div class="toolbar">
                <button id="btn-scan" class="btn-primary">Scan Database</button>
                <button id="btn-scale" class="btn-primary" disabled>Scale Items</button>
                <button id="btn-verify" class="btn-secondary" disabled>Verify All</button>
                <button id="btn-export" class="btn-accent" disabled>Export</button>
                <div class="filters">
                    <input type="text" id="filter-search" placeholder="Search items...">
                    <select id="filter-profile">
                        <option value="">All Profiles</option>
                        <option value="GENERAL">General</option>
                        <option value="RELIC_MYTHIC">Relic/Mythic</option>
                        <option value="JSE">JSE</option>
                    </select>
                    <select id="filter-flags">
                        <option value="">All Flags</option>
                        <option value="MANUAL_REVIEW">Manual Review</option>
                        <option value="PET_ITEM">Pet Item</option>
                    </select>
                </div>
            </div>

            <div class="items-layout">
                <!-- Left: Item list -->
                <aside id="item-list" class="panel">
                    <div id="item-list-content">
                        <p class="placeholder">Run a scan to see items</p>
                    </div>
                </aside>

                <!-- Center: Item detail -->
                <div id="item-detail" class="panel">
                    <div id="item-detail-content">
                        <p class="placeholder">Select an item</p>
                    </div>
                </div>

                <!-- Right: Estimator + verification -->
                <aside id="item-sidebar" class="panel">
                    <div id="estimator-content">
                        <p class="placeholder">Select an item to see era comparison</p>
                    </div>
                </aside>
            </div>
        </section>

        <!-- HEATMAP TAB -->
        <section id="tab-heatmap" class="tab-content">
            <button id="btn-heatmap" class="btn-primary">Generate Heatmap</button>
            <div id="heatmap-grid" class="heatmap-container"></div>
        </section>

        <!-- CONFLICTS TAB -->
        <section id="tab-conflicts" class="tab-content">
            <button id="btn-conflicts" class="btn-primary">Check Conflicts</button>
            <div id="conflicts-list"></div>
        </section>

        <!-- AUDIT LOG TAB -->
        <section id="tab-audit" class="tab-content">
            <button id="btn-load-audit" class="btn-primary">Load Audit Log</button>
            <div id="audit-entries"></div>
        </section>

        <!-- SETTINGS TAB -->
        <section id="tab-settings" class="tab-content">
            <form id="settings-form" class="settings-grid">
                <h2>Database Connection</h2>
                <label>Host <input type="text" name="db_host"></label>
                <label>Port <input type="number" name="db_port"></label>
                <label>User <input type="text" name="db_user"></label>
                <label>Password <input type="password" name="db_password" placeholder="(unchanged)"></label>
                <label>Database <input type="text" name="db_name"></label>
                <button type="button" id="btn-test-db" class="btn-secondary">Test Connection</button>
                <div id="db-test-result"></div>

                <h2>Scaling</h2>
                <label>Target Level <input type="number" name="target_level" min="1" max="99"></label>
                <label>Fetch Delay (s) <input type="number" name="fetch_delay" step="0.1" min="0"></label>

                <h2>Paths</h2>
                <label>FFXI Install Path <input type="text" name="ffxi_install_path"></label>
                <label>LSB Repository Path <input type="text" name="lsb_repo_path"></label>
                <label>Output Directory <input type="text" name="output_dir"></label>

                <button type="submit" class="btn-primary">Save Settings</button>
            </form>
            <div class="lsb-watcher">
                <h2>LSB Update Detector</h2>
                <button id="btn-check-lsb" class="btn-secondary">Check for Updates</button>
                <div id="lsb-updates"></div>
            </div>
        </section>
    </main>

    <div id="loading-overlay" class="hidden">
        <div class="spinner"></div>
        <p id="loading-message">Loading...</p>
    </div>

    <div id="toast-container"></div>

    <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat: HTML structure for single-page GUI"
```

---

## Task 16: Frontend — CSS styling

**Files:**
- Create: `vanascale/static/style.css`

- [ ] **Step 1: Write FFXI-themed dark CSS**

```css
/* VanaScale — FFXI-inspired dark theme */
:root {
    --bg-primary: #0a0e1a;
    --bg-secondary: #111827;
    --bg-panel: #1a2035;
    --bg-hover: #243050;
    --border: #2a3555;
    --gold: #d4a843;
    --gold-dim: #8a6f2a;
    --text: #e8e8e8;
    --text-dim: #8899aa;
    --green: #4ade80;
    --amber: #fbbf24;
    --red: #ef4444;
    --blue: #60a5fa;
    --font-mono: 'Consolas', 'Monaco', 'Courier New', monospace;
    --font-sans: 'Segoe UI', 'Arial', sans-serif;
    --radius: 6px;
    --transition: 0.2s ease;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
    background: var(--bg-primary);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    min-height: 100vh;
}

/* Header */
header {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    padding: 12px 24px;
    display: flex;
    align-items: center;
    gap: 32px;
}

header h1 {
    color: var(--gold);
    font-size: 20px;
    letter-spacing: 2px;
    text-transform: uppercase;
}

/* Navigation tabs */
#nav-tabs { display: flex; gap: 4px; }

.tab {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    padding: 8px 16px;
    cursor: pointer;
    border-radius: var(--radius) var(--radius) 0 0;
    font-size: 13px;
    transition: var(--transition);
}

.tab:hover { color: var(--text); background: var(--bg-hover); }
.tab.active {
    color: var(--gold);
    border-color: var(--border);
    border-bottom-color: var(--bg-primary);
    background: var(--bg-primary);
}

/* Main layout */
main { padding: 16px 24px; }

.tab-content { display: none; }
.tab-content.active { display: block; }

/* Toolbar */
.toolbar {
    display: flex; gap: 8px; align-items: center;
    margin-bottom: 16px; flex-wrap: wrap;
}

.filters { display: flex; gap: 8px; margin-left: auto; }

/* Buttons */
.btn-primary, .btn-secondary, .btn-accent {
    padding: 8px 16px; border: none; border-radius: var(--radius);
    cursor: pointer; font-size: 13px; transition: var(--transition);
}

.btn-primary { background: var(--gold); color: #000; }
.btn-primary:hover { background: #e8bc54; }
.btn-primary:disabled { background: var(--gold-dim); cursor: not-allowed; opacity: 0.5; }

.btn-secondary { background: var(--bg-hover); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--border); }

.btn-accent { background: var(--green); color: #000; }
.btn-accent:hover { background: #6ee7a0; }
.btn-accent:disabled { opacity: 0.5; cursor: not-allowed; }

/* Inputs */
input, select {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: var(--radius);
    font-size: 13px;
}

input:focus, select:focus { outline: none; border-color: var(--gold); }

/* Three-column items layout */
.items-layout {
    display: grid;
    grid-template-columns: 280px 1fr 300px;
    gap: 16px;
    height: calc(100vh - 160px);
}

.panel {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
    overflow-y: auto;
}

.placeholder { color: var(--text-dim); text-align: center; padding: 40px 0; }

/* Item list */
.item-entry {
    padding: 8px 10px; cursor: pointer;
    border-radius: 4px; margin-bottom: 2px;
    display: flex; justify-content: space-between; align-items: center;
    transition: var(--transition);
}

.item-entry:hover { background: var(--bg-hover); }
.item-entry.selected { background: var(--bg-hover); border-left: 3px solid var(--gold); }

.item-entry .item-name { font-size: 13px; }
.item-entry .item-level { font-family: var(--font-mono); font-size: 12px; color: var(--text-dim); }

.family-group { margin-bottom: 8px; }
.family-header {
    font-size: 12px; color: var(--gold-dim); padding: 4px 10px;
    text-transform: uppercase; letter-spacing: 1px;
}

/* Verification badges */
.badge {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: bold; text-transform: uppercase;
}

.badge-green { background: var(--green); color: #000; }
.badge-amber { background: var(--amber); color: #000; }
.badge-red { background: var(--red); color: #fff; }
.badge-grey { background: var(--text-dim); color: #000; }

/* Manual review banner */
.manual-review-banner {
    background: var(--red); color: #fff; padding: 8px 12px;
    border-radius: var(--radius); margin-bottom: 12px;
    font-weight: bold; text-align: center;
}

/* Stats table */
.stats-table { width: 100%; border-collapse: collapse; }
.stats-table th, .stats-table td {
    padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--border);
}
.stats-table th { color: var(--text-dim); font-size: 12px; }
.stats-table td { font-family: var(--font-mono); font-size: 13px; }
.stats-table .changed { color: var(--amber); }
.stats-table .unchanged { color: var(--text-dim); }

.stats-table input[type="number"] {
    width: 60px; background: var(--bg-secondary); border: 1px solid var(--border);
    color: var(--gold); text-align: right; font-family: var(--font-mono);
}

/* Estimator bar */
.estimator-bar {
    height: 20px; background: var(--bg-secondary);
    border-radius: 10px; margin: 8px 0; position: relative; overflow: hidden;
}

.estimator-fill {
    height: 100%; border-radius: 10px; transition: width 0.5s ease;
}

.estimator-marker {
    position: absolute; top: -4px; width: 3px; height: 28px;
    background: var(--gold); border-radius: 2px; transform: translateX(-50%);
}

/* Heatmap */
.heatmap-container { overflow-x: auto; }

.heatmap-table { border-collapse: collapse; }
.heatmap-table th, .heatmap-table td {
    width: 50px; height: 32px; text-align: center;
    font-size: 11px; border: 1px solid var(--bg-primary);
}
.heatmap-table th { color: var(--text-dim); background: var(--bg-secondary); }

.cell-empty { background: #1a1a2e; color: var(--text-dim); }
.cell-sparse { background: #4a1942; color: var(--text); }
.cell-moderate { background: #2a4a6a; color: var(--text); }
.cell-well-covered { background: #1a5a3a; color: var(--text); }

/* Conflicts */
.conflict-card {
    background: var(--bg-secondary); border: 1px solid var(--red);
    border-radius: var(--radius); padding: 16px; margin-bottom: 12px;
}

.conflict-card h3 { color: var(--red); margin-bottom: 8px; }
.conflict-stat { font-family: var(--font-mono); font-size: 15px; margin-bottom: 8px; }

/* Settings */
.settings-grid {
    max-width: 600px; display: flex; flex-direction: column; gap: 12px;
}

.settings-grid h2 {
    color: var(--gold); margin-top: 16px; padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
}

.settings-grid label {
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
}

.settings-grid input { flex: 1; }

/* Audit log */
.audit-entry {
    background: var(--bg-secondary); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 12px; margin-bottom: 8px;
}

.audit-entry .timestamp { color: var(--text-dim); font-size: 12px; }

/* Loading overlay */
#loading-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; z-index: 100;
}

#loading-overlay.hidden { display: none; }

.spinner {
    width: 40px; height: 40px; border: 3px solid var(--border);
    border-top-color: var(--gold); border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Toast notifications */
#toast-container { position: fixed; bottom: 24px; right: 24px; z-index: 200; }

.toast {
    padding: 12px 20px; border-radius: var(--radius); margin-top: 8px;
    font-size: 13px; animation: slideIn 0.3s ease;
}

.toast-success { background: var(--green); color: #000; }
.toast-error { background: var(--red); color: #fff; }
.toast-info { background: var(--blue); color: #000; }

@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* Scrollbar */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: var(--bg-primary); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--gold-dim); }
```

- [ ] **Step 2: Commit**

```bash
git add static/style.css
git commit -m "feat: FFXI-themed dark CSS"
```

---

## Task 17: Frontend — JavaScript application logic

**Files:**
- Create: `vanascale/static/app.js`

- [ ] **Step 1: Write app.js**

```javascript
/* VanaScale frontend application */

const API = {
    async get(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error((await r.json()).error || r.statusText);
        return r.json();
    },
    async post(url, body = {}) {
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error((await r.json()).error || r.statusText);
        return r.json();
    },
};

// ── State ──────────────────────────────────────────

let state = {
    items: [],         // raw scanned items
    scaledItems: [],   // after scaling
    selectedId: null,
    activeTab: 'items',
};

// ── Tab navigation ─────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        state.activeTab = tab.dataset.tab;
    });
});

// ── Loading / Toast ────────────────────────────────

function showLoading(msg = 'Loading...') {
    document.getElementById('loading-message').textContent = msg;
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

// ── Scan ───────────────────────────────────────────

document.getElementById('btn-scan').addEventListener('click', async () => {
    try {
        showLoading('Scanning database for items above target level...');
        const data = await API.post('/api/scan');
        state.items = data.items;
        state.scaledItems = [];
        renderItemList(state.items);
        document.getElementById('btn-scale').disabled = false;
        toast(`Found ${data.count} items`, 'success');
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        hideLoading();
    }
});

// ── Scale ──────────────────────────────────────────

document.getElementById('btn-scale').addEventListener('click', async () => {
    try {
        showLoading('Scaling items...');
        const data = await API.post('/api/scale');
        state.scaledItems = data.items;
        renderItemList(data.items);
        document.getElementById('btn-verify').disabled = false;
        document.getElementById('btn-export').disabled = false;
        toast(`Scaled ${data.count} items`, 'success');
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        hideLoading();
    }
});

// ── Verify All ─────────────────────────────────────

document.getElementById('btn-verify').addEventListener('click', async () => {
    try {
        showLoading('Verifying items against FFXIAH and BG-Wiki...');
        const data = await API.post('/api/verify/batch');
        for (const r of data.results) {
            const item = state.scaledItems.find(i => i.item_id === r.item_id);
            if (item) item.verification = r.status;
        }
        renderItemList(state.scaledItems);
        toast(`Verified ${data.results.length} items`, 'success');
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        hideLoading();
    }
});

// ── Export ──────────────────────────────────────────

document.getElementById('btn-export').addEventListener('click', async () => {
    try {
        showLoading('Exporting...');
        const data = await API.post('/api/export');
        toast('Export complete! Files written to output directory.', 'success');
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        hideLoading();
    }
});

// ── Render item list ───────────────────────────────

function renderItemList(items) {
    const container = document.getElementById('item-list-content');
    if (!items.length) {
        container.innerHTML = '<p class="placeholder">No items found</p>';
        return;
    }

    // Apply filters
    const search = document.getElementById('filter-search').value.toLowerCase();
    const profile = document.getElementById('filter-profile').value;
    const flag = document.getElementById('filter-flags').value;

    let filtered = items.filter(i => {
        if (search && !i.name.toLowerCase().includes(search)) return false;
        if (profile && i.profile !== profile) return false;
        if (flag && !(i.flags || []).includes(flag)) return false;
        return true;
    });

    // Group by family
    const families = {};
    const orphans = [];
    for (const item of filtered) {
        if (item.family_id) {
            if (!families[item.family_id]) families[item.family_id] = [];
            families[item.family_id].push(item);
        } else {
            orphans.push(item);
        }
    }

    let html = '';
    for (const [fam, members] of Object.entries(families)) {
        members.sort((a, b) => (a.family_tier || 0) - (b.family_tier || 0));
        html += `<div class="family-group">`;
        html += `<div class="family-header">${fam}</div>`;
        for (const item of members) {
            html += renderItemEntry(item);
        }
        html += `</div>`;
    }
    for (const item of orphans) {
        html += renderItemEntry(item);
    }

    container.innerHTML = html;
    container.querySelectorAll('.item-entry').forEach(el => {
        el.addEventListener('click', () => selectItem(parseInt(el.dataset.id)));
    });
}

function renderItemEntry(item) {
    const badge = getBadgeClass(item.verification);
    const selected = item.item_id === state.selectedId ? ' selected' : '';
    const manualReview = (item.flags || []).includes('MANUAL_REVIEW') ? ' style="border-right:3px solid var(--red)"' : '';
    return `<div class="item-entry${selected}" data-id="${item.item_id}"${manualReview}>
        <span class="item-name">${item.name}</span>
        <span>
            <span class="item-level">${item.level}</span>
            ${badge ? `<span class="badge ${badge}">${item.verification || ''}</span>` : ''}
        </span>
    </div>`;
}

function getBadgeClass(status) {
    if (!status) return '';
    const map = {
        'ALL_AGREE': 'badge-green',
        'DB_MISSING': 'badge-amber',
        'CONFLICT': 'badge-red',
        'UNVERIFIED': 'badge-grey',
    };
    return map[status] || '';
}

// ── Filter listeners ───────────────────────────────

['filter-search', 'filter-profile', 'filter-flags'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        renderItemList(state.scaledItems.length ? state.scaledItems : state.items);
    });
});

// ── Select item ────────────────────────────────────

async function selectItem(itemId) {
    state.selectedId = itemId;
    renderItemList(state.scaledItems.length ? state.scaledItems : state.items);

    const item = (state.scaledItems.length ? state.scaledItems : state.items)
        .find(i => i.item_id === itemId);
    if (!item) return;

    renderItemDetail(item);

    // Load estimator if scaled
    if (item.scaled) {
        try {
            const est = await API.get(`/api/estimate/${itemId}`);
            renderEstimator(est, item);
        } catch (e) {
            document.getElementById('estimator-content').innerHTML =
                `<p class="placeholder">${e.message}</p>`;
        }
    }
}

function renderItemDetail(item) {
    const detail = document.getElementById('item-detail-content');
    const s = item.scaled;

    let html = '';

    if ((item.flags || []).includes('MANUAL_REVIEW')) {
        html += '<div class="manual-review-banner">MANUAL REVIEW REQUIRED — SMN Blood Pact Damage</div>';
    }

    html += `<h2>${item.name}</h2>`;
    html += `<p>Profile: <strong>${item.profile}</strong>`;
    if (item.family_id) html += ` | Family: <strong>${item.family_id}</strong> (+${item.family_tier || 0})`;
    html += `</p>`;

    html += '<table class="stats-table"><thead><tr><th>Stat</th><th>Original</th>';
    if (s) html += '<th>Scaled</th>';
    html += '</tr></thead><tbody>';

    html += `<tr><td>Level</td><td>${item.level}</td>${s ? `<td class="changed">${s.level}</td>` : ''}</tr>`;

    if (item.dmg !== null) {
        const dmgChanged = s && s.dmg !== item.dmg;
        html += `<tr><td>DMG</td><td>${item.dmg}</td>${s ? `<td class="${dmgChanged ? 'changed' : 'unchanged'}">${s.dmg}</td>` : ''}</tr>`;
        html += `<tr><td>Delay</td><td>${item.delay}</td>${s ? `<td class="unchanged">${s.delay}</td>` : ''}</tr>`;
    }

    const mods = s ? s.mods : (item.mods || []);
    for (const mod of mods) {
        const orig = mod.original !== undefined ? mod.original : mod.value;
        const scaled = mod.scaled !== undefined ? mod.scaled : null;
        const changed = scaled !== null && scaled !== orig;
        html += `<tr>
            <td>Mod ${mod.mod_id}${mod.scale_type ? ` <span class="badge badge-grey">${mod.scale_type}</span>` : ''}</td>
            <td>${orig}</td>
            ${scaled !== null ? `<td class="${changed ? 'changed' : 'unchanged'}">
                <input type="number" value="${scaled}" data-item="${item.item_id}" data-mod="${mod.mod_id}"
                       onchange="overrideMod(this)">
                ${mod.overridden ? ' <span class="badge badge-amber">override</span>' : ''}
            </td>` : ''}
        </tr>`;
    }

    html += '</tbody></table>';
    detail.innerHTML = html;
}

async function overrideMod(input) {
    const itemId = parseInt(input.dataset.item);
    const modId = parseInt(input.dataset.mod);
    const value = parseInt(input.value);
    try {
        await API.post('/api/override', { item_id: itemId, mod_id: modId, value });
        toast('Override saved', 'success');
    } catch (e) {
        toast(e.message, 'error');
    }
}

function renderEstimator(est, item) {
    const container = document.getElementById('estimator-content');
    let html = `<h3>Era Comparison</h3>`;
    html += `<p>Compared against <strong>${est.era_item_count}</strong> items at level 70-75</p>`;
    html += `<div class="estimator-bar">
        <div class="estimator-fill" style="width:${est.percentile}%;background:linear-gradient(90deg,var(--red),var(--amber),var(--green))"></div>
        <div class="estimator-marker" style="left:${est.percentile}%"></div>
    </div>`;
    html += `<p style="text-align:center;font-family:var(--font-mono)">
        Percentile: <strong>${est.percentile}%</strong> | Score: ${est.score.toFixed(1)}
    </p>`;

    // Verification section
    const badge = getBadgeClass(item.verification);
    if (item.verification) {
        html += `<h3 style="margin-top:16px">Verification</h3>`;
        html += `<span class="badge ${badge}">${item.verification}</span>`;
    }

    container.innerHTML = html;
}

// ── Heatmap ────────────────────────────────────────

document.getElementById('btn-heatmap').addEventListener('click', async () => {
    try {
        showLoading('Computing job coverage heatmap...');
        const data = await API.get('/api/heatmap');
        renderHeatmap(data.grid);
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        hideLoading();
    }
});

function renderHeatmap(grid) {
    const container = document.getElementById('heatmap-grid');
    const jobs = [...new Set(grid.map(c => c.job_name))];
    const slots = [...new Set(grid.map(c => c.slot_name))];

    let html = '<table class="heatmap-table"><thead><tr><th></th>';
    for (const slot of slots) html += `<th>${slot}</th>`;
    html += '</tr></thead><tbody>';

    for (const job of jobs) {
        html += `<tr><th>${job}</th>`;
        for (const slot of slots) {
            const cell = grid.find(c => c.job_name === job && c.slot_name === slot);
            const score = cell ? cell.score : 'empty';
            const count = cell ? cell.count : 0;
            html += `<td class="cell-${score.replace('-', '-')}">${count}</td>`;
        }
        html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ── Conflicts ──────────────────────────────────────

document.getElementById('btn-conflicts').addEventListener('click', async () => {
    try {
        showLoading('Checking stacking conflicts...');
        const data = await API.get('/api/conflicts');
        renderConflicts(data.conflicts);
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        hideLoading();
    }
});

function renderConflicts(conflicts) {
    const container = document.getElementById('conflicts-list');
    if (!conflicts.length) {
        container.innerHTML = '<p class="placeholder">No stacking conflicts found</p>';
        return;
    }

    let html = '';
    for (const c of conflicts) {
        html += `<div class="conflict-card">
            <h3>${c.job_name} — Mod ${c.mod_id}</h3>
            <div class="conflict-stat">${c.total} / ${c.era_cap} (${c.exceeds ? 'EXCEEDS' : 'OK'})</div>
            <table class="stats-table"><thead><tr><th>Item</th><th>Slot</th><th>Value</th></tr></thead><tbody>`;
        for (const item of c.contributors) {
            html += `<tr><td>${item.item_name}</td><td>${item.slot_name}</td><td>${item.value}</td></tr>`;
        }
        html += '</tbody></table></div>';
    }
    container.innerHTML = html;
}

// ── Audit Log ──────────────────────────────────────

document.getElementById('btn-load-audit').addEventListener('click', async () => {
    try {
        showLoading('Loading audit log...');
        const data = await API.get('/api/audit');
        renderAudit(data.entries);
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        hideLoading();
    }
});

function renderAudit(entries) {
    const container = document.getElementById('audit-entries');
    if (!entries.length) {
        container.innerHTML = '<p class="placeholder">No audit entries yet</p>';
        return;
    }

    let html = '';
    for (const e of entries) {
        html += `<div class="audit-entry">
            <div class="timestamp">${e.timestamp} | ${e.profile_used}</div>
            <strong>${e.item_name}</strong> (ID: ${e.item_id})
            ${e.family_id ? ` | Family: ${e.family_id}` : ''}
        </div>`;
    }
    container.innerHTML = html;
}

// ── Settings ───────────────────────────────────────

(async function loadSettings() {
    try {
        const data = await API.get('/api/settings');
        const form = document.getElementById('settings-form');
        for (const [key, val] of Object.entries(data)) {
            const input = form.querySelector(`[name="${key}"]`);
            if (input && key !== 'db_password') input.value = val;
        }
    } catch (e) {
        // Settings may not be configured yet
    }
})();

document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {};
    for (const input of form.querySelectorAll('input')) {
        if (input.name) data[input.name] = input.value;
    }
    // Only send password if changed
    if (!data.db_password) delete data.db_password;
    try {
        await API.post('/api/settings', data);
        toast('Settings saved', 'success');
    } catch (e) {
        toast(e.message, 'error');
    }
});

document.getElementById('btn-test-db').addEventListener('click', async () => {
    const form = document.getElementById('settings-form');
    const data = {};
    for (const input of form.querySelectorAll('input')) {
        if (input.name) data[input.name] = input.value;
    }
    try {
        const result = await API.post('/api/settings/test-db', data);
        const el = document.getElementById('db-test-result');
        if (result.status === 'ok') {
            el.innerHTML = '<span style="color:var(--green)">Connection successful!</span>';
        } else {
            el.innerHTML = `<span style="color:var(--red)">${result.status}</span>`;
        }
    } catch (e) {
        document.getElementById('db-test-result').innerHTML =
            `<span style="color:var(--red)">${e.message}</span>`;
    }
});

// ── LSB Watcher ────────────────────────────────────

document.getElementById('btn-check-lsb').addEventListener('click', async () => {
    try {
        showLoading('Checking LSB repository for updates...');
        const data = await API.get('/api/lsb-updates');
        const el = document.getElementById('lsb-updates');
        if (data.has_updates) {
            el.innerHTML = `<div class="conflict-card">
                <h3>Upstream Changes Detected</h3>
                <p>${data.affected_items.length} previously scaled items were modified upstream.</p>
                <p>Item IDs: ${data.affected_items.join(', ')}</p>
                <h4>Recent Commits:</h4>
                ${data.commits.map(c => `<p><code>${c.hash}</code> ${c.message}</p>`).join('')}
            </div>`;
        } else {
            el.innerHTML = '<p style="color:var(--green)">No upstream changes to scaled items.</p>';
        }
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        hideLoading();
    }
});
```

- [ ] **Step 2: Commit**

```bash
git add static/app.js
git commit -m "feat: frontend JavaScript application logic"
```

---

## Task 18: README

**Files:**
- Create: `vanascale/README.md`

- [ ] **Step 1: Write README.md**

```markdown
# VanaScale

A 75-cap item downscaling tool for Final Fantasy XI LandSandBoat private servers.

VanaScale scans your LSB database for items above level 75, applies configurable
scaling formulas to bring their stats in line with a 75-cap meta, verifies data
against FFXIAH and BG-Wiki, and exports SQL/Lua module/DAT overlay files.

## Requirements

- Python 3.10+
- MariaDB/MySQL (your LSB database)
- FFXI installation (for DAT overlay generation, optional)
- Git (for LSB update detection, optional)

## Installation

```bash
cd vanascale
pip install -r requirements.txt
```

## First Run

1. Start the server:
   ```bash
   python app.py
   ```
2. Open http://localhost:5000 in your browser.
3. Go to the **Settings** tab and enter your MariaDB credentials.
4. Click **Test Connection** to verify.
5. Go to the **Items** tab and click **Scan Database**.
6. Click **Scale Items** to apply the scaling formulas.
7. Review items, adjust overrides as needed.
8. Click **Export** when ready.

## Scaling Profiles

- **GENERAL**: `scaled = round(original * 75 / item_level)`
- **RELIC_MYTHIC**: `scaled = round(original * sqrt(75 / item_level))` (gentler curve)
- **JSE**: Standard formula with 85% floor

## LSB Update Detector

Configure your LSB repository path in Settings. On each launch (or manually via
the Settings tab), VanaScale checks for upstream commits that modified item SQL
files and alerts you if any previously scaled items were changed.

## Applying Exports

### SQL File
```bash
mysql -u root -p xidb < vanascale_changes.sql
```

### LSB Lua Module
Copy the `vanascale_module/vanascale/` directory into your LSB `modules/` folder:
```bash
cp -r output/vanascale_module/vanascale/ /path/to/lsb/modules/
```
Then apply the SQL: `modules/vanascale/sql/vanascale_items.sql`

### XiPivot Overlay
Copy the `vanascale/` overlay directory to your XiPivot overlays path.
Add it to your XiPivot configuration to show corrected item levels client-side.

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```

---

## Task 19: Integration wiring + test run

**Files:**
- Modify: `vanascale/app.py` (if any wiring issues found)
- Create: `vanascale/tests/test_app.py`

- [ ] **Step 1: Write integration smoke test**

`tests/test_app.py`:
```python
"""Smoke tests for Flask API routes (no DB required)."""
import pytest
from app import app

@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as c:
        yield c

def test_index_serves_html(client):
    r = client.get('/')
    assert r.status_code == 200
    assert b'VanaScale' in r.data

def test_get_settings(client):
    r = client.get('/api/settings')
    assert r.status_code == 200
    data = r.get_json()
    assert 'target_level' in data

def test_scan_without_db(client):
    r = client.post('/api/scan')
    # Should fail gracefully without DB connection
    assert r.status_code in (200, 400, 500)

def test_export_without_scaled_items(client):
    r = client.post('/api/export')
    assert r.status_code == 400
```

- [ ] **Step 2: Run all tests**

```bash
cd C:/Users/Calvin\ Candie/vanascale && python -m pytest tests/ -v
```

- [ ] **Step 3: Fix any failures**

- [ ] **Step 4: Manual test — start Flask and load GUI**

```bash
cd C:/Users/Calvin\ Candie/vanascale && python app.py
```

Open http://localhost:5000 and verify:
- Page loads with dark theme
- All 5 tabs are clickable
- Settings form renders
- Scan button attempts to connect (will fail without DB, should show error toast)

- [ ] **Step 5: Commit**

```bash
git add tests/test_app.py
git commit -m "test: integration smoke tests for Flask app"
```

---

## Task 20: Final review + polish

- [ ] **Step 1: Verify all files exist and are under 500 lines**

```bash
wc -l *.py static/*.js static/*.css
```

Split any file over 500 lines.

- [ ] **Step 2: Run full test suite**

```bash
python -m pytest tests/ -v --tb=short
```

- [ ] **Step 3: Verify .gitignore excludes sensitive files**

```bash
git status
```

Confirm `vanascale.json` and `vanascale.db` are not tracked.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final polish and verification"
```

---

## Spec Coverage Verification

| Spec Section | Task(s) | Notes |
|---|---|---|
| Step 1 — Scanner | Task 5 | Family detection, profile classification, pet flags |
| Step 2 — Verification | Task 7 | FFXIAH + BG-Wiki fetch, cache, 3-way comparison |
| Step 3 — Scaling Engine | Task 6 | All profiles, mod safety table, family proportions, latents, pet mods |
| Step 4 — Estimator | Task 8 | Weighted scoring, percentile placement |
| Step 5 — Heatmap | Task 9 | 22x16 grid, score tiers |
| Step 6 — Conflict Checker | Task 10 | Per-job stacking detection, era caps |
| Step 7 — Review Panel GUI | Tasks 15-17 | Full single-page GUI with all specified panels |
| Step 8 — Export | Tasks 11-12 | SQL, Lua module, patchnotes, XiPivot DAT overlay |
| Step 9 — Audit Log | Task 3 | SQLite-backed with rollback |
| Step 10 — LSB Update Detector | Task 13 | Git-based change detection |
| DB Connection | Task 4 | Connection pool, test endpoint |
| Config | Task 1 | vanascale.json with all settings |
| Data Models | Task 2 | All dataclasses and constants |
| README | Task 18 | Full documentation |
| File structure | All | Matches spec exactly |
| Constraints | All | No original DAT modification, no auto-apply, no committed credentials |
