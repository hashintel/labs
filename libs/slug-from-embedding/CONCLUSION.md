# Slug from Embedding: Research Findings

## Research Question

Can short kebab-case slugs be generated directly from content embeddings,
without re-feeding source text through an LLM? The slug task is the concrete
vehicle; the general claim is embeddings as a substrate for cheap auxiliary
outputs.

## Corpus

Two corpora were prepared:

- **Original (10k)**: 10,000 samples from FineWeb-Edu (50%), arXiv (25%),
  GitHub issues (25%). Slugs distilled via Anthropic Haiku batch API
  (98.3% valid).
- **URL (2.3M)**: 2,298,564 samples from FineWeb-Edu with slugs extracted
  from source URLs at zero labeling cost. This is the primary training corpus.

## Baselines

| Method | Exact Match | Token F1 | Notes |
|--------|-------------|----------|-------|
| Random (floor) | ~0% | ~0% | Random vocab tokens |
| Haiku (ceiling) | 94.2% | — | LLM with source text access |

## Embedding Models

Two encoders were evaluated:

- **OpenAI text-embedding-3-small** (1536d): via OpenRouter, ~$23 total
  for 2.3M embeddings
- **Harrier** (1024d): local on MPS, original corpus only

## Vocab Strategies

The URL corpus has 315,929 unique slug tokens, 62% hapax. Two vocab
strategies were developed:

### KMeans Compression (5000 clusters)

Three grouping strategies were tested on token embeddings:

| Strategy | Clusters | Noise | Compression | Notes |
|----------|----------|-------|-------------|-------|
| Connected components (cosine ≥ 0.85) | 206,138 | 181,225 | 1.5x | "a" swallowed 51k tokens via transitivity |
| Louvain communities (cosine ≥ 0.85) | 206,167 | 181,225 | 1.5x | Broke up giant blob (5.6k) but still ~no compression |
| KMeans (k=5000) | 5,000 | 0 | 63x | Semantic groupings: how/what/who, can/does/should |

**Finding**: At cosine similarity ≥ 0.85, isolated single-word tokens form
a near-fully-connected graph (251M edges for 316k nodes, ~800 neighbors per
token). Embedding models trained on full sentences don't separate individual
words well in vector space. KMeans was the only practical compression strategy.

**Critical limitation discovered late**: 47.2% of reference slug tokens map
to a *different* representative after compression. A perfect model can only
reach 50.2% raw Token F1. This means raw Token F1 conflates model quality
with compression loss. Compressed Token F1 (mapping references through the
same compression before comparing) is the fair metric for compressed-vocab
models.

### BPE Tokenizer (5000 subwords)

Byte-pair encoding trained on the slug corpus with `-` as a special token.
The pre-tokenizer splits on hyphens (`Split(pattern="-", behavior="isolated")`)
so BPE learns subword units within slug tokens, never merging across word
boundaries. Average encoded length: 11.7 subwords per slug.

**Key advantage**: Lossless reconstruction. Any slug can be perfectly
roundtripped through encode/decode. No compression ceiling. Same vocab size
(5000) as KMeans, but the model can express any token via subword composition
instead of being limited to 5000 representatives.

## Variant 1: MLP Multi-label Classifier

Architecture: embedding (1536d) → 2-layer MLP (768 hidden) → three heads:
- Token head: sigmoid over 5000 compressed vocab tokens (which tokens present)
- Length head: 6-class softmax (slug length 3-8)
- Optional position head (variant 1b)

### Experiment 1a: BCE Loss (baseline)

- **Parameters**: 5,619,853
- **Training**: 5 epochs, batch_size=1024, lr=1e-3, eval every 2000 steps
- **Result**: Val loss plateaued at epoch 2 (1.6572), train kept dropping
  (1.6421 by epoch 5). Mild overfitting, early plateau.
- **Evaluation** (229,496 test samples):
  - Validity: 100% (structural check only), Exact match: 0.0%
  - Token F1: 0.085, ROUGE-1: 0.085, ROUGE-L: 0.077
  - BERTScore F1: 0.818 (high baseline for short strings)
  - Vocab diversity: 22.6% (51,791 unique predictions)

**Failure mode**: The model collapsed to predicting the highest-frequency
tokens regardless of input. Top predictions: "of-the-a" (16,916×),
"of-the-in" (16,145×), "of-the-how" (6,393×). BCE loss rewards predicting
common tokens when 4,995 of 5,000 outputs should be zero.

### Experiment 1b: Focal Loss (γ=2)

- **Training**: Same setup. Val plateaued at 1.6543 (step 6000) vs BCE's
  1.6572 (step 4000). Within noise.
- **Evaluation**: Token F1: 0.083, identical to baseline.
- **Conclusion**: Loss function is not the bottleneck.

### Experiment 1c: Bigger Projector (4 layers, 1024 hidden)

