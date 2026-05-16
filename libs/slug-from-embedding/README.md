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
slug-distill test       # test the prompt on 5 random samples
slug-distill submit     # submit full batch
slug-distill poll       # wait for completion
slug-distill collect    # validate and merge
```

Output: `data/corpus_with_slugs.parquet` (adds `slug` column)

### 3. Embed corpus

Generate embeddings with registered encoders:

```bash
slug-embed openai       # text-embedding-3-small via OpenRouter
slug-embed harrier      # harrier-oss-v1-0.6b locally (MPS)
```

Output: `data/embeddings_{encoder}.parquet`

### 4. Split dataset

Cluster-based train/val/test split (80/10/10) per encoder, to prevent
near-duplicate leakage:

```bash
slug-split all
```

Output: `data/splits_{encoder}.parquet`

### 5. Generate baselines

Two baselines bracket expected model performance:

```bash
# Random baseline (floor): samples a training slug per test sample
slug-baseline random --encoder openai
slug-baseline random --encoder harrier

# Haiku baseline (ceiling): re-runs distillation prompt on test set
slug-baseline haiku            # submits union of both test sets
slug-baseline haiku-poll       # wait for batch
slug-baseline haiku-collect    # validate and split per encoder
```

Output: `data/predictions/{name}_{encoder}_{split}.parquet`

### 6. Evaluate

The evaluation harness is a composable pipeline of `Transform` steps. Each
transform enriches a `datasets.Dataset` with per-sample columns, then computes
aggregate statistics. The pipeline is:

1. **ExactMatch**: string equality between predicted and gold slugs
2. **SlugTokenF1**: bag-of-words precision/recall/F1 (split slugs on `-`)
3. **Rouge**: ROUGE-1 and ROUGE-L (slugs split to space-separated words)
4. **BertScore**: BERTScore P/R/F1 via roberta-large
5. **Distinctiveness**: Jaccard distance to top-5 cosine neighbors in embedding space
6. **VocabDiversity**: unique predictions / total predictions

```bash
slug-eval data/predictions/random_openai_test.parquet --encoder openai --name random
slug-eval data/predictions/haiku_openai_test.parquet --encoder openai --name haiku
```

Output: `data/results/{name}_{encoder}_{split}.json` (summary) and
`data/results/{name}_{encoder}_{split}_detail.parquet` (per-sample scores)

### 7. Report

Generate publication-quality figures comparing all evaluated runs:

```bash
slug-report                    # all encoders
slug-report --encoder openai   # single encoder
```

Produces violin plots, scatter plots (Token F1 vs Distinctiveness), CDFs, and
per-source breakdowns as PNGs in `data/results/figures/`.

### 8. Train models

*TODO: three variants (classifier, frozen-LM projector, from-scratch seq2seq)*

## Project structure

```
src/slug_from_embedding/
    config.py               # paths, constants, encoder registry, API clients
    io.py                   # shared parquet read/write helpers
    prepare_corpus.py       # corpus preparation (datatrove pipeline)
    distill_slugs.py        # slug label distillation (Anthropic Batch API)
    embed_corpus.py         # embedding generation (OpenRouter / local)
    split_dataset.py        # train/val/test splitting (KMeans clustering)
    baselines.py            # baseline prediction generation (random, haiku)
    report.py               # evaluation report with matplotlib/seaborn figures
    evaluation/
        __init__.py         # pipeline wiring and CLI
        transform.py        # Transform protocol and Pipeline compositor
        data.py             # dataset loading via DuckDB join
        exact_match.py      # exact string match
        slug_token_f1.py    # bag-of-words token P/R/F1
        rouge.py            # ROUGE-1 and ROUGE-L
        bert_score.py       # BERTScore via roberta-large
        distinctiveness.py  # cosine neighbor Jaccard distance
        vocab_diversity.py  # prediction diversity measurement
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

## Adding an evaluation metric

Create a new file in `evaluation/` implementing the `Transform` protocol:

```python
from .transform import Transform

class MyMetric(Transform):
    def transform(self, dataset):
        # Add per-sample column(s)
        scores = [...]
        return dataset.add_column("my_score", scores)

    def evaluate(self, dataset, stats):
        # Compute aggregate stats
        return {"mean_my_score": float(np.mean(dataset["my_score"]))}
```

Then add it to `default_pipeline` in `evaluation/__init__.py`.

## Data files

| File | Description |
|---|---|
| `data/corpus.parquet` | 10k documents from 3 sources |
| `data/corpus_with_slugs.parquet` | corpus with distilled slug labels |
| `data/embeddings_{encoder}.parquet` | embeddings per encoder |
| `data/splits_{encoder}.parquet` | train/val/test split per encoder |
| `data/predictions/*.parquet` | prediction files (id, predicted_slug) |
| `data/results/*.json` | evaluation summary per run |
| `data/results/*_detail.parquet` | per-sample evaluation scores |
| `data/results/figures/*.png` | comparison figures |

## Environment

Requires a `.env` file:

```
ANTHROPHIC_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
```
