"""PyTorch dataset for MLP slug prediction.

Wraps the shared data loader with MLP-specific target encoding:
- token_targets: multi-hot float tensor [vocab_size]
- token_positions: per-token position in the gold slug (-1 if absent)
- length: number of tokens in the gold slug
"""

import torch
from torch.utils.data import Dataset as TorchDataset

from slug_from_embedding.config import Encoder

from ..data import load_split
from ..vocab import SlugVocab


class SlugDataset(TorchDataset):
    """MLP training dataset: embeddings → multi-hot token targets."""

    def __init__(self, encoder: Encoder, split: str, vocab: SlugVocab):
        self.vocab = vocab
        raw = load_split(encoder, split)
        self.embeddings = raw.embeddings
        self.slugs = raw.slugs

    def __len__(self) -> int:
        return len(self.slugs)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        slug = self.slugs[idx]
        indices = self.vocab.encode_slug(slug)
        length = len(slug.split("-"))

        # Multi-hot target for token prediction
        token_targets = torch.zeros(len(self.vocab), dtype=torch.float32)
        for i in indices:
            token_targets[i] = 1.0

        # Position target: position of each token in the slug, -1 if absent.
        # Used by the position head (variant 1b).
        token_positions = torch.full((len(self.vocab),), -1, dtype=torch.long)
        for pos, i in enumerate(indices):
            token_positions[i] = pos

        return {
            "embedding": torch.from_numpy(self.embeddings[idx]),
            "token_targets": token_targets,
            "token_positions": token_positions,
            "length": length,
        }
