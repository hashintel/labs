"""Workspace: typed data access layer for a named corpus and its artifacts.

A Workspace owns all paths and data access for a single corpus. All derived
artifacts (embeddings, splits, models, predictions, results) live under the
workspace directory, namespaced by encoder where applicable.

Layout:
    data/{name}/
        corpus_partial.parquet
        corpus.parquet
        staging/
        logs/
        batches/{operation}/
        {encoder}/
            embeddings.parquet
            splits.parquet
            models/{variant}/
            predictions/
            results/
                figures/
"""

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NewType

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from datasets import Dataset

from vec2slug.config import DATA_DIR, Encoder

Id = NewType("Id", str)

type Split = Literal["train", "val", "test"]


@dataclass(frozen=True)
class CorpusText:
    id: Id
    text: str


@dataclass
class SplitData:
    """Training/inference data for a single split: ids, embeddings, and slugs."""

    ids: list[Id]
    embeddings: np.ndarray
    slugs: list[str]


CORPUS_SCHEMA = pa.schema([
    pa.field("id", pa.utf8()),
    pa.field("text", pa.utf8()),
    pa.field("source", pa.utf8()),
    pa.field("token_count", pa.int64()),
    pa.field("slug", pa.utf8()),
])

CORPUS_PARTIAL_SCHEMA = pa.schema([
    pa.field("id", pa.utf8()),
    pa.field("text", pa.utf8()),
    pa.field("source", pa.utf8()),
    pa.field("token_count", pa.int64()),
])

EMBEDDING_SCHEMA = pa.schema([
    pa.field("id", pa.utf8()),
    pa.field("embedding", pa.list_(pa.float32())),
])

SPLIT_SCHEMA = pa.schema([
    pa.field("id", pa.utf8()),
    pa.field("split", pa.utf8()),
    pa.field("cluster", pa.int32()),
])

PREDICTION_SCHEMA = pa.schema([
    pa.field("id", pa.utf8()),
    pa.field("predicted_slug", pa.utf8()),
])


