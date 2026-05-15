"""Embed the corpus using either OpenRouter (text-embedding-3-small) or Harrier (local).

Reads corpus.parquet and writes embeddings to a separate parquet file per encoder.

Usage:
    uv run embed_corpus.py openai      # OpenAI text-embedding-3-small via OpenRouter
    uv run embed_corpus.py harrier     # microsoft/harrier-oss-v1-0.6b locally

Output:
    data/embeddings_openai.parquet     # columns: id, embedding (float[1536])
    data/embeddings_harrier.parquet    # columns: id, embedding (float[1024])
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import duckdb
import numpy as np
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# ── Configuration ──────────────────────────────────────────────────────────────

DATA_DIR = Path(__file__).parent / "data"
CORPUS_FILE = DATA_DIR / "corpus.parquet"

# OpenRouter settings
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_MODEL = "openai/text-embedding-3-small"  # provider-prefixed
OPENROUTER_BATCH_SIZE = 100  # docs per API call

# Harrier settings
HARRIER_MODEL = "microsoft/harrier-oss-v1-0.6b"
HARRIER_BATCH_SIZE = 32  # 256 was overloading MPS; 32 is more stable


# ── Helpers ────────────────────────────────────────────────────────────────────


def load_corpus() -> list[tuple[str, str]]:
    """Load (id, text) pairs from corpus.parquet."""
    return duckdb.sql(f"SELECT id, text FROM '{CORPUS_FILE}'").fetchall()


def write_embeddings(ids: list[str], embeddings: np.ndarray, output_path: Path):
    """Write id + embedding array to parquet via DuckDB."""
    import pyarrow as pa

    dim = embeddings.shape[1]
    embeddings_tbl = pa.table(
        {
            "id": ids,
            "embedding": [embeddings[i].tolist() for i in range(len(ids))],
        }
    )

    conn = duckdb.connect()
    conn.execute(f"""
        COPY (SELECT * FROM embeddings_tbl)
        TO '{output_path}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    conn.close()
    print(f"Wrote {len(ids)} embeddings ({dim}d) to {output_path}")


def batched(items, n):
    """Yield successive n-sized chunks from items."""
    for i in range(0, len(items), n):
        yield items[i : i + n]


# ── OpenAI via OpenRouter ─────────────────────────────────────────────────────


def embed_openai():
    """Embed corpus using text-embedding-3-small via OpenRouter."""
    from openai import OpenAI

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("Set OPENROUTER_API_KEY in .env")
        sys.exit(1)

    client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)
    corpus = load_corpus()
    print(f"Embedding {len(corpus)} documents with {OPENROUTER_MODEL}...")

    all_ids = []
    all_embeddings = []

    for i, batch in enumerate(batched(corpus, OPENROUTER_BATCH_SIZE)):
        ids = [doc_id for doc_id, _ in batch]
        texts = [text for _, text in batch]

        response = client.embeddings.create(model=OPENROUTER_MODEL, input=texts)

        # Response data is ordered by index
        batch_embeddings = [None] * len(texts)
        for item in response.data:
            batch_embeddings[item.index] = item.embedding

        all_ids.extend(ids)
        all_embeddings.extend(batch_embeddings)

        done = min((i + 1) * OPENROUTER_BATCH_SIZE, len(corpus))
        print(f"  {done}/{len(corpus)}")

    embeddings_array = np.array(all_embeddings, dtype=np.float32)
    output_path = DATA_DIR / "embeddings_openai.parquet"
    write_embeddings(all_ids, embeddings_array, output_path)


# ── Harrier (local) ───────────────────────────────────────────────────────────


def embed_harrier():
    """Embed corpus using harrier-oss-v1-0.6b locally via transformers + torch."""
    import torch
    import torch.nn.functional as F
    from transformers import AutoModel, AutoTokenizer

    corpus = load_corpus()
    ids = [doc_id for doc_id, _ in corpus]
    texts = [text for _, text in corpus]

    print(f"Loading {HARRIER_MODEL}...")
    tokenizer = AutoTokenizer.from_pretrained(HARRIER_MODEL)
    model = AutoModel.from_pretrained(HARRIER_MODEL, dtype="auto")
    model.eval()

    # Use MPS on Apple Silicon, CUDA if available, else CPU
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")
    model.to(device)
    print(f"Using device: {device}")

    def last_token_pool(last_hidden_states, attention_mask):
        # Check if left-padded (all sequences end at last position)
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

    for i, batch_texts in enumerate(batched(texts, HARRIER_BATCH_SIZE)):
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

        done = min((i + 1) * HARRIER_BATCH_SIZE, len(texts))
        print(f"  {done}/{len(texts)}")

    embeddings_array = np.concatenate(all_embeddings, axis=0).astype(np.float32)
    output_path = DATA_DIR / "embeddings_harrier.parquet"
    write_embeddings(ids, embeddings_array, output_path)


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run embed_corpus.py [openai|harrier]")
        sys.exit(1)

    command = sys.argv[1]
    if command == "openai":
        embed_openai()
    elif command == "harrier":
        embed_harrier()
    else:
        print(f"Unknown encoder: {command}. Use 'openai' or 'harrier'.")
        sys.exit(1)
