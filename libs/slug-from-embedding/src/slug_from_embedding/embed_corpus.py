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
import hashlib
import json
import time
from itertools import batched
from pathlib import Path

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

BATCH_SIZE_LIMIT = 50_000  # OpenAI batch API: max 50k embedding inputs per batch
BATCH_FILE_SIZE_LIMIT = 200 * 1024 * 1024  # 200 MiB
POLL_INTERVAL = 60


# ── Real-time backends ─────────────────────────────────────────────────────────


def _embed_openrouter(cfg: EncoderConfig):
    """Embed via OpenRouter's OpenAI-compatible embeddings endpoint."""
    client = openrouter_client()
    corpus = load_corpus_texts(CORPUS_WITH_SLUGS_FILE)
    print(f"Embedding {len(corpus)} documents with {cfg.model}...")

    all_ids = []
    all_embeddings = []

    for i, batch in enumerate(batched(corpus, cfg.batch_size)):
        ids = [doc_id for doc_id, _ in batch]
        texts = [text for _, text in batch]

        response = client.embeddings.create(model=cfg.model, input=texts)

        batch_embeddings = [None] * len(texts)
        for item in response.data:
            batch_embeddings[item.index] = item.embedding

        all_ids.extend(ids)
        all_embeddings.extend(batch_embeddings)

        done = min((i + 1) * cfg.batch_size, len(corpus))
        print(f"  {done}/{len(corpus)}")

    embeddings_array = np.array(all_embeddings, dtype=np.float32)
    write_embeddings(all_ids, embeddings_array, embeddings_file(cfg.name))


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


def _make_custom_id(doc_id: str) -> str:
    return hashlib.sha256(doc_id.encode()).hexdigest()[:16]


def _write_batch_jsonl(
    chunk: list[tuple[str, str]],
    jsonl_path: Path,
    model: str,
) -> list[Path]:
    """Write a JSONL batch file. If it exceeds 200MiB, split in half recursively."""
    with open(jsonl_path, "w") as f:
        for doc_id, text in chunk:
            custom_id = _make_custom_id(doc_id)
            request = {
                "custom_id": custom_id,
                "method": "POST",
                "url": "/v1/embeddings",
                "body": {
                    "model": model,
                    "input": text,
                },
            }
            f.write(json.dumps(request) + "\n")

    file_size = jsonl_path.stat().st_size
    if file_size <= BATCH_FILE_SIZE_LIMIT:
        return [jsonl_path]

    # Too large: split in half
    print(
        f"    {jsonl_path.name} is {file_size / 1e6:.1f}MB (>{BATCH_FILE_SIZE_LIMIT / 1e6:.0f}MB), splitting..."
    )
    jsonl_path.unlink()
    mid = len(chunk) // 2
    stem = jsonl_path.stem
    parent = jsonl_path.parent
    left = _write_batch_jsonl(chunk[:mid], parent / f"{stem}a.jsonl", model)
    right = _write_batch_jsonl(chunk[mid:], parent / f"{stem}b.jsonl", model)
    return left + right


def _batch_submit(cfg: EncoderConfig):
    """Split corpus into batch files, upload, and submit to OpenAI Batch API."""
    from openai import OpenAI

    client = OpenAI(api_key=require_env("OPENAI_API_KEY"))
    corpus = load_corpus_texts(CORPUS_WITH_SLUGS_FILE)
    bd = batch_dir("embed_openai")

    print(f"Preparing {len(corpus)} documents for batch embedding...")
    print(f"  Batch dir: {bd}")
    print(f"  Corpus: {CORPUS_WITH_SLUGS_FILE.name}")

    # Build id mapping
    id_map = {}
    for doc_id, _ in corpus:
        id_map[_make_custom_id(doc_id)] = doc_id
    (bd / "id_map.json").write_text(json.dumps(id_map))

    # Split into chunks, then write JSONL (may split further if over 200MiB)
    model = cfg.model.removeprefix("openai/")
    chunks = list(batched(corpus, BATCH_SIZE_LIMIT))
    print(f"  {len(chunks)} chunks of up to {BATCH_SIZE_LIMIT} requests")

    jsonl_files: list[Path] = []
    for chunk_idx, chunk in enumerate(chunks):
        jsonl_path = bd / f"batch_{chunk_idx:03d}.jsonl"
        jsonl_files.extend(_write_batch_jsonl(list(chunk), jsonl_path, model))

    print(f"  {len(jsonl_files)} batch files after size validation")

    # Upload and submit each file
    batch_ids = []
    for jsonl_path in jsonl_files:
        size_mb = jsonl_path.stat().st_size / 1e6
        n_lines = sum(1 for _ in open(jsonl_path))
        print(f"  Uploading {jsonl_path.name} ({n_lines} requests, {size_mb:.1f}MB)...")

        with open(jsonl_path, "rb") as f:
            uploaded = client.files.create(file=f, purpose="batch")

        batch = client.batches.create(
            input_file_id=uploaded.id,
            endpoint="/v1/embeddings",
            completion_window="24h",
        )
        batch_ids.append(batch.id)
        print(f"    batch_id={batch.id}, status={batch.status}")

    (bd / "batch_ids.json").write_text(json.dumps(batch_ids))
    print(f"\nSubmitted {len(batch_ids)} batches. Run --batch-poll to check status.")


