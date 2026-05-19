"""Seq2seq inference: beam search decoding.

Beam search maintains k candidate sequences in parallel, selecting by
total length-normalized log-probability. This avoids the repetition
pathology of greedy decoding without post-hoc patchwork: repetitive
sequences naturally score worse because the model's predictions become
poorly calibrated on histories it never saw during training.
"""

import json
from pathlib import Path

import numpy as np
import torch

from slug_from_embedding.config import STOPWORDS, Encoder

from ..predictor import Predictor
from .bpe_vocab import BpeVocab
from .model import SlugDecoder
from .vocab import SeqVocab

MIN_DECODE_TOKENS = 3
MIN_SLUG_WORDS = 3


class Seq2SeqPredictor(Predictor):
    """Beam search decoding from the prefix-conditioned transformer decoder."""

    def __init__(
        self,
        model_dir: Path,
        encoder: Encoder,
        device: str = "cpu",
        beam_width: int = 4,
        length_penalty: float = 1.2,
        filter_repetition: bool = True,
    ):
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
        self.beam_width = beam_width
        self.length_penalty = length_penalty
        self.filter_repetition = filter_repetition

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
        slugs = []
        with torch.no_grad():
            for i in range(len(embeddings)):
                embedding = torch.from_numpy(embeddings[i : i + 1]).to(self.device)
                slug = self._beam_search_single(embedding)
                slugs.append(slug)
        return slugs

    def _beam_search_single(self, embedding: torch.Tensor) -> str:
        """Beam search for a single embedding."""
        bos = self.vocab.bos_idx
        eos = self.vocab.eos_idx
        pad = self.vocab.pad_idx
        unk_idx = self.vocab.unk_idx if hasattr(self.vocab, "unk_idx") else None
        k = self.beam_width

        # Each beam: (log_prob, token_ids)
        active: list[tuple[float, list[int]]] = [(0.0, [bos])]
        completed: list[tuple[float, list[int]]] = []

        # Expand embedding to beam width
        # (recomputed each step since active beam count can change)

        # max_length - 1: tokens start as [BOS] (len 1) and the model
        # prepends a prefix, so total positions = 1 + len(tokens). The
        # position embedding has max_length + 1 slots (0..max_length),
        # so len(tokens) must stay <= max_length.
        for step in range(self.max_length - 1):
            if not active:
                break

            candidates: list[tuple[float, list[int]]] = []

            # Batch all active beams into a single forward pass
            max_len = max(len(tokens) for _, tokens in active)
            padded = [
                tokens + [pad] * (max_len - len(tokens))
                for _, tokens in active
            ]
            input_ids = torch.tensor(padded, dtype=torch.long, device=self.device)
            embedding_batch = embedding.expand(len(active), -1)
            all_logits = self.model(embedding_batch, input_ids)

            for beam_idx, (log_prob, tokens) in enumerate(active):
                # Get logits at the actual last position (not padded)
                next_logits = all_logits[beam_idx, len(tokens) - 1, :]

                # Suppress PAD always
                next_logits[pad] = -float("inf")

                # Suppress EOS until minimum subword count
                content_length = len(tokens) - 1  # exclude BOS
                if content_length < MIN_DECODE_TOKENS:
                    next_logits[eos] = -float("inf")

                # Suppress EOS until minimum slug word count
                slug_so_far = self.vocab.decode_indices(tokens[1:])
                slug_stripped = slug_so_far.strip("-")
                words = slug_stripped.split("-") if slug_stripped else []
                if len(words) < MIN_SLUG_WORDS:
                    next_logits[eos] = -float("inf")

                # Hard-suppress EOS after stopwords
                if words and words[-1] in STOPWORDS:
                    next_logits[eos] = -float("inf")

                # Suppress UNK
                if unk_idx is not None:
                    next_logits[unk_idx] = -float("inf")

                # Log probabilities
                log_probs = torch.log_softmax(next_logits, dim=0)

                # Take top-k expansions
                top_log_probs, top_indices = log_probs.topk(k)

                for j in range(k):
                    token_id = top_indices[j].item()
                    new_log_prob = log_prob + top_log_probs[j].item()
                    new_tokens = tokens + [token_id]

                    if token_id == eos:
                        completed.append((new_log_prob, new_tokens))
                    else:
                        candidates.append((new_log_prob, new_tokens))

            # Keep top-k active beams
            candidates.sort(key=lambda x: x[0], reverse=True)
            active = candidates[:k]

            # Stop if we have enough completed beams
            if len(completed) >= k:
                break

        # Include active beams that hit max_length (no forced EOS cost)
        for log_prob, tokens in active:
            completed.append((log_prob, tokens))

        # Score and rank completed beams
        scored: list[tuple[float, bool, list[int]]] = []
        for log_prob, tokens in completed:
            length = len(tokens) - 2  # exclude BOS and EOS
            penalty = ((5.0 + length) / 6.0) ** self.length_penalty
            score = log_prob / penalty

            slug = self.vocab.decode_indices(tokens).strip("-")
            words = [w for w in slug.split("-") if w and w not in STOPWORDS]

            # Trailing stopword penalty
            last_word = slug.split("-")[-1] if slug else ""
            if last_word in STOPWORDS:
                score -= 1.0

            has_repeat = len(words) != len(set(words))
            scored.append((score, has_repeat, tokens))

        # Prefer non-repeating; within each group, take highest score
        if self.filter_repetition:
            scored.sort(key=lambda x: (x[1], -x[0]))
        else:
            scored.sort(key=lambda x: -x[0])
        best_tokens = scored[0][2] if scored else [bos, eos]

        slug = self.vocab.decode_indices(best_tokens)
        slug = slug.strip("-")
        return slug if slug else ""
