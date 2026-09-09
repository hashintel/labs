"""Delta Lake directory storage backed by delta-rs."""

from pathlib import Path

import pandas as pd
from deltalake import DeltaTable, write_deltalake


class DeltaTableStore:
    def __init__(self, root: str | Path):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, name: str) -> Path:
        return self.root / name.lower()

    def save(self, name: str, frame: pd.DataFrame, mode: str = "overwrite") -> None:
        normalized = frame.rename(columns=str.upper).reset_index(drop=True)
        write_deltalake(
            str(self._path(name)),
            normalized,
            mode=mode,
            schema_mode="overwrite" if mode == "overwrite" else None,
        )
        print(f"  saved {name.lower()} ({len(normalized)} rows)")

    def read(self, name: str) -> pd.DataFrame:
        return DeltaTable(str(self._path(name))).to_pandas()

    def exists(self, name: str) -> bool:
        return (self._path(name) / "_delta_log").exists()

    def tables(self) -> list[str]:
        return sorted(
            path.name for path in self.root.iterdir() if (path / "_delta_log").exists()
        )

