"""CLI entry point for slug prediction.

Handles the shared concerns: loading embeddings for a split, batching
predictions through the variant's Predictor, and writing the output
parquet. Each variant just implements Predictor.predict().
"""

import argparse
from pathlib import Path

import duckdb
import numpy as np

from slug_from_embedding.config import DATA_DIR, ENCODERS, Encoder, embeddings_file, splits_file

from .predictor import Predictor

MODELS_DIR = DATA_DIR / "models"
PREDICTIONS_DIR = DATA_DIR / "predictions"


def _load_embeddings(encoder: Encoder, split: str) -> tuple[list[str], np.ndarray]:
    """Load ids and embeddings for a split."""
    rows = duckdb.sql(f"""
        SELECT splits.id, embeddings.embedding
        FROM '{splits_file(encoder)}' as splits
        JOIN '{embeddings_file(encoder)}' as embeddings ON splits.id = embeddings.id
        WHERE splits.split = '{split}'
    """).fetchall()

    ids = [r[0] for r in rows]
    embeddings = np.array([r[1] for r in rows], dtype=np.float32)
    return ids, embeddings


def _write_predictions(ids: list[str], slugs: list[str], out_path: Path):
    """Write (id, predicted_slug) parquet."""
    PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect()
    conn.execute("CREATE TABLE preds (id VARCHAR, predicted_slug VARCHAR)")
    conn.executemany("INSERT INTO preds VALUES (?, ?)", list(zip(ids, slugs)))
    conn.execute(f"COPY preds TO '{out_path}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    conn.close()
    print(f"Wrote {len(slugs)} predictions to {out_path}")


def run_prediction(
    predictor: Predictor,
    encoder: Encoder,
    split: str,
    tag: str,
    batch_size: int = 512,
):
    """Load data, run predictor in batches, write output."""
    ids, embeddings = _load_embeddings(encoder, split)
    print(f"Predicting {len(ids)} samples...")

    all_slugs = []
    for i in range(0, len(embeddings), batch_size):
        batch_slugs = predictor.predict(embeddings[i : i + batch_size])
        all_slugs.extend(batch_slugs)

    out_path = PREDICTIONS_DIR / f"{tag}_{encoder}_{split}.parquet"
    _write_predictions(ids, all_slugs, out_path)
    return out_path


def _build_predictor(variant: str, ordering: str, model_dir: Path, encoder: Encoder, device: str) -> tuple[Predictor, str]:
    """Instantiate the right Predictor and return it with its output tag."""
    match variant:
        case "mlp":
            from .mlp.predict import PairwisePredictor, PositionPredictor, ScorePredictor

            match ordering:
                case "score":
                    return ScorePredictor(model_dir, device), f"{model_dir.name}_score"
                case "position":
                    return PositionPredictor(model_dir, device), f"{model_dir.name}_position"
                case "pairwise":
                    return PairwisePredictor(model_dir, encoder, device), f"{model_dir.name}_pairwise"
                case _:
                    raise ValueError(f"Unknown ordering: {ordering}")
        case _:
            raise ValueError(f"Unknown variant: {variant}")


def _resolve_device(device: str | None) -> str:
    if device:
        return device
    import torch
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def main():
    parser = argparse.ArgumentParser(description="Generate slug predictions from a trained model")
    parser.add_argument("model_dir", type=str, nargs="?", help="Path to model directory")
    parser.add_argument("--variant", default="mlp", choices=["mlp"])
    parser.add_argument("--encoder", choices=list(ENCODERS), required=True)
    parser.add_argument("--split", default="test", choices=["train", "val", "test"])
    parser.add_argument("--ordering", default="score", choices=["score", "position", "pairwise"])
    parser.add_argument("--device", type=str, default=None)
    args = parser.parse_args()

    device = _resolve_device(args.device)

    if args.model_dir:
        model_dir = Path(args.model_dir)
    else:
        tag = f"mlp_{args.encoder}"
        if args.ordering == "position":
            tag += "_pos"
        model_dir = MODELS_DIR / tag

    predictor, tag = _build_predictor(args.variant, args.ordering, model_dir, args.encoder, device)
    run_prediction(predictor, args.encoder, args.split, tag)
