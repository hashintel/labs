"""Predictor protocol: the shared interface for all model variants.

Each variant (MLP, seq2seq, projector) implements this protocol.
The shared CLI handles data loading, batching, and output writing.
"""

from abc import ABC, abstractmethod

import numpy as np


class Predictor(ABC):
    """Maps embeddings to slug strings."""

    @abstractmethod
    def predict(self, embeddings: np.ndarray) -> list[str]:
        """Predict slugs for a batch of embeddings.

        Args:
            embeddings: float32 array of shape [batch, dim]

        Returns:
            List of kebab-case slug strings, one per input.
        """
        ...
