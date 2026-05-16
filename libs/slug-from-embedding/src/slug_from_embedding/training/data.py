"""Shared data loading for training: raw embeddings + slugs from DuckDB.

Each model variant wraps this into its own torch Dataset with the
appropriate target encoding (multi-hot for MLP, token sequences for
seq2seq, etc).
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


@dataclass
class RawSplit:
    """Raw training data for a single split."""

    ids: list[str]
    embeddings: np.ndarray  # [n, dim], float32
    slugs: list[str]


def load_split(encoder: Encoder, split: str) -> RawSplit:
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
    """).fetchall()

    ids = [r[0] for r in rows]
    embeddings = np.array([r[1] for r in rows], dtype=np.float32)
    slugs = [r[2] for r in rows]

    return RawSplit(ids=ids, embeddings=embeddings, slugs=slugs)
