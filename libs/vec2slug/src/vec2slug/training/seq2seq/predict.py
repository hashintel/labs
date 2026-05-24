"""Seq2seq inference: beam search with Huang-style bounded reward.

The canonical decoder uses bounded additive length reward, not GNMT-style
length normalisation:

    score(y) = log p(y | x) + r * min(words(y), B) + penalties(y)

Because the reward is capped and all future log-probability increments are
<= 0, every unfinished hypothesis has an admissible upper bound:

    UB(h) = log_prob(h) + r * B

Decoding can stop once the best completed hypothesis dominates the upper bound
of every active hypothesis. This is the Huang et al. (2017) style "optimal
modulo beam size" stopping criterion.
"""

from __future__ import annotations

import json
import math
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

# Bounded length reward defaults. The reward cap B is set to the reference P75
# word count: length bonus stops accumulating past typical slug length so the
# admissible upper bound stays tight.
DEFAULT_LENGTH_REWARD = 1.5
DEFAULT_REWARD_CAP = 6  # words (reference P75)

TRAILING_STOPWORD_PENALTY = 1.0
REPETITION_PENALTY = 2.0
NO_EOS_FALLBACK_PENALTY = 5.0


type Beam = tuple[float, list[int]]  # (raw cumulative log-prob, token ids)
type ScoredSlug = tuple[str, float]


