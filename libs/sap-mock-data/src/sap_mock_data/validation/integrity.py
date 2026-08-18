"""Small, storage-independent relationship checks."""

from __future__ import annotations

from typing import Any

from ..storage import TableStore

RELATIONSHIPS = (
    ("makt", "MATNR", "mara", "MATNR"),
    ("marc", "MATNR", "mara", "MATNR"),
    ("mard", "MATNR", "mara", "MATNR"),
    ("vbap", "VBELN", "vbak", "VBELN"),
    ("vbep", "VBELN", "vbak", "VBELN"),
    ("ekpo", "EBELN", "ekko", "EBELN"),
)


def integrity_report(store: TableStore) -> dict[str, Any]:
    checks = []
    for child_table, child_key, parent_table, parent_key in RELATIONSHIPS:
        if not store.exists(child_table) or not store.exists(parent_table):
            continue
        child = store.read(child_table)
        parent = store.read(parent_table)
        missing = set(child[child_key].dropna()) - set(parent[parent_key].dropna())
        checks.append(
            {
                "child": f"{child_table}.{child_key}",
                "parent": f"{parent_table}.{parent_key}",
                "missing_keys": len(missing),
            }
        )
    return {"ok": all(check["missing_keys"] == 0 for check in checks), "checks": checks}

