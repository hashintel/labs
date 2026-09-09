"""Reusable embedding infrastructure: embedders and checkpointed runner.

Embedder is the ABC for anything that turns text batches into vectors.
It declares when a batch is full via should_flush() (same pattern as
Batch.should_split). CheckpointedRunner handles the iteration, sharding,
resumption, concurrent dispatch, and merging.

The pipeline is fully streaming: documents are read lazily from DuckDB,
batched according to the embedder's constraints, dispatched to a thread
pool with bounded concurrency, and checkpointed to disk periodically.
Nothing materializes the full corpus in memory.

Usage:
    embedder = openrouter_embedder(model="openai/text-embedding-3-small")
    runner = CheckpointedRunner(workspace, encoder="openai", embedder=embedder)
    runner.run()
"""

import time
from abc import ABC, abstractmethod
from collections.abc import Iterator
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from pathlib import Path

import duckdb
import numpy as np

from .workspace import CorpusText, Id, Workspace

CHECKPOINT_INTERVAL = 50
CONCURRENT_REQUESTS = 8
MAX_RETRIES = 5


class Embedder(ABC):
    """Turns a batch of texts into embedding vectors.

    Subclasses declare when a batch is full via should_flush(). The runner
    fills batches by pulling documents until should_flush() returns True,
    then hands the batch to embed().
    """

    @abstractmethod
    def embed(self, texts: list[str]) -> np.ndarray:
        """Embed a batch of texts. Returns array of shape (len(texts), dim)."""
        ...

    @abstractmethod
    def should_flush(
        self, *, current_count: int, current_tokens: int, next_text: str
    ) -> bool:
        """Whether the current batch should be sent before adding next_text."""
        ...

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count for a text. Override for model-specific counting."""
        return len(text) // 4 + 1


class OpenAICompatibleEmbedder(Embedder):
    """Embedder for OpenAI-compatible embedding APIs (OpenAI, OpenRouter, etc.).

    API constraints:
    - Max 2048 inputs per request
    - Max 8192 tokens per individual input (truncated by the API)
    - Max 300,000 tokens summed across all inputs per request
    """

    MAX_INPUTS_PER_REQUEST = 2048
    MAX_TOKENS_PER_REQUEST = 300_000

    def __init__(self, client, model: str):
        self._client = client
        self._model = model

    def should_flush(
        self, *, current_count: int, current_tokens: int, next_text: str
    ) -> bool:
        if current_count >= self.MAX_INPUTS_PER_REQUEST:
            return True
        next_tokens = self.estimate_tokens(next_text)
        return current_tokens + next_tokens > self.MAX_TOKENS_PER_REQUEST

    def embed(self, texts: list[str]) -> np.ndarray:
        """Send a single embedding request with retry and validation."""
        for attempt in range(MAX_RETRIES):
            try:
                response = self._client.embeddings.create(
                    model=self._model, input=texts
                )
                if not response.data or len(response.data) != len(texts):
                    raise ValueError(
                        f"Expected {len(texts)} embeddings, "
                        f"got {len(response.data) if response.data else 0}"
                    )
                embeddings: list[list[float] | None] = [None] * len(texts)
                for item in response.data:
                    embeddings[item.index] = item.embedding
                if any(embedding is None for embedding in embeddings):
                    raise ValueError("Response had gaps in embedding indices")
                return np.array(embeddings, dtype=np.float32)
            except Exception as error:
                if attempt < MAX_RETRIES - 1:
                    wait = 2**attempt * 5
                    print(
                        f"  Error: {error}. Retrying in {wait}s... "
                        f"({attempt + 1}/{MAX_RETRIES})"
                    )
                    time.sleep(wait)
                else:
                    raise
        raise RuntimeError("Unreachable")


class LocalTransformersEmbedder(Embedder):
    """Embedder using a local transformers model on MPS/CUDA/CPU."""

    def __init__(self, model_name: str, batch_size: int = 32):
        import torch
        from transformers import AutoModel, AutoTokenizer

        self._batch_size = batch_size
        self._tokenizer = AutoTokenizer.from_pretrained(model_name)
        self._model = AutoModel.from_pretrained(model_name, dtype="auto")
        self._model.eval()

        if torch.backends.mps.is_available():
            self._device = torch.device("mps")
        elif torch.cuda.is_available():
            self._device = torch.device("cuda")
        else:
            self._device = torch.device("cpu")
        self._model.to(self._device)
        print(f"Loaded {model_name} on {self._device}")

    def should_flush(
        self, *, current_count: int, current_tokens: int, next_text: str
    ) -> bool:
        return current_count >= self._batch_size

    def embed(self, texts: list[str]) -> np.ndarray:
        import torch
        import torch.nn.functional as F

        batch_dict = self._tokenizer(
            texts,
            max_length=8192,
            padding=True,
            truncation=True,
            return_tensors="pt",
        )
        batch_dict = {key: value.to(self._device) for key, value in batch_dict.items()}

        with torch.inference_mode():
            outputs = self._model(**batch_dict)

        embedding = self._last_token_pool(
            outputs.last_hidden_state, batch_dict["attention_mask"]
        )
        embedding = F.normalize(embedding, p=2, dim=1)
        return embedding.cpu().float().numpy()

    @staticmethod
    def _last_token_pool(last_hidden_states, attention_mask):
        import torch

        left_padding = attention_mask[:, -1].sum() == attention_mask.shape[0]
        if left_padding:
            return last_hidden_states[:, -1]
        sequence_lengths = attention_mask.sum(dim=1) - 1
        batch_size = last_hidden_states.shape[0]
        return last_hidden_states[
            torch.arange(batch_size, device=last_hidden_states.device),
            sequence_lengths,
        ]


def openrouter_embedder(model: str) -> OpenAICompatibleEmbedder:
    """Create an embedder pointed at OpenRouter."""
    from vec2slug.config import openrouter_client

    return OpenAICompatibleEmbedder(client=openrouter_client(), model=model)


def fill_batches(
    documents: Iterator[CorpusText], embedder: Embedder
) -> Iterator[list[CorpusText]]:
    """Yield batches from a document stream, respecting the embedder's constraints.

    Lazy: pulls from the document iterator one at a time, yields a batch
    as soon as should_flush() triggers. Never materializes more than one
    batch in memory.
    """
    current_batch: list[CorpusText] = []
    current_tokens = 0

    for document in documents:
        if current_batch and embedder.should_flush(
            current_count=len(current_batch),
            current_tokens=current_tokens,
            next_text=document.text,
        ):
            yield current_batch
            current_batch = []
            current_tokens = 0

        current_batch.append(document)
        current_tokens += embedder.estimate_tokens(document.text)

    if current_batch:
        yield current_batch


class CheckpointedRunner:
    """Embed a stream of (id, text) pairs with sharding, resumption, and concurrency.

    The source is any iterator of CorpusText. For corpus embedding, use
    the from_workspace() factory. For arbitrary text (e.g., vocab tokens),
    construct directly with an output_path and document stream.

    The pipeline is fully streaming:
    1. Documents are read lazily from the source iterator
    2. Completed IDs are filtered inline (no second full scan)
    3. Batches are filled lazily via fill_batches (respects embedder constraints)
    4. Batches are dispatched to a thread pool with bounded concurrency
    5. Results are checkpointed to disk periodically
    6. Shards are merged into the final output at the end
    """

    def __init__(
        self,
        output_path: Path,
        embedder: Embedder,
        *,
        concurrent_requests: int = CONCURRENT_REQUESTS,
        checkpoint_interval: int = CHECKPOINT_INTERVAL,
    ):
        self.output_path = output_path
        self.embedder = embedder
        self.concurrent_requests = concurrent_requests
        self.checkpoint_interval = checkpoint_interval
        self.shard_directory = output_path.parent / f".{output_path.stem}_shards"

    @classmethod
    def from_workspace(
        cls,
        workspace: Workspace,
        encoder: str,
        embedder: Embedder,
        **kwargs,
    ) -> "CheckpointedRunner":
        """Create a runner that writes to the workspace's canonical embedding path."""
        return cls(
            output_path=workspace.embeddings_path(encoder),
            embedder=embedder,
            **kwargs,
        )

    def run(self, documents: Iterator[CorpusText], total: int):
        """Embed documents with checkpointing and concurrency.

        Args:
            documents: lazy stream of (id, text) pairs to embed.
            total: total number of documents (for progress reporting).
        """
        if self.output_path.exists():
            print(f"Output already exists: {self.output_path}")
            return

        self.shard_directory.mkdir(parents=True, exist_ok=True)

        completed_ids = self._load_completed_ids()

        if len(completed_ids) == total and total > 0:
            print("All documents already embedded, merging...")
            self._merge_shards()
            return

        if completed_ids:
            print(
                f"Resuming: {len(completed_ids)} already embedded, "
                f"{total - len(completed_ids)} remaining"
            )
        else:
            print(f"Embedding {total} documents...")

        remaining = (
            document for document in documents if document.id not in completed_ids
        )
        batches = fill_batches(remaining, self.embedder)

        self._dispatch(
            total=total,
            batches=batches,
            already_done=len(completed_ids),
        )
        self._merge_shards()

    def _load_completed_ids(self) -> set[str]:
        completed: set[str] = set()
        for shard in sorted(self.shard_directory.glob("*.parquet")):
            rows = duckdb.sql(f"SELECT id FROM '{shard}'").fetchall()
            completed.update(row[0] for row in rows)
        return completed

    def _dispatch(
        self, total: int, batches: Iterator[list[CorpusText]], already_done: int
    ):
        sink = _ShardSink(self.shard_directory, self.checkpoint_interval)
        progress = _Progress(total, already_done)

        if self.concurrent_requests <= 1:
            self._dispatch_sequential(batches, sink, progress)
        else:
            self._dispatch_concurrent(batches, sink, progress)

        sink.flush()

    def _dispatch_sequential(
        self,
        batches: Iterator[list[CorpusText]],
        sink: "_ShardSink",
        progress: "_Progress",
    ):
        for batch in batches:
            ids, embeddings = self._embed_batch(batch)
            sink.ingest(ids, embeddings)
            progress.advance(len(ids))

    def _dispatch_concurrent(
        self,
        batches: Iterator[list[CorpusText]],
        sink: "_ShardSink",
        progress: "_Progress",
    ):
        with ThreadPoolExecutor(max_workers=self.concurrent_requests) as pool:
            in_flight: dict[Future, None] = {}

            for batch in batches:
                if len(in_flight) >= self.concurrent_requests:
                    self._collect_one(in_flight, sink, progress)

                in_flight[pool.submit(self._embed_batch, batch)] = None

            while in_flight:
                self._collect_one(in_flight, sink, progress)

    def _collect_one(
        self,
        in_flight: dict[Future, None],
        sink: "_ShardSink",
        progress: "_Progress",
    ):
        future = next(as_completed(in_flight))
        try:
            ids, embeddings = future.result()
        except Exception:
            print("  Batch failed after retries, checkpointing and exiting.")
            sink.flush()
            raise
        del in_flight[future]

        sink.ingest(ids, embeddings)
        progress.advance(len(ids))

    def _embed_batch(
        self, batch_documents: list[CorpusText]
    ) -> tuple[list[Id], np.ndarray]:
        ids = [document.id for document in batch_documents]
        texts = [document.text for document in batch_documents]
        return ids, self.embedder.embed(texts)

    def _merge_shards(self):
        print("Merging shards...")
        shard_glob = self.shard_directory / "*.parquet"
        merge_count = duckdb.sql(
            f"SELECT count(*) FROM read_parquet('{shard_glob}')"
        ).fetchone()[0]
        duckdb.sql(f"""
            COPY (
                SELECT * FROM read_parquet('{shard_glob}')
                ORDER BY id
            ) TO '{self.output_path}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """)
        print(f"Wrote {merge_count} embeddings to {self.output_path}")


