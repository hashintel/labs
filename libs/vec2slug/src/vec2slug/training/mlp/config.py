"""MLP variant configuration."""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class MLPConfig:
    """Architecture config for the SlugMLP model."""

    hidden_dim: int = 768
    num_layers: int = 2
    dropout: float = 0.2
    position_head: bool = False
    token_loss: Literal["bce", "focal"] = "bce"
    focal_gamma: float = 2.0
    tag: str | None = None