class Workspace:
    name: str
    root: Path

    def __init__(self, name: str, *, base_dir: Path = DATA_DIR):
        self.name = name
        self.root = base_dir / name

    def __repr__(self) -> str:
        return f"Workspace({self.name!r}, root={self.root})"

    def ensure(self) -> "Workspace":
        """Create the workspace root directory if it doesn't exist."""
        self.root.mkdir(parents=True, exist_ok=True)
        return self

    def encoder_dir(self, encoder: Encoder) -> Path:
        return self.root / encoder

    def staging_dir(self, source: str | None = None) -> Path:
        directory = self.root / "staging"
        if source:
            directory = directory / source
        return directory

    def logs_dir(self, source: str | None = None) -> Path:
        directory = self.root / "logs"
        if source:
            directory = directory / source
        return directory

    def batch_dir(self, operation: str) -> Path:
        return self.root / "batches" / operation

    def models_dir(self, encoder: Encoder, variant: str | None = None) -> Path:
        directory = self.encoder_dir(encoder) / "models"
        if variant:
            directory = directory / variant
        return directory

    def predictions_dir(self, encoder: Encoder) -> Path:
        return self.encoder_dir(encoder) / "predictions"

    def results_dir(self, encoder: Encoder) -> Path:
        return self.encoder_dir(encoder) / "results"

    def figures_dir(self, encoder: Encoder) -> Path:
        return self.results_dir(encoder) / "figures"

    def corpus_partial_path(self) -> Path:
        return self.root / "corpus_partial.parquet"

    def corpus_path(self) -> Path:
        return self.root / "corpus.parquet"

    def embeddings_path(self, encoder: Encoder) -> Path:
        return self.encoder_dir(encoder) / "embeddings.parquet"

    def splits_path(self, encoder: Encoder) -> Path:
        return self.encoder_dir(encoder) / "splits.parquet"

    def prediction_path(
        self, encoder: Encoder, name: str, split: Split = "test"
    ) -> Path:
        return self.predictions_dir(encoder) / f"{name}_{split}.parquet"

    def result_path(self, encoder: Encoder, name: str, split: Split = "test") -> Path:
        return self.results_dir(encoder) / f"{name}_{split}.json"

    def result_detail_path(
        self, encoder: Encoder, name: str, split: Split = "test"
    ) -> Path:
        return self.results_dir(encoder) / f"{name}_{split}_detail.parquet"

    def load_corpus_texts(self) -> list[CorpusText]:
        """Load (id, text) pairs from the corpus, ordered by id."""
        path = self.corpus_path()
        rows = duckdb.sql(f"SELECT id, text FROM '{path}' ORDER BY id").fetchall()
        return [CorpusText(id=Id(row[0]), text=row[1]) for row in rows]

    def iter_corpus_texts(self, *, fetch_size: int = 10_000) -> Iterator[CorpusText]:
        """Stream (id, text) pairs from the corpus without loading all into memory."""
        path = self.corpus_path()
        result = duckdb.sql(f"SELECT id, text FROM '{path}' ORDER BY id")
        while True:
            chunk = result.fetchmany(fetch_size)
            if not chunk:
                break
            for row in chunk:
                yield CorpusText(id=Id(row[0]), text=row[1])

    def load_embeddings(self, encoder: Encoder) -> tuple[list[Id], np.ndarray]:
        """Load all embeddings as (ids, matrix) with efficient Arrow-native path."""
        path = self.embeddings_path(encoder)
        table = pq.read_table(path, schema=EMBEDDING_SCHEMA)

        ids = [Id(value) for value in table.column("id").to_pylist()]

        column = table.column("embedding")
        # For large datasets, combine_chunks() can overflow 32-bit list offsets.
        # Process per-chunk and concatenate as numpy instead.
        chunk_arrays = []
        for chunk in column.chunks:
            offsets = chunk.offsets.to_numpy()
            values = chunk.values.to_numpy()
            dimension = offsets[1] - offsets[0]
            chunk_arrays.append(values.reshape(-1, dimension))
        embeddings = np.concatenate(chunk_arrays, axis=0)

        return ids, embeddings

    def write_embeddings(self, ids: list[Id], embeddings: np.ndarray, path: Path):
        """Write embeddings to a specific parquet path with schema validation.

        For shard writes during checkpointing. For the canonical encoder
        location, use write_encoder_embeddings instead.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        table = pa.table(
            {"id": ids, "embedding": embeddings.tolist()},
            schema=EMBEDDING_SCHEMA,
        )
        pq.write_table(table, path, compression="zstd")

    def write_encoder_embeddings(
        self, encoder: Encoder, ids: list[Id], embeddings: np.ndarray
    ):
        """Write embeddings to the canonical location for an encoder."""
        path = self.embeddings_path(encoder)
        self.write_embeddings(ids, embeddings, path)

    def load_split_ids(self, encoder: Encoder, split: Split) -> list[Id]:
        """Load document IDs for a given split."""
        path = self.splits_path(encoder)
        rows = duckdb.sql(
            f"SELECT id FROM '{path}' WHERE split = '{split}' ORDER BY id"
        ).fetchall()
        return [Id(row[0]) for row in rows]

    def split_data_path(self, encoder: Encoder, split: Split) -> Path:
        """Path to a materialized split parquet file."""
        return self.encoder_dir(encoder) / f"split_{split}.parquet"

    def materialize_split(self, encoder: Encoder, split: Split) -> Path:
        """Precompute a split's data as a single parquet file.

        DuckDB exports the three-way join directly to parquet, bypassing
        the Python row-by-row roundtrip. Much faster for large splits.
        """
        output = self.split_data_path(encoder, split)
        if output.exists():
            return output

        corpus_path = self.corpus_path()
        splits_path = self.splits_path(encoder)
        embeddings_path = self.embeddings_path(encoder)

        print(f"Materializing {encoder}/{split} split...")
        duckdb.sql(f"""
            COPY (
                SELECT
                    corpus.id AS id,
                    embeddings.embedding::FLOAT[] AS embedding,
                    corpus.slug AS slug
                FROM '{corpus_path}' as corpus
                JOIN '{splits_path}' as splits
                    ON corpus.id = splits.id
                JOIN '{embeddings_path}' as embeddings
                    ON corpus.id = embeddings.id
                WHERE splits.split = '{split}'
                ORDER BY corpus.id
            ) TO '{output}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """)
        print(f"  Wrote {output}")
        return output

    def load_split_data(self, encoder: Encoder, split: Split) -> SplitData:
        """Load ids, embeddings, and gold slugs for a split.

        Uses materialized parquet if available, otherwise falls back to
        the three-way DuckDB join.
        """
        cached = self.split_data_path(encoder, split)
        if cached.exists():
            table = pq.read_table(cached)
        else:
            corpus_path = self.corpus_path()
            splits_path = self.splits_path(encoder)
            embeddings_path = self.embeddings_path(encoder)

            table = duckdb.sql(f"""
                SELECT
                    corpus.id,
                    embeddings.embedding,
                    corpus.slug
                FROM '{corpus_path}' as corpus
                JOIN '{splits_path}' as splits
                    ON corpus.id = splits.id
                JOIN '{embeddings_path}' as embeddings
                    ON corpus.id = embeddings.id
                WHERE splits.split = '{split}'
                ORDER BY corpus.id
            """).to_arrow_table()

        assert len(table) > 0, f"Empty split: {encoder}/{split}"

        ids = [Id(value) for value in table.column("id").to_pylist()]
        slugs = table.column("slug").to_pylist()

        # Efficient Arrow-native embedding extraction (same as load_embeddings)
        column = table.column("embedding")
        chunk_arrays = []
        for chunk in column.chunks:
            offsets = chunk.offsets.to_numpy()
            values = chunk.values.to_numpy()
            dimension = offsets[1] - offsets[0]
            chunk_arrays.append(values.reshape(-1, dimension))
        embeddings = np.concatenate(chunk_arrays, axis=0).astype(np.float32)

        return SplitData(ids=ids, embeddings=embeddings, slugs=slugs)

    def load_split_embeddings(
        self, encoder: Encoder, split: Split
    ) -> tuple[list[Id], np.ndarray]:
        """Load ids and embeddings for a split (no slugs)."""
        splits_path = self.splits_path(encoder)
        embeddings_path = self.embeddings_path(encoder)

        rows = duckdb.sql(f"""
            SELECT splits.id, embeddings.embedding
            FROM '{splits_path}' as splits
            JOIN '{embeddings_path}' as embeddings ON splits.id = embeddings.id
            WHERE splits.split = '{split}'
            ORDER BY splits.id
        """).fetchall()

        assert len(rows) > 0, f"Empty split: {encoder}/{split}"

        ids = [Id(row[0]) for row in rows]
        embedding_matrix = np.array([row[1] for row in rows], dtype=np.float32)
        return ids, embedding_matrix

    def load_split_slugs(self, encoder: Encoder, split: Split) -> list[str]:
        """Load gold slugs for a split, ordered by id."""
        corpus_path = self.corpus_path()
        splits_path = self.splits_path(encoder)

        rows = duckdb.sql(f"""
            SELECT corpus.slug
            FROM '{corpus_path}' as corpus
            JOIN '{splits_path}' as splits ON corpus.id = splits.id
            WHERE splits.split = '{split}'
            ORDER BY corpus.id
        """).fetchall()

        return [row[0] for row in rows]

    def load_split_texts(self, encoder: Encoder, split: Split) -> list[CorpusText]:
        """Load (id, text) pairs for a split, ordered by id."""
        corpus_path = self.corpus_path()
        splits_path = self.splits_path(encoder)

        rows = duckdb.sql(f"""
            SELECT corpus.id, corpus.text
            FROM '{corpus_path}' as corpus
            JOIN '{splits_path}' as splits
                ON corpus.id = splits.id
            WHERE splits.split = '{split}'
            ORDER BY corpus.id
        """).fetchall()
        return [CorpusText(id=Id(row[0]), text=row[1]) for row in rows]

    def load_evaluation_dataset(
        self, prediction_path: Path, encoder: Encoder
    ) -> Dataset:
        """Load an evaluation dataset: predictions joined with corpus and embeddings.

        Returns a HuggingFace Dataset with columns: id, source, token_count,
        prediction, reference, text_embedding.
        """
        corpus_path = self.corpus_path()
        embeddings_path = self.embeddings_path(encoder)

        table = duckdb.sql(f"""
            SELECT
                prediction.id as id,
                corpus.source as source,
                corpus.token_count as token_count,
                prediction.predicted_slug as prediction,
                corpus.slug as reference,
                embeddings.embedding as text_embedding
            FROM '{prediction_path}' as prediction
            JOIN '{corpus_path}' as corpus
                ON prediction.id = corpus.id
            JOIN '{embeddings_path}' as embeddings
                ON prediction.id = embeddings.id
            ORDER BY prediction.id
        """).to_arrow_table()

        return Dataset(table)

    def write_predictions(
        self,
        encoder: Encoder,
        name: str,
        ids: list[Id],
        slugs: list[str],
        split: Split = "test",
    ):
        """Write prediction output with schema validation."""
        path = self.prediction_path(encoder, name, split)
        path.parent.mkdir(parents=True, exist_ok=True)
        table = pa.table(
            {"id": ids, "predicted_slug": slugs},
            schema=PREDICTION_SCHEMA,
        )
        pq.write_table(table, path, compression="zstd")
