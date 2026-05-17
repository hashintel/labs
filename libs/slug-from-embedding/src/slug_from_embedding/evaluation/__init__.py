"""Evaluation harness for slug predictions.

Composes transforms into a pipeline: each enriches the Dataset with
per-sample columns, then produces aggregate stats.

Usage:
    uv run slug-eval data/original/openai/predictions/haiku_test.parquet --encoder openai
    uv run slug-eval data/original/openai/predictions/haiku_test.parquet --encoder openai --split test
"""

import argparse
import json
from pathlib import Path

from ..config import ENCODERS, Encoder
from ..libs.workspace import Split, Workspace
from .bert_score import BertScore
from .data import transform_dataset
from .distinctiveness import Distinctiveness
from .exact_match import ExactMatch
from .length_bucket import LengthBucket
from .per_source import PerSource
from .rouge import Rouge
from .slug_token_f1 import SlugTokenF1
from .transform import pipeline
from .validity import Validity
from .vocab_diversity import VocabDiversity

default_pipeline = pipeline(
    Validity(),
    ExactMatch(),
    SlugTokenF1(),
    Rouge(),
    BertScore(),
    Distinctiveness(),
    VocabDiversity(),
    PerSource(),
    LengthBucket(),
)


def format_summary(stats: dict) -> str:
    lines = [
        f"Samples: {stats.get('n_samples', '?')}",
        "",
        "Overall:",
        f"  Validity:         {stats['validity_rate']:.1%}",
        f"  Exact match:      {stats['exact_match']:.1%}",
        f"  Token P/R/F1:     {stats['mean_f1_precision']:.3f} / {stats['mean_f1_recall']:.3f} / {stats['mean_f1']:.3f}",
        f"  ROUGE-1/L:        {stats['mean_rouge1']:.3f} / {stats['mean_rouge_l']:.3f}",
        f"  BERTScore P/R/F1: {stats['mean_bertscore_precision']:.3f} / {stats['mean_bertscore_recall']:.3f} / {stats['mean_bertscore_f1']:.3f}",
        f"  Distinctiveness:  {stats['mean_distinctiveness']:.3f}",
        f"  Vocab diversity:  {stats['vocab_diversity']:.1%} ({stats['unique_predictions']} unique)",
    ]

    if "per_source" in stats:
        lines.extend(["", "Per source:"])
        for source, metrics in sorted(stats["per_source"].items()):
            lines.append(
                f"  {source:<16s} (n={metrics['n']:>4d})  "
                f"exact={metrics['exact_match']:.1%}  "
                f"tok_f1={metrics['mean_f1']:.3f}  "
                f"rouge1={metrics['mean_rouge1']:.3f}  "
                f"rouge_l={metrics['mean_rouge_l']:.3f}  "
                f"bert_f1={metrics['mean_bertscore_f1']:.3f}"
            )

    if "per_length_bucket" in stats:
        lines.extend(["", "Per length bucket:"])
        for bucket, metrics in sorted(stats["per_length_bucket"].items()):
            lines.append(
                f"  {bucket:<10s} (n={metrics['n']:>4d}, avg={metrics['mean_token_count']:>5.0f} tok)  "
                f"exact={metrics['exact_match']:.1%}  "
                f"tok_f1={metrics['mean_f1']:.3f}  "
                f"rouge_l={metrics['mean_rouge_l']:.3f}  "
                f"distinct={metrics['mean_distinctiveness']:.3f}"
            )

    return "\n".join(lines)


def save_results(
    workspace: Workspace,
    name: str,
    encoder: Encoder,
    split: Split,
    stats: dict,
    dataset,
):
    """Save summary JSON and per-sample detail parquet."""
    results_directory = workspace.results_dir(encoder)
    results_directory.mkdir(parents=True, exist_ok=True)

    summary_file = workspace.result_path(encoder, name, split)
    clean_stats = json.loads(
        json.dumps(stats, default=lambda x: float(x) if hasattr(x, "item") else x)
    )
    with open(summary_file, "w") as f:
        json.dump(clean_stats, f, indent=2)
    print(f"Summary: {summary_file}")

    detail_file = workspace.result_detail_path(encoder, name, split)
    detail_columns = [
        "id",
        "source",
        "token_count",
        "length_bucket",
        "reference",
        "prediction",
        "valid",
        "exact_match",
        "f1_precision",
        "f1_recall",
        "f1",
        "rouge1",
        "rouge_l",
        "bertscore_f1",
        "distinctiveness",
    ]
    missing = [
        column for column in detail_columns if column not in dataset.column_names
    ]
    if missing:
        raise ValueError(f"Expected columns missing from dataset: {missing}")
    dataset.select_columns(detail_columns).to_parquet(str(detail_file))
    print(f"Detail:  {detail_file}")


def main():
    parser = argparse.ArgumentParser(description="Evaluate slug predictions")
    parser.add_argument(
        "predictions", type=Path, help="Predictions parquet (id, predicted_slug)"
    )
    parser.add_argument("--encoder", required=True, choices=list(ENCODERS))
    parser.add_argument("--split", default="test")
    parser.add_argument(
        "--name", help="Name for results files (default: predictions filename stem)"
    )
    parser.add_argument("--workspace", default="original")
    args = parser.parse_args()

    workspace = Workspace(args.workspace)
    name = args.name or args.predictions.stem

    print(f"Loading dataset ({args.encoder}, {args.split})...")
    dataset = workspace.load_evaluation_dataset(args.predictions, encoder=args.encoder)
    print(f"  {len(dataset)} samples")

    print("Preparing...")
    dataset = transform_dataset(dataset)

    print("Running pipeline...")
    dataset = default_pipeline.transform(dataset)

    print("Computing stats...")
    stats = {"n_samples": len(dataset)}
    stats = default_pipeline.evaluate(dataset, stats)

    print()
    print(format_summary(stats))
    print()

    save_results(workspace, name, args.encoder, args.split, stats, dataset)


if __name__ == "__main__":
    main()
