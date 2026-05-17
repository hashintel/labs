"""Embed the corpus using a registered encoder.

Supports three backends:
  - openrouter: real-time embeddings via OpenRouter (small corpora)
  - local: local transformers model on MPS/CUDA (e.g., Harrier)
  - openai-batch: OpenAI Batch API at 50% cost (large corpora)

Usage:
    uv run slug-embed openai
    uv run slug-embed harrier
    uv run slug-embed openai --batch
    uv run slug-embed openai --batch-poll
    uv run slug-embed openai --batch-collect
"""

import argparse
import json
import sys
from itertools import batched
from pathlib import Path
from typing import Any

import numpy as np

from .config import (
    CORPUS_WITH_SLUGS_FILE,
    ENCODERS,
    EncoderConfig,
    batch_dir,
    embeddings_file,
    openrouter_client,
    require_env,
)
from .io import load_corpus_texts, write_embeddings
from .libs.batch import Batch, RequestInfo

CHECKPOINT_INTERVAL = 50  # write checkpoint every N batches
CONCURRENT_REQUESTS = 8   # parallel API calls


def _load_completed_ids(out_path: Path) -> set[str]:
    """Load IDs already embedded from an existing output file."""
    if not out_path.exists():
        return set()
    import duckdb

    rows = duckdb.sql(f"SELECT id FROM '{out_path}'").fetchall()
    return {r[0] for r in rows}


