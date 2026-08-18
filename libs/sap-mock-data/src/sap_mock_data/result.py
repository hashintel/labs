"""Generation result types."""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class GenerationResult:
    tables: tuple[str, ...]
    row_counts: dict[str, int]
    scenarios: tuple[str, ...]
    started_at: datetime
    finished_at: datetime

    @property
    def table_count(self) -> int:
        return len(self.tables)

