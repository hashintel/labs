"""Generate baseline predictions for evaluation.

Two baselines that bracket expected model performance:
- Random: sample a slug from the training set (floor)
- Haiku: re-run the distillation prompt via Batch API on test texts (ceiling)

The Haiku baseline submits the union of all encoder test sets in one batch,
producing a single predictions file that works with any encoder at eval time.

Usage:
    uv run slug-baseline random --encoder openai
    uv run slug-baseline haiku
    uv run slug-baseline haiku-poll
    uv run slug-baseline haiku-collect
"""

import argparse
import json
import time

import duckdb
import numpy as np

from .config import (
    CORPUS_WITH_SLUGS_FILE,
    DATA_DIR,
    DISTILL_MAX_TOKENS,
    DISTILL_MODEL,
    DISTILL_TEMPERATURE,
    ENCODERS,
    POLL_INTERVAL,
    POLL_MAX_WAIT,
    anthropic_client,
    splits_file,
)
from .distill_slugs import (
    SYSTEM_PROMPT,
    build_messages,
    extract_text,
    make_custom_id,
    validate_slug,
)

PREDICTIONS_DIR = DATA_DIR / "predictions"
BASELINE_BATCH_ID_FILE = DATA_DIR / "baseline_batch_id.txt"
BASELINE_ID_MAP_FILE = DATA_DIR / "baseline_id_map.json"
BASELINE_RESULTS_FILE = DATA_DIR / "baseline_batch_results.jsonl"


def _test_ids_and_texts(encoder: str, split: str) -> list[tuple[str, str]]:
    """Load (id, text) pairs for the given encoder/split."""
    return duckdb.sql(f"""
        SELECT c.id, c.text
        FROM '{CORPUS_WITH_SLUGS_FILE}' c
        JOIN '{splits_file(encoder)}' s ON c.id = s.id
        WHERE s.split = '{split}'
    """).fetchall()


def _train_slugs(encoder: str) -> list[str]:
    """Load all training-set slugs for the given encoder."""
    rows = duckdb.sql(f"""
        SELECT c.slug
        FROM '{CORPUS_WITH_SLUGS_FILE}' c
        JOIN '{splits_file(encoder)}' s ON c.id = s.id
        WHERE s.split = 'train'
    """).fetchall()
    return [r[0] for r in rows]


# ── Random baseline ──────────────────────────────────────────────────────────


def cmd_random(encoder: str, split: str = "test", seed: int = 42):
    """For each test sample, pick a random slug from the training set."""
    slugs = _train_slugs(encoder)
    test_data = _test_ids_and_texts(encoder, split)

    rng = np.random.RandomState(seed)
    predictions = {}
    for doc_id, _ in test_data:
        predictions[doc_id] = slugs[rng.randint(len(slugs))]

    print(
        f"Random baseline: {len(predictions)} predictions from {len(slugs)} training slugs"
    )
    save_predictions(predictions, f"random_{encoder}_{split}")


# ── Haiku baseline (batch API) ───────────────────────────────────────────────


def _union_test_ids_and_texts(split: str = "test") -> list[tuple[str, str]]:
    """Load (id, text) pairs for the union of all encoder test sets."""
    encoder_clauses = " UNION ".join(
        f"SELECT id FROM '{splits_file(enc)}' WHERE split = '{split}'"
        for enc in ENCODERS
    )
    return duckdb.sql(f"""
        SELECT DISTINCT c.id, c.text
        FROM '{CORPUS_WITH_SLUGS_FILE}' c
        WHERE c.id IN ({encoder_clauses})
    """).fetchall()


def cmd_haiku_submit(split: str = "test"):
    """Submit a batch for the union of all encoder test sets."""
    client = anthropic_client()
    test_data = _union_test_ids_and_texts(split)
    print(
        f"Building batch for {len(test_data)} test samples (union of all encoders)..."
    )

    id_map = {}
    requests = []
    for doc_id, text in test_data:
        custom_id = make_custom_id(doc_id)
        id_map[custom_id] = doc_id
        requests.append(
            {
                "custom_id": custom_id,
                "params": {
                    "model": DISTILL_MODEL,
                    "max_tokens": DISTILL_MAX_TOKENS,
                    "temperature": DISTILL_TEMPERATURE,
                    "system": SYSTEM_PROMPT,
                    "messages": build_messages(text),
                },
            }
        )

    BASELINE_ID_MAP_FILE.write_text(json.dumps(id_map))

    print("Submitting batch...")
    batch = client.messages.batches.create(requests=requests)
    BASELINE_BATCH_ID_FILE.write_text(batch.id)
    print(f"Batch submitted: {batch.id}")
    print(f"Status: {batch.processing_status}")


