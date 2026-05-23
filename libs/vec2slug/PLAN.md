# Slug Generation from Embeddings

Research project to investigate whether short slugs (kebab-case labels) can be generated directly from existing content embeddings, without re-feeding the source text through an LLM at slug time.

## Motivation

The HASH platform (and pi-mono) already maintains content embeddings for retrieval. If those vectors carry enough abstractive signal, auxiliary outputs like slugs, tags, or category labels can be produced via small trained heads at near-zero marginal cost. This avoids the latency, $/token, and operational overhead of an LLM call per item.

The slug task is the concrete vehicle. The general claim is broader: embeddings as a substrate for cheap auxiliary outputs.

## Research questions

1. Is enough slug-relevant information preserved in a pooled sentence embedding to generate plausible kebab-case labels?
2. How does this compare across encoders, e.g. OpenAI `text-embedding-3-small` vs `harrier-oss-v1-0.6b`?
3. How does it compare across decoder architectures, from a multi-label classifier (no sequence model at all) up to a frozen LM with a trained projector?
4. Where does the gist-recovery fail? Use a leave-one-token-out salience probe to identify which input tokens the slug depends on, and whether pooling strategy washes out salient nouns.

## Adversarial framing (acknowledged upfront)

"Why not just feed the text to a small LM and have it generate a slug directly?" Valid. The defense:

- Latency / cost at scale: feeding 2k tokens through a decoder per slug is dramatically more expensive than feeding a precomputed vector through an MLP.
- Embeddings already exist in the index; the source text may not be conveniently accessible at slug time.
- Forced abstraction: the embedding has already compressed the text into a gist, which may yield more consistent slugs across paraphrases.

The demo is framed as research with an engineering payoff, not as a claim that this beats a prompted LLM on quality.

## Architectures under test

Three variants, all sharing the same (text, slug) corpus and the same encoder pass (embeddings cached once to disk).

### Variant 1: Multi-label classifier

`embedding → MLP → sigmoid over slug-vocab`

- Build a fixed vocabulary from the distilled slug corpus (split on `-`, lowercase, drop rare tokens). Target size ~5-20k tokens.
- Train a 2-layer MLP with sigmoid output over the vocab.
- At inference: take top-k tokens above threshold, sort by some criterion (frequency, learned ordering), join with hyphens.
- No projector, no sequence model.
- Smallest, fastest, most defensible "low resource" story.
- Failure mode: bag-of-words ordering. Joins may read awkwardly.

### Variant 2: Frozen LM with trained projector (prefix-tuning style)

`embedding → MLP projector → N soft tokens → frozen decoder LM → slug`

- Encoder frozen, decoder frozen, only the projector trains.
- Projector is a 2-layer MLP with GELU, output reshaped into N soft prompt tokens (N=8 default) in the decoder's hidden-size space.
- Decoder candidates: `Qwen/Qwen3-0.6B-Base` (default), `HuggingFaceTB/SmolLM2-360M` (faster fallback).
- Standard GEIA / prefix-tuning setup. Trainable params ~1-5M.
- Risk: if 1024-d embeddings don't contain enough slug-relevant signal, no projector capacity will save it.

### Variant 3: Tiny from-scratch seq2seq

`embedding → thin linear adapter → tiny transformer decoder (trained from scratch) → slug`

- Custom small vocabulary (same as Variant 1 for direct comparison), 4-layer transformer decoder, ~5-20M params total.
- The linear adapter is just a dimensionality match, not a "projector" in the prefix-tuning sense.
- Sequence model, but the prior is learned from our corpus, not from English Wikipedia.

### Why all three

The comparison is the result. We expect roughly: Variant 1 cheapest and competitive on common topics, Variant 3 best balance of quality and cost, Variant 2 most fluent but largest and slowest. Reality may diverge. Diverging results are the most interesting outcome.

Variants 1 and 3 share output vocabulary so they're directly comparable. Variant 2 operates over the LM's BPE so the comparison there is fuzzier.

## Corpus

Aim for ~10k (text, slug) pairs, distilled from Haiku with a locked prompt.

### Source mix

