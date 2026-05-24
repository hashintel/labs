# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "numpy>=1.24",
#     "onnxruntime>=1.16",
# ]
# ///
"""vec2slug: generate URL slugs from text embeddings.

Standalone inference script for vec2slug models. Loads an ONNX (or
PyTorch) model and its JSON sidecar, runs beam search decoding, and
returns kebab-case slugs.

Usage as a library:

    from inference import OnnxPredictor
    predictor = OnnxPredictor.from_dir(".")
    slugs = predictor.predict(embeddings)  # [N, input_dim] float32

Usage from the command line:

    uv run inference.py .                          # random demo
    uv run inference.py . --input embeddings.npy   # real embeddings

PyTorch backend (requires torch):

    from inference import PyTorchPredictor
    predictor = PyTorchPredictor.from_dir(".")
"""

from __future__ import annotations

import argparse
import json
import sys
from abc import ABC, abstractmethod
from pathlib import Path
from typing import TypedDict

import numpy as np


class ModelConfig(TypedDict):
    input_dim: int
    embed_dim: int
    num_heads: int
    num_layers: int
    max_slug_tokens: int
    vocab_size: int


class TokenConfig(TypedDict):
    pad: int
    bos: int
    eos: int
    unk: int
    hyphen: int


class BeamSearchConfig(TypedDict):
    beam_width: int
    length_reward: float
    reward_cap: int
    min_decode_tokens: int
    min_slug_words: int


class Sidecar(TypedDict):
    model: ModelConfig
    tokens: TokenConfig
    vocab: dict[str, str]  # token_id (str) -> token
    beam_search: BeamSearchConfig
    stopwords: list[str]


def _log_softmax(x: np.ndarray) -> np.ndarray:
    """Numerically stable log-softmax over a 1-D array."""
    x_max = x.max()
    shifted = x - x_max
    return shifted - np.log(np.exp(shifted).sum())