def cmd_haiku_poll():
    """Poll until the baseline batch completes."""
    client = anthropic_client()
    batch_id = BASELINE_BATCH_ID_FILE.read_text().strip()
    print(f"Polling batch {batch_id}...")

    deadline = time.time() + POLL_MAX_WAIT
    while time.time() < deadline:
        try:
            batch = client.messages.batches.retrieve(batch_id)
            counts = batch.request_counts
            print(
                f"  status={batch.processing_status}  "
                f"processing={counts.processing}  "
                f"succeeded={counts.succeeded}  "
                f"errored={counts.errored}"
            )
            if batch.processing_status == "ended":
                print("Batch complete.")
                return
        except Exception as e:
            print(f"  retrieve failed: {e}")
        time.sleep(POLL_INTERVAL)

    raise TimeoutError(f"Batch did not complete within {POLL_MAX_WAIT}s")


def cmd_haiku_collect(split: str = "test"):
    """Collect results from the baseline batch and save as predictions."""
    client = anthropic_client()
    batch_id = BASELINE_BATCH_ID_FILE.read_text().strip()
    id_map = json.loads(BASELINE_ID_MAP_FILE.read_text())

    # Stream results to file if not cached
    if not BASELINE_RESULTS_FILE.exists():
        print(f"Streaming results to {BASELINE_RESULTS_FILE}...")
        n = 0
        with open(BASELINE_RESULTS_FILE, "w") as f:
            for result in client.messages.batches.results(batch_id):
                record = {"custom_id": result.custom_id}
                if result.result.type == "succeeded":
                    raw = extract_text(result.result.message.content) or ""
                    record["status"] = "succeeded"
                    record["raw"] = raw
                else:
                    record["status"] = result.result.type
                f.write(json.dumps(record) + "\n")
                n += 1
        print(f"  {n} raw results")

    # Parse and validate
    predictions = {}
    invalid = 0
    with open(BASELINE_RESULTS_FILE) as f:
        for line in f:
            record = json.loads(line)
            custom_id = record["custom_id"]
            doc_id = id_map.get(custom_id, custom_id)
            if record["status"] == "succeeded":
                slug = validate_slug(record.get("raw", ""))
                if slug:
                    predictions[doc_id] = slug
                else:
                    invalid += 1
            else:
                invalid += 1

    print(f"Haiku baseline: {len(predictions)} valid, {invalid} invalid")
    save_predictions(predictions, f"haiku_{split}")

    # Split into per-encoder prediction files
    union_file = PREDICTIONS_DIR / f"haiku_{split}.parquet"
    for encoder in ENCODERS:
        out = PREDICTIONS_DIR / f"haiku_{encoder}_{split}.parquet"
        duckdb.sql(f"""
            COPY (
                SELECT p.id, p.predicted_slug
                FROM '{union_file}' p
                JOIN '{splits_file(encoder)}' s ON p.id = s.id
                WHERE s.split = '{split}'
            ) TO '{out}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """)
        count = duckdb.sql(f"SELECT count(*) FROM '{out}'").fetchone()[0]
        print(f"  {encoder}: {count} predictions -> {out.name}")


def cmd_haiku(split: str = "test"):
    """Submit, poll, and collect in one step."""
    cmd_haiku_submit(split)
    cmd_haiku_poll()
    cmd_haiku_collect(split)


# ── Shared ────────────────────────────────────────────────────────────────────


def save_predictions(predictions: dict[str, str], name: str):
    """Write predictions to parquet as (id, predicted_slug)."""
    PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    output = PREDICTIONS_DIR / f"{name}.parquet"

    conn = duckdb.connect()
    conn.execute("CREATE TABLE preds (id VARCHAR, predicted_slug VARCHAR)")
    conn.executemany("INSERT INTO preds VALUES (?, ?)", list(predictions.items()))
    conn.execute(f"""
        COPY (SELECT * FROM preds)
        TO '{output}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    conn.close()
    print(f"Wrote {len(predictions)} predictions to {output}")


# ── CLI ───────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Generate baseline predictions")
    parser.add_argument(
        "command",
        choices=["random", "haiku", "haiku-submit", "haiku-poll", "haiku-collect"],
    )
    parser.add_argument("--encoder", choices=list(ENCODERS))
    parser.add_argument("--split", default="test")
    args = parser.parse_args()

    if args.command == "random":
        if not args.encoder:
            parser.error("--encoder is required for random baseline")
        cmd_random(args.encoder, args.split)
    elif args.command == "haiku":
        cmd_haiku(args.split)
    elif args.command == "haiku-submit":
        cmd_haiku_submit(args.split)
    elif args.command == "haiku-poll":
        cmd_haiku_poll()
    elif args.command == "haiku-collect":
        cmd_haiku_collect(args.split)


if __name__ == "__main__":
    main()