| Source | Share | Notes |
|---|---|---|
| Wikipedia (markdown) | 25% | Encyclopedic baseline. Cap at 25% to avoid encyclopedic bias. |
| arXiv abstracts | 20% | Technical, has natural title labels we ignore in favor of distilled ones. |
| Hacker News | 20% | Conversational register, submission bodies. |
| GitHub issues | 15% | Code-adjacent, technical bug reports. |
| FineWeb-Edu (`sample-10BT`) | 15% | General web text, filtered for educational quality. Stream, don't materialize. |
| StackExchange or pi-mono | 5% | Target distribution slice if available. |

### Preprocessing

Single shared cleaner function across sources:

- Strip markdown formatting (code fences, tables, link syntax, headers).
- Strip HTML entities.
- Length filter: 200-4000 characters. Filter while streaming for FineWeb.
- Light dedup on first 200 chars (set-based).

### Distillation

Use Claude Haiku 4.5. Cheaper than Sonnet, sufficient for this constrained task.

Lock the prompt before the full run:

1. Write prompt with 3-5 few-shot examples of target slug style (kebab-case, max 6 words, no stopwords).
2. Test on 50 items from each source.
3. Eyeball outputs across sources for style consistency.
4. Only then run the full ~10k.

Temperature 0. Style drift is the enemy: model quality is upper-bounded by label consistency.

Budget: ~$10-20 total, overnight batch.

### Train/val/test split

80/10/10. Split by embedding cluster (or by source URL hash) rather than random to avoid near-duplicate leakage.

## Evaluation

### Quantitative

- ROUGE-L against held-out distilled slugs.
- BERTScore for semantic similarity.
- Distinctiveness: do nearby embeddings (top-5 in cosine) get distinguishable slugs, or does the model collapse to generic labels?
- Inference latency, parameter count, memory footprint per variant.

### Qualitative

- Hand-rated set of ~200 (text, gold slug, predicted slug) tuples across all variants.
- Salience probe (leave-one-token-out from encoder, cosine shift + slug change) on representative inputs.
- Side-by-side comparison across encoders for the salience question.

### Predictions to log before running

Write down expectations before training:

- Which variant will be most fluent?
- Which encoder will win on technical-noun-heavy inputs?
- Where will all variants fail similarly?
- Where will distilled-label style be obviously visible in outputs?

Diverging from predictions = the demo's best slides.

## Timeline

Two weeks rather than rushing a single day. The interesting result is the full comparison; a half-finished comparison is much weaker.

Rough phasing:

- **Day 1-2**: corpus assembly, cleaner function, dedup, streaming setup for FineWeb.
- **Day 3**: lock distillation prompt, run on 50-item samples per source, iterate.
- **Day 4**: full distillation run with Haiku. Build slug vocabulary for Variants 1 and 3.
- **Day 5**: cache embeddings for both encoders (`text-embedding-3-small` and `harrier-oss-v1-0.6b`) across the full corpus.
- **Day 6-7**: train and evaluate Variant 1 (classifier). Fast.
- **Day 8-10**: train and evaluate Variant 3 (from-scratch seq2seq).
- **Day 11-12**: train and evaluate Variant 2 (frozen-LM + projector).
- **Day 13**: salience probes, comparison table, qualitative review.
- **Day 14**: write up, prepare demo.

## Deliverables

1. Comparison table across 3 variants × 2 encoders on quantitative metrics.
2. Salience probe outputs on representative inputs across encoders.
3. Hand-picked qualitative examples showing where each variant wins and loses.
4. Resource/latency table: params, memory, ms/slug.
5. Short writeup framing the result as "embeddings as substrate for cheap auxiliary outputs, with slugs as the proof of concept."

## Open questions / things to revisit

- Pooling strategy. Mean pooling may wash out salient nouns. If `harrier` uses last-token or attention pooling, this is part of the comparison story.
- LoRA on Variant 2's decoder. If frozen-decoder outputs feel flat, a tiny LoRA (r=8, q_proj + v_proj) usually recovers the last 30% of quality. Worth trying if budget allows.
- Constrained decoding for Variant 2 (kebab-case only, max 6 tokens, no repeats) via `LogitsProcessor`. Significantly improves perceived quality.
- Whether to also benchmark against a prompted-Haiku baseline as a quality ceiling. Honest and useful, but doubles eval cost.
- Versioning: projector weights are tied to (encoder version, decoder version, training data snapshot). Treat as a triple at serving time.
