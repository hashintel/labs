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
    DISTILL_MAX_TOKENS,
    DISTILL_MODEL,
    DISTILL_TEMPERATURE,
    ENCODERS,
    POLL_INTERVAL,
    POLL_MAX_WAIT,
    Encoder,
    anthropic_client,
)
from .distill_slugs import (
    SYSTEM_PROMPT,
    build_messages,
    extract_text,
    make_custom_id,
    validate_slug,
)
from .libs.workspace import Split, Workspace


def cmd_random(
    workspace: Workspace, encoder: Encoder, split: Split = "test", seed: int = 42
):
    """For each test sample, pick a random slug from the training set."""
    slugs = workspace.load_split_slugs(encoder, "train")
    test_texts = workspace.load_split_texts(encoder, split)

    rng = np.random.RandomState(seed)
    ids = [text.id for text in test_texts]
    predicted = [slugs[rng.randint(len(slugs))] for _ in ids]

    print(f"Random baseline: {len(ids)} predictions from {len(slugs)} training slugs")

    workspace.write_predictions(encoder, "random", ids, predicted, split)
    print(f"Wrote {len(ids)} predictions")


def _union_test_ids_and_texts(
    workspace: Workspace, split: Split = "test"
) -> list[tuple[str, str]]:
    """Load (id, text) pairs for the union of all encoder test sets."""
    corpus_path = workspace.corpus_path()
    encoder_clauses = " UNION ".join(
        f"SELECT id FROM '{workspace.splits_path(encoder)}' WHERE split = '{split}'"
        for encoder in ENCODERS
    )
    return duckdb.sql(f"""
        SELECT DISTINCT c.id, c.text
        FROM '{corpus_path}' c
        WHERE c.id IN ({encoder_clauses})
        ORDER BY c.id
    """).fetchall()


def cmd_haiku_submit(workspace: Workspace, split: Split = "test"):
    """Submit a batch for the union of all encoder test sets."""
    client = anthropic_client()
    test_data = _union_test_ids_and_texts(workspace, split)
    print(
        f"Building batch for {len(test_data)} test samples (union of all encoders)..."
    )

    batch_directory = workspace.batch_dir("baseline")
    id_map_file = batch_directory / "id_map.json"
    batch_id_file = batch_directory / "batch_id.txt"

    id_map = {}
    requests = []
    for document_id, text in test_data:
        custom_id = make_custom_id(document_id)
        id_map[custom_id] = document_id
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

    id_map_file.write_text(json.dumps(id_map))

    print("Submitting batch...")
    batch = client.messages.batches.create(requests=requests)
    batch_id_file.write_text(batch.id)
    print(f"Batch submitted: {batch.id}")
    print(f"Status: {batch.processing_status}")


def cmd_haiku_poll(workspace: Workspace):
    """Poll until the baseline batch completes."""
    client = anthropic_client()
    batch_directory = workspace.batch_dir("baseline")
    batch_id = (batch_directory / "batch_id.txt").read_text().strip()
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
        except Exception as error:
            print(f"  retrieve failed: {error}")
        time.sleep(POLL_INTERVAL)

    raise TimeoutError(f"Batch did not complete within {POLL_MAX_WAIT}s")


def cmd_haiku_collect(workspace: Workspace, split: Split = "test"):
    """Collect results from the baseline batch and save as predictions."""
    client = anthropic_client()
    batch_directory = workspace.batch_dir("baseline")
    batch_id = (batch_directory / "batch_id.txt").read_text().strip()
    id_map = json.loads((batch_directory / "id_map.json").read_text())
    results_file = batch_directory / "results.jsonl"

    if not results_file.exists():
        print(f"Streaming results to {results_file}...")
        count = 0
        with open(results_file, "w") as f:
            for result in client.messages.batches.results(batch_id):
                record = {"custom_id": result.custom_id}
                if result.result.type == "succeeded":
                    raw = extract_text(result.result.message.content) or ""
                    record["status"] = "succeeded"
                    record["raw"] = raw
                else:
                    record["status"] = result.result.type
                f.write(json.dumps(record) + "\n")
                count += 1
        print(f"  {count} raw results")

    ids = []
    predicted = []
    invalid = 0
    with open(results_file) as f:
        for line in f:
            record = json.loads(line)
            custom_id = record["custom_id"]
            document_id = id_map.get(custom_id, custom_id)
            if record["status"] == "succeeded":
                slug = validate_slug(record.get("raw", ""))
                if slug:
                    ids.append(document_id)
                    predicted.append(slug)
                else:
                    invalid += 1
            else:
                invalid += 1

    print(f"Haiku baseline: {len(ids)} valid, {invalid} invalid")

    # Write the union predictions file
    workspace.write_predictions("openai", "haiku_union", ids, predicted, split)

    # Split into per-encoder prediction files
    for encoder in ENCODERS:
        splits_path = workspace.splits_path(encoder)
        prediction_ids = []
        prediction_slugs = []
        for document_id, slug in zip(ids, predicted):
            row = duckdb.sql(f"""
                SELECT id FROM '{splits_path}'
                WHERE id = '{document_id}' AND split = '{split}'
            """).fetchone()
            if row:
                prediction_ids.append(document_id)
                prediction_slugs.append(slug)

        workspace.write_predictions(
            encoder, "haiku", prediction_ids, prediction_slugs, split
        )
        print(f"  {encoder}: {len(prediction_ids)} predictions")


def main():
    parser = argparse.ArgumentParser(description="Generate baseline predictions")
    parser.add_argument(
        "command",
        choices=["random", "haiku", "haiku-submit", "haiku-poll", "haiku-collect"],
    )
    parser.add_argument("--encoder", choices=list(ENCODERS))
    parser.add_argument("--split", default="test")
    parser.add_argument("--workspace", default="original")
    args = parser.parse_args()

    workspace = Workspace(args.workspace)

    match args.command:
        case "random":
            if not args.encoder:
                parser.error("--encoder is required for random baseline")
            cmd_random(workspace, args.encoder, args.split)
        case "haiku":
            cmd_haiku_submit(workspace, args.split)
            cmd_haiku_poll(workspace)
            cmd_haiku_collect(workspace, args.split)
        case "haiku-submit":
            cmd_haiku_submit(workspace, args.split)
        case "haiku-poll":
            cmd_haiku_poll(workspace)
        case "haiku-collect":
            cmd_haiku_collect(workspace, args.split)


if __name__ == "__main__":
    main()
