"""Embed the corpus using a registered encoder.

Supports three backends:
  - openrouter: real-time embeddings via OpenRouter (with checkpointing)
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
from typing import Any, cast

import duckdb
import numpy as np

from .config import (
    ENCODERS,
    EncoderConfig,
    openrouter_client,
    require_env,
)
from .libs.batch import Batch, RequestInfo
from .libs.workspace import Id, Workspace

CHECKPOINT_INTERVAL = 50  # write checkpoint every N batches
CONCURRENT_REQUESTS = 8  # parallel API calls
MAX_RETRIES = 5


def _embed_openrouter(workspace: Workspace, encoder_config: EncoderConfig):
    """Embed via OpenRouter's OpenAI-compatible embeddings endpoint.

    Writes checkpoints every CHECKPOINT_INTERVAL batches to a shards
    directory. On restart, skips documents already embedded. Merges
    shards into the final output at the end.
    """
    client = openrouter_client()
    output_path = workspace.embeddings_path(encoder_config.name)
    shard_directory = output_path.parent / ".embeddings_shards"
    shard_directory.mkdir(parents=True, exist_ok=True)

    completed_ids: set[str] = set()
    for shard in sorted(shard_directory.glob("*.parquet")):
        rows = duckdb.sql(f"SELECT id FROM '{shard}'").fetchall()
        completed_ids.update(row[0] for row in rows)

    corpus = workspace.load_corpus_texts()
    remaining = [
        (text.id, text.text) for text in corpus if text.id not in completed_ids
    ]

    if completed_ids:
        print(
            f"Resuming: {len(completed_ids)} already embedded, {len(remaining)} remaining"
        )
    else:
        print(f"Embedding {len(corpus)} documents with {encoder_config.model}...")

    shard_ids: list[Id] = []
    shard_embeddings: list[list[float]] = []
    shard_count = len(list(shard_directory.glob("*.parquet")))

    def flush_shard():
        nonlocal shard_ids, shard_embeddings, shard_count
        if not shard_ids:
            return
        shard_path = shard_directory / f"shard_{shard_count:04d}.parquet"
        array = np.array(shard_embeddings, dtype=np.float32)
        workspace.write_embeddings(shard_ids, array, shard_path)
        shard_count += 1
        shard_ids = []
        shard_embeddings = []

    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed

    total = len(corpus)
    done_so_far = len(completed_ids)
    start_time = time.time()

    def embed_batch(
        batch_data: list[tuple[Id, str]],
    ) -> tuple[list[Id], list[list[float]]]:
        ids = [document_id for document_id, _ in batch_data]
        texts = [text for _, text in batch_data]

        for attempt in range(MAX_RETRIES):
            try:
                response = client.embeddings.create(
                    model=encoder_config.model, input=texts
                )
                if not response.data or len(response.data) != len(texts):
                    raise ValueError(
                        f"Expected {len(texts)} embeddings, got {len(response.data) if response.data else 0}"
                    )
                embeddings = cast(list[list[float]], [None] * len(texts))
                for item in response.data:
                    embeddings[item.index] = item.embedding
                if any(embedding is None for embedding in embeddings):
                    raise ValueError("Response had gaps in embedding indices")

                return ids, embeddings
            except Exception as error:
                if attempt < MAX_RETRIES - 1:
                    wait = 2**attempt * 5
                    print(
                        f"  Error: {error}. Retrying in {wait}s... ({attempt + 1}/{MAX_RETRIES})"
                    )
                    time.sleep(wait)
                else:
                    raise

    batches_since_checkpoint = 0
    all_batches = list(batched(remaining, encoder_config.batch_size))

    with ThreadPoolExecutor(max_workers=CONCURRENT_REQUESTS) as pool:
        for chunk_start in range(0, len(all_batches), CONCURRENT_REQUESTS):
            chunk = all_batches[chunk_start : chunk_start + CONCURRENT_REQUESTS]
            futures = {
                pool.submit(embed_batch, list(batch)): index
                for index, batch in enumerate(chunk)
            }

            results = cast(
                list[tuple[list[Id], list[list[float]]]], [None] * len(chunk)
            )
            for future in as_completed(futures):
                index = futures[future]
                try:
                    results[index] = future.result()
                except Exception:
                    print("  Batch failed after retries, checkpointing and exiting.")
                    flush_shard()
                    raise

            for ids, embeddings in results:
                shard_ids.extend(ids)
                shard_embeddings.extend(embeddings)
                done_so_far += len(ids)

            batches_since_checkpoint += len(chunk)
            elapsed = time.time() - start_time
            rate = (done_so_far - len(completed_ids)) / elapsed if elapsed > 0 else 0
            eta = (total - done_so_far) / rate / 3600 if rate > 0 else 0
            print(
                f"  {done_so_far:>9,}/{total:,}  ({rate:.0f} docs/s, ~{eta:.1f}h remaining)"
            )

            if batches_since_checkpoint >= CHECKPOINT_INTERVAL:
                flush_shard()
                batches_since_checkpoint = 0

    flush_shard()

    print("Merging shards...")
    shard_glob = shard_directory / "*.parquet"
    merge_count = duckdb.sql(
        f"""
            SELECT count(*)
            FROM read_parquet('{shard_glob}')
        """
    ).fetchone()[0]

    duckdb.sql(f"""
        COPY (
            SELECT * FROM read_parquet('{shard_glob}')
            ORDER BY id
        ) TO '{output_path}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    print(f"Wrote {merge_count} embeddings to {output_path}")


