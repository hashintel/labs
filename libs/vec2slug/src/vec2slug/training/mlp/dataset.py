"""PyTorch dataset for MLP slug prediction.

Wraps the workspace data loader with MLP-specific target encoding:
- token_targets: multi-hot float tensor [vocab_size]
- token_positions: per-token position in the gold slug (-1 if absent)
- length: number of tokens in the gold slug
"""

import logging

import numpy as np
import torch
from torch.utils.data import Dataset as TorchDataset

from vec2slug.config import Encoder
from vec2slug.libs.workspace import Split, Workspace

from .vocab import SlugVocab

log = logging.getLogger(__name__)


class SlugDataset(TorchDataset):
    """MLP training dataset: embeddings -> multi-hot token targets.

    When max_samples is set, a seeded random subsample is drawn. This is
    useful for validation during training (5-10k is enough for a reliable
    signal; the full 230k test set is overkill for per-eval-step checks).
    """

    def __init__(
        self,
        workspace: Workspace,
        encoder: Encoder,
        split: Split,
        vocab: SlugVocab,
        max_samples: int | None = None,
        seed: int = 42,
    ):
        self.vocab = vocab
        raw = workspace.load_split_data(encoder, split)
        self.embeddings = raw.embeddings
        self.slugs = raw.slugs

        if max_samples is not None and max_samples < len(self.slugs):
            rng = np.random.default_rng(seed)
            indices = rng.choice(len(self.slugs), size=max_samples, replace=False)
            indices.sort()
            self.embeddings = self.embeddings[indices]
            self.slugs = [self.slugs[i] for i in indices]

        self._validate_oov(split)

    def _validate_oov(self, split: Split):
        """Check for out-of-vocabulary tokens.

        With compressed vocab, OOV means a token wasn't in the compression
        mapping. Training split should have zero OOV. Val/test may have
        some; log the rate but don't fail.
        """
        oov_count = 0
        total_tokens = 0
        for slug in self.slugs:
            for token in slug.split("-"):
                total_tokens += 1
                if self.vocab.compression is not None:
                    token = self.vocab.compression.get(token, token)
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
