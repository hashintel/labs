"""Variant registry: maps variant names to their trainer and predictor classes.

To add a new variant, import its classes and add entries to each dict.
"""

from pathlib import Path
from typing import Callable

from slug_from_embedding.config import Encoder

from .predictor import Predictor
from .trainer import Trainer


def _load_mlp_score(model_dir: Path, encoder: Encoder, device: str) -> Predictor:
    from .mlp.predict import ScorePredictor

    return ScorePredictor(model_dir, encoder, device)


def _load_mlp_position(model_dir: Path, encoder: Encoder, device: str) -> Predictor:
    from .mlp.predict import PositionPredictor

    return PositionPredictor(model_dir, encoder, device)


def _load_mlp_pairwise(model_dir: Path, encoder: Encoder, device: str) -> Predictor:
    from .mlp.predict import PairwisePredictor

    return PairwisePredictor(model_dir, encoder, device)


def _load_mlp_trainer() -> type[Trainer]:
    from .mlp.train import Trainer as MLPTrainer

    return MLPTrainer


type TrainerLoader = Callable[[], type[Trainer]]
type PredictorLoader = Callable[[Path, Encoder, str], Predictor]

TRAINERS: dict[str, TrainerLoader] = {
    "mlp": _load_mlp_trainer,
}


PREDICTOR_LOADERS: dict[str, PredictorLoader] = {
    "mlp-score": _load_mlp_score,
    "mlp-position": _load_mlp_position,
    "mlp-pairwise": _load_mlp_pairwise,
}
