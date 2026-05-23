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

import numpy as np
import torch

from vec2slug.config import Encoder
from vec2slug.libs.workspace import Workspace

from ..predictor import Predictor
from .model import MAX_SLUG_LENGTH, MIN_SLUG_LENGTH, SlugMLP
from .vocab import SlugVocab


@dataclass
class MLPOutput:
    """Decoded model output for one sample."""

    token_probs: np.ndarray
    position_logits: np.ndarray | None
    length: int


class MLPPredictor(Predictor):
    """Base MLP predictor. Subclasses implement _order() for token arrangement."""

    def __init__(self, model_dir: Path, encoder: Encoder, device: str = "cpu"):
        self.manifest = json.loads((model_dir / "manifest.json").read_text())
        self._validate(self.manifest, encoder)

        model_config = self.manifest["model"]
        self.vocab = SlugVocab.load(model_dir / "vocab.json")
        self.device = device
        self.model_dir = model_dir

        self.model = SlugMLP(
            input_dim=model_config["input_dim"],
            vocab_size=model_config["vocab_size"],
            hidden_dim=model_config["hidden_dim"],
            num_layers=model_config.get("num_layers", 2),
            dropout=model_config["dropout"],
            position_head=model_config["position_head"],
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
        for output in outputs:
            top_k = np.argsort(output.token_probs)[-output.length :].tolist()
            ordered = self._order(top_k, output)
            slugs.append(self.vocab.decode_indices(ordered))
        return slugs

    @abstractmethod
    def _order(self, token_indices: list[int], output: MLPOutput) -> list[int]:
        """Arrange selected token indices into slug order."""
        ...

    def _forward(self, embeddings: np.ndarray) -> list[MLPOutput]:
        with torch.no_grad():
            embedding_tensor = torch.from_numpy(embeddings).to(self.device)
            raw = self.model(embedding_tensor)

        token_probs = torch.sigmoid(raw["token_logits"]).cpu().numpy()
        length_predictions = (
            raw["length_logits"].argmax(dim=1).cpu().numpy() + MIN_SLUG_LENGTH
        )
        length_predictions = np.clip(
            length_predictions, MIN_SLUG_LENGTH, MAX_SLUG_LENGTH
        )

        position_logits = None
        if "position_logits" in raw:
            position_logits = raw["position_logits"].cpu().numpy()

        return [
            MLPOutput(
                token_probs=token_probs[index],
                position_logits=position_logits[index]
                if position_logits is not None
                else None,
                length=int(length_predictions[index]),
            )
            for index in range(len(embeddings))
        ]


class ScorePredictor(MLPPredictor):
    """Variant 1a: order tokens by descending sigmoid score."""

    def _order(self, token_indices: list[int], output: MLPOutput) -> list[int]:
        return sorted(token_indices, key=lambda i: output.token_probs[i], reverse=True)


class PositionPredictor(MLPPredictor):
    """Variant 1b: order tokens by position head's predicted position."""

    def __init__(self, model_dir: Path, encoder: Encoder, device: str = "cpu"):
        super().__init__(model_dir, encoder, device)
        if not self.manifest["model"]["position_head"]:
            raise ValueError(
                "Position ordering requires a model trained with position_head=True"
            )

    def _order(self, token_indices: list[int], output: MLPOutput) -> list[int]:
        return sorted(token_indices, key=lambda i: output.position_logits[i].argmax())


class PairwisePredictor(MLPPredictor):
    """Variant 1c: order tokens by saved pairwise co-occurrence statistics."""

    def __init__(self, model_dir: Path, encoder: Encoder, device: str = "cpu"):
        super().__init__(model_dir, encoder, device)
        print("Loading pairwise ordering table...")
        self.pairwise_table = _load_pairwise_table(model_dir)
        print(f"  {len(self.pairwise_table)} pairs")

    def _order(self, token_indices: list[int], output: MLPOutput) -> list[int]:
        if len(token_indices) <= 1:
            return token_indices

        scores = {}
        for index_a in token_indices:
            score = 0.0
            for index_b in token_indices:
                if index_a == index_b:
                    continue
                key = (min(index_a, index_b), max(index_a, index_b))
                probability = self.pairwise_table.get(key, 0.5)
                score += probability if index_a < index_b else (1.0 - probability)
            scores[index_a] = score / (len(token_indices) - 1)

        return sorted(token_indices, key=lambda i: scores[i], reverse=True)


def _load_pairwise_table(model_dir: Path) -> dict[tuple[int, int], float]:
    """Load a saved pairwise table from the model directory."""
    raw = json.loads((model_dir / "pairwise.json").read_text())
    return {
        (int(key.split(",")[0]), int(key.split(",")[1])): value
        for key, value in raw.items()
    }


MLP_PREDICTORS: dict[str, type[MLPPredictor]] = {
    "score": ScorePredictor,
    "position": PositionPredictor,
    "pairwise": PairwisePredictor,
}


def build_pairwise_table(
    workspace: Workspace,
    vocab: SlugVocab,
    encoder: Encoder,
) -> dict[tuple[int, int], float]:
    """Build pairwise ordering probabilities from training data.

    For each pair (a, b) that co-occur in a slug, count how often a
    appears before b. Called during training and saved as an artifact;
    loaded from disk at prediction time.
    """
    slugs = workspace.load_split_slugs(encoder, "train")

    pair_counts: dict[tuple[int, int], list[int]] = {}

    for slug in slugs:
        indices = vocab.encode_slug(slug)
        for position_a, index_a in enumerate(indices):
            for position_b, index_b in enumerate(indices):
                if index_a == index_b:
                    continue
                key = (min(index_a, index_b), max(index_a, index_b))
                if key not in pair_counts:
                    pair_counts[key] = [0, 0]
                if (index_a < index_b and position_a < position_b) or (
                    index_a > index_b and position_a > position_b
                ):
                    pair_counts[key][0] += 1
                else:
                    pair_counts[key][1] += 1

    table: dict[tuple[int, int], float] = {}
    for key, (first, second) in pair_counts.items():
        total = first + second
        table[key] = first / total if total > 0 else 0.5

    return table
