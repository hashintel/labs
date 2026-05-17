"""Shared training infrastructure: runtime helpers and constants."""

import numpy as np
import torch

SCHEMA_VERSION = 1


def resolve_device(device: str | None = None) -> str:
    """Pick the best available device, or use the one explicitly requested."""
    if device:
        return device
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def seed_all(seed: int):
    """Seed all RNGs for reproducibility."""
    torch.manual_seed(seed)
    np.random.seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
