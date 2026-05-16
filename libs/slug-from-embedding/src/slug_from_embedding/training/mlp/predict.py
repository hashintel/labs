"""MLP inference: base predictor with three ordering subclasses.

MLPPredictor handles model loading, validation, forward pass, and top-k
token selection. Subclasses implement _order() to arrange selected tokens
into a slug:

  ScorePredictor (1a):    sort by descending sigmoid score
  PositionPredictor (1b): sort by position head's predicted position
  PairwisePredictor (1c): sort by saved pairwise co-occurrence statistics
"""

import json
from abc import abstractmethod
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import torch

from slug_from_embedding.config import CORPUS_WITH_SLUGS_FILE, Encoder, splits_file

from ..predictor import Predictor
from .model import MAX_SLUG_LENGTH, MIN_SLUG_LENGTH, SlugMLP
from .vocab import SlugVocab


@dataclass
class MLPOutput:
    """Decoded model output for one sample."""

    token_probs: np.ndarray              # [vocab_size]
    position_logits: np.ndarray | None   # [vocab_size, max_length] or None
    length: int                          # predicted slug length


class MLPPredictor(Predictor):
    """Base MLP predictor. Subclasses implement _order() for token arrangement."""

    def __init__(self, model_dir: Path, encoder: Encoder, device: str = "cpu"):
        self.manifest = json.loads((model_dir / "manifest.json").read_text())
        self._validate(self.manifest, encoder)

        model_cfg = self.manifest["model"]
        self.vocab = SlugVocab.load(model_dir / "vocab.json")
        self.device = device
        self.model_dir = model_dir

        self.model = SlugMLP(
            input_dim=model_cfg["input_dim"],
            vocab_size=model_cfg["vocab_size"],
            hidden_dim=model_cfg["hidden_dim"],
            dropout=model_cfg["dropout"],
            position_head=model_cfg["position_head"],
        )
        self.model.load_state_dict(
            torch.load(model_dir / "best.pt", map_location=device, weights_only=True)
        )
        self.model.to(device)
        self.model.eval()

    def _validate(self, manifest: dict, encoder: Encoder):
        if manifest.get("variant") != "mlp":
            raise ValueError(f"Expected variant 'mlp', got '{manifest.get('variant')}'")
        if manifest.get("encoder") != encoder:
            raise ValueError(
                f"Model trained on '{manifest['encoder']}', "
                f"but prediction requested for '{encoder}'"
            )

    def predict(self, embeddings: np.ndarray) -> list[str]:
        outputs = self._forward(embeddings)
        slugs = []
        for out in outputs:
            top_k = np.argsort(out.token_probs)[-out.length:].tolist()
            ordered = self._order(top_k, out)
            slugs.append(self.vocab.decode_indices(ordered))
        return slugs

    @abstractmethod
    def _order(self, token_indices: list[int], out: MLPOutput) -> list[int]:
        """Arrange selected token indices into slug order."""
        ...

    def _forward(self, embeddings: np.ndarray) -> list[MLPOutput]:
        with torch.no_grad():
            emb = torch.from_numpy(embeddings).to(self.device)
            raw = self.model(emb)

        token_probs = torch.sigmoid(raw["token_logits"]).cpu().numpy()
        length_preds = raw["length_logits"].argmax(dim=1).cpu().numpy() + MIN_SLUG_LENGTH
        length_preds = np.clip(length_preds, MIN_SLUG_LENGTH, MAX_SLUG_LENGTH)

        pos_logits = None
        if "position_logits" in raw:
            pos_logits = raw["position_logits"].cpu().numpy()

        return [
            MLPOutput(
                token_probs=token_probs[j],
                position_logits=pos_logits[j] if pos_logits is not None else None,
                length=int(length_preds[j]),
            )
            for j in range(len(embeddings))
        ]


# ── Ordering subclasses ───────────────────────────────────────────────────────


class ScorePredictor(MLPPredictor):
    """Variant 1a: order tokens by descending sigmoid score."""

    def _order(self, token_indices: list[int], out: MLPOutput) -> list[int]:
        return sorted(token_indices, key=lambda i: out.token_probs[i], reverse=True)


class PositionPredictor(MLPPredictor):
    """Variant 1b: order tokens by position head's predicted position."""

    def __init__(self, model_dir: Path, encoder: Encoder, device: str = "cpu"):
        super().__init__(model_dir, encoder, device)
        if not self.manifest["model"]["position_head"]:
            raise ValueError("Position ordering requires a model trained with position_head=True")

    def _order(self, token_indices: list[int], out: MLPOutput) -> list[int]:
        return sorted(token_indices, key=lambda i: out.position_logits[i].argmax())


class PairwisePredictor(MLPPredictor):
    """Variant 1c: order tokens by saved pairwise co-occurrence statistics."""

    def __init__(self, model_dir: Path, encoder: Encoder, device: str = "cpu"):
        super().__init__(model_dir, encoder, device)
        print("Loading pairwise ordering table...")
        self.pairwise_table = _load_pairwise_table(model_dir)
        print(f"  {len(self.pairwise_table)} pairs")

    def _order(self, token_indices: list[int], out: MLPOutput) -> list[int]:
        if len(token_indices) <= 1:
            return token_indices

        scores = {}
        for idx_a in token_indices:
            s = 0.0
            for idx_b in token_indices:
                if idx_a == idx_b:
                    continue
                key = (min(idx_a, idx_b), max(idx_a, idx_b))
                prob = self.pairwise_table.get(key, 0.5)
                s += prob if idx_a < idx_b else (1.0 - prob)
            scores[idx_a] = s / (len(token_indices) - 1)

        return sorted(token_indices, key=lambda i: scores[i], reverse=True)


# ── Helpers ────────────────────────────────────────────────────────────────────


def _load_pairwise_table(model_dir: Path) -> dict[tuple[int, int], float]:
    """Load a saved pairwise table from the model directory."""
    raw = json.loads((model_dir / "pairwise.json").read_text())
    return {
        (int(k.split(",")[0]), int(k.split(",")[1])): v
        for k, v in raw.items()
    }


MLP_PREDICTORS: dict[str, type[MLPPredictor]] = {
    "score": ScorePredictor,
    "position": PositionPredictor,
    "pairwise": PairwisePredictor,
}


# ── Pairwise table construction (called during training) ──────────────────────


def build_pairwise_table(
    vocab: SlugVocab, encoder: Encoder,
) -> dict[tuple[int, int], float]:
    """Build pairwise ordering probabilities from training data.

    For each pair (a, b) that co-occur in a slug, count how often a
    appears before b. Called during training and saved as an artifact;
    loaded from disk at prediction time.
    """
    rows = duckdb.sql(f"""
        SELECT corpus.slug
        FROM '{CORPUS_WITH_SLUGS_FILE}' as corpus
        JOIN '{splits_file(encoder)}' as splits ON corpus.id = splits.id
        WHERE splits.split = 'train'
        ORDER BY corpus.id
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

    table: dict[tuple[int, int], float] = {}
    for key, (first, second) in pair_counts.items():
        total = first + second
        table[key] = first / total if total > 0 else 0.5

    return table
