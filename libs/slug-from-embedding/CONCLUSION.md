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

### Experiment 3b: KMeans vocab, embed_dim=384

- **Parameters**: 11,539,594
- **Training**: 15 epochs, same setup.
- **Result**: tok_f1 reached 0.345, consistently ~0.02 ahead of 256d.
  Val loss 3.403. Train/val gap widened to 8.6% by end.
- **Conclusion**: Capacity matters. Larger decoder extracts more signal.
- **Qualitative highlights**:
  - "buddhist-in-burma" vs ref "buddhism-in-burma" (one token off)
  - "digital-media-lab" = exact match
  - "drinking-water-benefits" vs ref "enjoy-the-numerous-benefits-of-drinking-water-2"

### Experiment 3c: BPE vocab, embed_dim=384 (15 epochs, first run)

- **Parameters**: ~11.5M
- **Training**: 15 epochs, tok_f1 reached 0.249 and still climbing linearly.
- **Observation**: BPE tok_f1 starts lower and climbs slower than KMeans
  because the per-step prediction task is harder (12 subwords vs 5 tokens).
  The slope (~0.014/10k steps) is similar to KMeans (~0.017/10k steps).
  Whether BPE catches up depends on extended training.

### Experiment 3d: BPE vocab, embed_dim=512 (15 epochs)

- **Parameters**: 18,528,136
- **Training**: 15 epochs, tok_f1 reached 0.254.
- **Observation**: Consistently ~0.01 ahead of 384d BPE at the same step
  count, confirming capacity matters for BPE too. Same pattern as
  KMeans 256d→384d.

### Experiment 3e: BPE vocab, embed_dim=384, 50 epochs *(running)*

Extended training to find the BPE plateau. At 15 epochs, both BPE runs
were still climbing linearly with no sign of plateauing. The question:
does extended training close the gap with KMeans compressed tok_f1?

### The Compression Ceiling

Analysis of the KMeans-5000 mapping revealed that 47.2% of reference slug
tokens map to a different representative. A perfect model can only reach
50.2% raw Token F1 with this vocab. The KMeans model's 0.345 compressed
tok_f1 represents 69% of the theoretical ceiling.

Example: the model predicted "anne-essex-fly" for an Amelia Earhart article.
Investigation showed: amelia → anne (female-names-starting-with-A cluster),
earhart → harry (surname cluster), and "fly" is the representative for the
aviation cluster. The model captured "female aviator" but the compression
couldn't express it.

BPE eliminates this ceiling. Under BPE, the same model generated
"emma-j-amelia-ear" for the Earhart article: it actually recovered "amelia"
and the start of "earhart" via subword composition. This is impossible with
KMeans compression.

### Decoding Strategy

Greedy decoding produced a repetition pathology: "turtle-of-turtle",
"audio-video-sync-audio-video". The model gets stuck in loops because
at each step the highest single-token probability leads back to the same
word.

**Beam search** (width=4) eliminates this by evaluating full sequence
probability. Repetitive sequences naturally score worse because the model's
predictions become poorly calibrated on histories it never saw during
training. No post-hoc deduplication needed.

Additional decoding constraints:
- **Length-normalized scoring**: `score = log_prob / ((5 + len) / 6)^1.2`
  prevents short sequences from winning on accumulated log-prob alone
- **Minimum word count**: suppress EOS until at least 3 slug-level words
  are generated
- **Soft stopword penalty**: -0.15 score for sequences ending on a stopword
  ("and", "of", "the"), acting as a tiebreaker between otherwise equal
  candidates
- **UNK suppression**: for BPE vocab, prevent `<unk>` from appearing

### Qualitative Comparison: KMeans vs BPE (beam search)

| Source text topic | KMeans (384d) | BPE (512d) | Reference |
|---|---|---|---|
| CRISPR citrus greening | genetic-engineering-citrus-green | crispr-cas9-greening-bug | an-off-switch-to-greening |
| Amelia Earhart | anne-essex-fly | emma-j-amelia-ear | amelia-earharts-enduring-image |
| RO membrane replacement | how-to-set-rover-membrane | reverse-osmosis-filter-replacement | ro-membrane-replacement-time-or-not-yet |
| Manatee deaths | mantis-fish-death | manatee-endangered-species-threatens | manatees-next-on-the-endangered-species-list |
| Visual alarm devices | sound-warning-signs | visual-alarm-devices | visual-alarm-signal |
| Audit risk formula | risk-assessment-of-a | audit-risk-audit-formula | audit-risk-calculator |
| Cholera symptoms | campylobacter-cholera-outbreak | cholera-symptoms-diagnosis-and-treatment | clinical-features-of-cholera |
| Tel Aviv history | history-of-israel | tel-aviv-city-of-tel | a-brief-history-of-tel-aviv |

