"""Seq2seq inference: greedy autoregressive decoding."""

import json
from pathlib import Path

import numpy as np
import torch

from slug_from_embedding.config import Encoder

from ..predictor import Predictor
from .bpe_vocab import BpeVocab
from .model import SlugDecoder
from .vocab import SeqVocab


MIN_DECODE_TOKENS = 3


class Seq2SeqPredictor(Predictor):
    """Greedy decoding from the prefix-conditioned transformer decoder."""

    def __init__(self, model_dir: Path, encoder: Encoder, device: str = "cpu"):
        self.manifest = json.loads((model_dir / "manifest.json").read_text())
        self._validate(self.manifest, encoder)

        model_config = self.manifest["model"]

        # Load the right vocab type
        tokenizer_path = model_dir / "tokenizer.json"
        vocab_path = model_dir / "vocab.json"
        if tokenizer_path.exists():
            self.vocab = BpeVocab.load(tokenizer_path)
        else:
            self.vocab = SeqVocab.load(vocab_path)

        self.device = device
        self.max_length = model_config["max_slug_tokens"]

        self.model = SlugDecoder(
            vocab_size=model_config["vocab_size"],
            embed_dim=model_config["embed_dim"],
            num_heads=model_config["num_heads"],
            num_layers=model_config["num_layers"],
            input_dim=model_config["input_dim"],
            max_length=model_config["max_slug_tokens"],
            dropout=model_config["dropout"],
        )
        self.model.load_state_dict(
            torch.load(model_dir / "best.pt", map_location=device, weights_only=True)
        )
        self.model.to(device)
        self.model.eval()

    def _validate(self, manifest: dict, encoder: Encoder):
        if manifest.get("variant") != "seq2seq":
            raise ValueError(
                f"Expected variant 'seq2seq', got '{manifest.get('variant')}'"
            )
        if manifest.get("encoder") != encoder:
            raise ValueError(
                f"Model trained on '{manifest['encoder']}', "
                f"but prediction requested for '{encoder}'"
            )

    def predict(self, embeddings: np.ndarray) -> list[str]:
        batch_size = len(embeddings)
        embedding_tensor = torch.from_numpy(embeddings).to(self.device)

        bos = self.vocab.bos_idx
        eos = self.vocab.eos_idx
        pad = self.vocab.pad_idx

        # Start with BOS
        generated = torch.full(
            (batch_size, 1), bos, dtype=torch.long, device=self.device
        )
        finished = torch.zeros(batch_size, dtype=torch.bool, device=self.device)

        # For BPE, no-repeat should only suppress at the slug-token level,
        # not subword level. Disable no-repeat for BPE.
        use_no_repeat = isinstance(self.vocab, SeqVocab)

        with torch.no_grad():
            for _ in range(self.max_length):
                logits = self.model(embedding_tensor, generated)
                # Take the last position's logits
                next_logits = logits[:, -1, :]
                # Suppress EOS until minimum length reached
                tokens_generated = generated.size(1) - 1  # exclude BOS
                if tokens_generated < MIN_DECODE_TOKENS:
                    next_logits[:, eos] = -float("inf")
                    next_logits[:, pad] = -float("inf")
                # No-repeat for compressed vocab (not BPE)
                if use_no_repeat:
                    for i in range(batch_size):
                        for token_id in generated[i].tolist():
                            if token_id not in (bos, eos, pad):
                                next_logits[i, token_id] = -float("inf")
                # Greedy: pick the most likely token
                next_token = next_logits.argmax(dim=-1)  # [batch]
                # Mask finished sequences to PAD
                next_token = next_token.masked_fill(finished, pad)
                # Mark sequences that just generated EOS
                finished = finished | (next_token == eos)
                # Append
                generated = torch.cat(
                    [generated, next_token.unsqueeze(1)], dim=1
                )
                # Stop if all finished
                if finished.all():
                    break

        # Decode each sequence
        slugs = []
        for i in range(batch_size):
            indices = generated[i, 1:].cpu().tolist()  # skip BOS
            slug = self.vocab.decode_indices(indices)
            slugs.append(slug if slug else "")

        return slugs
