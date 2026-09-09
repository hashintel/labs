"""Benchmark inference speed on pre-computed test embeddings.

No API calls needed. Loads embeddings from benchmark_test_100.json,
runs the model, reports timing statistics.

Usage:
    uv run python benchmark_inference.py
    uv run python benchmark_inference.py --model data/url/openai/models/seq2seq_bpe_d384_l6
    uv run python benchmark_inference.py --samples 50 --warmup 10
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np

from vec2slug.training.seq2seq.predict import Seq2SeqPredictor

DEFAULT_MODEL = Path("data/url/openai/models/seq2seq_bpe_d512_l6_t24_eos")
DEFAULT_DATA = Path("data/url/openai/benchmark_test_100.json")


def main():
    parser = argparse.ArgumentParser(description="Benchmark slug inference")
    parser.add_argument(
        "--model", type=Path, default=DEFAULT_MODEL, help="Model directory"
    )
    parser.add_argument(
        "--data", type=Path, default=DEFAULT_DATA, help="Benchmark embeddings JSON"
    )
    parser.add_argument(
        "--samples", type=int, default=100, help="Number of samples to run"
    )
    parser.add_argument(
        "--warmup", type=int, default=5, help="Warmup iterations (not timed)"
    )
    args = parser.parse_args()

    # Load embeddings
    with open(args.data) as f:
        data = json.load(f)

    samples = data[: args.samples]
    embeddings = [np.array(s["embedding"], dtype=np.float32) for s in samples]
    print(f"Loaded {len(samples)} embeddings from {args.data}")

    # Load model
    print(f"Loading model from {args.model}...")
    predictor = Seq2SeqPredictor(model_dir=args.model, encoder="openai", device="cpu")
    print("Model loaded.")

    # Warmup
    print(f"Warming up ({args.warmup} iterations)...")
    for i in range(args.warmup):
        emb = embeddings[i % len(embeddings)].reshape(1, -1)
        predictor.predict(emb)

    # Benchmark: one at a time (realistic deployment scenario)
    print(f"Benchmarking {len(samples)} samples...")
    times = []
    predictions = []
    for i, emb in enumerate(embeddings):
        emb_batch = emb.reshape(1, -1)
        start = time.perf_counter()
        slug = predictor.predict(emb_batch)[0]
        elapsed = time.perf_counter() - start
        times.append(elapsed)
        predictions.append(slug)

    times_ms = [t * 1000 for t in times]
    times_ms_unsorted = times_ms.copy()
    times_ms.sort()

    # Report
    print()
    print(f"Model: {args.model.name}")
    print(f"Samples: {len(times_ms)}")
    print(f"  Mean:   {np.mean(times_ms):.1f} ms")
    print(f"  Median: {np.median(times_ms):.1f} ms")
    print(f"  P5:     {np.percentile(times_ms, 5):.1f} ms")
    print(f"  P95:    {np.percentile(times_ms, 95):.1f} ms")
    print(f"  Min:    {min(times_ms):.1f} ms")
    print(f"  Max:    {max(times_ms):.1f} ms")
    print(f"  Total:  {sum(times):.2f} s")
    print(f"  Throughput: {len(times_ms) / sum(times):.1f} inferences/sec")
    print()

    # Show a few examples
    print("Sample predictions:")
    for i in range(min(5, len(samples))):
        ref = samples[i].get("reference", "?")
        pred = predictions[i]
        print(f"  ref: {ref}")
        print(f"  pred: {pred}  ({times_ms_unsorted[i]:.1f} ms)")
        print()


if __name__ == "__main__":
    main()
