"""Store generated tables in memory."""

import pandas as pd


class MemoryTableStore:
    def __init__(self) -> None:
        self._tables: dict[str, pd.DataFrame] = {}

    def save(self, name: str, frame: pd.DataFrame, mode: str = "overwrite") -> None:
        key = name.lower()
        normalized = frame.rename(columns=str.upper).reset_index(drop=True)
        if mode == "append" and key in self._tables:
            normalized = pd.concat([self._tables[key], normalized], ignore_index=True)
        self._tables[key] = normalized.copy(deep=True)

    def read(self, name: str) -> pd.DataFrame:
        return self._tables[name.lower()].copy(deep=True)

    def exists(self, name: str) -> bool:
        return name.lower() in self._tables

    def tables(self) -> list[str]:
        return sorted(self._tables)
