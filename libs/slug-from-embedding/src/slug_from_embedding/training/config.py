"""Shared training infrastructure: types, paths, runtime, artifact helpers."""

from pathlib import Path
from typing import Literal

import duckdb
import numpy as np
import torch

from slug_from_embedding.config import DATA_DIR

type Split = Literal["train", "val", "test"]

MODELS_DIR = DATA_DIR / "models"
PREDICTIONS_DIR = DATA_DIR / "predictions"

SCHEMA_VERSION = 1


def resolve_device(device: str | None = None) -> str:
    """Pick the best available device, or use the one explicitly requested."""
    if device:
        return device
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def seed_all(seed: int):
    """Seed all RNGs for reproducibility."""
    torch.manual_seed(seed)
    np.random.seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def write_predictions(ids: list[str], slugs: list[str], out_path: Path):
    """Write (id, predicted_slug) parquet. Used by all prediction paths."""
    assert len(ids) == len(slugs), f"ID/slug count mismatch: {len(ids)} vs {len(slugs)}"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect()
    conn.execute("CREATE TABLE preds (id VARCHAR, predicted_slug VARCHAR)")
    conn.executemany("INSERT INTO preds VALUES (?, ?)", list(zip(ids, slugs)))
    conn.execute(f"COPY preds TO '{out_path}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    conn.close()
