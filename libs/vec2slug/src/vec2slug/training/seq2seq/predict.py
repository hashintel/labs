"""Seq2seq inference: beam search with optimal stopping.

Uses bounded additive length reward with score-based stopping
(Huang et al. 2017) instead of the standard count-based early
stopping that biases toward short outputs.
"""

import json
from pathlib import Path

import numpy as np
import torch

from vec2slug.config import STOPWORDS, Encoder

from ..predictor import Predictor
from .bpe_vocab import BpeVocab
from .model import SlugDecoder
from .vocab import SeqVocab

MIN_DECODE_TOKENS = 3
MIN_SLUG_WORDS = 3


# Bounded length reward defaults. The reward cap B is set to the
# reference P75 word count: length bonus stops accumulating past
# typical slug length so the admissible upper bound stays tight.
DEFAULT_LENGTH_REWARD = 1.5
DEFAULT_REWARD_CAP = 6  # words (reference P75)


class Seq2SeqPredictor(Predictor):
    """Beam search decoding from the prefix-conditioned transformer decoder."""

    def __init__(
        self,
        model_dir: Path,
        encoder: Encoder,
        device: str = "cpu",
        beam_width: int = 4,
        length_reward: float = DEFAULT_LENGTH_REWARD,
        reward_cap: int = DEFAULT_REWARD_CAP,
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
        self.length_reward = length_reward
        self.reward_cap = reward_cap
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
                candidates = self._beam_search(embedding)
                slug = candidates[0][0] if candidates else ""
                slugs.append(slug)
        return slugs

    def predict_topk(
        self, embeddings: np.ndarray, k: int = 5
    ) -> list[list[tuple[str, float]]]:
        """Return top-k slug candidates with scores for each embedding."""
        results = []
        with torch.no_grad():
            for i in range(len(embeddings)):
                embedding = torch.from_numpy(embeddings[i : i + 1]).to(self.device)
                candidates = self._beam_search(embedding)
                results.append(candidates[:k])
        return results

    def _score(self, log_prob: float, tokens: list[int]) -> float:
        """Score a completed beam using bounded additive length reward.

        score = log_prob + r * min(word_count, B) + penalties

        The reward cap B means length bonus stops accumulating past
        typical slug length. Short outputs can still win if the model
        is confident enough.
        """
        slug = self.vocab.decode_indices(tokens).strip("-")
        words = slug.split("-") if slug else []
        word_count = len([w for w in words if w])

        score = log_prob + self.length_reward * min(word_count, self.reward_cap)

        # Trailing stopword penalty
        if words and words[-1] in STOPWORDS:
            score -= 1.0

        # Repetition as additive penalty (not lexicographic) so the
        # stopping bound stays sound.
        if self.filter_repetition:
            content = [w for w in words if w and w not in STOPWORDS]
            if len(content) != len(set(content)):
                score -= 2.0

        return score

    def _beam_search(self, embedding: torch.Tensor) -> list[tuple[str, float]]:
        """Beam search with score-based optimal stopping.

        Returns all completed candidates as (slug, score) pairs,
        deduplicated and sorted by score descending.

        Instead of stopping when K beams have completed (which favors
        short outputs), stops when the best completed beam provably
        dominates every active beam's upper bound:

            UB(h) = log_prob(h) + r * B

        because future log-prob increments are <= 0 and total reward
        can never exceed r * B.

        See: Huang et al. (2017), "When to Finish? Optimal Beam Search
        for Neural Text Generation (modulo beam size)".
        """
        bos = self.vocab.bos_idx
        eos = self.vocab.eos_idx
        pad = self.vocab.pad_idx
        unk_idx = self.vocab.unk_idx if hasattr(self.vocab, "unk_idx") else None
        k = self.beam_width
        r = self.length_reward
        B = self.reward_cap

        active: list[tuple[float, list[int]]] = [(0.0, [bos])]
        best_finished_score = -float("inf")
        completed: list[tuple[float, list[int]]] = []

        for step in range(self.max_length - 1):
            if not active:
                break

            candidates: list[tuple[float, list[int]]] = []

            # Batch all active beams into a single forward pass
            max_len = max(len(tokens) for _, tokens in active)
            padded = [tokens + [pad] * (max_len - len(tokens)) for _, tokens in active]
            input_ids = torch.tensor(padded, dtype=torch.long, device=self.device)
            embedding_batch = embedding.expand(len(active), -1)
            all_logits = self.model(embedding_batch, input_ids)

            for beam_idx, (log_prob, tokens) in enumerate(active):
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

                log_probs = torch.log_softmax(next_logits, dim=0)
                top_log_probs, top_indices = log_probs.topk(k)

                for j in range(k):
                    token_id = top_indices[j].item()
                    new_log_prob = log_prob + top_log_probs[j].item()
                    new_tokens = tokens + [token_id]

                    if token_id == eos:
                        score = self._score(new_log_prob, new_tokens)
                        completed.append((new_log_prob, new_tokens))
                        if score > best_finished_score:
                            best_finished_score = score
                    else:
                        candidates.append((new_log_prob, new_tokens))

            # Keep top-k active beams by raw log-prob
            candidates.sort(key=lambda x: x[0], reverse=True)
            active = candidates[:k]

            # Score-based optimal stopping: stop when the best finished
            # beam dominates every active beam's upper bound.
            if active and best_finished_score > -float("inf"):
                best_active_log_prob = active[0][0]
                upper_bound = best_active_log_prob + r * B
                if best_finished_score >= upper_bound:
                    break

        # Include active beams that hit max_length
        for log_prob, tokens in active:
            completed.append((log_prob, tokens))

        # Final ranking by the same score used for stopping
        scored = [
            (self._score(log_prob, tokens), tokens)
            for log_prob, tokens in completed
        ]
        scored.sort(key=lambda x: -x[0])
        # Deduplicate and sort by score
        seen: set[str] = set()
        results: list[tuple[str, float]] = []
        for score, tokens in scored:
            slug = self.vocab.decode_indices(tokens).strip("-")
            if not slug or slug in seen:
                continue
            seen.add(slug)
            results.append((slug, score))

        return results
