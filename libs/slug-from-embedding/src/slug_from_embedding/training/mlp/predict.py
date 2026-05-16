"""MLP predictors: three ordering sub-variants implementing the Predictor protocol.

All three share the same model (backbone + token head + length head),
differing only in how they arrange the selected top-k tokens into a slug:

  ScorePredictor (1a):    sort by descending sigmoid score
  PositionPredictor (1b): sort by position head's predicted position
  PairwisePredictor (1c): sort by learned pairwise ordering from training data
"""

import json
from pathlib import Path
from typing import Literal

import duckdb
import numpy as np
import torch

from slug_from_embedding.config import DATA_DIR, Encoder, splits_file

from ..predictor import Predictor
from ..vocab import SlugVocab
from .model import MAX_SLUG_LENGTH, MIN_SLUG_LENGTH, SlugMLP

type OrderingVariant = Literal["score", "position", "pairwise"]


def _load_model(model_dir: Path, device: str) -> tuple[SlugMLP, SlugVocab, dict]:
    """Load a trained SlugMLP from a checkpoint directory."""
    config = json.loads((model_dir / "config.json").read_text())
    vocab = SlugVocab.load(model_dir / "vocab.json")

    model = SlugMLP(
        input_dim=config["input_dim"],
        vocab_size=config["vocab_size"],
        hidden_dim=config["hidden_dim"],
        dropout=config["dropout"],
        position_head=config["position_head"],
    )
    model.load_state_dict(
        torch.load(model_dir / "best.pt", map_location=device, weights_only=True)
    )
    model.to(device)
    model.eval()

    return model, vocab, config


def _forward(model: SlugMLP, embeddings: np.ndarray, device: str) -> dict[str, np.ndarray]:
    """Run the model forward pass, returning numpy arrays."""
    with torch.no_grad():
        emb = torch.from_numpy(embeddings).to(device)
        out = model(emb)

    token_probs = torch.sigmoid(out["token_logits"]).cpu().numpy()
    length_preds = out["length_logits"].argmax(dim=1).cpu().numpy() + MIN_SLUG_LENGTH
    length_preds = np.clip(length_preds, MIN_SLUG_LENGTH, MAX_SLUG_LENGTH)

    result = {"token_probs": token_probs, "length_preds": length_preds}

    if "position_logits" in out:
        result["position_logits"] = out["position_logits"].cpu().numpy()

    return result


def _select_top_k(token_probs: np.ndarray, k: int) -> list[int]:
    """Select the top-k token indices by sigmoid probability."""
    return np.argsort(token_probs)[-k:].tolist()


# ── Ordering strategies ────────────────────────────────────────────────────────


def order_by_score(token_indices: list[int], token_scores: np.ndarray) -> list[int]:
    """Sort selected tokens by descending sigmoid score."""
    return sorted(token_indices, key=lambda i: token_scores[i], reverse=True)


def order_by_position(token_indices: list[int], position_logits: np.ndarray) -> list[int]:
    """Sort by the position head's argmax for each token."""
    return sorted(token_indices, key=lambda i: position_logits[i].argmax())


def order_by_pairwise(
    token_indices: list[int],
    pairwise_table: dict[tuple[int, int], float],
) -> list[int]:
    """Sort using pairwise ordering probabilities.

    For each token, compute the average probability that it comes before
    each other selected token. Sort by descending average.
    """
    if len(token_indices) <= 1:
        return token_indices

    scores = {}
    for idx_a in token_indices:
        s = 0.0
        for idx_b in token_indices:
            if idx_a == idx_b:
                continue
            key = (min(idx_a, idx_b), max(idx_a, idx_b))
            prob = pairwise_table.get(key, 0.5)
            # prob = P(smaller index first). Flip if idx_a is the larger.
            s += prob if idx_a < idx_b else (1.0 - prob)
        scores[idx_a] = s / (len(token_indices) - 1)

    return sorted(token_indices, key=lambda i: scores[i], reverse=True)