class Seq2SeqPredictor(Predictor):
    """Beam search decoding from the prefix-conditioned transformer decoder.

    Max-length convention
    ---------------------
    Training examples are encoded as:

        input_ids  = [BOS, tok1, ..., tokN]
        target_ids = [tok1, ..., tokN, EOS]

    ``max_slug_tokens`` is the length of ``input_ids`` and ``target_ids``.
    Therefore the longest valid content sequence has ``max_slug_tokens - 1``
    content tokens followed by EOS as the final prediction. Inference must run
    for ``max_slug_tokens`` prediction steps so that these longest valid examples
    can still pay the learned EOS probability.
    """

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
        if beam_width <= 0:
            raise ValueError(f"beam_width must be positive, got {beam_width}")
        if length_reward < 0:
            raise ValueError(
                "length_reward must be non-negative for the Huang-style upper "
                f"bound, got {length_reward}"
            )
        if reward_cap < 0:
            raise ValueError(f"reward_cap must be non-negative, got {reward_cap}")

        self.manifest = json.loads((model_dir / "manifest.json").read_text())
        self._validate(self.manifest, encoder)

        model_config = self.manifest["model"]

        tokenizer_path = model_dir / "tokenizer.json"
        vocab_path = model_dir / "vocab.json"
        if tokenizer_path.exists():
            self.vocab = BpeVocab.load(tokenizer_path)
        else:
            self.vocab = SeqVocab.load(vocab_path)

        self.device = device
        self.max_length = int(model_config["max_slug_tokens"])
        self.max_content_tokens = max(self.max_length - 1, 0)
        self.beam_width = int(beam_width)
        self.length_reward = float(length_reward)
        self.reward_cap = int(reward_cap)
        self.filter_repetition = filter_repetition

        self.decode_config = {
            "score": "bounded_additive_length_reward",
            "beam_width": self.beam_width,
            "length_reward": self.length_reward,
            "reward_cap_words": self.reward_cap,
            "min_decode_tokens_before_eos": MIN_DECODE_TOKENS,
            "min_slug_words_before_eos": MIN_SLUG_WORDS,
            "trailing_stopword_penalty": TRAILING_STOPWORD_PENALTY,
            "repetition_penalty": REPETITION_PENALTY if filter_repetition else 0.0,
            "no_eos_fallback_penalty": NO_EOS_FALLBACK_PENALTY,
            "active_pruning": "partial_bounded_reward_score",
            "stopping": "huang_bounded_reward_upper_bound",
            "max_input_tokens": self.max_length,
            "max_content_tokens": self.max_content_tokens,
            "force_eos_at_max_content_tokens": True,
        }

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
                f"Expected variant 'seq2seq', got {manifest.get('variant')!r}"
            )
        if manifest.get("encoder") != encoder:
            raise ValueError(
                f"Model trained on {manifest['encoder']!r}, "
                f"but prediction requested for {encoder!r}"
            )

    def predict(self, embeddings: np.ndarray) -> list[str]:
        slugs: list[str] = []
        with torch.no_grad():
            for i in range(len(embeddings)):
                embedding = torch.as_tensor(
                    embeddings[i : i + 1], dtype=torch.float32, device=self.device
                )
                candidates = self._beam_search(embedding)
                slug = candidates[0][0] if candidates else ""
                slugs.append(slug)
        return slugs

    def predict_topk(
        self, embeddings: np.ndarray, k: int = 5
    ) -> list[list[ScoredSlug]]:
        """Return top-k slug candidates with final decode scores."""
        results: list[list[ScoredSlug]] = []
        with torch.no_grad():
            for i in range(len(embeddings)):
                embedding = torch.as_tensor(
                    embeddings[i : i + 1], dtype=torch.float32, device=self.device
                )
                candidates = self._beam_search(embedding)
                results.append(candidates[:k])
        return results

    def _decode_slug(self, tokens: list[int]) -> str:
        return self.vocab.decode_indices(tokens).strip("-")

    def _words(self, tokens: list[int]) -> list[str]:
        slug = self._decode_slug(tokens)
        return [w for w in slug.split("-") if w]

    def _score(self, log_prob: float, tokens: list[int]) -> float:
        """Score a completed beam using bounded additive length reward.

        score = log_prob + r * min(word_count, B) + penalties

        Penalties are non-positive, so the stopping upper bound
        ``log_prob + r * B`` remains admissible.
        """
        words = self._words(tokens)
        score = log_prob + self.length_reward * min(len(words), self.reward_cap)

        if words and words[-1] in STOPWORDS:
            score -= TRAILING_STOPWORD_PENALTY

        if self.filter_repetition:
            content = [w for w in words if w not in STOPWORDS]
            if len(content) != len(set(content)):
                score -= REPETITION_PENALTY

        return score

    def _partial_score(self, log_prob: float, tokens: list[int]) -> float:
        """Score an unfinished beam for active-beam pruning.

        This uses the same positive bounded-reward term as completed-beam
        scoring. It avoids pruning longer hypotheses solely because they have
        paid for more generated tokens. Negative completion penalties are not
        applied to active beams.
        """
        word_count = len(self._words(tokens))
        return log_prob + self.length_reward * min(word_count, self.reward_cap)

    def _upper_bound(self, log_prob: float) -> float:
        """Admissible upper bound on any completion of an active beam."""
        return log_prob + self.length_reward * self.reward_cap

    def _mask_never_tokens(self, logits: torch.Tensor) -> torch.Tensor:
        """Suppress tokens that should never be generated."""
        masked = logits.clone()
        masked[self.vocab.pad_idx] = -float("inf")
        unk_idx = self.vocab.unk_idx if hasattr(self.vocab, "unk_idx") else None
        if unk_idx is not None:
            masked[unk_idx] = -float("inf")
        return masked

    def _apply_token_constraints(
        self,
        logits: torch.Tensor,
        tokens: list[int],
    ) -> torch.Tensor:
        """Return masked next-token logits for one non-final active beam."""
        eos = self.vocab.eos_idx
        masked = self._mask_never_tokens(logits)

        content_length = len(tokens) - 1  # exclude BOS
        if content_length < MIN_DECODE_TOKENS:
            masked[eos] = -float("inf")

        words = self._words(tokens)
        if len(words) < MIN_SLUG_WORDS:
            masked[eos] = -float("inf")

        if words and words[-1] in STOPWORDS:
            masked[eos] = -float("inf")

        return masked

    def _force_finish_active(
        self,
        embedding: torch.Tensor,
        active: list[Beam],
    ) -> list[Beam]:
        """Close unfinished beams by charging them an EOS probability.

        This is only a fallback path. The normal decode loop force-closes beams
        once they reach ``max_content_tokens``. If an unfinished beam is still
        scorable under the model's position-embedding limit, append EOS using the
        model's raw EOS log-probability. If it is already too long to score,
        apply a fallback penalty rather than treating it as completed for free.
        """
        if not active:
            return []

        eos = self.vocab.eos_idx
        pad = self.vocab.pad_idx
        finished: list[Beam] = []

        # The model can score inputs of length <= max_length. Longer active beams
        # should not normally exist with forced final EOS enabled.
        scorable: list[Beam] = [b for b in active if len(b[1]) <= self.max_length]
        unscorable: list[Beam] = [b for b in active if len(b[1]) > self.max_length]

        if scorable:
            max_len = max(len(tokens) for _, tokens in scorable)
            padded = [
                tokens + [pad] * (max_len - len(tokens)) for _, tokens in scorable
            ]
            input_ids = torch.tensor(padded, dtype=torch.long, device=self.device)
            embedding_batch = embedding.expand(len(scorable), -1)
            logits = self.model(embedding_batch, input_ids)

            for beam_idx, (log_prob, tokens) in enumerate(scorable):
                next_logits = logits[beam_idx, len(tokens) - 1, :]
                log_probs = torch.log_softmax(
                    self._mask_never_tokens(next_logits), dim=0
                )
                eos_log_prob = float(log_probs[eos].item())
                if math.isfinite(eos_log_prob):
                    finished.append((log_prob + eos_log_prob, tokens + [eos]))
                else:
                    finished.append((
                        log_prob - NO_EOS_FALLBACK_PENALTY,
                        tokens + [eos],
                    ))

        for log_prob, tokens in unscorable:
            finished.append((log_prob - NO_EOS_FALLBACK_PENALTY, tokens + [eos]))

        return finished

    def _beam_search(self, embedding: torch.Tensor) -> list[ScoredSlug]:
        """Beam search with Huang-style score-based optimal stopping.

        Returns completed candidates as ``(slug, score)`` pairs, deduplicated and
        sorted by score descending.
        """
        bos = self.vocab.bos_idx
        eos = self.vocab.eos_idx
        pad = self.vocab.pad_idx
        k = self.beam_width

        active: list[Beam] = [(0.0, [bos])]
        completed: list[Beam] = []
        best_finished_score = -float("inf")
        stopped_by_bound = False

        # Run for max_length prediction steps: at most max_length - 1 content
        # tokens, then EOS on the final step for longest valid examples.
        for _ in range(self.max_length):
            if not active:
                break

            candidates: list[Beam] = []

            max_len = max(len(tokens) for _, tokens in active)
            padded = [tokens + [pad] * (max_len - len(tokens)) for _, tokens in active]
            input_ids = torch.tensor(padded, dtype=torch.long, device=self.device)
            embedding_batch = embedding.expand(len(active), -1)
            all_logits = self.model(embedding_batch, input_ids)

            for beam_idx, (log_prob, tokens) in enumerate(active):
                content_length = len(tokens) - 1  # exclude BOS
                force_eos = content_length >= self.max_content_tokens

                raw_next_logits = all_logits[beam_idx, len(tokens) - 1, :]

                if force_eos:
                    # Force the only valid next token to be EOS, but compute its
                    # probability under the model distribution so max-length beams
                    # do not avoid paying the EOS log-probability cost.
                    log_probs = torch.log_softmax(
                        self._mask_never_tokens(raw_next_logits), dim=0
                    )
                    top_log_probs = log_probs[eos].reshape(1)
                    top_indices = torch.tensor(
                        [eos], dtype=torch.long, device=self.device
                    )
                else:
                    next_logits = self._apply_token_constraints(raw_next_logits, tokens)
                    if not torch.isfinite(next_logits).any():
                        # Defensive fallback: if constraints remove every token,
                        # close the beam with EOS and charge its raw probability.
                        log_probs = torch.log_softmax(
                            self._mask_never_tokens(raw_next_logits), dim=0
                        )
                        top_log_probs = log_probs[eos].reshape(1)
                        top_indices = torch.tensor(
                            [eos], dtype=torch.long, device=self.device
                        )
                    else:
                        log_probs = torch.log_softmax(next_logits, dim=0)
                        top_count = min(k, log_probs.numel())
                        top_log_probs, top_indices = log_probs.topk(top_count)

                for token_log_prob, token_idx in zip(top_log_probs, top_indices):
                    token_log_prob_float = float(token_log_prob.item())
                    if not math.isfinite(token_log_prob_float):
                        continue

                    token_id = int(token_idx.item())
                    new_log_prob = log_prob + token_log_prob_float
                    new_tokens = tokens + [token_id]

                    if token_id == eos:
                        completed.append((new_log_prob, new_tokens))
                        score = self._score(new_log_prob, new_tokens)
                        best_finished_score = max(best_finished_score, score)
                    else:
                        candidates.append((new_log_prob, new_tokens))

            # Keep top-k active beams under a partial form of the final objective,
            # rather than raw log-probability. This is not a theorem about beams
            # already pruned away, but it makes pruning consistent with the score.
            candidates.sort(
                key=lambda beam: self._partial_score(beam[0], beam[1]),
                reverse=True,
            )
            active = candidates[:k]

            # Stop once no retained active beam can beat the best completed beam.
            if active and best_finished_score > -float("inf"):
                max_active_bound = max(self._upper_bound(lp) for lp, _ in active)
                if best_finished_score >= max_active_bound:
                    stopped_by_bound = True
                    break

        # Do not include unfinished beams after a valid Huang bound stop: by
        # construction they cannot beat the best completed candidate. If the loop
        # simply exhausted its budget and something is still active, finish it by
        # charging EOS instead of treating it as completed for free.
        if active and not stopped_by_bound:
            completed.extend(self._force_finish_active(embedding, active))

        scored = [
            (self._score(log_prob, tokens), tokens) for log_prob, tokens in completed
        ]
        scored.sort(key=lambda item: item[0], reverse=True)

        seen: set[str] = set()
        results: list[ScoredSlug] = []
        for score, tokens in scored:
            slug = self._decode_slug(tokens)
            if not slug or slug in seen:
                continue
            seen.add(slug)
            results.append((slug, score))

        return results
