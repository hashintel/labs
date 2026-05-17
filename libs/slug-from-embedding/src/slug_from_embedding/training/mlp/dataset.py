"""PyTorch dataset for MLP slug prediction.

Wraps the workspace data loader with MLP-specific target encoding:
- token_targets: multi-hot float tensor [vocab_size]
- token_positions: per-token position in the gold slug (-1 if absent)
- length: number of tokens in the gold slug
"""

import logging

import torch
from torch.utils.data import Dataset as TorchDataset

from slug_from_embedding.config import Encoder
from slug_from_embedding.libs.workspace import Split, Workspace

from .vocab import SlugVocab

log = logging.getLogger(__name__)


class SlugDataset(TorchDataset):
    """MLP training dataset: embeddings -> multi-hot token targets."""

    def __init__(
        self, workspace: Workspace, encoder: Encoder, split: Split, vocab: SlugVocab
    ):
        self.vocab = vocab
        raw = workspace.load_split_data(encoder, split)
        self.embeddings = raw.embeddings
        self.slugs = raw.slugs

        self._validate_oov(split)

    def _validate_oov(self, split: Split):
        """Check for out-of-vocabulary tokens.

        Training split should have zero OOV (vocab was built from it).
        Val/test may have OOV; log the rate but don't fail.
        """
        oov_count = 0
        total_tokens = 0
        for slug in self.slugs:
            for token in slug.split("-"):
                total_tokens += 1
                if token not in self.vocab.token_to_idx:
                    oov_count += 1

        if oov_count == 0:
            return

        rate = oov_count / total_tokens
        message = f"{split}: {oov_count}/{total_tokens} tokens OOV ({rate:.1%})"

        if split == "train":
            raise ValueError(
                f"Training data has OOV tokens (vocab is inconsistent): {message}"
            )
        else:
            log.warning(message)

    def __len__(self) -> int:
        return len(self.slugs)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        slug = self.slugs[idx]
        indices = self.vocab.encode_slug(slug)
        length = len(slug.split("-"))

        token_targets = torch.zeros(len(self.vocab), dtype=torch.float32)
        for index in indices:
            token_targets[index] = 1.0

        token_positions = torch.full((len(self.vocab),), -1, dtype=torch.long)
        for position, index in enumerate(indices):
            token_positions[index] = position

        return {
            "embedding": torch.from_numpy(self.embeddings[idx]),
            "token_targets": token_targets,
            "token_positions": token_positions,
            "length": length,
        }
