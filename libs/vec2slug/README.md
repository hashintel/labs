# Slug from Embedding

Research project: can short kebab-case slugs be generated directly from content
embeddings, without re-feeding the source text through an LLM?

See [PLAN.md](PLAN.md) for the full research plan, motivation, and architecture.

## Quick start

```bash
cd libs/vec2slug
uv sync
```

## Corpora

Two corpus pipelines are available. Set `SLUG_CORPUS` to switch which corpus
the downstream tools (embed, split, train, eval) operate on.

### Original (10k, LLM-distilled slugs)

Small corpus from three sources with Haiku-generated slug labels. Good for
fast iteration and evaluating the labeling approach.

```bash
slug-prepare fetch && slug-prepare merge   # -> data/corpus.parquet
slug-distill submit && slug-distill poll && slug-distill collect
# -> data/corpus_with_slugs.parquet
```

### URL-extracted (2.3M, zero-cost slugs)

Large-scale corpus from FineWeb-Edu with slugs extracted directly from URLs.
Human-written URL slugs are free ground truth at massive scale.

```bash
slug-prepare-urls fetch --tasks 8   # -> data/url_corpus_with_slugs.parquet
```

To use the URL corpus for all downstream steps:

```bash
# In .env or shell:
export SLUG_CORPUS=data/url_corpus_with_slugs.parquet
```

All derived files (embeddings, splits, models, batches) are automatically
namespaced by the active corpus to avoid collisions.

## Pipeline

### 1. Embed corpus

Generate embeddings with registered encoders:

```bash
slug-embed openai           # text-embedding-3-small via OpenRouter (real-time)
slug-embed harrier          # harrier-oss-v1-0.6b locally (MPS)
slug-embed openai --batch   # OpenAI Batch API at 50% cost (large corpora)
slug-embed openai --batch-poll
slug-embed openai --batch-collect
```

The real-time backend checkpoints to disk every 50 batches for resumability.
The batch backend auto-throttles submission in waves to stay under OpenAI's
enqueued token limit.

Output: `data/[corpus_tag_]embeddings_{encoder}.parquet`

### 2. Split dataset

Cluster-based train/val/test split (80/10/10) per encoder, to prevent
near-duplicate leakage:

```bash
slug-split all
```

Output: `data/[corpus_tag_]splits_{encoder}.parquet`

### 3. Train models

MLP bag-of-tokens classifier with three ordering sub-variants:

```bash
slug-train-mlp --encoder openai                # variant 1a (score ordering)
slug-train-mlp --encoder openai --position-head # variant 1b (position head)
```

The trainer saves a full manifest (config, hyperparams, seed, results) and
all artifacts (weights, vocab, pairwise ordering table) to the model directory.
Refuses to overwrite existing checkpoints without `--overwrite`.

Output: `data/models/mlp_{encoder}[_pos]/`

### 4. Predict

```bash
slug-predict --variant mlp-score --encoder openai
slug-predict --variant mlp-position --encoder openai
slug-predict --variant mlp-pairwise --encoder openai
```

The CLI dispatches to the right predictor via the variant registry. Each
variant validates that the model was trained on the same encoder.

Output: `data/predictions/{model}_{variant}_{encoder}_{split}.parquet`

### 5. Generate baselines

Two baselines bracket expected model performance:

```bash
slug-baseline random --encoder openai     # floor: random training slug
slug-baseline haiku                       # ceiling: re-run distillation prompt
```

### 6. Evaluate

Composable pipeline of `Transform` steps, each enriching a `datasets.Dataset`
with per-sample columns then computing aggregate statistics:

Validity, ExactMatch, SlugTokenF1, Rouge (1+L), BertScore, Distinctiveness
(similarity-weighted Jaccard to cosine neighbors), VocabDiversity, PerSource,
LengthBucket.

```bash
slug-eval data/predictions/haiku_openai_test.parquet --encoder openai --name haiku
```

Output: `data/results/{name}_{encoder}_{split}.json` + `_detail.parquet`

### 7. Report

Generate publication-quality figures comparing all evaluated runs:

```bash
slug-report                    # all encoders
slug-report --encoder openai   # single encoder
```

Produces violin plots, per-source breakdowns, per-length-bucket breakdowns,
source x length heatmaps, F1 vs distinctiveness scatter, CDFs, and
length vs F1 scatter as PNGs in `data/results/figures/`.

## Project structure

```
src/vec2slug/
    config.py                   # paths, encoder registry, corpus routing, API clients
    io.py                       # shared parquet read/write helpers
    prepare_corpus.py           # original corpus (datatrove, 3 sources)
    prepare_url_corpus.py       # URL-extracted corpus (datatrove, FineWeb-Edu)
    distill_slugs.py            # slug distillation (Anthropic Batch API)
    embed_corpus.py             # embedding (OpenRouter, local, OpenAI Batch API)
    split_dataset.py            # train/val/test splitting (KMeans clustering)
    baselines.py                # baseline predictions (random, haiku)
    report.py                   # evaluation figures (matplotlib/seaborn)

    libs/
        batch.py                # generic batch API ABC (splitting, waves, persistence)

    evaluation/
        __init__.py             # pipeline wiring and CLI
        transform.py            # Transform ABC and Pipeline compositor
        data.py                 # dataset loading via DuckDB join
        validity.py             # slug format validation
        exact_match.py          # exact string match
        slug_token_f1.py        # bag-of-words token P/R/F1
        rouge.py                # ROUGE-1 and ROUGE-L
        bert_score.py           # BERTScore via roberta-large
        distinctiveness.py      # similarity-weighted cosine neighbor Jaccard
        vocab_diversity.py      # prediction diversity
        per_source.py           # per-source breakdown
        length_bucket.py        # per-length-bucket breakdown

    training/
        config.py               # shared types, paths, runtime helpers
        data.py                 # canonical data access layer
        trainer.py              # Trainer ABC
        predictor.py            # Predictor ABC
        registry.py             # variant registry (explicit dict)
        predict_cli.py          # shared prediction CLI

        mlp/
            config.py           # MLPConfig dataclass
            vocab.py            # slug token vocabulary (MLP-specific)
            model.py            # SlugMLP architecture
            dataset.py          # torch Dataset with multi-hot targets
            train.py            # Trainer subclass with checkpointing
            predict.py          # MLPPredictor + ordering subclasses
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

## Adding a model variant

1. Create `training/{variant}/` with model, dataset, train, predict modules
2. Implement `Trainer` and `Predictor` ABCs
3. Add entries to `TRAINERS` and `PREDICTOR_LOADERS` in `training/registry.py`
4. Add a CLI entry point in `pyproject.toml`

## Data files

| File | Description |
|---|---|
| `data/corpus.parquet` | 10k documents (original, pre-distillation) |
| `data/corpus_with_slugs.parquet` | 10k with Haiku-distilled slugs |
| `data/url_corpus_with_slugs.parquet` | 2.3M with URL-extracted slugs |
| `data/[tag_]embeddings_{encoder}.parquet` | embeddings per encoder |
| `data/[tag_]splits_{encoder}.parquet` | train/val/test splits |
| `data/models/{variant}_{encoder}/` | trained model artifacts |
| `data/predictions/*.parquet` | prediction files (id, predicted_slug) |
| `data/results/*.json` | evaluation summaries |
| `data/results/*_detail.parquet` | per-sample evaluation scores |
| `data/results/figures/*.png` | comparison figures |
| `data/batches/{tag}_{operation}/` | batch API state (id maps, batch IDs) |

## Environment

Requires a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
OPENAI_API_KEY=sk-...
```