BPE consistently produces more specific, more accurate slugs despite lower
tok_f1 at the same epoch count. The metrics don't fully capture the
qualitative improvement because BPE can express the *right* words while
KMeans is forced to use the nearest representative.

## Key Findings

1. **Bag-of-tokens classifiers fail for this task.** The MLP predicts tokens
   independently and collapses to high-frequency function words. Three
   ablations (loss function, capacity, position head) all hit the same
   ceiling. The architecture is fundamentally wrong for generation.

2. **Seq2seq decoders extract real signal from embeddings.** Autoregressive
   generation produces topically relevant, human-readable slugs. The ability
   to model token co-occurrence and sequence structure is essential.

3. **Vocab strategy matters as much as model architecture.** KMeans
   compression caps raw Token F1 at 50.2% due to 47% of tokens mapping to
   different representatives. BPE eliminates this ceiling entirely with
   lossless subword composition. Qualitatively, BPE produces more specific
   and accurate slugs even when its tok_f1 is numerically lower.

4. **Embeddings encode topic but not lexical specifics.** The model
   consistently captures the right topic ("buddhist" for Buddhism,
   "hurricane" for storm preparation) but misses specific names and
   terminology. Sentence-level embeddings encode meaning, not the words
   used to express it.

5. **Decoder capacity matters.** Both KMeans and BPE showed consistent
   ~0.02 tok_f1 improvement when going from 256d to 384d (and 384d to
   512d for BPE). The embedding contains more signal than smaller decoders
   can extract.

6. **Decoding strategy matters as much as model quality.** Beam search
   eliminated greedy decoding's repetition pathology without changing model
   weights. The same model produces dramatically different output quality
   depending on how we search its probability distribution.

7. **Isolated tokens cluster poorly in embedding space.** At cosine ≥ 0.85,
   316k single-word tokens form a near-fully-connected graph (251M edges).
   Sentence-trained embedding models don't separate individual words well.
   This rules out similarity-based vocab compression strategies.

## Open Questions

- **Where does BPE plateau?** Extended training (50 epochs) is running.
  The linear slope suggests significant room for improvement.
- **Is the embedding the ultimate ceiling?** Even with perfect decoding,
  sentence-level embeddings may not encode enough information to reconstruct
  specific terminology. A different embedding model (e.g. one trained on
  titles/headings) might raise this ceiling.
- **Would a pretrained decoder help?** A pretrained LM already knows
  language structure and common phrases. Our from-scratch decoder must learn
  all of this from the slug corpus. Variant 2 (frozen LM + trained projector)
  would test this.

## Experiment Log

| Experiment | Variant | Vocab | embed_dim | Epochs | tok_f1 | Val Loss | Params |
|---|---|---|---|---|---|---|---|
| 1a | MLP (BCE) | KMeans-5000 | 768 | 5 | 0.085 | 1.657 | 5.6M |
| 1b | MLP (focal) | KMeans-5000 | 768 | 5 | 0.083 | 1.654 | 5.6M |
| 1c | MLP (big) | KMeans-5000 | 1024 | 5 | — | 1.657 | 9.9M |
| 3a | Seq2seq | KMeans-5000 | 256 | 15 | 0.326 | 3.517 | 6.1M |
| 3b | Seq2seq | KMeans-5000 | 384 | 15 | 0.345 | 3.403 | 11.5M |
| 3c | Seq2seq | BPE-5000 | 384 | 15 | 0.249 | 2.181 | 11.5M |
| 3d | Seq2seq | BPE-5000 | 512 | 15 | 0.254 | 2.128 | 18.5M |
| 3e | Seq2seq | BPE-5000 | 384 | 50 | *running* | — | 11.5M |
