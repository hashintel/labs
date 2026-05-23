"""Seq2seq vocabulary with special tokens.

Wraps the compressed vocab with BOS/EOS/PAD at fixed indices.
The MLP vocab has no special tokens and silently skips OOV;
the seq2seq vocab needs explicit sequence boundaries for
autoregressive generation.
"""

import json
from pathlib import Path
from typing import Self

from vec2slug.config import Encoder
from vec2slug.libs.workspace import Workspace

PAD_IDX = 0
BOS_IDX = 1
EOS_IDX = 2
SPECIAL_OFFSET = 3


class SeqVocab:
    """Vocabulary for autoregressive slug generation.

    Indices 0-2 are reserved for PAD, BOS, EOS. Content tokens
    start at index 3. The compression mapping (if any) is applied
    before index lookup.
    """

    pad_idx = PAD_IDX
    bos_idx = BOS_IDX
    eos_idx = EOS_IDX

    def __init__(
        self,
        tokens: list[str],
        compression: dict[str, str] | None = None,
    ):
        self.tokens = tokens
        self.compression = compression
        self.token_to_idx = {
            token: index + SPECIAL_OFFSET
            for index, token in enumerate(tokens)
        }

    def __len__(self) -> int:
        return len(self.tokens) + SPECIAL_OFFSET

    def encode_slug(self, slug: str) -> list[int]:
        """Encode a slug as [BOS, tok1, tok2, ..., tokN, EOS]."""
        indices = [BOS_IDX]
        for token in slug.split("-"):
            if self.compression is not None:
                token = self.compression.get(token, token)
            index = self.token_to_idx.get(token)
            if index is not None:
                indices.append(index)
        indices.append(EOS_IDX)
        return indices

    def decode_indices(self, indices: list[int]) -> str:
        """Decode indices to a slug string, stopping at EOS."""
        tokens = []
        for index in indices:
            if index == EOS_IDX:
                break
            if index < SPECIAL_OFFSET:
                continue
            tokens.append(self.tokens[index - SPECIAL_OFFSET])
        return "-".join(tokens) if tokens else ""

    def save(self, path: Path):
        data = {"tokens": self.tokens}
        if self.compression is not None:
            data["compression"] = self.compression
        path.write_text(json.dumps(data))

    @classmethod
    def load(cls, path: Path) -> Self:
        raw = json.loads(path.read_text())
        if isinstance(raw, list):
            return cls(raw)
        return cls(raw["tokens"], compression=raw.get("compression"))

    @classmethod
    def from_compressed(
        cls,
        workspace: Workspace,
        encoder: Encoder,
        compression_name: str,
    ) -> Self:
        """Build vocab from a compression mapping."""
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

    @classmethod
    def from_training(cls, workspace: Workspace, encoder: Encoder) -> Self:
        """Build vocab from all unique tokens in the training split."""
        slugs = workspace.load_split_slugs(encoder, "train")
        tokens = set()
        for slug in slugs:
            for token in slug.split("-"):
                tokens.add(token)
        return cls(sorted(tokens))