def build_pairwise_table(
    vocab: SlugVocab, encoder: Encoder,
) -> dict[tuple[int, int], float]:
    """Build pairwise ordering probabilities from training data.

    For each pair (a, b) that co-occur in a slug, count how often a
    appears before b. The probability P(a before b) is used at inference
    to sort via a comparison key.
    """
    rows = duckdb.sql(f"""
        SELECT corpus.slug
        FROM '{DATA_DIR / "corpus_with_slugs.parquet"}' as corpus
        JOIN '{splits_file(encoder)}' as splits ON corpus.id = splits.id
        WHERE splits.split = 'train'
    """).fetchall()

    pair_counts: dict[tuple[int, int], list[int]] = {}

    for (slug,) in rows:
        indices = vocab.encode_slug(slug)
        for pos_a, idx_a in enumerate(indices):
            for pos_b, idx_b in enumerate(indices):
                if idx_a == idx_b:
                    continue
                key = (min(idx_a, idx_b), max(idx_a, idx_b))
                if key not in pair_counts:
                    pair_counts[key] = [0, 0]
                if (idx_a < idx_b and pos_a < pos_b) or (idx_a > idx_b and pos_a > pos_b):
                    pair_counts[key][0] += 1
                else:
                    pair_counts[key][1] += 1

    table = {}
    for key, (first, second) in pair_counts.items():
        total = first + second
        table[key] = first / total if total > 0 else 0.5

    return table


# ── Predictor implementations ─────────────────────────────────────────────────


class ScorePredictor(Predictor):
    """Variant 1a: order tokens by descending sigmoid score."""

    def __init__(self, model_dir: Path, device: str = "cpu"):
        self.model, self.vocab, _ = _load_model(model_dir, device)
        self.device = device

    def predict(self, embeddings: np.ndarray) -> list[str]:
        out = _forward(self.model, embeddings, self.device)
        slugs = []
        for j in range(len(embeddings)):
            top_k = _select_top_k(out["token_probs"][j], int(out["length_preds"][j]))
            ordered = order_by_score(top_k, out["token_probs"][j])
            slugs.append(self.vocab.decode_indices(ordered))
        return slugs


class PositionPredictor(Predictor):
    """Variant 1b: order tokens by position head predictions."""

    def __init__(self, model_dir: Path, device: str = "cpu"):
        self.model, self.vocab, config = _load_model(model_dir, device)
        self.device = device
        if not config["position_head"]:
            raise ValueError("Model was not trained with position head")

    def predict(self, embeddings: np.ndarray) -> list[str]:
        out = _forward(self.model, embeddings, self.device)
        slugs = []
        for j in range(len(embeddings)):
            top_k = _select_top_k(out["token_probs"][j], int(out["length_preds"][j]))
            ordered = order_by_position(top_k, out["position_logits"][j])
            slugs.append(self.vocab.decode_indices(ordered))
        return slugs


class PairwisePredictor(Predictor):
    """Variant 1c: order tokens by learned pairwise co-occurrence ordering."""

    def __init__(self, model_dir: Path, encoder: Encoder, device: str = "cpu"):
        self.model, self.vocab, _ = _load_model(model_dir, device)
        self.device = device
        print("Building pairwise ordering table from training data...")
        self.pairwise_table = build_pairwise_table(self.vocab, encoder)
        print(f"  {len(self.pairwise_table)} pairs")

    def predict(self, embeddings: np.ndarray) -> list[str]:
        out = _forward(self.model, embeddings, self.device)
        slugs = []
        for j in range(len(embeddings)):
            top_k = _select_top_k(out["token_probs"][j], int(out["length_preds"][j]))
            ordered = order_by_pairwise(top_k, self.pairwise_table)
            slugs.append(self.vocab.decode_indices(ordered))
        return slugs
