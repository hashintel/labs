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
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

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

# Cache decoded prefixes because the beam scorer and constraints repeatedly
# inspect the same short token sequences. Keep this bounded for long batch jobs.
DECODE_CACHE_SIZE = 262_144


type Beam = tuple[float, list[int]]  # (raw cumulative log-prob, token ids)
type ScoredSlug = tuple[str, float]
type LayerCache = tuple[torch.Tensor, torch.Tensor]  # (K, V), [heads, seq, head_dim]
type KVCache = tuple[LayerCache, ...]


@dataclass(slots=True)
class CachedBeam:
    """Active beam state for cached incremental decoding."""

    log_prob: float
    tokens: list[int]
    cache: KVCache
    next_logits: torch.Tensor


@dataclass(slots=True)
class PendingBeam:
    """Candidate selected for one cached decoder advance."""

    log_prob: float
    tokens: list[int]
    parent_cache: KVCache
    token_id: int
    position: int


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
        use_cache: bool = True,
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
        self.use_cache = bool(use_cache)

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
            "kv_cache": self.use_cache,
            "decode_cache_size": DECODE_CACHE_SIZE,
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

        if self.use_cache and not self._supports_kv_cache():
            # The cache path intentionally reuses the model's existing MHA
            # weights. If the model architecture changes in a way the manual
            # incremental step cannot mirror exactly, fall back to the regular
            # full-prefix forward path rather than risking divergent logits.
            self.use_cache = False
        self.decode_config["kv_cache"] = self.use_cache

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
        if len(embeddings) == 0:
            return slugs

        # The CLI already chunks inputs. Move each chunk to the target device
        # once instead of creating a new tensor for every row.
        embedding_batch = torch.as_tensor(
            embeddings, dtype=torch.float32, device=self.device
        )
        with torch.inference_mode():
            for i in range(len(embedding_batch)):
                candidates = self._beam_search(embedding_batch[i : i + 1])
                slug = candidates[0][0] if candidates else ""
                slugs.append(slug)
        return slugs

    def predict_topk(
        self, embeddings: np.ndarray, k: int = 5
    ) -> list[list[ScoredSlug]]:
        """Return top-k slug candidates with final decode scores."""
        results: list[list[ScoredSlug]] = []
        if len(embeddings) == 0:
            return results

        embedding_batch = torch.as_tensor(
            embeddings, dtype=torch.float32, device=self.device
        )
        with torch.inference_mode():
            for i in range(len(embedding_batch)):
                candidates = self._beam_search(embedding_batch[i : i + 1])
                results.append(candidates[:k])
        return results

    @lru_cache(maxsize=DECODE_CACHE_SIZE)  # noqa: B019
    def _decode_slug_tuple(self, tokens: tuple[int, ...]) -> str:
        return self.vocab.decode_indices(list(tokens)).strip("-")

    @lru_cache(maxsize=DECODE_CACHE_SIZE)  # noqa: B019
    def _words_tuple(self, tokens: tuple[int, ...]) -> tuple[str, ...]:
        slug = self._decode_slug_tuple(tokens)
        return tuple(w for w in slug.split("-") if w)

    def _decode_slug(self, tokens: list[int]) -> str:
        return self._decode_slug_tuple(tuple(tokens))

    def _words(self, tokens: list[int]) -> list[str]:
        return list(self._words_tuple(tuple(tokens)))

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

    def _supports_kv_cache(self) -> bool:
        """Return whether the model layout is supported by manual KV caching.

        The cache path mirrors ``DecoderBlock.forward`` exactly for the current
        architecture: pre-norm self-attention with one ``nn.MultiheadAttention``
        module where query/key/value share the same embedding dimension. If a
        future model changes those assumptions, use the uncached path until the
        cache implementation is updated too.
        """
        for block in self.model.blocks:
            attn = block.attn
            if getattr(attn, "in_proj_weight", None) is None:
                return False
            if getattr(attn, "bias_k", None) is not None:
                return False
            if getattr(attn, "bias_v", None) is not None:
                return False
            if getattr(attn, "add_zero_attn", False):
                return False
            if attn.embed_dim % attn.num_heads != 0:
                return False
        return True

    def _cached_self_attention(
        self,
        attn: torch.nn.MultiheadAttention,
        x: torch.Tensor,
        past_k: torch.Tensor | None,
        past_v: torch.Tensor | None,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """One-token self-attention step using cached keys and values.

        Args:
            attn: The block's existing ``nn.MultiheadAttention`` module.
            x: Current normalized hidden state, shape ``[B, D]``.
            past_k/past_v: Optional caches, shape ``[B, H, S, Dh]``.

        Returns:
            ``(attn_output, new_k, new_v)`` where caches include the current
            token. Because the query is always the newest token and the cache
            contains only prefix/past/current positions, no causal mask is
            needed for this single-step attention call.
        """
        batch_size, embed_dim = x.shape
        num_heads = attn.num_heads
        head_dim = embed_dim // num_heads

        qkv = F.linear(x, attn.in_proj_weight, attn.in_proj_bias)
        q, k, v = qkv.chunk(3, dim=-1)

        q = q.view(batch_size, num_heads, 1, head_dim)
        k = k.view(batch_size, num_heads, 1, head_dim)
        v = v.view(batch_size, num_heads, 1, head_dim)

        if past_k is not None:
            k_all = torch.cat([past_k, k], dim=2)
            v_all = torch.cat([past_v, v], dim=2)
        else:
            k_all = k
            v_all = v

        scores = torch.matmul(q, k_all.transpose(-2, -1)) / math.sqrt(head_dim)
        weights = torch.softmax(scores, dim=-1)
        attn_output = torch.matmul(weights, v_all)
        attn_output = (
            attn_output.transpose(1, 2).contiguous().view(batch_size, embed_dim)
        )
        attn_output = attn.out_proj(attn_output)
        return attn_output, k_all, v_all

    def _init_prefix_cache(self, embedding: torch.Tensor) -> KVCache:
        """Run the source prefix token once and cache it for every layer."""
        batch_size = embedding.size(0)
        if batch_size != 1:
            raise ValueError("_init_prefix_cache expects a single embedding")

        positions = torch.zeros(batch_size, dtype=torch.long, device=self.device)
        x = self.model.embedding_projection(embedding)
        x = x + self.model.position_embedding(positions)
        x = self.model.dropout(x)

        cache: list[LayerCache] = []
        for block in self.model.blocks:
            normed = block.ln1(x)
            attn_out, k, v = self._cached_self_attention(block.attn, normed, None, None)
            x = x + attn_out
            x = x + block.ffn(block.ln2(x))
            cache.append((k[0].contiguous(), v[0].contiguous()))

        return tuple(cache)

    def _append_cached_tokens(
        self,
        parent_caches: list[KVCache],
        token_ids: list[int],
        positions: list[int],
    ) -> tuple[list[KVCache], torch.Tensor]:
        """Append one token to each cached beam and return next-token logits.

        ``positions`` are model sequence positions including the prefix at 0:
        BOS is position 1, the first content token is position 2, and so on.
        """
        if not token_ids:
            return [], torch.empty(0, len(self.vocab), device=self.device)

        batch_size = len(token_ids)
        token_tensor = torch.tensor(token_ids, dtype=torch.long, device=self.device)
        position_tensor = torch.tensor(positions, dtype=torch.long, device=self.device)

        x = self.model.token_embedding(token_tensor)
        x = x + self.model.position_embedding(position_tensor)
        x = self.model.dropout(x)

        new_batched_cache: list[tuple[torch.Tensor, torch.Tensor]] = []
        for layer_idx, block in enumerate(self.model.blocks):
            past_k = torch.stack(
                [cache[layer_idx][0] for cache in parent_caches], dim=0
            )
            past_v = torch.stack(
                [cache[layer_idx][1] for cache in parent_caches], dim=0
            )

            normed = block.ln1(x)
            attn_out, k, v = self._cached_self_attention(
                block.attn, normed, past_k, past_v
            )
            x = x + attn_out
            x = x + block.ffn(block.ln2(x))
            new_batched_cache.append((k, v))

        logits = self.model.output_projection(self.model.ln_final(x))

        # Split the batched cache back into per-beam states. ``contiguous`` avoids
        # keeping the whole temporary batch tensor alive through a narrow view.
        caches: list[KVCache] = []
        for beam_idx in range(batch_size):
            layers: list[LayerCache] = []
            for k, v in new_batched_cache:
                layers.append((k[beam_idx].contiguous(), v[beam_idx].contiguous()))
            caches.append(tuple(layers))

        return caches, logits

    def _initial_cached_beam(self, embedding: torch.Tensor) -> CachedBeam:
        """Create the initial active beam after consuming prefix + BOS."""
        bos = self.vocab.bos_idx
        prefix_cache = self._init_prefix_cache(embedding)
        caches, logits = self._append_cached_tokens([prefix_cache], [bos], [1])
        return CachedBeam(
            log_prob=0.0,
            tokens=[bos],
            cache=caches[0],
            next_logits=logits[0],
        )

    def _force_finish_cached_active(self, active: list[CachedBeam]) -> list[Beam]:
        """Close cached active beams by charging current EOS probability."""
        eos = self.vocab.eos_idx
        finished: list[Beam] = []
        for beam in active:
            log_probs = torch.log_softmax(
                self._mask_never_tokens(beam.next_logits), dim=0
            )
            eos_log_prob = float(log_probs[eos].item())
            if math.isfinite(eos_log_prob):
                finished.append((beam.log_prob + eos_log_prob, beam.tokens + [eos]))
            else:
                finished.append((
                    beam.log_prob - NO_EOS_FALLBACK_PENALTY,
                    beam.tokens + [eos],
                ))
        return finished

    def _beam_search(self, embedding: torch.Tensor) -> list[ScoredSlug]:
        if self.use_cache:
            return self._beam_search_cached(embedding)
        return self._beam_search_uncached(embedding)

    def _beam_search_cached(self, embedding: torch.Tensor) -> list[ScoredSlug]:
        """Beam search using per-layer KV caches.

        The cached version keeps the same scoring, constraints, forced-EOS
        behavior, and Huang-style stopping rule as the uncached implementation.
        The only intended difference is compute: every retained active beam is
        advanced by one token instead of recomputing the whole prefix on every
        beam step.
        """
        eos = self.vocab.eos_idx
        k = self.beam_width

        active: list[CachedBeam] = [self._initial_cached_beam(embedding)]
        completed: list[Beam] = []
        best_finished_score = -float("inf")
        stopped_by_bound = False

        for _ in range(self.max_length):
            if not active:
                break

            pending: list[PendingBeam] = []

            for beam in active:
                content_length = len(beam.tokens) - 1  # exclude BOS
                force_eos = content_length >= self.max_content_tokens
                raw_next_logits = beam.next_logits

                if force_eos:
                    # Same as the uncached path: EOS is the only valid next
                    # token, but its probability is still paid under the raw
                    # model distribution.
                    log_probs = torch.log_softmax(
                        self._mask_never_tokens(raw_next_logits), dim=0
                    )
                    top_log_probs = log_probs[eos].reshape(1)
                    top_indices = torch.tensor(
                        [eos], dtype=torch.long, device=self.device
                    )
                else:
                    next_logits = self._apply_token_constraints(
                        raw_next_logits, beam.tokens
                    )
                    if not torch.isfinite(next_logits).any():
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
                    new_log_prob = beam.log_prob + token_log_prob_float
                    new_tokens = beam.tokens + [token_id]

                    if token_id == eos:
                        completed.append((new_log_prob, new_tokens))
                        score = self._score(new_log_prob, new_tokens)
                        best_finished_score = max(best_finished_score, score)
                    else:
                        # Position of the newly appended token in the model
                        # sequence. Prefix is 0, BOS is 1, content starts at 2.
                        pending.append(
                            PendingBeam(
                                log_prob=new_log_prob,
                                tokens=new_tokens,
                                parent_cache=beam.cache,
                                token_id=token_id,
                                position=len(new_tokens),
                            )
                        )

            pending.sort(
                key=lambda beam: self._partial_score(beam.log_prob, beam.tokens),
                reverse=True,
            )
            selected = pending[:k]

            if selected:
                caches, next_logits = self._append_cached_tokens(
                    [beam.parent_cache for beam in selected],
                    [beam.token_id for beam in selected],
                    [beam.position for beam in selected],
                )
                active = [
                    CachedBeam(
                        log_prob=beam.log_prob,
                        tokens=beam.tokens,
                        cache=caches[i],
                        next_logits=next_logits[i],
                    )
                    for i, beam in enumerate(selected)
                ]
            else:
                active = []

            if active and best_finished_score > -float("inf"):
                max_active_bound = max(
                    self._upper_bound(beam.log_prob) for beam in active
                )
                if best_finished_score >= max_active_bound:
                    stopped_by_bound = True
                    break

        if active and not stopped_by_bound:
            completed.extend(self._force_finish_cached_active(active))

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

    def _beam_search_uncached(self, embedding: torch.Tensor) -> list[ScoredSlug]:
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
