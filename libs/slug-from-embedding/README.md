# Slug from Embedding

Research project: can short kebab-case slugs be generated directly from content
embeddings, without re-feeding the source text through an LLM?

See [PLAN.md](PLAN.md) for the full research plan, motivation, and architecture.

## Quick start

```bash
cd libs/slug-from-embedding
uv sync
```

## Pipeline

### 1. Prepare corpus

Pull 10k samples from three sources (FineWeb-Edu 50%, arXiv 25%, GitHub issues
25%), filter for English, quality, repetition, and token length:

```bash
slug-prepare fetch
slug-prepare merge
```

Output: `data/corpus.parquet` (10k rows: `text`, `id`, `url`, `token_count`, `source`)

### 2. Distill slug labels

Generate gold slug labels using Claude Haiku via the Anthropic Batch API:

```bash
# Test the prompt on 5 random samples first
slug-distill test

# Full batch
slug-distill all

# Or step by step:
slug-distill submit
slug-distill poll
slug-distill collect
```

Output: `data/corpus_with_slugs.parquet` (adds `slug` column)

### 3. Embed corpus

Generate embeddings with registered encoders:

```bash
# OpenAI text-embedding-3-small via OpenRouter
slug-embed openai

# Microsoft harrier-oss-v1-0.6b locally (MPS-accelerated)
slug-embed harrier
```

Output: `data/embeddings_openai.parquet` (1536d), `data/embeddings_harrier.parquet` (1024d)

### 4. Split dataset

Cluster-based train/val/test split (80/10/10) per encoder, to prevent
near-duplicate leakage:

```bash
slug-split all
```

Output: `data/splits_openai.parquet`, `data/splits_harrier.parquet`

### 5. Train models

*TODO: three variants (classifier, frozen-LM projector, from-scratch seq2seq)*

### 6. Evaluate

*TODO: ROUGE-L, BERTScore, distinctiveness, latency*

## Project structure

```
src/slug_from_embedding/
    config.py           # Paths, constants, encoder registry, API clients
    io.py               # Shared parquet read/write helpers
    prepare_corpus.py   # Corpus preparation (datatrove pipeline)
    distill_slugs.py    # Slug label distillation (Anthropic Batch API)
    embed_corpus.py     # Embedding generation (OpenRouter / local)
    split_dataset.py    # Train/val/test splitting (KMeans clustering)
```

## Adding an encoder

Add an entry to `ENCODERS` in `config.py`:

```python
"my-encoder": EncoderConfig(
    name="my-encoder",
    model="org/model-name",
    dim=768,
    batch_size=64,
    backend="openrouter",  # or "local"
),
```

Then run `slug-embed my-encoder` and `slug-split my-encoder`.

## Data files

| File | Description |
|---|---|
| `data/corpus.parquet` | 10k documents from 3 sources |
| `data/corpus_with_slugs.parquet` | Corpus with distilled slug labels |
| `data/embeddings_{encoder}.parquet` | Embeddings per encoder |
| `data/splits_{encoder}.parquet` | Train/val/test split per encoder |
| `data/batch_id.txt` | Anthropic batch ID |
| `data/id_map.json` | Batch custom_id to corpus doc_id mapping |
| `data/batch_results.jsonl` | Raw batch results (cached) |

## Environment

Requires a `.env` file:

```
ANTHROPHIC_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
```
