"""Storage contract used by the pandas generation engine."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import pandas as pd


@runtime_checkable
class TableStore(Protocol):
    def save(self, name: str, frame: pd.DataFrame, mode: str = "overwrite") -> None: ...
    def read(self, name: str) -> pd.DataFrame: ...
    def exists(self, name: str) -> bool: ...
    def tables(self) -> list[str]: ...

