"""PyTorch dataset for seq2seq slug generation.

Encodes each sample as:
- embedding: the source document embedding
- input_ids: [BOS, tok1, tok2, ..., tokN] (teacher forcing input)
- target_ids: [tok1, tok2, ..., tokN, EOS] (shifted prediction target)

Sequences are padded to max_length with PAD_IDX.
"""

import logging

import numpy as np
import torch
from torch.utils.data import Dataset as TorchDataset

from slug_from_embedding.config import Encoder
from slug_from_embedding.libs.workspace import Split, Workspace

log = logging.getLogger(__name__)


class SeqDataset(TorchDataset):
    """Seq2seq training dataset: embeddings -> token sequences.

    Accepts any vocab with encode_slug(), pad_idx, and compression attributes.
    """

    def __init__(
        self,
        workspace: Workspace,
        encoder: Encoder,
        split: Split,
        vocab,  # SeqVocab or BpeVocab
        max_length: int = 10,
        max_samples: int | None = None,
        seed: int = 42,
    ):
        self.vocab = vocab
        self.max_length = max_length

        raw = workspace.load_split_data(encoder, split)

        # Filter out slugs that exceed max_length when encoded.
        # Truncating would produce targets without EOS, corrupting the
        # termination signal. Filtering drops ~0.6% at max_length=24.
        keep = []
        for i, slug in enumerate(raw.slugs):
            encoded = vocab.encode_slug(slug)
            # encoded includes BOS and EOS; input/target are max_length each
            if len(encoded) - 1 <= max_length:  # input_ids = encoded[:-1]
                keep.append(i)

        n_filtered = len(raw.slugs) - len(keep)
        if n_filtered > 0:
            print(
                f"  {split}: filtered {n_filtered}/{len(raw.slugs)} "
                f"({n_filtered/len(raw.slugs):.1%}) slugs exceeding "
                f"{max_length} tokens"
            )

        keep_arr = np.array(keep)
        self.embeddings = raw.embeddings[keep_arr]
        self.slugs = [raw.slugs[i] for i in keep]

        if max_samples is not None and max_samples < len(self.slugs):
            rng = np.random.default_rng(seed)
            indices = rng.choice(len(self.slugs), size=max_samples, replace=False)
            indices.sort()
            self.embeddings = self.embeddings[indices]
            self.slugs = [self.slugs[i] for i in indices]

        self._validate_oov(split)

    def _validate_oov(self, split: Split):
        # BPE handles unseen tokens via subword decomposition; skip OOV check
        if not hasattr(self.vocab, "token_to_idx"):
            return

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
            raise ValueError(f"Training data has OOV tokens: {message}")
        else:
            log.warning(message)

    def __len__(self) -> int:
        return len(self.slugs)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        slug = self.slugs[idx]
        encoded = self.vocab.encode_slug(slug)  # [BOS, tok1, ..., tokN, EOS]

        # Split into input (BOS + tokens) and target (tokens + EOS)
        input_ids = encoded[:-1]  # [BOS, tok1, ..., tokN]
        target_ids = encoded[1:]  # [tok1, ..., tokN, EOS]

        # Sequences guaranteed to fit by __init__ filtering.
        assert len(input_ids) <= self.max_length, (
            f"input_ids length {len(input_ids)} exceeds max_length "
            f"{self.max_length} for slug {slug!r}"
        )

        # Pad to max_length
        pad_idx = self.vocab.pad_idx
        pad_length = self.max_length - len(input_ids)
        input_ids = input_ids + [pad_idx] * pad_length
        target_ids = target_ids + [pad_idx] * pad_length

        return {
            "embedding": torch.from_numpy(self.embeddings[idx]),
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "target_ids": torch.tensor(target_ids, dtype=torch.long),
        }
