"""Canonical data access layer for training and inference.

All DuckDB queries that touch corpus/splits/embeddings live here.
Queries include ORDER BY id for deterministic results.
"""

from dataclasses import dataclass

import duckdb
import numpy as np

from slug_from_embedding.config import (
    CORPUS_WITH_SLUGS_FILE,
    Encoder,
    embeddings_file,
    splits_file,
)

from .config import Split


@dataclass
class RawSplit:
    """Raw training data for a single split."""

    ids: list[str]
    embeddings: np.ndarray  # [n, dim], float32
    slugs: list[str]


def load_split(encoder: Encoder, split: Split) -> RawSplit:
    """Load ids, embeddings, and gold slugs for a split."""
    rows = duckdb.sql(f"""
        SELECT
            corpus.id as id,
            embeddings.embedding as embedding,
            corpus.slug as slug
        FROM '{CORPUS_WITH_SLUGS_FILE}' as corpus
        JOIN '{splits_file(encoder)}' as splits
            ON corpus.id = splits.id
        JOIN '{embeddings_file(encoder)}' as embeddings
            ON corpus.id = embeddings.id
        WHERE splits.split = '{split}'
        ORDER BY corpus.id
    """).fetchall()

    assert len(rows) > 0, f"Empty split: {encoder}/{split}"

    ids = [r[0] for r in rows]
    embeddings = np.array([r[1] for r in rows], dtype=np.float32)
    slugs = [r[2] for r in rows]

    return RawSplit(ids=ids, embeddings=embeddings, slugs=slugs)


def load_embeddings(encoder: Encoder, split: Split) -> tuple[list[str], np.ndarray]:
    """Load ids and embeddings for a split (no slugs)."""
    rows = duckdb.sql(f"""
        SELECT splits.id, embeddings.embedding
        FROM '{splits_file(encoder)}' as splits
        JOIN '{embeddings_file(encoder)}' as embeddings
            ON splits.id = embeddings.id
        WHERE splits.split = '{split}'
        ORDER BY splits.id
    """).fetchall()

    assert len(rows) > 0, f"Empty split: {encoder}/{split}"

    ids = [r[0] for r in rows]
    embeddings = np.array([r[1] for r in rows], dtype=np.float32)
    return ids, embeddings


def load_training_slugs(encoder: Encoder) -> list[str]:
    """Load all training-set slugs for the given encoder."""
    rows = duckdb.sql(f"""
        SELECT corpus.slug
        FROM '{CORPUS_WITH_SLUGS_FILE}' as corpus
        JOIN '{splits_file(encoder)}' as splits
            ON corpus.id = splits.id
        WHERE splits.split = 'train'
        ORDER BY corpus.id
    """).fetchall()
    return [r[0] for r in rows]


def load_texts(encoder: Encoder, split: Split) -> list[tuple[str, str]]:
    """Load (id, text) pairs for the given encoder/split."""
    return duckdb.sql(f"""
        SELECT corpus.id, corpus.text
        FROM '{CORPUS_WITH_SLUGS_FILE}' as corpus
        JOIN '{splits_file(encoder)}' as splits ON corpus.id = splits.id
        WHERE splits.split = '{split}'
        ORDER BY corpus.id
    """).fetchall()