class SlugPredictor(ABC):
    """Beam search slug predictor. Subclasses provide the forward pass."""

    def __init__(self, sidecar: Sidecar):
        tokens = sidecar["tokens"]
        self.pad_idx = tokens["pad"]
        self.bos_idx = tokens["bos"]
        self.eos_idx = tokens["eos"]
        self.unk_idx = tokens["unk"]
        self.hyphen_idx = tokens["hyphen"]

        self.id_to_token: dict[int, str] = {
            int(k): v for k, v in sidecar["vocab"].items()
        }

        beam = sidecar["beam_search"]
        self.beam_width: int = beam["beam_width"]
        self.length_reward: float = beam["length_reward"]
        self.reward_cap: int = beam["reward_cap"]
        self.min_decode_tokens: int = beam["min_decode_tokens"]
        self.min_slug_words: int = beam["min_slug_words"]
        self.max_length: int = sidecar["model"]["max_slug_tokens"]
        self.max_content_tokens: int = max(self.max_length - 1, 0)

        self.stopwords: frozenset[str] = frozenset(sidecar["stopwords"])

    def predict(self, embeddings: np.ndarray) -> list[str]:
        """Predict slugs for a batch of embeddings.

        Args:
            embeddings: float32 array of shape [N, input_dim].

        Returns:
            List of kebab-case slug strings, one per embedding.
        """
        slugs = []
        for i in range(len(embeddings)):
            candidates = self._beam_search(embeddings[i : i + 1])
            slugs.append(candidates[0][0] if candidates else "")
        return slugs

    def predict_topk(
        self, embeddings: np.ndarray, k: int = 5
    ) -> list[list[tuple[str, float]]]:
        """Return top-k slug candidates with scores for each embedding."""
        results = []
        for i in range(len(embeddings)):
            candidates = self._beam_search(embeddings[i : i + 1])
            results.append(candidates[:k])
        return results

    @abstractmethod
    def _forward(self, embeddings: np.ndarray, token_ids: np.ndarray) -> np.ndarray:
        """Run the model: (embeddings, token_ids) -> logits.

        Args:
            embeddings: [batch, input_dim] float32
            token_ids:  [batch, seq_len] int64

        Returns:
            logits: [batch, seq_len, vocab_size] float32
        """
        raise NotImplementedError

    def _decode_tokens(self, indices: list[int]) -> str:
        """Decode token indices to a slug string, stopping at EOS."""
        parts: list[str] = []
        for idx in indices:
            if idx == self.eos_idx:
                break
            if idx in (self.pad_idx, self.bos_idx):
                continue
            if idx == self.hyphen_idx:
                parts.append("-")
            else:
                token = self.id_to_token.get(idx)
                if token is not None:
                    parts.append(token)
        return "".join(parts)

    def _score(self, log_prob: float, tokens: list[int]) -> float:
        """Score a completed beam using bounded additive length reward.

        score = log_prob + r * min(word_count, B) + penalties
        """
        slug = self._decode_tokens(tokens).strip("-")
        words = slug.split("-") if slug else []
        word_count = len([w for w in words if w])

        score = log_prob + self.length_reward * min(word_count, self.reward_cap)

        # Trailing stopword penalty
        if words and words[-1] in self.stopwords:
            score -= 1.0

        # Repetition penalty
        content = [w for w in words if w and w not in self.stopwords]
        if len(content) != len(set(content)):
            score -= 2.0

        return score

    def _partial_score(self, log_prob: float, tokens: list[int]) -> float:
        """Optimistic partial score for active beam ranking."""
        slug = self._decode_tokens(tokens).strip("-")
        words = [w for w in slug.split("-") if w] if slug else []
        return log_prob + self.length_reward * min(len(words), self.reward_cap)

    def _beam_search(self, embedding: np.ndarray) -> list[tuple[str, float]]:
        """Beam search with score-based optimal stopping.

        Uses bounded additive length reward with the Huang et al. (2017)
        stopping criterion: stop when the best completed beam provably
        dominates every active beam's upper bound.
        """
        bos = self.bos_idx
        eos = self.eos_idx
        pad = self.pad_idx
        unk = self.unk_idx
        k = self.beam_width
        r = self.length_reward
        B = self.reward_cap

        active: list[tuple[float, list[int]]] = [(0.0, [bos])]
        best_finished_score = -float("inf")
        completed: list[tuple[float, list[int]]] = []
        stopped_by_bound = False

        for _step in range(self.max_length):
            if not active:
                break

            candidates: list[tuple[float, list[int]]] = []

            # Batch all active beams into a single forward pass
            max_len = max(len(t) for _, t in active)
            padded = [t + [pad] * (max_len - len(t)) for _, t in active]
            input_ids = np.array(padded, dtype=np.int64)
            embedding_batch = np.tile(embedding, (len(active), 1))

            all_logits = self._forward(embedding_batch, input_ids)

            for beam_idx, (log_prob, tokens) in enumerate(active):
                next_logits = all_logits[beam_idx, len(tokens) - 1, :].copy()
                content_length = len(tokens) - 1  # exclude BOS
                force_eos = content_length >= self.max_content_tokens

                # Suppress PAD and UNK always
                next_logits[pad] = -np.inf
                if unk is not None:
                    next_logits[unk] = -np.inf

                if force_eos:
                    # Force EOS, but charge its model probability
                    log_probs = _log_softmax(next_logits)
                    top_indices = np.array([eos])
                else:
                    if content_length < self.min_decode_tokens:
                        next_logits[eos] = -np.inf

                    slug_so_far = self._decode_tokens(tokens[1:]).strip("-")
                    words = slug_so_far.split("-") if slug_so_far else []
                    if len(words) < self.min_slug_words:
                        next_logits[eos] = -np.inf

                    if words and words[-1] in self.stopwords:
                        next_logits[eos] = -np.inf

                    log_probs = _log_softmax(next_logits)
                    top_count = min(k, len(log_probs))
                    top_indices = np.argpartition(log_probs, -top_count)[-top_count:]
                    top_indices = top_indices[np.argsort(log_probs[top_indices])[::-1]]

                for j in range(len(top_indices)):
                    token_id = int(top_indices[j])
                    token_lp = float(log_probs[token_id])
                    if not np.isfinite(token_lp):
                        continue
                    new_log_prob = log_prob + token_lp
                    new_tokens = tokens + [token_id]

                    if token_id == eos:
                        score = self._score(new_log_prob, new_tokens)
                        completed.append((new_log_prob, new_tokens))
                        if score > best_finished_score:
                            best_finished_score = score
                    else:
                        candidates.append((new_log_prob, new_tokens))

            # Rank by partial objective for consistent pruning
            candidates.sort(
                key=lambda x: self._partial_score(x[0], x[1]), reverse=True
            )
            active = candidates[:k]

            # Optimal stopping: best completed dominates all active upper bounds
            if active and best_finished_score > -float("inf"):
                max_active_lp = max(lp for lp, _ in active)
                upper_bound = max_active_lp + r * B
                if best_finished_score >= upper_bound:
                    stopped_by_bound = True
                    break

        # Force-finish active beams by charging EOS probability
        if active and not stopped_by_bound:
            max_len = max(len(t) for _, t in active)
            padded = [t + [pad] * (max_len - len(t)) for _, t in active]
            input_ids = np.array(padded, dtype=np.int64)
            embedding_batch = np.tile(embedding, (len(active), 1))
            finish_logits = self._forward(embedding_batch, input_ids)

            for bi, (log_prob, tokens) in enumerate(active):
                nl = finish_logits[bi, len(tokens) - 1, :].copy()
                nl[pad] = -np.inf
                if unk is not None:
                    nl[unk] = -np.inf
                lp = _log_softmax(nl)
                eos_lp = float(lp[eos])
                if np.isfinite(eos_lp):
                    completed.append((log_prob + eos_lp, tokens + [eos]))
                else:
                    completed.append((log_prob - 5.0, tokens + [eos]))

        # Deduplicate and rank
        scored = [
            (self._score(log_prob, tokens), tokens)
            for log_prob, tokens in completed
        ]
        scored.sort(key=lambda x: -x[0])

        seen: set[str] = set()
        results: list[tuple[str, float]] = []
        for score, tokens in scored:
            slug = self._decode_tokens(tokens).strip("-")
            if not slug or slug in seen:
                continue
            seen.add(slug)
            results.append((slug, score))

        return results


