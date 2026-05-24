"""Benchmark Haiku slug generation cost on the same 100 test samples.

Uses the same samples as benchmark_inference.py (benchmark_test_100.json),
joins back to the corpus for source text, calls Haiku with the distillation
prompt, reports actual token usage and cost per call.

Usage:
    uv run python benchmark_haiku_cost.py
    uv run python benchmark_haiku_cost.py --samples 20
"""

import argparse
import json
import time
from pathlib import Path

import duckdb
from dotenv import load_dotenv

load_dotenv()

from vec2slug.config import (
    DISTILL_MAX_TOKENS,
    DISTILL_MODEL,
    DISTILL_TEMPERATURE,
    anthropic_client,
)
from vec2slug.distill_slugs import (
    SYSTEM_PROMPT,
    build_messages,
)

BENCHMARK_DATA = Path("data/url/openai/benchmark_test_100.json")
CORPUS = Path("data/url/corpus.parquet")

# Haiku 3.5 pricing (as of 2025)
# https://docs.anthropic.com/en/docs/about-claude/models
HAIKU_INPUT_PRICE = 0.80 / 1_000_000  # $/token
HAIKU_OUTPUT_PRICE = 4.00 / 1_000_000  # $/token


def main():
    parser = argparse.ArgumentParser(description="Benchmark Haiku slug cost")
    parser.add_argument("--samples", type=int, default=100, help="Number of samples")
    args = parser.parse_args()

    # Load the same IDs used in benchmark_inference.py
    with open(BENCHMARK_DATA) as f:
        benchmark = json.load(f)
    sample_ids = [s["id"] for s in benchmark[: args.samples]]

    # Join to corpus for source text
    conn = duckdb.connect()
    placeholders = ", ".join(f"'{sid}'" for sid in sample_ids)
    rows = conn.execute(f"""
        SELECT id, text, slug, token_count
        FROM '{CORPUS}'
        WHERE id IN ({placeholders})
    """).fetchall()

    # Index by ID to preserve benchmark order
    by_id = {r[0]: r for r in rows}
    samples = [by_id[sid] for sid in sample_ids if sid in by_id]

    print(f"Model: {DISTILL_MODEL}")
    print(f"Matched {len(samples)} of {len(sample_ids)} benchmark samples to corpus")
    print()

    client = anthropic_client()
    total_input_tokens = 0
    total_output_tokens = 0
    total_cost = 0.0
    times = []

    for doc_id, text, ref_slug, token_count in samples:
        start = time.perf_counter()
        response = client.messages.create(
            model=DISTILL_MODEL,
            max_tokens=DISTILL_MAX_TOKENS,
            temperature=DISTILL_TEMPERATURE,
            system=SYSTEM_PROMPT,
            messages=build_messages(text),
        )
        elapsed = time.perf_counter() - start

        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        cost = input_tokens * HAIKU_INPUT_PRICE + output_tokens * HAIKU_OUTPUT_PRICE

        total_input_tokens += input_tokens
        total_output_tokens += output_tokens
        total_cost += cost
        times.append(elapsed)

        generated = response.content[0].text if response.content else ""
        print(f"  ref: {ref_slug}")
        print(f"  gen: {generated}")
        print(
            f"  doc tokens: {token_count}, input: {input_tokens}, output: {output_tokens}"
        )
        print(f"  cost: ${cost:.6f}, latency: {elapsed * 1000:.0f}ms")
        print()

    avg_input = total_input_tokens / len(samples)
    avg_output = total_output_tokens / len(samples)
    avg_cost = total_cost / len(samples)
    avg_time = sum(times) / len(samples)

    print("=" * 60)
    print("Average per call:")
    print(f"  Input tokens:  {avg_input:.0f}")
    print(f"  Output tokens: {avg_output:.0f}")
    print(f"  Cost:          ${avg_cost:.6f}")
    print(f"  Latency:       {avg_time * 1000:.0f}ms")
    print()
    print(f"Total ({len(samples)} calls):")
    print(f"  Input tokens:  {total_input_tokens}")
    print(f"  Output tokens: {total_output_tokens}")
    print(f"  Cost:          ${total_cost:.6f}")
    print(f"  Latency:       {sum(times):.1f}s")


if __name__ == "__main__":
    main()
