"""Build canonical table manifests."""

from __future__ import annotations

import hashlib
from typing import Any

import pandas as pd

from ..storage import TableStore


def _canonical_frame(name: str, frame: pd.DataFrame) -> pd.DataFrame:
    canonical = frame.copy()
    if name in {"sapapo_tr", "sapapo_trm"} and "TRLID" in canonical:
        canonical["TRLID"] = "<runtime-id>"
    if name == "scenario_metadata" and "INJECTED_AT" in canonical:
        canonical["INJECTED_AT"] = "<runtime-timestamp>"
    return canonical.reindex(sorted(canonical.columns), axis=1)


def table_manifest(name: str, frame: pd.DataFrame) -> dict[str, Any]:
    canonical = _canonical_frame(name, frame)
    row_hashes = pd.util.hash_pandas_object(canonical, index=False).sort_values()
    content_hash = hashlib.sha256(row_hashes.to_numpy().tobytes()).hexdigest()
    return {
        "rows": len(frame),
        "columns": [
            {"name": column, "dtype": str(frame[column].dtype)} for column in frame.columns
        ],
        "null_counts": {column: int(frame[column].isna().sum()) for column in frame.columns},
        "content_sha256": content_hash,
    }


def build_manifest(store: TableStore) -> dict[str, Any]:
    return {
        "format_version": 1,
        "tables": {
            name: table_manifest(name, store.read(name)) for name in store.tables()
        },
    }