class OnnxPredictor(SlugPredictor):
    """ONNX Runtime inference. No torch dependency."""

    def __init__(self, session, sidecar: Sidecar):
        super().__init__(sidecar)
        self.session = session

    @classmethod
    def from_dir(cls, model_dir: str | Path) -> OnnxPredictor:
        """Load from a directory containing model.onnx and model.json."""
        import onnxruntime as ort

        model_dir = Path(model_dir)
        session = ort.InferenceSession(str(model_dir / "model.onnx"))
        sidecar = json.loads((model_dir / "model.json").read_text())
        return cls(session, sidecar)

    def _forward(self, embeddings: np.ndarray, token_ids: np.ndarray) -> np.ndarray:
        return self.session.run(
            None,
            {"src_embedding": embeddings, "token_ids": token_ids},
        )[0]


def _load_pytorch_model(model_dir: Path, model_config: ModelConfig):
    """Build and load the SlugDecoder. Requires torch.

    The model is a prefix-conditioned transformer decoder: the source
    embedding is projected into decoder space and placed at position 0,
    followed by BOS and autoregressive token embeddings.
    """
    import torch
    from torch import Tensor, nn

    class DecoderBlock(nn.Module):
        def __init__(self, embed_dim: int, num_heads: int, dropout: float):
            super().__init__()
            self.ln1 = nn.LayerNorm(embed_dim)
            self.attn = nn.MultiheadAttention(
                embed_dim, num_heads, dropout=dropout, batch_first=True
            )
            self.ln2 = nn.LayerNorm(embed_dim)
            self.ffn = nn.Sequential(
                nn.Linear(embed_dim, embed_dim * 4),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(embed_dim * 4, embed_dim),
                nn.Dropout(dropout),
            )

        def forward(self, x: Tensor, attn_mask: Tensor) -> Tensor:
            normed = self.ln1(x)
            x = (
                x
                + self.attn(
                    normed, normed, normed, attn_mask=attn_mask, is_causal=True
                )[0]
            )
            x = x + self.ffn(self.ln2(x))
            return x

    class SlugDecoder(nn.Module):
        def __init__(
            self,
            vocab_size: int,
            embed_dim: int,
            num_heads: int,
            num_layers: int,
            input_dim: int,
            max_length: int,
            dropout: float = 0.1,
        ):
            super().__init__()
            self.embed_dim = embed_dim
            self.max_length = max_length
            self.embedding_projection = nn.Linear(input_dim, embed_dim)
            self.token_embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
            self.position_embedding = nn.Embedding(max_length + 1, embed_dim)
            self.dropout = nn.Dropout(dropout)
            self.blocks = nn.ModuleList(
                [DecoderBlock(embed_dim, num_heads, dropout) for _ in range(num_layers)]
            )
            self.ln_final = nn.LayerNorm(embed_dim)
            self.output_projection = nn.Linear(embed_dim, vocab_size)

        def forward(self, embeddings: Tensor, target_ids: Tensor) -> Tensor:
            prefix = self.embedding_projection(embeddings).unsqueeze(1)
            token_emb = self.token_embedding(target_ids)
            seq = torch.cat([prefix, token_emb], dim=1)
            positions = torch.arange(seq.size(1), device=seq.device)
            seq = seq + self.position_embedding(positions)
            seq = self.dropout(seq)
            attn_mask = nn.Transformer.generate_square_subsequent_mask(
                seq.size(1), device=seq.device
            )
            for block in self.blocks:
                seq = block(seq, attn_mask)
            seq = self.ln_final(seq)
            return self.output_projection(seq[:, 1:, :])

    model = SlugDecoder(
        vocab_size=model_config["vocab_size"],
        embed_dim=model_config["embed_dim"],
        num_heads=model_config["num_heads"],
        num_layers=model_config["num_layers"],
        input_dim=model_config["input_dim"],
        max_length=model_config["max_slug_tokens"],
    )
    model.load_state_dict(
        torch.load(model_dir / "model.pt", map_location="cpu", weights_only=True)
    )
    model.eval()
    return model


