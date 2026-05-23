"""Variant registry: maps variant names to their trainer and predictor classes.

To add a new variant, import its classes and add entries to each dict.
"""

from pathlib import Path
from typing import Callable

from vec2slug.config import Encoder

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


def _load_seq2seq(model_dir: Path, encoder: Encoder, device: str) -> Predictor:
    from .seq2seq.predict import Seq2SeqPredictor

    return Seq2SeqPredictor(model_dir, encoder, device)


def _load_mlp_trainer() -> type[Trainer]:
    from .mlp.train import Trainer as MLPTrainer

    return MLPTrainer


def _load_seq2seq_trainer() -> type[Trainer]:
    from .seq2seq.train import Trainer as Seq2SeqTrainer

    return Seq2SeqTrainer


type TrainerLoader = Callable[[], type[Trainer]]
type PredictorLoader = Callable[[Path, Encoder, str], Predictor]

TRAINERS: dict[str, TrainerLoader] = {
    "mlp": _load_mlp_trainer,
    "seq2seq": _load_seq2seq_trainer,
}


PREDICTOR_LOADERS: dict[str, PredictorLoader] = {
    "mlp-score": _load_mlp_score,
    "mlp-position": _load_mlp_position,
    "mlp-pairwise": _load_mlp_pairwise,
    "seq2seq": _load_seq2seq,
}
