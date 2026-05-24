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
from typing import Any

import numpy as np

from .config import (
    ENCODERS,
    EncoderConfig,
    require_env,
)
from .libs.batch import Batch, RequestInfo
from .libs.embed import (
    CheckpointedRunner,
    LocalTransformersEmbedder,
    openrouter_embedder,
)
from .libs.workspace import Workspace


def _embed_openrouter(workspace: Workspace, encoder_config: EncoderConfig):
    """Embed via OpenRouter using the checkpointed runner."""
    import duckdb

    embedder = openrouter_embedder(model=encoder_config.model)
    runner = CheckpointedRunner.from_workspace(workspace, encoder_config.name, embedder)
    total = duckdb.sql(f"SELECT count(*) FROM '{workspace.corpus_path()}'").fetchone()[
        0
    ]
    runner.run(workspace.iter_corpus_texts(), total=total)


def _embed_local(workspace: Workspace, encoder_config: EncoderConfig):
    """Embed locally using the checkpointed runner."""
    import duckdb

    embedder = LocalTransformersEmbedder(
        model_name=encoder_config.model, batch_size=encoder_config.batch_size
    )
    runner = CheckpointedRunner.from_workspace(
        workspace, encoder_config.name, embedder, concurrent_requests=1
    )
    total = duckdb.sql(f"SELECT count(*) FROM '{workspace.corpus_path()}'").fetchone()[
        0
    ]
    runner.run(workspace.iter_corpus_texts(), total=total)


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
