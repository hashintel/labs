"""CLI entry point for slug prediction.

Handles shared concerns: loading embeddings, batching predictions
through the variant's Predictor, and writing the output parquet.
"""

import argparse
from pathlib import Path

from slug_from_embedding.config import ENCODERS
from slug_from_embedding.libs.workspace import Workspace

from .config import resolve_device
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
    parser.add_argument("--workspace", default="original")
    args = parser.parse_args()

    workspace = Workspace(args.workspace)
    device = resolve_device(args.device)

    if args.model_dir:
        model_dir = Path(args.model_dir)
    else:
        base = args.variant.split("-")[0]
        tag = f"{base}_{args.encoder}"
        if "position" in args.variant:
            tag += "_pos"
        model_dir = workspace.models_dir(args.encoder, tag)

    loader = PREDICTOR_LOADERS[args.variant]
    predictor = loader(model_dir, args.encoder, device)

    ids, embeddings = workspace.load_split_embeddings(args.encoder, args.split)
    print(f"Predicting {len(ids)} samples...")

    all_slugs: list[str] = []
    for start in range(0, len(embeddings), args.batch_size):
        batch_embeddings = embeddings[start : start + args.batch_size]
        batch_slugs = predictor.predict(batch_embeddings)
        assert len(batch_slugs) == len(batch_embeddings), (
            f"Predictor returned {len(batch_slugs)} slugs for {len(batch_embeddings)} inputs"
        )
        all_slugs.extend(batch_slugs)

    prediction_name = f"{model_dir.name}_{args.variant}"
    workspace.write_predictions(
        args.encoder, prediction_name, ids, all_slugs, args.split
    )
    print(
        f"Wrote {len(all_slugs)} predictions to {workspace.prediction_path(args.encoder, prediction_name, args.split)}"
    )
