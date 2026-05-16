"""MLP variant configuration."""

from dataclasses import dataclass


@dataclass(frozen=True)
class MLPConfig:
    """Architecture config for the SlugMLP model."""

    hidden_dim: int = 768
    dropout: float = 0.2
    position_head: bool = False
