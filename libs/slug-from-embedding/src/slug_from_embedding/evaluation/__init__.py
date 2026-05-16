"""Evaluation harness for slug predictions.

Composes transforms into a pipeline: each enriches the Dataset with
per-sample columns, then produces aggregate stats.

Usage:
    uv run slug-eval data/predictions/random_openai_test.parquet --encoder openai
    uv run slug-eval data/predictions/haiku_test.parquet --encoder openai --split test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import duckdb
import numpy as np

from ..config import DATA_DIR, ENCODERS

from .bert_score import BertScore
from .data import load_dataset, transform_dataset
from .distinctiveness import Distinctiveness
from .exact_match import ExactMatch
from .length_bucket import LengthBucket
from .per_source import PerSource
from .rouge import Rouge
from .slug_token_f1 import SlugTokenF1
from .transform import pipeline
from .validity import Validity
from .vocab_diversity import VocabDiversity

RESULTS_DIR = DATA_DIR / "results"

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
        for src, m in sorted(stats["per_source"].items()):
            lines.append(
                f"  {src:<16s} (n={m['n']:>4d})  "
                f"exact={m['exact_match']:.1%}  "
                f"tok_f1={m['mean_f1']:.3f}  "
                f"rouge1={m['mean_rouge1']:.3f}  "
                f"rouge_l={m['mean_rouge_l']:.3f}  "
                f"bert_f1={m['mean_bertscore_f1']:.3f}"
            )

    if "per_length_bucket" in stats:
        lines.extend(["", "Per length bucket:"])
        for bucket, m in sorted(stats["per_length_bucket"].items()):
            lines.append(
                f"  {bucket:<10s} (n={m['n']:>4d}, avg={m['mean_token_count']:>5.0f} tok)  "
                f"exact={m['exact_match']:.1%}  "
                f"tok_f1={m['mean_f1']:.3f}  "
                f"rouge_l={m['mean_rouge_l']:.3f}  "
                f"distinct={m['mean_distinctiveness']:.3f}"
            )

    return "\n".join(lines)



def save_results(name: str, encoder: str, split: str, stats: dict, ds):
    """Save summary JSON and per-sample detail parquet."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    tag = f"{name}_{encoder}_{split}"

    # Summary JSON
    summary_file = RESULTS_DIR / f"{tag}.json"
    # Convert any numpy types for JSON serialization
    clean_stats = json.loads(json.dumps(stats, default=lambda x: float(x) if hasattr(x, 'item') else x))
    with open(summary_file, "w") as f:
        json.dump(clean_stats, f, indent=2)
    print(f"Summary: {summary_file}")

    # Detail parquet: export the enriched dataset columns we care about
    detail_file = RESULTS_DIR / f"{tag}_detail.parquet"
    detail_cols = [
        "id", "source", "token_count", "length_bucket",
        "reference", "prediction",
        "valid", "exact_match", "f1_precision", "f1_recall", "f1",
        "rouge1", "rouge_l", "bertscore_f1", "distinctiveness",
    ]
    missing = [c for c in detail_cols if c not in ds.column_names]
    if missing:
        raise ValueError(f"Expected columns missing from dataset: {missing}")
    ds.select_columns(detail_cols).to_parquet(str(detail_file))
    print(f"Detail:  {detail_file}")


def main():
    parser = argparse.ArgumentParser(description="Evaluate slug predictions")
    parser.add_argument("predictions", type=Path, help="Predictions parquet (id, predicted_slug)")
    parser.add_argument("--encoder", required=True, choices=list(ENCODERS))
    parser.add_argument("--split", default="test")
    parser.add_argument("--name", help="Name for results files (default: predictions filename stem)")
    args = parser.parse_args()

    name = args.name or args.predictions.stem

    print(f"Loading dataset ({args.encoder}, {args.split})...")
    ds = load_dataset(args.predictions, encoder=args.encoder)
    print(f"  {len(ds)} samples")

    print("Preparing...")
    ds = transform_dataset(ds)

    print("Running pipeline...")
    ds = default_pipeline.transform(ds)

    print("Computing stats...")
    stats = {"n_samples": len(ds)}
    stats = default_pipeline.evaluate(ds, stats)

    print()
    print(format_summary(stats))
    print()

    save_results(name, args.encoder, args.split, stats, ds)


if __name__ == "__main__":
    main()
