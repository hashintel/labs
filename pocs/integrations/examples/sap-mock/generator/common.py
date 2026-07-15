"""Shared runtime for the synthetic SAP generator.

Vendored-and-ported from hashintel/SAP_Mock_Data (the two generation notebooks,
Databricks/pyspark shell replaced with pandas + deltalake). The scenario
injection, dirty-data, and smoke-test stages of the upstream repo are not
ported; pull them from upstream if ever needed.
"""
import os
import random
from pathlib import Path

import numpy as np
import pandas as pd
from deltalake import DeltaTable, write_deltalake
from faker import Faker

# Notebook widget defaults, verbatim. SCALE_FACTOR multiplies the volume knobs
# linearly (TPC-style); an explicit env var always wins over the scaled value.
DEFAULTS = {
    "RANDOM_SEED": "42",
    "NUM_CUSTOMERS": "30",
    "NUM_FINISHED_GOODS": "40",
    "NUM_RAW_MATERIALS": "30",
    "MOQ_FINISHED_MIN": "250",
    "MOQ_FINISHED_MAX": "1000",
    "MOQ_RAW_MIN": "1000",
    "MOQ_RAW_MAX": "10000",
    "NUM_ORDERS": "5000",
    "HUB_PLANT": "1000",
    "DELIVERY_FILL_RATE": "0.8",
    "SAFETY_STOCK_WEEKS": "6",
    "SUPPLIER_RELIABILITY_RATE": "1.0",
    "UNRELIABLE_MATERIALS": "",
}

SCALED_KNOBS = {"NUM_ORDERS", "NUM_CUSTOMERS", "NUM_FINISHED_GOODS", "NUM_RAW_MATERIALS"}


def param(name):
    if name in os.environ:
        return os.environ[name]
    default = DEFAULTS[name]
    sf = float(os.environ.get("SCALE_FACTOR", "1"))
    if name in SCALED_KNOBS and sf != 1:
        return str(max(1, round(int(default) * sf)))
    return default


def widget(name, default):
    """A notebook widget with no scaling semantics: env var or its notebook default."""
    return os.environ.get(name, default)


def seed_all(seed):
    """Reset every RNG the generators draw from; called at the top of each stage
    exactly like the notebooks re-seed per notebook (byte-identity depends on it)."""
    Faker.seed(seed)
    random.seed(seed)
    np.random.seed(seed)


class Warehouse:
    """One Delta directory per table, the layout sap-mock.yaml's delta_scan reads."""

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, name):
        return self.root / name.lower()

    def save(self, name, pdf, mode="overwrite"):
        # Uppercase columns, as the notebooks' save helpers do. Drop the pandas
        # index -- Spark's saveAsTable never writes it, and write_deltalake would
        # otherwise emit a phantom __index_level_0__ column for concat'd frames.
        pdf = pdf.rename(columns={c: c.upper() for c in pdf.columns}).reset_index(drop=True)
        write_deltalake(
            str(self._path(name)), pdf, mode=mode,
            schema_mode="overwrite" if mode == "overwrite" else None,
        )
        print(f"  saved {name} ({len(pdf)} rows)")

    def read(self, name):
        return DeltaTable(str(self._path(name))).to_pandas()

    def exists(self, name):
        return (self._path(name) / "_delta_log").exists()

    def tables(self):
        return sorted(p.name for p in self.root.iterdir() if (p / "_delta_log").exists())
