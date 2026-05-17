from dataclasses import dataclass
from pathlib import Path
from typing import NewType

import duckdb

from slug_from_embedding.config import DATA_DIR

Id = NewType("Id", str)


@dataclass(frozen=True)
class CorpusText:
    id: Id
    text: str


class Dataset:
    name: str
    base_dir: Path

    def _dataset_dir(self) -> Path:
        return self.base_dir / self.name

    def __init__(self, *, name: str, base_dir: Path = DATA_DIR):
        self.name = name
        self.base_dir = base_dir

    def corpus_texts(self) -> list[CorpusText]:
        corpus_file = self._dataset_dir() / "corpus.parquet"

        rows = duckdb.sql(
            f"SELECT id, text FROM '{corpus_file}' ORDER BY id"
        ).fetchall()

        return [CorpusText(id=Id(id), text=text) for id, text in rows]
