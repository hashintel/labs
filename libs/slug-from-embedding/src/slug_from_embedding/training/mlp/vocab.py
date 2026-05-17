"""Slug token vocabulary built from training data.

The vocabulary is the set of individual words (split on '-') that appear
in gold slugs across the training split. Optionally compressed via a
token mapping (e.g. KMeans clustering) that maps rare tokens to cluster
representatives, reducing vocab size dramatically.
"""

import json
from pathlib import Path
from typing import Self

from slug_from_embedding.config import Encoder
from slug_from_embedding.libs.workspace import Workspace


class SlugVocab:
    """Maps between slug tokens and integer indices.

    When a compression mapping is provided, encode_slug maps each token
    through the mapping before index lookup. This means the model's output
    space is the set of representative tokens, not the full vocabulary.
    """

    def __init__(
        self,
        tokens: list[str],
        compression: dict[str, str] | None = None,
    ):
        self.tokens = tokens
        self.token_to_idx = {token: index for index, token in enumerate(tokens)}
        self.compression = compression

    def __len__(self) -> int:
        return len(self.tokens)

    def encode_slug(self, slug: str) -> list[int]:
        """Convert a slug string to a list of token indices.

        If compression is set, each token is mapped to its representative
        first. Unknown tokens (after compression) are skipped.
        """
        indices = []
        for token in slug.split("-"):
            if self.compression is not None:
                token = self.compression.get(token, token)
            index = self.token_to_idx.get(token)
            if index is not None:
                indices.append(index)
        return indices

    def decode_indices(self, indices: list[int]) -> str:
        """Convert a list of token indices back to a slug string."""
        return "-".join(self.tokens[index] for index in indices)

    def save(self, path: Path):
        """Save vocab and optional compression mapping."""
        data = {"tokens": self.tokens}
        if self.compression is not None:
            data["compression"] = self.compression
        path.write_text(json.dumps(data))

    @classmethod
    def load(cls, path: Path) -> Self:
        raw = json.loads(path.read_text())
        # Support both old format (bare list) and new format (dict with tokens key)
        if isinstance(raw, list):
            return cls(raw)
        return cls(raw["tokens"], compression=raw.get("compression"))

    @classmethod
    def from_training(cls, workspace: Workspace, encoder: Encoder) -> Self:
        """Build vocab from all unique tokens in the training split."""
        slugs = workspace.load_split_slugs(encoder, "train")
        tokens = set()
        for slug in slugs:
            for token in slug.split("-"):
                tokens.add(token)
        return cls(sorted(tokens))

    @classmethod
    def from_compressed(
        cls,
        workspace: Workspace,
        encoder: Encoder,
        compression_name: str,
    ) -> Self:
        """Build vocab from a compression mapping.

        Loads the mapping from {encoder}/vocab_compression/{name}.json,
        extracts the unique representatives as the vocab, and stores the
        full mapping for encoding.
        """
        mapping_path = (
            workspace.encoder_dir(encoder)
            / "vocab_compression"
            / f"{compression_name}.json"
        )
        if not mapping_path.exists():
            raise FileNotFoundError(
                f"Compression mapping not found: {mapping_path}\n"
                f"Run slug-compress-vocab first."
            )
        compression = json.loads(mapping_path.read_text())
        representatives = sorted(set(compression.values()))
        return cls(representatives, compression=compression)
