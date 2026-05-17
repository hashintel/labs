"""Slug token vocabulary built from training data.

The vocabulary is the set of individual words (split on '-') that appear
in gold slugs across the training split. No frequency cutoff: even hapax
tokens are included.
"""

import json
from pathlib import Path
from typing import Self

from slug_from_embedding.config import Encoder
from slug_from_embedding.libs.workspace import Workspace


def build_vocab(workspace: Workspace, encoder: Encoder) -> list[str]:
    """Build a sorted vocabulary of slug tokens from the training split."""
    slugs = workspace.load_split_slugs(encoder, "train")
    tokens = set()
    for slug in slugs:
        for token in slug.split("-"):
            tokens.add(token)
    return sorted(tokens)


class SlugVocab:
    """Maps between slug tokens and integer indices."""

    def __init__(self, tokens: list[str]):
        self.tokens = tokens
        self.token_to_idx = {token: index for index, token in enumerate(tokens)}

    def __len__(self) -> int:
        return len(self.tokens)

    def encode_slug(self, slug: str) -> list[int]:
        """Convert a slug string to a list of token indices. Unknown tokens are skipped."""
        indices = []
        for token in slug.split("-"):
            index = self.token_to_idx.get(token)
            if index is not None:
                indices.append(index)
        return indices

    def decode_indices(self, indices: list[int]) -> str:
        """Convert a list of token indices back to a slug string."""
        return "-".join(self.tokens[index] for index in indices)

    def save(self, path: Path):
        path.write_text(json.dumps(self.tokens))

    @classmethod
    def load(cls, path: Path) -> Self:
        tokens = json.loads(path.read_text())
        return cls(tokens)

    @classmethod
    def from_training(cls, workspace: Workspace, encoder: Encoder) -> Self:
        return cls(build_vocab(workspace, encoder))
