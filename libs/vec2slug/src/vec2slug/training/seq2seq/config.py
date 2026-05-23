"""Seq2seq variant configuration."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Seq2SeqConfig:
    """Architecture config for the prefix-conditioned transformer decoder."""

    embed_dim: int = 256
    num_heads: int = 8
    num_layers: int = 4
    dropout: float = 0.1
    max_slug_tokens: int = 32
