"""CLI entry point for slug prediction.

Handles shared concerns: loading embeddings, batching predictions
through the variant's Predictor, and writing the output parquet.
"""

import argparse
from pathlib import Path

import numpy as np
from tqdm import tqdm

from vec2slug.config import ENCODERS, SEED
from vec2slug.libs.workspace import Workspace

from .config import resolve_device
from .registry import PREDICTOR_LOADERS

DEFAULT_MAX_SAMPLES = 5000


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
    parser.add_argument(
        "--max-samples",
        type=int,
        default=DEFAULT_MAX_SAMPLES,
        help=f"Random subsample size (default: {DEFAULT_MAX_SAMPLES}). 0 for all.",
    )
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--workspace", default="original")
    parser.add_argument(
        "--no-repetition-filter",
        action="store_true",
        help="Disable repetition filtering in beam search (seq2seq only)",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Disable KV cache for incremental decoding (seq2seq only)",
    )
    parser.add_argument(
        "--tag",
        type=str,
        default=None,
        help="Tag to append to model name",
    )
    args = parser.parse_args()

    workspace = Workspace(args.workspace)
    device = resolve_device(args.device)

    if args.model_dir:
        model_dir = Path(args.model_dir)
    else:
        base = args.variant.split("-")[0]
        variant_name = base
        if "position" in args.variant:
            variant_name += "_pos"
        if args.tag:
            variant_name = f"{variant_name}_{args.tag}"
        model_dir = workspace.models_dir(args.encoder, variant_name)

    loader = PREDICTOR_LOADERS[args.variant]
    predictor_kwargs = {}
    if args.no_cache:
        predictor_kwargs["use_cache"] = False
    predictor = loader(model_dir, args.encoder, device, **predictor_kwargs)

    if args.no_repetition_filter and hasattr(predictor, "filter_repetition"):
        predictor.filter_repetition = False

    ids, embeddings = workspace.load_split_embeddings(args.encoder, args.split)

    total = len(ids)
    if args.max_samples and args.max_samples < total:
        rng = np.random.default_rng(args.seed)
        indices = rng.choice(total, size=args.max_samples, replace=False)
        indices.sort()
        ids = [ids[i] for i in indices]
        embeddings = embeddings[indices]
        print(f"Sampled {len(ids)} from {total:,} test samples (seed={args.seed})")
    else:
        print(f"Predicting {total:,} samples...")

    all_slugs: list[str] = []
    with tqdm(total=len(ids), unit="sample") as pbar:
        for start in range(0, len(embeddings), args.batch_size):
            batch_embeddings = embeddings[start : start + args.batch_size]
            batch_slugs = predictor.predict(batch_embeddings)
            assert len(batch_slugs) == len(batch_embeddings), (
                f"Predictor returned {len(batch_slugs)} slugs for {len(batch_embeddings)} inputs"
            )
            all_slugs.extend(batch_slugs)
            pbar.update(len(batch_slugs))

    prediction_name = f"{model_dir.name}_{args.variant}"
    if args.tag:
        prediction_name = f"{prediction_name}_{args.tag}"
    workspace.write_predictions(
        args.encoder, prediction_name, ids, all_slugs, args.split
    )
    print(
        f"Wrote {len(all_slugs)} predictions to {workspace.prediction_path(args.encoder, prediction_name, args.split)}"
    )