class PyTorchPredictor(SlugPredictor):
    """PyTorch inference. Requires: pip install torch"""

    def __init__(self, model, sidecar: Sidecar):
        super().__init__(sidecar)
        self.model = model

    @classmethod
    def from_dir(cls, model_dir: str | Path) -> PyTorchPredictor:
        """Load from a directory containing model.pt and model.json."""
        model_dir = Path(model_dir)
        sidecar = json.loads((model_dir / "model.json").read_text())
        model = _load_pytorch_model(model_dir, sidecar["model"])
        return cls(model, sidecar)

    def _forward(self, embeddings: np.ndarray, token_ids: np.ndarray) -> np.ndarray:
        import torch

        with torch.no_grad():
            logits = self.model(
                torch.from_numpy(embeddings),
                torch.from_numpy(token_ids),
            )
            return logits.numpy()


def main():
    parser = argparse.ArgumentParser(
        description="Generate URL slugs from text embeddings",
    )
    parser.add_argument(
        "model_dir",
        type=Path,
        help="Directory containing model.onnx and model.json",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Path to .npy file with embeddings (shape [N, input_dim])",
    )
    parser.add_argument(
        "--backend",
        choices=["onnx", "pytorch"],
        default="onnx",
        help="Inference backend (default: onnx)",
    )
    parser.add_argument(
        "--topk",
        type=int,
        default=1,
        help="Number of candidates per embedding (default: 1)",
    )
    args = parser.parse_args()

    # Load model
    if args.backend == "onnx":
        predictor = OnnxPredictor.from_dir(args.model_dir)
    else:
        predictor = PyTorchPredictor.from_dir(args.model_dir)

    # Load or generate embeddings
    sidecar = json.loads((args.model_dir / "model.json").read_text())
    input_dim = sidecar["model"]["input_dim"]

    if args.input is not None:
        embeddings = np.load(args.input).astype(np.float32)
        print(f"Loaded {len(embeddings)} embeddings from {args.input}", file=sys.stderr)
    else:
        embeddings = np.random.randn(3, input_dim).astype(np.float32)
        print(
            "No --input provided, using random embeddings (results will be nonsensical)",
            file=sys.stderr,
        )

    # Predict
    if args.topk > 1:
        results = predictor.predict_topk(embeddings, k=args.topk)
        for i, candidates in enumerate(results):
            print(f"[{i}]")
            for slug, score in candidates:
                print(f"  {score:+.2f}  {slug}")
    else:
        slugs = predictor.predict(embeddings)
        for slug in slugs:
            print(slug)


if __name__ == "__main__":
    main()
