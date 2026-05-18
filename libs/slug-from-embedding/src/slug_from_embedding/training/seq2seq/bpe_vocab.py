"""BPE vocabulary for seq2seq slug generation.

Trains a byte-pair encoding tokenizer on slug strings, with `-` as a
special token so the model explicitly generates word boundaries. This
gives lossless reconstruction of any slug token via subword composition,
eliminating the ~47% token loss from KMeans compression.

Sequences are longer than compressed vocab (8 slug tokens × ~2-3 subwords
= ~20 units) but still short enough for the decoder.
"""

from pathlib import Path
from typing import Self

from tokenizers import Tokenizer
from tokenizers.models import BPE
from tokenizers.pre_tokenizers import Split
from tokenizers.trainers import BpeTrainer

from slug_from_embedding.config import Encoder
from slug_from_embedding.libs.workspace import Workspace

PAD = "<pad>"
BOS = "<bos>"
EOS = "<eos>"
UNK = "<unk>"
HYPHEN = "-"

SPECIAL_TOKENS = [PAD, BOS, EOS, UNK, HYPHEN]


class BpeVocab:
    """BPE tokenizer for slug generation.

    Wraps a HuggingFace tokenizer trained on slug strings. The hyphen
    is a special token: the model generates subword units and explicit
    hyphens to reconstruct full slugs.
    """

    def __init__(self, tokenizer: Tokenizer):
        self.tokenizer = tokenizer
        self.pad_idx = tokenizer.token_to_id(PAD)
        self.bos_idx = tokenizer.token_to_id(BOS)
        self.eos_idx = tokenizer.token_to_id(EOS)
        self.unk_idx = tokenizer.token_to_id(UNK)
        self.hyphen_idx = tokenizer.token_to_id(HYPHEN)

    def __len__(self) -> int:
        return self.tokenizer.get_vocab_size()

    @property
    def compression(self) -> None:
        """BPE has no compression mapping; interface compat with SeqVocab."""
        return None

    def encode_slug(self, slug: str) -> list[int]:
        """Encode a slug as [BOS, subword1, -, subword2, ..., EOS]."""
        encoded = self.tokenizer.encode(slug)
        return [self.bos_idx] + encoded.ids + [self.eos_idx]

    def decode_indices(self, indices: list[int]) -> str:
        """Decode indices to a slug string, stopping at EOS.

        Reconstructs by joining subword tokens directly (no spaces),
        with `-` tokens becoming hyphens in the output.
        """
        parts: list[str] = []
        for idx in indices:
            if idx == self.eos_idx:
                break
            if idx in (self.pad_idx, self.bos_idx):
                continue
            if idx == self.hyphen_idx:
                parts.append("-")
            else:
                token = self.tokenizer.id_to_token(idx)
                if token is not None:
                    parts.append(token)
        return "".join(parts)

    def save(self, path: Path):
        self.tokenizer.save(str(path))

    @classmethod
    def load(cls, path: Path) -> Self:
        tokenizer = Tokenizer.from_file(str(path))
        return cls(tokenizer)

    @classmethod
    def train(
        cls,
        workspace: Workspace,
        encoder: Encoder,
        vocab_size: int = 5000,
    ) -> Self:
        """Train BPE on training split slugs."""
        slugs = workspace.load_split_slugs(encoder, "train")
        print(f"  Training BPE on {len(slugs):,} slugs...")

        tokenizer = Tokenizer(BPE(unk_token=UNK))
        # Split on hyphen so BPE learns subword units within slug tokens,
        # not across hyphen boundaries
        tokenizer.pre_tokenizer = Split(pattern=HYPHEN, behavior="isolated")

        trainer = BpeTrainer(
            vocab_size=vocab_size,
            special_tokens=SPECIAL_TOKENS,
            show_progress=True,
        )
        tokenizer.train_from_iterator(slugs, trainer=trainer)

        result = cls(tokenizer)

        # Stats
        total_subwords = 0
        total_slugs = 0
        for slug in slugs[:10000]:
            encoded = result.encode_slug(slug)
            total_subwords += len(encoded) - 2  # exclude BOS/EOS
            total_slugs += 1
        avg_length = total_subwords / total_slugs
        print(f"  Vocab size: {len(result)}")
        print(f"  Avg encoded length: {avg_length:.1f} subwords (sample of 10k)")

        return result
