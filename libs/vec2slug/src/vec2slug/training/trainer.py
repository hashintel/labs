"""Trainer protocol: the shared interface for all model variant trainers.

Each variant (MLP, seq2seq, projector) implements this ABC.
"""

from abc import ABC, abstractmethod
from pathlib import Path

from vec2slug.config import Encoder


class Trainer(ABC):
    """Trains a model and saves artifacts to a model directory."""

    @abstractmethod
    def __init__(
        self,
        encoder: Encoder,
        device: str,
        overwrite: bool = False,
    ): ...

    @abstractmethod
    def run(self) -> Path:
        """Execute training and return the model directory."""
        ...
