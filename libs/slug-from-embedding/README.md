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
uv run prepare_corpus.py fetch
uv run prepare_corpus.py merge
```

Output: `data/corpus.parquet` (10k rows: `text`, `id`, `url`, `token_count`, `source`)

### 2. Distill slug labels

Generate gold slug labels using Claude Haiku via the Anthropic Batch API (50%
cheaper than real-time):

```bash
# Test the prompt on 5 random samples first
uv run distill_slugs.py test

# Full batch (submits 10k requests, polls until done, collects results)
uv run distill_slugs.py all

# Or step by step:
uv run distill_slugs.py submit
uv run distill_slugs.py poll
uv run distill_slugs.py collect
```

Output: `data/corpus_with_slugs.parquet` (adds `slug` column)

### 3. Embed corpus

Generate embeddings with both encoders:

```bash
# OpenAI text-embedding-3-small via OpenRouter
uv run embed_corpus.py openai

# Microsoft harrier-oss-v1-0.6b locally (MPS-accelerated)
uv run embed_corpus.py harrier
```

Output: `data/embeddings_openai.parquet` (10k × 1536d), `data/embeddings_harrier.parquet` (10k × 1024d)

### 4. Split dataset

Cluster-based train/val/test split (80/10/10) per encoder, to prevent
near-duplicate leakage:

```bash
uv run split_dataset.py all
```

Output: `data/splits_openai.parquet`, `data/splits_harrier.parquet` (columns: `id`, `split`)

### 5. Train models

*TODO: three variants (classifier, frozen-LM projector, from-scratch seq2seq)*

### 6. Evaluate

*TODO: ROUGE-L, BERTScore, distinctiveness, latency*

## Data files

| File | Description |
|---|---|
| `data/corpus.parquet` | 10k documents from 3 sources |
| `data/corpus_with_slugs.parquet` | Corpus with distilled slug labels |
| `data/embeddings_openai.parquet` | text-embedding-3-small embeddings (1536d) |
| `data/embeddings_harrier.parquet` | harrier-oss-v1-0.6b embeddings (1024d) |
| `data/splits_openai.parquet` | Train/val/test split by OpenAI embedding clusters |
| `data/splits_harrier.parquet` | Train/val/test split by harrier embedding clusters |
| `data/batch_id.txt` | Anthropic batch ID for slug distillation |
| `data/id_map.json` | Mapping from batch custom_ids to corpus doc_ids |
| `data/batch_results.jsonl` | Raw batch results (cached for idempotent collect) |

## Environment

Requires a `.env` file:

```
ANTHROPHIC_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
```
