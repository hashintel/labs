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

## Vocab Compression

The URL corpus has 315,929 unique slug tokens, 62% hapax. Three grouping
strategies were tested on token embeddings:

| Strategy | Clusters | Noise | Compression | Notes |
|----------|----------|-------|-------------|-------|
| Connected components (cosine ≥ 0.85) | 206,138 | 181,225 | 1.5x | "a" swallowed 51k tokens via transitivity |
| Louvain communities (cosine ≥ 0.85) | 206,167 | 181,225 | 1.5x | Broke up giant blob (5.6k) but still ~no compression |
| KMeans (k=5000) | 5,000 | 0 | 63x | Semantic groupings: how/what/who, can/does/should |

**Finding**: At cosine similarity ≥ 0.85, isolated single-word tokens form
a near-fully-connected graph (251M edges for 316k nodes, ~800 neighbors per
token). Embedding models trained on full sentences don't separate individual
words well in vector space. KMeans was the only practical compression strategy.

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
  - Validity: 0.4%, Exact match: 0.0%
  - Token F1: 0.085, ROUGE-1: 0.085, ROUGE-L: 0.077
  - BERTScore F1: 0.818 (high baseline for short strings)
  - Vocab diversity: 22.6% (51,791 unique predictions)

**Failure mode**: The model collapsed to predicting the highest-frequency
tokens regardless of input. The top 3 predictions are "of-the-a" (16,916),
"of-the-in" (16,145), and "of-the-how" (6,393). These are all function
words that appear in nearly every training slug. BCE loss rewards this
strategy: predicting common tokens is always a safe bet when 4,995 of
5,000 outputs should be zero.

Critically, the validity check rejects these predictions because "of",
"the", and "a" are stopwords in the distillation rules. The model learned
the frequency distribution of the training data, not the content-to-slug
mapping.

This motivates focal loss: by down-weighting the easy high-frequency
tokens, the model is forced to learn which *discriminative* tokens to
predict for each input.

### Experiment 1b: Focal Loss (γ=2)

Focal loss down-weights the 4995 easy negatives per sample, focusing gradient
on the ~5 hard positives. Diagnoses whether the BCE gradient dilution is
the bottleneck.

- **Training**: Same setup. Val plateaued at 1.6543 (step 6000) vs BCE's
  1.6572 (step 4000). Within noise.
- **Conclusion**: Loss function is not the bottleneck. The model reaches
  the same ceiling regardless of how gradients are weighted.

### Experiment 1c: Bigger Projector

Tests whether model capacity is the bottleneck. If train and val both
improve, capacity was limiting. If the same plateau appears, the information
ceiling is in the embeddings.

- **Result**: *(pending)*

## Key Observations

1. **Data scale solved the cold-start problem.** The original 10k corpus
   produced only 57 unique predictions. The 2.3M URL corpus gives the model
   enough signal to learn meaningful patterns.

2. **Embeddings don't separate isolated tokens well.** This is the vocab
   compression finding: embedding models encode contextual meaning from
   full sentences. Single words lack that context, so they cluster into
   a near-uniform ball in vector space.

3. **The MLP architecture has fundamental limitations for this task.**
   It predicts tokens independently (bag-of-tokens) and can't model
   co-occurrence: "if I picked token A, I should also pick token B."
   A seq2seq decoder that autoregressively generates tokens is the
   natural next step.

4. **Val plateau after 2 epochs is informative, not discouraging.**
   It means the model extracted what it could from the embeddings quickly.
   The question is whether a different decoder (seq2seq) or loss (focal)
   can extract more from the same embeddings.

## Next Steps

- [ ] Evaluate MLP baseline predictions (Token F1, ROUGE, BERTScore)
- [ ] Focal loss experiment
- [ ] Bigger projector experiment (3 layers, 1024 hidden)
- [ ] Variant 2: Frozen LM with trained projector
- [ ] Variant 3: From-scratch seq2seq (4-layer transformer decoder)
- [ ] Cross-variant disagreement analysis
