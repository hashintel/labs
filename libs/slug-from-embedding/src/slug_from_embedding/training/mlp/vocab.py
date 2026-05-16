"""Slug token vocabulary built from training data.

The vocabulary is the set of individual words (split on '-') that appear
in gold slugs across the training split. No frequency cutoff: even hapax
tokens are included. With only 10k samples this vocabulary is inherently
sparse; absolute performance will be bounded by data scale, not architecture.
"""

import json
from pathlib import Path
from typing import Self

import duckdb

from slug_from_embedding.config import CORPUS_WITH_SLUGS_FILE, Encoder, splits_file


def build_vocab(encoder: Encoder) -> list[str]:
    """Build a sorted vocabulary of slug tokens from the training split."""
    tokens = duckdb.sql(f"""
        WITH slug_tokens AS (
            SELECT unnest(string_split(corpus.slug, '-')) as token
            FROM '{CORPUS_WITH_SLUGS_FILE}' as corpus
            JOIN '{splits_file(encoder)}' as splits
                ON corpus.id = splits.id
            WHERE splits.split = 'train'
        )
        SELECT DISTINCT token FROM slug_tokens
        ORDER BY token
    """).fetchall()

    return [row[0] for row in tokens]


class SlugVocab:
    """Maps between slug tokens and integer indices."""

    def __init__(self, tokens: list[str]):
        self.tokens = tokens
        self.token_to_idx = {t: i for i, t in enumerate(tokens)}

    def __len__(self) -> int:
        return len(self.tokens)

    def encode_slug(self, slug: str) -> list[int]:
        """Convert a slug string to a list of token indices. Unknown tokens are skipped."""
        indices = []
        for token in slug.split("-"):
            idx = self.token_to_idx.get(token)
            if idx is not None:
                indices.append(idx)
        return indices

    def decode_indices(self, indices: list[int]) -> str:
        """Convert a list of token indices back to a slug string."""
        return "-".join(self.tokens[i] for i in indices)

    def save(self, path: Path):
        path.write_text(json.dumps(self.tokens))

    @classmethod
    def load(cls, path: Path) -> Self:
        tokens = json.loads(path.read_text())
        return cls(tokens)

    @classmethod
    def from_training(cls, encoder: Encoder) -> Self:
        return cls(build_vocab(encoder))
