#!/usr/bin/env python3
"""Generate the synthetic SAP dataset as Delta tables (one directory per table).

usage: python generator/generate.py [warehouse-dir]     # default: ../.mock-warehouse

env knobs (all optional):
  SCALE_FACTOR=5      multiply the volume defaults linearly (orders, customers,
                      finished goods, raw materials); default 1
  NUM_ORDERS=500      set any single volume directly (also NUM_CUSTOMERS,
                      NUM_FINISHED_GOODS, NUM_RAW_MATERIALS); overrides SCALE_FACTOR
  RANDOM_SEED=7       default 42; same seed, same data
  SCENARIOS=demo      default: 11 curated disruption events. Also: none | all |
                      SCN003,SCN011 (explicit ids each need their SCNxxx_CONFIG)

Volume defaults at SCALE_FACTOR=1: 5000 orders, 30 customers, 40 finished
goods, 30 raw materials -> ~93k rows across 44 tables.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pyarrow as pa
from deltalake import write_deltalake

from common import Warehouse, param
import masterdata
import transactions

ALL_SCENARIOS = [f"SCN{i:03d}" for i in range(1, 27)]

# Upstream contract: a scenario injects only when BOTH its ENABLED toggle and its
# CONFIG string are set -- empty config is a silent skip (no defaults upstream).
# SCENARIOS=demo supplies this curated, generation-tested config set (valid on
# SF>=0.5 warehouses: FG MAT-A0001.., RM MAT-R0001.., plants 1000-4000, VEND-00xx).
DEMO_CONFIGS = {
    "SCN001": "MAT-A0008,1000,FG01,500",       # stock deviation: MATDOC 344 + MARD
    "SCN003": "2000,ALL,20250615,30",          # fire damage at plant 2000
    "SCN011": "MAT-A0005,1000,25,20250615",    # +25% demand increase
    "SCN012": "MAT-NEW01,1000,MAT-A0005",      # new product introduction
    "SCN014": "1000,95,30",                    # capacity saturation
    "SCN015": "1000,20250615,7,0.3",           # equipment failure
    "SCN016": "1000,MAT-A0005;MAT-A0008,30",   # competing production
    "SCN020": "40,30",                         # network demand volatility
    "SCN021": "VEND-0005,ALL,0.72,3",          # supplier OTIF drift
    "SCN023": "VEND-0008,MAT-R0010",           # regulatory review flag
    "SCN026": "VEND-0008,ALL,0.85,3",          # supplier recovery
}


def resolve_scenarios():
    """SCENARIOS=demo (default) | none | SCN001,SCN003 is sugar for the notebook's
    SCN*_ENABLED (and, for demo, SCN*_CONFIG) env vars."""
    sugar = os.environ.get("SCENARIOS", "demo").strip().lower()
    if sugar == "demo":
        for s, cfg in DEMO_CONFIGS.items():
            os.environ.setdefault(f"{s}_ENABLED", "true")
            os.environ.setdefault(f"{s}_CONFIG", cfg)
    elif sugar not in ("none", "off", ""):
        wanted = ALL_SCENARIOS if sugar == "all" else [s.strip().upper() for s in sugar.split(",")]
        unknown = [s for s in wanted if s not in ALL_SCENARIOS]
        if unknown:
            sys.exit(f"unknown scenario id(s): {', '.join(unknown)} (valid: SCN001..SCN026, demo, none)")
        for s in wanted:
            os.environ.setdefault(f"{s}_ENABLED", "true")

    enabled = [s for s in ALL_SCENARIOS if os.environ.get(f"{s}_ENABLED", "false").lower() == "true"]
    configless = [s for s in enabled if not os.environ.get(f"{s}_CONFIG", "").strip()]
    if configless:
        print(f"[generate] WARNING: enabled without SCN*_CONFIG (upstream skips these silently): "
              f"{', '.join(configless)} -- set configs or use SCENARIOS=demo")
    return enabled

# The consumption chain (BWART 261 movements -> RESB) never fires upstream:
# MARD only carries FG01 stock, so raw-material issues find nothing at RM01.
# Downstream pipelines read resb unconditionally; seed it empty and typed.
RESB_SCHEMA = pa.schema([
    ("MANDT", pa.string()), ("RSNUM", pa.string()), ("RSPOS", pa.string()),
    ("MATNR", pa.string()), ("BDMNG", pa.float64()), ("ENMNG", pa.float64()),
    ("WERKS", pa.string()), ("LGORT", pa.string()),
])


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        return
    root = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).resolve().parent.parent / ".mock-warehouse")
    wh = Warehouse(root)
    print(f"[generate] warehouse: {wh.root}")
    print(f"[generate] seed={param('RANDOM_SEED')} orders={param('NUM_ORDERS')} "
          f"customers={param('NUM_CUSTOMERS')} fg={param('NUM_FINISHED_GOODS')} rm={param('NUM_RAW_MATERIALS')}")

    masterdata.generate(wh)
    transactions.generate(wh)

    enabled = resolve_scenarios()
    if enabled:
        print(f"[generate] injecting scenarios: {', '.join(enabled)}")
        import scenario_config
        import scenarios
        scenario_config.generate(wh)
        scenarios.generate(wh)

    if not wh.exists("resb"):
        write_deltalake(str(wh.root / "resb"), pa.table({f.name: [] for f in RESB_SCHEMA}, schema=RESB_SCHEMA), mode="overwrite")
        print("  seeded empty resb (consumption chain is empty upstream)")

    tables = wh.tables()
    print(f"[generate] done: {len(tables)} delta tables")
    print("[generate] " + ", ".join(tables))


if __name__ == "__main__":
    main()