- **Parameters**: 9,852,813 (1.8x baseline)
- **Training**: Val plateaued at 1.6571, identical to baseline.
- **Conclusion**: Capacity is not the bottleneck.

### Variant 1 Summary

Three experiments hit the same ceiling (~1.657 val loss, ~0.085 tok F1).
The MLP bag-of-tokens architecture cannot recover slug tokens from embeddings.
It predicts tokens independently and cannot model co-occurrence or sequence.

## Variant 3: Seq2seq Transformer Decoder

Architecture: embedding (1536d) → linear projection → prefix token at
position 0 → 4-layer causal transformer decoder → autoregressive token
generation.

The source embedding is projected into the decoder's hidden space and
prepended as a "prefix" token. Standard causal self-attention lets every
generated token attend to the prefix (the embedding) and all previous
tokens. This gives the model the ability to generate coherent sequences
rather than predicting tokens independently.

### Experiment 3a: KMeans vocab, embed_dim=256

- **Parameters**: 6,121,866
- **Training**: 15 epochs, batch_size=1024, lr=3e-4, eval every 2000 steps
- **Result**: Val loss still dropping at epoch 15 (3.517). tok_f1 reached
  0.326 and was still climbing.
- **Qualitative**: Generates topically relevant slugs. Some repetition
  ("turtle-of-turtle") due to decoder degeneration.

### Experiment 3b: KMeans vocab, embed_dim=384

- **Parameters**: 11,539,594
- **Training**: 15 epochs, same setup.
- **Result**: tok_f1 reached 0.345, consistently ~0.02 ahead of 256d.
  Val loss 3.403. Train/val gap widened to 8.6% by end.
- **Conclusion**: Capacity matters. Larger decoder extracts more signal.
- **Qualitative** (with no-repeat-1gram constraint):
  - "buddhist-in-burma" vs ref "buddhism-in-burma" (one token off)
  - "introduction-to-medical-terminology" vs ref "medical-terminology-course"
  - "digital-media-lab" = exact match
  - "drinking-water-benefits" vs ref "enjoy-the-numerous-benefits-of-drinking-water-2"

### The Compression Ceiling

Analysis of the KMeans-5000 mapping revealed that 47.2% of reference slug
tokens map to a different representative. A perfect model can only reach
50.2% raw Token F1 with this vocab. The model's 0.345 is 69% of that
theoretical ceiling.

Example: the model predicted "anne-essex-fly" for an Amelia Earhart article.
Investigation showed: amelia → anne (female-names-starting-with-A cluster),
earhart → harry (surname cluster), and "fly" is the representative for the
aviation cluster. The model captured "female aviator" but the compression
couldn't express it.

This motivated switching to BPE tokenization: same vocab size (5000),
lossless reconstruction, no compression ceiling.

### Experiment 3c: BPE vocab, embed_dim=384 *(running)*

- **Parameters**: ~11.5M
- **Hypothesis**: If compression was the primary bottleneck, tok_f1 should
  jump well past 0.345. If it lands in the same range, the embedding
  information ceiling is real.

## Key Findings

1. **Bag-of-tokens classifiers fail for this task.** The MLP predicts tokens
   independently and collapses to high-frequency function words. Three
   ablations (loss function, capacity, position head) all hit the same
   ceiling. The architecture is fundamentally wrong.

2. **Seq2seq decoders extract real signal.** Autoregressive generation
   reached tok_f1 0.345 (4x the MLP's 0.085) and produces topically
   relevant, human-readable slugs. The ability to model token co-occurrence
   and sequence structure is essential.

3. **Vocab compression has a hard ceiling.** KMeans-5000 maps 47% of tokens
   to different representatives, capping raw Token F1 at 50.2%. BPE
   tokenization eliminates this ceiling while keeping the same vocab size.

4. **Embeddings encode topic but not lexical specifics.** The model
   consistently captures the right topic ("buddhist" for Buddhism,
   "hurricane" for storm preparation) but misses specific names and
   terminology. This may be a fundamental property of sentence-level
   embeddings: they encode meaning, not the words used to express it.

5. **Decoder capacity matters.** 384d consistently outperformed 256d
   (~0.02 tok_f1), and was still improving at 15 epochs. The embedding
   contains more signal than the smaller decoder can extract.

6. **Isolated tokens cluster poorly in embedding space.** At cosine ≥ 0.85,
   316k single-word tokens form a near-fully-connected graph (251M edges).
   Sentence-trained embedding models don't separate individual words well.

## Next Steps

- [ ] Complete BPE experiment (running)
- [ ] If BPE improves: extend to 30 epochs, try embed_dim=512
- [ ] If BPE doesn't improve: the embedding ceiling is confirmed
- [ ] Evaluate all models with compressed Token F1 for fair comparison
- [ ] Variant 2: Frozen LM with trained projector (different approach entirely)
- [ ] Cross-variant disagreement analysis
- [ ] Failure exemplar analysis (where does the model fail and why?)