def _embed_local(workspace: Workspace, encoder_config: EncoderConfig):
    """Embed locally using transformers + torch."""
    import torch
    import torch.nn.functional as F
    from transformers import AutoModel, AutoTokenizer

    corpus = workspace.load_corpus_texts()
    ids = [text.id for text in corpus]
    texts = [text.text for text in corpus]

    print(f"Loading {encoder_config.model}...")
    tokenizer = AutoTokenizer.from_pretrained(encoder_config.model)
    model = AutoModel.from_pretrained(encoder_config.model, dtype="auto")
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

    for index, batch_texts in enumerate(batched(texts, encoder_config.batch_size)):
        batch_dict = tokenizer(
            batch_texts,
            max_length=8192,
            padding=True,
            truncation=True,
            return_tensors="pt",
        )
        batch_dict = {key: value.to(device) for key, value in batch_dict.items()}

        with torch.inference_mode():
            outputs = model(**batch_dict)

        embedding = last_token_pool(
            outputs.last_hidden_state, batch_dict["attention_mask"]
        )
        embedding = F.normalize(embedding, p=2, dim=1)
        all_embeddings.append(embedding.cpu().float().numpy())

        done = min((index + 1) * encoder_config.batch_size, len(texts))
        print(f"  {done}/{len(texts)}")

    embeddings_array = np.concatenate(all_embeddings, axis=0).astype(np.float32)
    workspace.write_encoder_embeddings(encoder_config.name, ids, embeddings_array)


BACKENDS = {
    "openrouter": _embed_openrouter,
    "local": _embed_local,
}


BATCH_REQUEST_LIMIT = 50_000
BATCH_FILE_SIZE_LIMIT = 200 * 1024 * 1024  # 200 MiB
MAX_CONCURRENT_BATCHES = 3  # ~100M token enqueue limit / ~25M tokens per batch


class EmbeddingRequest:
    """A single embedding request: document ID + text."""

    __slots__ = ("document_id", "text")

    def __init__(self, document_id: str, text: str):
        self.document_id = document_id
        self.text = text


class EmbeddingBatch(Batch[EmbeddingRequest, list[float]]):
    """OpenAI Batch API for embeddings."""

    def __init__(self, workspace: Workspace, model: str, api_key: str):
        super().__init__(
            batch_dir=workspace.batch_dir("embed_openai"),
            max_concurrent_batches=MAX_CONCURRENT_BATCHES,
        )
        self.workspace = workspace
        self.model = model
        self.api_key = api_key
        self._batch_counter = 0

    def _client(self):
        from openai import OpenAI

        return OpenAI(api_key=self.api_key)

    def request_id(self, request: EmbeddingRequest) -> str:
        return request.document_id

    def request_size(self, request: EmbeddingRequest) -> int:
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


def _run_batch(workspace: Workspace, encoder_config: EncoderConfig, action: str):
    """Run a batch action (submit, poll, collect)."""
    model = encoder_config.model.removeprefix("openai/")
    api_key = require_env("OPENAI_API_KEY")
    embedding_batch = EmbeddingBatch(workspace=workspace, model=model, api_key=api_key)

    match action:
        case "submit":
            corpus = workspace.load_corpus_texts()
            print(f"Preparing {len(corpus)} documents for batch embedding...")
            print(f"  Batch dir: {embedding_batch.batch_dir}")

            requests = [EmbeddingRequest(text.id, text.text) for text in corpus]
            embedding_batch.submit(requests)
            print("\nRun --batch-poll to check status.")

        case "poll":
            embedding_batch.poll()

        case "collect":
            results = embedding_batch.collect()
            print(f"\n{len(results)} embeddings collected")

            corpus = workspace.load_corpus_texts()
            ids = []
            embeddings = []
            missing = 0
            for text in corpus:
                embedding = results.get(text.id)
                if embedding:
                    ids.append(text.id)
                    embeddings.append(embedding)
                else:
                    missing += 1

            if missing:
                print(f"  Warning: {missing} documents missing embeddings")

            embeddings_array = np.array(embeddings, dtype=np.float32)
            workspace.write_encoder_embeddings(
                encoder_config.name, ids, embeddings_array
            )


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
    parser.add_argument("--workspace", default="original")
    args = parser.parse_args()

    workspace = Workspace(args.workspace)
    encoder_config = ENCODERS[args.encoder]

    if args.batch:
        _run_batch(workspace, encoder_config, "submit")
    elif args.batch_poll:
        _run_batch(workspace, encoder_config, "poll")
    elif args.batch_collect:
        _run_batch(workspace, encoder_config, "collect")
    else:
        backend_function = BACKENDS.get(encoder_config.backend)
        if not backend_function:
            print(f"Unknown backend: {encoder_config.backend}")
            sys.exit(1)
        backend_function(workspace, encoder_config)


if __name__ == "__main__":
    main()