class _ShardSink:
    """Accumulates embedding results and flushes to parquet shards."""

    def __init__(self, shard_directory: Path, checkpoint_interval: int):
        self.shard_directory = shard_directory
        self.checkpoint_interval = checkpoint_interval
        self._ids: list[Id] = []
        self._embeddings: list[np.ndarray] = []
        self._shard_count = len(list(shard_directory.glob("*.parquet")))
        self.batches_since_flush = 0

    def ingest(self, ids: list[Id], embeddings: np.ndarray):
        self._ids.extend(ids)
        self._embeddings.append(embeddings)
        self.batches_since_flush += 1

        if self.batches_since_flush >= self.checkpoint_interval:
            self.flush()

    def flush(self):
        if not self._ids:
            return
        shard_path = self.shard_directory / f"shard_{self._shard_count:04d}.parquet"

        import pyarrow as pa
        import pyarrow.parquet as pq

        from .workspace import EMBEDDING_SCHEMA

        array = np.concatenate(self._embeddings, axis=0)
        table = pa.table(
            {"id": self._ids, "embedding": array.tolist()},
            schema=EMBEDDING_SCHEMA,
        )
        pq.write_table(table, shard_path, compression="zstd")

        self._shard_count += 1
        self._ids = []
        self._embeddings = []
        self.batches_since_flush = 0


class _Progress:
    """Tracks and prints embedding progress."""

    def __init__(self, total: int, already_done: int):
        self.total = total
        self.done = already_done
        self._baseline = already_done
        self._start_time = time.time()

    def advance(self, count: int):
        self.done += count
        elapsed = time.time() - self._start_time
        rate = (self.done - self._baseline) / elapsed if elapsed > 0 else 0
        eta = (self.total - self.done) / rate / 3600 if rate > 0 else 0
        print(
            f"  {self.done:>9,}/{self.total:,}  "
            f"({rate:.0f} docs/s, ~{eta:.1f}h remaining)"
        )