def _batch_poll(cfg: EncoderConfig):
    """Poll all submitted batches until complete."""
    from openai import OpenAI

    client = OpenAI(api_key=require_env("OPENAI_API_KEY"))
    bd = batch_dir("embed_openai")
    batch_ids = json.loads((bd / "batch_ids.json").read_text())

    print(f"Polling {len(batch_ids)} batches...")
    while True:
        all_done = True
        for i, bid in enumerate(batch_ids):
            batch = client.batches.retrieve(bid)
            counts = batch.request_counts
            print(
                f"  [{i:>2d}] {bid}: {batch.status}  "
                f"completed={counts.completed}/{counts.total}  "
                f"failed={counts.failed}"
            )
            if batch.status not in ("completed", "failed", "cancelled", "expired"):
                all_done = False

        if all_done:
            print("\nAll batches complete.")
            return

        print(f"  Waiting {POLL_INTERVAL}s...")
        time.sleep(POLL_INTERVAL)


def _batch_collect(cfg: EncoderConfig):
    """Download results from all completed batches and write embeddings parquet."""
    from openai import OpenAI

    client = OpenAI(api_key=require_env("OPENAI_API_KEY"))
    bd = batch_dir("embed_openai")
    batch_ids = json.loads((bd / "batch_ids.json").read_text())
    id_map = json.loads((bd / "id_map.json").read_text())

    print(f"Collecting results from {len(batch_ids)} batches...")

    all_results: dict[str, list[float]] = {}
    failed = 0

    for i, bid in enumerate(batch_ids):
        batch = client.batches.retrieve(bid)
        if batch.status != "completed":
            print(f"  [{i:>2d}] {bid}: {batch.status} (skipping)")
            continue

        output_file_id = batch.output_file_id
        content = client.files.content(output_file_id).text

        for line in content.strip().split("\n"):
            result = json.loads(line)
            custom_id = result["custom_id"]
            doc_id = id_map.get(custom_id)
            if not doc_id:
                failed += 1
                continue

            if result.get("error"):
                failed += 1
                continue

            embedding = result["response"]["body"]["data"][0]["embedding"]
            all_results[doc_id] = embedding

        print(f"  [{i:>2d}] {bid}: {len(all_results)} embeddings collected so far")

    print(f"\nTotal: {len(all_results)} embeddings, {failed} failed")

    # Write in corpus order
    corpus = load_corpus_texts(CORPUS_WITH_SLUGS_FILE)
    ids = []
    embeddings = []
    missing = 0
    for doc_id, _ in corpus:
        emb = all_results.get(doc_id)
        if emb:
            ids.append(doc_id)
            embeddings.append(emb)
        else:
            missing += 1

    if missing:
        print(f"  Warning: {missing} documents missing embeddings")

    embeddings_array = np.array(embeddings, dtype=np.float32)
    out_path = embeddings_file(cfg.name)
    write_embeddings(ids, embeddings_array, out_path)


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
        _batch_submit(cfg)
    elif args.batch_poll:
        _batch_poll(cfg)
    elif args.batch_collect:
        _batch_collect(cfg)
    else:
        backend_fn = BACKENDS.get(cfg.backend)
        if not backend_fn:
            print(f"Unknown backend: {cfg.backend}")
            import sys

            sys.exit(1)
        backend_fn(cfg)


if __name__ == "__main__":
    main()