def _embed_openrouter(cfg: EncoderConfig):
    """Embed via OpenRouter's OpenAI-compatible embeddings endpoint.

    Writes checkpoints every CHECKPOINT_INTERVAL batches to a shards
    directory. On restart, skips documents already embedded. Merges
    shards into the final output at the end.
    """
    client = openrouter_client()
    out_path = embeddings_file(cfg.name)
    shard_dir = out_path.parent / f".{out_path.stem}_shards"
    shard_dir.mkdir(parents=True, exist_ok=True)

    # Check for already-completed IDs from previous shards
    completed_ids: set[str] = set()
    for shard in sorted(shard_dir.glob("*.parquet")):
        import duckdb

        rows = duckdb.sql(f"SELECT id FROM '{shard}'").fetchall()
        completed_ids.update(r[0] for r in rows)

    corpus = load_corpus_texts(CORPUS_WITH_SLUGS_FILE)
    remaining = [
        (doc_id, text) for doc_id, text in corpus if doc_id not in completed_ids
    ]

    if completed_ids:
        print(
            f"Resuming: {len(completed_ids)} already embedded, {len(remaining)} remaining"
        )
    else:
        print(f"Embedding {len(corpus)} documents with {cfg.model}...")

    shard_ids: list[str] = []
    shard_embeddings: list[list[float]] = []
    shard_count = len(list(shard_dir.glob("*.parquet")))

    def flush_shard():
        nonlocal shard_ids, shard_embeddings, shard_count
        if not shard_ids:
            return
        shard_path = shard_dir / f"shard_{shard_count:04d}.parquet"
        arr = np.array(shard_embeddings, dtype=np.float32)
        write_embeddings(shard_ids, arr, shard_path)
        shard_count += 1
        shard_ids = []
        shard_embeddings = []

    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed

    total = len(corpus)
    done_so_far = len(completed_ids)
    t_start = time.time()
    max_retries = 5

    def embed_batch(batch_data: list[tuple[str, str]]) -> tuple[list[str], list[list[float]]]:
        ids = [doc_id for doc_id, _ in batch_data]
        texts = [text for _, text in batch_data]
        for attempt in range(max_retries):
            try:
                response = client.embeddings.create(model=cfg.model, input=texts)
                if not response.data or len(response.data) != len(texts):
                    raise ValueError(
                        f"Expected {len(texts)} embeddings, got {len(response.data) if response.data else 0}"
                    )
                embeddings = [None] * len(texts)
                for item in response.data:
                    embeddings[item.index] = item.embedding
                if any(e is None for e in embeddings):
                    raise ValueError("Response had gaps in embedding indices")
                return ids, embeddings
            except Exception as e:
                if attempt < max_retries - 1:
                    wait = 2 ** attempt * 5
                    print(f"  Error: {e}. Retrying in {wait}s... ({attempt + 1}/{max_retries})")
                    time.sleep(wait)
                else:
                    raise

    batches_since_checkpoint = 0
    all_batches = list(batched(remaining, cfg.batch_size))

    with ThreadPoolExecutor(max_workers=CONCURRENT_REQUESTS) as pool:
        for chunk_start in range(0, len(all_batches), CONCURRENT_REQUESTS):
            chunk = all_batches[chunk_start : chunk_start + CONCURRENT_REQUESTS]
            futures = {
                pool.submit(embed_batch, list(b)): idx
                for idx, b in enumerate(chunk)
            }

            results = [None] * len(chunk)
            for future in as_completed(futures):
                idx = futures[future]
                try:
                    results[idx] = future.result()
                except Exception:
                    print("  Batch failed after retries, checkpointing and exiting.")
                    flush_shard()
                    raise

            for ids, embeddings in results:
                shard_ids.extend(ids)
                shard_embeddings.extend(embeddings)
                done_so_far += len(ids)

            batches_since_checkpoint += len(chunk)
            elapsed = time.time() - t_start
            rate = (done_so_far - len(completed_ids)) / elapsed if elapsed > 0 else 0
            eta = (total - done_so_far) / rate / 3600 if rate > 0 else 0
            print(f"  {done_so_far:>9,}/{total:,}  ({rate:.0f} docs/s, ~{eta:.1f}h remaining)")

            if batches_since_checkpoint >= CHECKPOINT_INTERVAL:
                flush_shard()
                batches_since_checkpoint = 0

    flush_shard()

    # Merge all shards into final output
    print("Merging shards...")
    import duckdb

    shard_glob = shard_dir / "*.parquet"
    merge_count = duckdb.sql(
        f"SELECT count(*) FROM read_parquet('{shard_glob}')"
    ).fetchone()[0]
    duckdb.sql(f"""
        COPY (
            SELECT * FROM read_parquet('{shard_glob}')
            ORDER BY id
        ) TO '{out_path}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    print(f"Wrote {merge_count} embeddings to {out_path}")


def _embed_local(cfg: EncoderConfig):
    """Embed locally using transformers + torch."""
    import torch
    import torch.nn.functional as F
    from transformers import AutoModel, AutoTokenizer

    corpus = load_corpus_texts(CORPUS_WITH_SLUGS_FILE)
    ids = [doc_id for doc_id, _ in corpus]
    texts = [text for _, text in corpus]

    print(f"Loading {cfg.model}...")
    tokenizer = AutoTokenizer.from_pretrained(cfg.model)
    model = AutoModel.from_pretrained(cfg.model, dtype="auto")
    model.eval()

    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")
    model.to(device)
    print(f"Using device: {device}")

    def last_token_pool(last_hidden_states, attention_mask):
        left_padding = attention_mask[:, -1].sum() == attention_mask.shape[0]
        if left_padding:
            return last_hidden_states[:, -1]
        sequence_lengths = attention_mask.sum(dim=1) - 1
        batch_size = last_hidden_states.shape[0]
        return last_hidden_states[
            torch.arange(batch_size, device=last_hidden_states.device),
            sequence_lengths,
        ]

    all_embeddings = []
    print(f"Embedding {len(texts)} documents...")

    for i, batch_texts in enumerate(batched(texts, cfg.batch_size)):
        batch_dict = tokenizer(
            batch_texts,
            max_length=8192,
            padding=True,
            truncation=True,
            return_tensors="pt",
        )
        batch_dict = {k: v.to(device) for k, v in batch_dict.items()}

        with torch.inference_mode():
            outputs = model(**batch_dict)

        emb = last_token_pool(outputs.last_hidden_state, batch_dict["attention_mask"])
        emb = F.normalize(emb, p=2, dim=1)
        all_embeddings.append(emb.cpu().float().numpy())

        done = min((i + 1) * cfg.batch_size, len(texts))
        print(f"  {done}/{len(texts)}")

    embeddings_array = np.concatenate(all_embeddings, axis=0).astype(np.float32)
    write_embeddings(ids, embeddings_array, embeddings_file(cfg.name))


BACKENDS = {
    "openrouter": _embed_openrouter,
    "local": _embed_local,
}


# ── OpenAI Batch API ──────────────────────────────────────────────────────────

BATCH_REQUEST_LIMIT = 50_000
BATCH_FILE_SIZE_LIMIT = 200 * 1024 * 1024  # 200 MiB
MAX_CONCURRENT_BATCHES = 3  # ~100M token enqueue limit / ~25M tokens per batch


class EmbeddingRequest:
    """A single embedding request: document ID + text."""

    __slots__ = ("doc_id", "text")

    def __init__(self, doc_id: str, text: str):
        self.doc_id = doc_id
        self.text = text


class EmbeddingBatch(Batch[EmbeddingRequest, list[float]]):
    """OpenAI Batch API for embeddings."""

    def __init__(self, model: str, api_key: str):
        super().__init__(
            batch_dir=batch_dir("embed_openai"),
            max_concurrent_batches=MAX_CONCURRENT_BATCHES,
        )
        self.model = model
        self.api_key = api_key
        self._batch_counter = 0

    def _client(self):
        from openai import OpenAI

        return OpenAI(api_key=self.api_key)

    def request_id(self, request: EmbeddingRequest) -> str:
        return request.doc_id

    def request_size(self, request: EmbeddingRequest) -> int:
        # JSON overhead (~150 bytes) + text length
        return 150 + len(request.text.encode("utf-8"))

    def should_split(
        self,
        request: RequestInfo[EmbeddingRequest],
        *,
        current_size: int,
        current_count: int,
    ) -> bool:
        return (
            current_count >= BATCH_REQUEST_LIMIT
            or current_size + request.size > BATCH_FILE_SIZE_LIMIT
        )

    def submit_batch(self, requests: list[RequestInfo[EmbeddingRequest]]) -> str:
        client = self._client()

        # Write JSONL
        jsonl_path = self.batch_dir / f"batch_{self._batch_counter:03d}.jsonl"
        self._batch_counter += 1
        with open(jsonl_path, "w") as f:
            for info in requests:
                line = {
                    "custom_id": info.safe_id,
                    "method": "POST",
                    "url": "/v1/embeddings",
                    "body": {
                        "model": self.model,
                        "input": info.request.text,
                    },
                }
                f.write(json.dumps(line) + "\n")

        size_mb = jsonl_path.stat().st_size / 1e6
        print(
            f"  Uploading {jsonl_path.name} ({len(requests)} requests, {size_mb:.1f}MB)..."
        )

        with open(jsonl_path, "rb") as f:
            uploaded = client.files.create(file=f, purpose="batch")

        batch = client.batches.create(
            input_file_id=uploaded.id,
            endpoint="/v1/embeddings",
            completion_window="24h",
        )
        print(f"    batch_id={batch.id}, status={batch.status}")
        return batch.id

    def poll_batch(self, batch_id: str) -> dict[str, Any]:
        client = self._client()
        batch = client.batches.retrieve(batch_id)
        counts = batch.request_counts
        done = batch.status in ("completed", "failed", "cancelled", "expired")
        return {
            "status": batch.status,
            "completed": counts.completed,
            "total": counts.total,
            "failed": counts.failed,
            "done": done,
        }

    def collect_batch(self, batch_id: str) -> dict[str, list[float]]:
        client = self._client()
        batch = client.batches.retrieve(batch_id)

        if batch.status != "completed":
            print(f"  Batch {batch_id}: {batch.status} (skipping)")
            return {}

        content = client.files.content(batch.output_file_id).text
        results: dict[str, list[float]] = {}

        for line in content.strip().split("\n"):
            result = json.loads(line)
            if result.get("error"):
                continue
            safe_id = result["custom_id"]
            embedding = result["response"]["body"]["data"][0]["embedding"]
            results[safe_id] = embedding

        return results


def _run_batch(cfg: EncoderConfig, action: str):
    """Run a batch action (submit, poll, collect)."""
    model = cfg.model.removeprefix("openai/")
    api_key = require_env("OPENAI_API_KEY")
    eb = EmbeddingBatch(model=model, api_key=api_key)

    match action:
        case "submit":
            corpus = load_corpus_texts(CORPUS_WITH_SLUGS_FILE)
            print(f"Preparing {len(corpus)} documents for batch embedding...")
            print(f"  Corpus: {CORPUS_WITH_SLUGS_FILE.name}")
            print(f"  Batch dir: {eb.batch_dir}")

            requests = [EmbeddingRequest(doc_id, text) for doc_id, text in corpus]
            eb.submit(requests)
            print("\nRun --batch-poll to check status.")

        case "poll":
            eb.poll()

        case "collect":
            results = eb.collect()
            print(f"\n{len(results)} embeddings collected")

            # Write in corpus order
            corpus = load_corpus_texts(CORPUS_WITH_SLUGS_FILE)
            ids = []
            embeddings = []
            missing = 0
            for doc_id, _ in corpus:
                emb = results.get(doc_id)
                if emb:
                    ids.append(doc_id)
                    embeddings.append(emb)
                else:
                    missing += 1

            if missing:
                print(f"  Warning: {missing} documents missing embeddings")

            embeddings_array = np.array(embeddings, dtype=np.float32)
            write_embeddings(ids, embeddings_array, embeddings_file(cfg.name))


# ── CLI ───────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Embed corpus with a registered encoder"
    )
    parser.add_argument("encoder", choices=list(ENCODERS))
    parser.add_argument(
        "--batch", action="store_true", help="Submit to OpenAI Batch API"
    )
    parser.add_argument("--batch-poll", action="store_true", help="Poll batch status")
    parser.add_argument(
        "--batch-collect", action="store_true", help="Collect batch results"
    )
    args = parser.parse_args()

    cfg = ENCODERS[args.encoder]

    if args.batch:
        _run_batch(cfg, "submit")
    elif args.batch_poll:
        _run_batch(cfg, "poll")
    elif args.batch_collect:
        _run_batch(cfg, "collect")
    else:
        backend_fn = BACKENDS.get(cfg.backend)
        if not backend_fn:
            print(f"Unknown backend: {cfg.backend}")
            sys.exit(1)
        backend_fn(cfg)


if __name__ == "__main__":
    main()
