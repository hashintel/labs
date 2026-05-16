"""CLI entry point for slug prediction.

Handles shared concerns: loading embeddings, batching predictions
through the variant's Predictor, and writing the output parquet.
"""

import argparse
from pathlib import Path

from slug_from_embedding.config import ENCODERS

from .config import MODELS_DIR, PREDICTIONS_DIR, resolve_device, write_predictions
from .data import load_embeddings
from .registry import PREDICTOR_LOADERS


def main():
    parser = argparse.ArgumentParser(
        description="Generate slug predictions from a trained model"
    )
    parser.add_argument(
        "model_dir", type=str, nargs="?", help="Path to model directory"
    )
    parser.add_argument("--variant", required=True, choices=list(PREDICTOR_LOADERS))
    parser.add_argument("--encoder", choices=list(ENCODERS), required=True)
    parser.add_argument("--split", default="test", choices=["train", "val", "test"])
    parser.add_argument("--device", type=str, default=None)
    parser.add_argument("--batch-size", type=int, default=512)
    args = parser.parse_args()

    device = resolve_device(args.device)

    if args.model_dir:
        model_dir = Path(args.model_dir)
    else:
        # Infer model dir from variant: "mlp-score" -> "mlp", "mlp-position" -> "mlp_pos"
        base = args.variant.split("-")[0]
        tag = f"{base}_{args.encoder}"
        if "position" in args.variant:
            tag += "_pos"
        model_dir = MODELS_DIR / tag

    # Load predictor via registry
    loader = PREDICTOR_LOADERS[args.variant]
    predictor = loader(model_dir, args.encoder, device)

    # Load data
    ids, embeddings = load_embeddings(args.encoder, args.split)
    print(f"Predicting {len(ids)} samples...")

    # Batch inference
    all_slugs: list[str] = []
    for i in range(0, len(embeddings), args.batch_size):
        batch_emb = embeddings[i : i + args.batch_size]
        batch_slugs = predictor.predict(batch_emb)
        assert len(batch_slugs) == len(batch_emb), (
            f"Predictor returned {len(batch_slugs)} slugs for {len(batch_emb)} inputs"
        )
        all_slugs.extend(batch_slugs)

    # Write output
    out_path = (
        PREDICTIONS_DIR
        / f"{model_dir.name}_{args.variant}_{args.encoder}_{args.split}.parquet"
    )
    write_predictions(ids, all_slugs, out_path)
    print(f"Wrote {len(all_slugs)} predictions to {out_path}")
