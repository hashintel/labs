"""Verify that HF inference.py produces identical slugs to the main predictor.

Loads the same model through both Seq2SeqPredictor (main codebase) and
the standalone HF OnnxPredictor, runs beam search on real test embeddings,
and asserts the outputs match.

Usage:
    uv run python scripts/verify_inference_parity.py
    uv run python scripts/verify_inference_parity.py --samples 500
"""

import argparse
import importlib.util
import sys
from pathlib import Path

import duckdb
import numpy as np

from vec2slug.training.seq2seq.predict import Seq2SeqPredictor

PROJECT = Path(__file__).parent.parent
DEFAULT_MODEL = PROJECT / "data/url/openai/models/seq2seq_bpe_d384_l4_t24_eos"
HF_INFERENCE = PROJECT / "hf/inference.py"


def load_hf_module():
    """Import hf/inference.py as a module without it being on sys.path."""
    spec = importlib.util.spec_from_file_location("hf_inference", HF_INFERENCE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_test_embeddings(n: int, seed: int) -> tuple[list[str], np.ndarray]:
    """Load a random subsample of test embeddings via DuckDB."""
    splits = PROJECT / "data/url/openai/splits.parquet"
    embeddings = PROJECT / "data/url/openai/embeddings.parquet"

    rows = duckdb.sql(f"""
        SELECT s.id, e.embedding
        FROM '{splits}' s
        JOIN '{embeddings}' e ON s.id = e.id
        WHERE s.split = 'test'
        ORDER BY s.id
    """).fetchall()

    rng = np.random.default_rng(seed)
    indices = rng.choice(len(rows), size=min(n, len(rows)), replace=False)
    indices.sort()

    ids = [rows[i][0] for i in indices]
    embs = np.array([rows[i][1] for i in indices], dtype=np.float32)
    return ids, embs


def main():
    parser = argparse.ArgumentParser(
        description="Verify HF inference.py matches main predictor"
    )
    parser.add_argument(
        "--model", type=Path, default=DEFAULT_MODEL, help="Model directory"
    )
    parser.add_argument(
        "--samples", type=int, default=100, help="Number of test samples"
    )
    parser.add_argument(
        "--seed", type=int, default=42, help="Random seed for sampling"
    )
    args = parser.parse_args()

    model_dir = args.model

    for artifact in ("model.onnx", "model.json"):
        if not (model_dir / artifact).exists():
            print(f"Missing {artifact} in {model_dir}.")
            print("Run export_onnx.py first.")
            sys.exit(1)

    print(f"Loading test embeddings ({args.samples} samples)...")
    ids, embeddings = load_test_embeddings(args.samples, args.seed)
    print(f"  Loaded {len(ids)} embeddings")

    print(f"\nLoading main predictor (cached Huang)...")
    main_pred = Seq2SeqPredictor(model_dir, encoder="openai", device="cpu")

    print(f"Loading HF ONNX predictor...")
    hf_module = load_hf_module()
    hf_pred = hf_module.OnnxPredictor.from_dir(model_dir)

    print(f"\nRunning main predictor on {len(ids)} samples...")
    main_slugs = main_pred.predict(embeddings)

    print(f"Running HF predictor on {len(ids)} samples...")
    hf_slugs = hf_pred.predict(embeddings)

    assert len(main_slugs) == len(hf_slugs) == len(ids)

    matches = 0
    mismatches = []
    for doc_id, main_slug, hf_slug in zip(ids, main_slugs, hf_slugs):
        if main_slug == hf_slug:
            matches += 1
        else:
            mismatches.append((doc_id, main_slug, hf_slug))

    print(f"\n{'=' * 60}")
    print(f"Results: {matches}/{len(ids)} identical ({matches / len(ids):.1%})")

    if mismatches:
        print(f"\n{len(mismatches)} mismatches:")
        for doc_id, main_slug, hf_slug in mismatches[:20]:
            print(f"  {doc_id}")
            print(f"    main: {main_slug}")
            print(f"    hf:   {hf_slug}")
            print()
        if len(mismatches) > 20:
            print(f"  ... and {len(mismatches) - 20} more")
        sys.exit(1)
    else:
        print("All outputs match.")


if __name__ == "__main__":
    main()
