# vec2slug

Generating URL slugs from content embeddings using a tiny transformer decoder.

A single pooled sentence embedding (OpenAI text-embedding-3-small, 1536 dimensions) is linearly projected into a 4- or 6-layer causal transformer decoder that autoregressively generates a kebab-case slug over a 5,000-token BPE vocabulary. The model produces topically coherent, human-readable slugs at 115ms on a budget VPS, roughly 14x faster and 85x cheaper than a Haiku-class LLM call for the same task. The broader claim is that embeddings are a reusable substrate for cheap auxiliary outputs; slug generation is the proof of concept.

The companion blog post is at [hash.dev/blog/vec2slug](https://hash.dev/blog/vec2slug).

## Results

Two models trained on 2.3M URL-extracted slugs from FineWeb-Edu, evaluated on 5,000 held-out test samples.

| Model | Params | Size | Tok F1 | BERTScore | Mean words | Inference |
|-------|--------|------|--------|-----------|------------|-----------|
| d=384, L=4, t=24, EOS | 11.5M | 46 MiB | 0.298 | 0.868 | 4.9 | ~115ms (VPS) |
| d=512, L=6, t=24, EOS | 24.8M | 99 MiB | 0.306 | 0.872 | 4.9 | ~258ms (VPS) |

Doubling parameters adds +0.008 Tok F1. Both models achieve 100% structural validity and 97%+ vocab diversity.

The MLP baseline (multi-label classification over KMeans-compressed vocabulary) collapsed to high-frequency function words across all ablations, reaching 0.07 to 0.08 Tok F1. The seq2seq architecture is necessary; bag-of-tokens models cannot recover slug content from embeddings.

## Quick start

```bash
cd libs/vec2slug
uv sync
cp .env.example .env  # add API keys
```

## Pipeline

### 1. Prepare corpus

Each corpus is a named workspace under `data/`. All downstream commands take `--workspace <name>` to select which corpus they operate on (defaults to `original`).

**URL-extracted (2.3M, primary).** Slugs extracted from FineWeb-Edu source URLs at zero labeling cost.

```bash
uv run slug-prepare-urls fetch --tasks 8
```

**Distilled (10k, feasibility).** Small corpus from FineWeb-Edu, arXiv, and GitHub issues with Haiku-generated slug labels.

```bash
uv run slug-prepare fetch && uv run slug-prepare merge
uv run slug-distill submit && uv run slug-distill poll && uv run slug-distill collect
```

### 2. Embed

```bash
uv run slug-embed openai --workspace url      # text-embedding-3-small via OpenRouter
uv run slug-embed openai --workspace url --batch      # OpenAI Batch API (50% cost)
uv run slug-embed openai --workspace url --batch-poll
uv run slug-embed openai --workspace url --batch-collect
```

Checkpoints to disk every 50 batches for resumability.

### 3. Split

Cluster-based train/val/test split (80/10/10) to prevent near-duplicate leakage.

```bash
uv run slug-split all --workspace url
```

### 4. Train

**Seq2seq (recommended).**

```bash
uv run slug-train-seq2seq --workspace url --encoder openai \
  --tokenizer bpe --embed-dim 384 --num-layers 4 --max-slug-tokens 24 --epochs 50
```

Key training flags: `--embed-dim`, `--num-layers`, `--num-heads`, `--max-slug-tokens`, `--epochs`, `--tokenizer bpe` (vs `--compression` for KMeans), `--tag` (suffix for model directory name). Position-aware EOS loss and label smoothing are applied automatically.

**MLP (baseline only).**

```bash
uv run slug-train-mlp --encoder openai --workspace url
```

### 5. Predict

```bash
uv run slug-predict --variant seq2seq --encoder openai --workspace url
```

The CLI dispatches to the right predictor via the variant registry. Each variant validates that the model was trained on the same encoder.

### 6. Evaluate

Seven metrics scored on held-out test samples: validity, exact match, token F1, ROUGE (1+L), BERTScore, distinctiveness (similarity-weighted Jaccard to cosine neighbors), and vocab diversity.

```bash
uv run slug-eval data/url/openai/predictions/{name}_test.parquet \
  --encoder openai --workspace url --name {name}
```

### 7. Export

ONNX export for browser or edge deployment.

```bash
python -m vec2slug.export_onnx \
  --model-dir data/url/openai/models/seq2seq_bpe_d384_l4_t24_eos \
  --output model.onnx
```

## Project structure

```
src/vec2slug/
    config.py                       # paths, encoder registry, corpus routing
    prepare_corpus.py               # original corpus (datatrove, 3 sources)
    prepare_url_corpus.py           # URL-extracted corpus (FineWeb-Edu)
    distill_slugs.py                # slug distillation (Anthropic Batch API)
    embed_corpus.py                 # embedding (OpenRouter, local, Batch API)
    split_dataset.py                # train/val/test splitting (KMeans clustering)
    compress_vocab.py               # KMeans vocabulary compression
    baselines.py                    # baseline predictions (random, haiku)
    analyze_attention.py            # attention pattern analysis
    export_onnx.py                  # ONNX export for deployment
    report.py                       # evaluation figures (matplotlib/seaborn)

    libs/
        batch.py                    # generic batch API ABC
        embed.py                    # embedding backend abstraction
        workspace.py                # workspace path management

    evaluation/
        __init__.py                 # pipeline wiring and CLI
        transform.py                # Transform ABC and Pipeline compositor
        data.py                     # dataset loading via DuckDB join
        validity.py                 # slug format validation
        exact_match.py              # exact string match
        slug_token_f1.py            # bag-of-words token P/R/F1
        compressed_token_f1.py      # F1 against compressed vocabulary
        rouge.py                    # ROUGE-1 and ROUGE-L
        bert_score.py               # BERTScore via roberta-large
        distinctiveness.py          # cosine-neighbor Jaccard
        vocab_diversity.py          # prediction uniqueness ratio
        per_source.py               # per-source breakdown
        length_bucket.py            # per-length-bucket breakdown

    training/
        config.py                   # shared types, paths, runtime helpers
        trainer.py                  # Trainer ABC
        predictor.py                # Predictor ABC
        registry.py                 # variant registry
        predict_cli.py              # shared prediction CLI

        mlp/                        # multi-label classifier (baseline)
            config.py / model.py / dataset.py / train.py / predict.py / vocab.py

        seq2seq/                    # prefix-conditioned transformer decoder
            config.py / model.py / dataset.py / train.py / predict.py
            bpe_vocab.py            # BPE tokenizer (5000 subwords, hyphen-aware)
            vocab.py                # KMeans-compressed vocabulary (legacy)

scripts/
    benchmark_inference.py          # CPU inference timing (VPS)
    benchmark_haiku_cost.py         # Haiku API cost measurement
    build_demo_examples.py          # curate examples for browser demo
    demo_predict.py                 # interactive prediction REPL
```

## Reproducing the canonical models

The full pipeline from corpus preparation to trained model:

```bash
# 1. Fetch and filter FineWeb-Edu with URL slug extraction
uv run slug-prepare-urls fetch --tasks 8

# 2. Embed the corpus
uv run slug-embed openai --workspace url

# 3. Split into train/val/test
uv run slug-split all --workspace url

# 4. Train the smaller canonical model (11.5M params)
uv run slug-train-seq2seq --workspace url --encoder openai \
  --tokenizer bpe --tag bpe_d384_l4_t24_eos \
  --embed-dim 384 --num-layers 4 --max-slug-tokens 24 --epochs 50

# 5. Train the larger canonical model (24.8M params)
uv run slug-train-seq2seq --workspace url --encoder openai \
  --tokenizer bpe --tag bpe_d512_l6_t24_eos \
  --embed-dim 512 --num-layers 6 --max-slug-tokens 24 --epochs 50
```

All artifacts (embeddings, splits, model checkpoints, predictions, evaluation results) are written under `data/` and gitignored. The workspace abstraction in `libs/workspace.py` manages the directory layout.

## Environment

Requires a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
OPENAI_API_KEY=sk-...
```
