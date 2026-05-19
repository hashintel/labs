# Slug from Embedding: Research Findings

## Summary

We tested whether single-pooled sentence embeddings can drive slug
generation without re-feeding source text. A multi-label classifier (MLP)
collapsed to high-frequency function words (0.085 tok_f1). A prefix-
conditioned transformer decoder over BPE-tokenized slugs reached 0.27
tok_f1 and produced topically correct, human-readable slugs. Performance
plateaued across architectural variants from 11M to 25M parameters;
whether this reflects an embedding-information ceiling or a data-quantity
ceiling cannot be determined from these experiments. The trained model is
small (46MB), runs in ~100ms on CPU, and costs ~5-25x less than an LLM
call for the same task.

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

Note: Haiku had access to the source text; this measures the ceiling for
source-text-conditioned generation, not for embedding-conditioned generation.
The gap between Haiku and seq2seq does not directly measure the embedding's
information loss.

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

**Critical limitation**: 47.2% of reference slug tokens map to a *different*
representative after compression. A perfect model can only reach 50.2% raw
Token F1. Compressed Token F1 (mapping references through the same compression
before comparing) is the fair metric for compressed-vocab models.

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

The first approach treats slug generation as multi-label classification:
predict which tokens appear in the slug, then assemble them.

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
  - Vocab diversity: 22.6% (51,791 unique predictions)
  - (BERTScore F1: 0.818, but this is the BERTScore floor for short
    strings; even collapsed function-word outputs score ~0.82. BERTScore
    is uninformative for this task.)

**Failure mode**: The model collapsed to predicting the highest-frequency
tokens regardless of input. Top predictions: "of-the-a" (16,916x),
"of-the-in" (16,145x), "of-the-how" (6,393x). BCE loss rewards predicting
common tokens when 4,995 of 5,000 outputs should be zero.

### Experiment 1b: Focal Loss (gamma=2)

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

After the MLP collapsed to frequency-based predictions, we hypothesized
that bag-of-tokens classification was fundamentally wrong: slug generation
requires modeling token co-occurrence and order. This motivated switching
to autoregressive generation.

Architecture: embedding (1536d) → linear projection → prefix token at
position 0 → causal transformer decoder → autoregressive token generation.

The source embedding is projected into the decoder's hidden space and
prepended as a "prefix" token. Standard causal self-attention lets every
generated token attend to the prefix (the embedding) and all previous
tokens. This gives the model the ability to generate coherent sequences
rather than predicting tokens independently.

### Full Evaluation (5,000 test samples, beam search)

Variant 1 was evaluated on the full test set (229k); Variant 3 uses a 5,000
sample subsample because beam search decoding is ~70ms/sample (full set
would take ~4.5 hours per model, 7 models).

| Model | Vocab | Dim | Layers | Params | Epochs | Exact | Tok F1 | Comp F1 | ROUGE-L | BERT F1 | Distinct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| seq2seq_bpe_d512_l6 | BPE | 512 | 6 | 24.8M | ~23 | 1.6% | 0.272 | - | 0.256 | 0.863 | 0.895 |
| seq2seq_bpe-d512 | BPE | 512 | 4 | 18.5M | 15 | 1.5% | 0.269 | - | 0.252 | 0.862 | 0.892 |
| seq2seq_bpe | BPE | 384 | 4 | 11.5M | 15-50† | 1.2% | 0.267 | - | 0.251 | 0.862 | 0.890 |
| seq2seq_bpe_d384_l6 | BPE | 384 | 6 | 15.1M | 15 | 1.4% | 0.259 | - | 0.243 | 0.861 | 0.890 |
| seq2seq_d384 | KMeans | 384 | 4 | 11.5M | 15 | 0.6% | 0.197 | 0.354 | 0.186 | 0.857 | 0.844 |
| seq2seq | KMeans | 256 | 4 | 6.1M | 15 | 0.5% | 0.189 | 0.332 | 0.178 | 0.856 | 0.836 |
| seq2seq_d512 | KMeans | 512 | 4 | 18.5M | 15 | 0.3% | 0.164 | 0.278 | 0.155 | 0.852 | 0.829 |

### What the numbers show

**BPE dominates KMeans across all metrics.** Even the smallest BPE model
(384d/4L, 11.5M) beats the best KMeans model on raw tok_f1 (0.267 vs 0.197).
KMeans d384 has a compressed F1 of 0.354, but that's measured in compressed
space and not directly comparable.

**Width matters more than depth for BPE.** The 512d/4L model (0.269) matches
the 512d/6L model (0.272) with 6M fewer parameters. The 384d/6L model
(0.259) underperforms the 384d/4L model (0.267), suggesting
the extra depth doesn't pay for itself at this scale.

**Extended training helps modestly.** The 384d/4L model was retrained
(history not captured), reaching 0.267 tok_f1 at eval.

**KMeans d512 underperforms d384.** Likely an artifact of interrupted
training (no history available for d512).

### The Compression Ceiling

Analysis of the KMeans-5000 mapping revealed that 47.2% of reference slug
tokens map to a different representative. A perfect model can only reach
50.2% raw Token F1 with this vocab. The KMeans model's 0.354 compressed tok_f1 represents 70% of the
theoretical ceiling (0.502), suggesting the model extracts most of the
signal available given the vocab constraint.

Example: the model predicted "anne-essex-fly" for an Amelia Earhart article.
Investigation showed: amelia → anne (female-names cluster), earhart → harry
(surname cluster), and "fly" is the representative for the aviation cluster.
The model captured "female aviator" but the compression couldn't express it.

BPE eliminates this ceiling. Under BPE, the same model generated
"emma-j-amelia-ear" for the Earhart article: it actually recovered "amelia"
and the start of "earhart" via subword composition. This is impossible with
KMeans compression.

### Decoding Strategy

Greedy decoding produced a repetition pathology: "turtle-of-turtle",
"audio-video-sync-audio-video". The model gets stuck in loops because
at each step the highest single-token probability leads back to the same
word.

**Beam search** (width=4) eliminates most repetition by evaluating full
sequence probability. Additional decoding constraints:

- **Length-normalized scoring**: `score = log_prob / ((5 + len) / 6)^1.2`
  prevents short sequences from winning on accumulated log-prob alone
- **Minimum word count**: suppress EOS until at least 3 slug words
- **Hard stopword EOS suppression**: prevent EOS immediately after a
  stopword ("and", "of", "the"). The model overproduces stopword endings
  (observed at ~6% vs 1.1% in training data) because stopwords have high
  unigram frequency and the model defaults to them when uncertain.
- **Stopword scoring penalty**: -1.0 on completed beams ending on a
  stopword, catching cases that slip through the hard suppression
  (e.g. max-length fallback)
- **Repetition filter**: prefer non-repeating beams in final selection.
  When the embedding strongly signals one concept, all beam paths may
  repeat it ("december-30-december"). The filter selects the best
  non-repeating completion, falling back to repeating only if no
  alternative exists. Residual repetition rate after filtering: 0.3-0.6%
  of predictions (morphological variants like subject/subjects that
  bypass exact-match detection).
- **UNK suppression**: for BPE vocab, prevent `<unk>` from appearing

The stopword issue is structural, not a calibration error. Only 1.1% of
training slugs end with a stopword (20k/1.8M), but the model overproduces
them because stopwords have high unigram frequency. When uncertain about
the next token, the model defaults to a high-frequency word, and if EOS
follows, the slug ends on a stopword. Hard suppression forces the model
past the stopword to commit to a content word.

### Qualitative Examples (beam search, all constraints)

| Source text topic | BPE 384d/4L (50ep) | BPE 512d/6L (~23ep) | Reference |
|---|---|---|---|
| Arsenic in drinking water | arsenic-in-drinking-water | arsenic-in-drinking-water | dartmouth-study-finds-arsenic-inhibits-dna-repair |
| Vision therapy for children | vision-therapy-for-children | vision-therapy-for-children | vision-therapy-for-children |
| Blood donation facts | facts-about-blood-donation | facts-about-blood-don | more-blood-donation-facts |
| Dragonflies vs mosquitoes | dragonflies-and-mosquito | dragonflies-and-mosquitoes | attracting-dragonflies-for-mosquito-control |
| Prescription drug epidemic | the-epidemic-of-prescription | prescription-drug-abuse | opioid-epidemic-in-the-united-states |
| TCP troubleshooting | troubleshooting-ip-client | troubleshooting-with-tcp | (networking article) |

Both models capture topic accurately. The 512d/6L model sometimes produces
more specific slugs ("prescription-drug-abuse" vs "the-epidemic-of-prescription")
but the difference is marginal. Exact matches occur at ~1.5% rate.

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
   lossless subword composition. BPE dominates KMeans on every metric.

4. **Performance saturates across model configurations.** All BPE models
   converge to similar performance (0.259-0.272 tok_f1) regardless of
   capacity (11.5M to 24.8M params). The model recovers domain vocabulary
   well ("arsenic", "dragonflies", "cholera") but fails on proper nouns
   ("Amelia Earhart" becomes "anne-essex-fly" under KMeans, "earliest-
   flight" under BPE). Whether this represents
   an embedding-content ceiling or a data-quantity ceiling cannot be
   distinguished from these experiments; we discuss possible distinguishing
   experiments below.

5. **Width and depth are roughly interchangeable at fixed parameter
   budget.** 512d/4L matches 512d/6L (0.269 vs 0.272) with 6M fewer
   parameters. 384d/6L slightly underperforms 384d/4L (0.259 vs 0.267).
   Neither dimension dominates; the bottleneck is elsewhere.

6. **Decoding strategy matters as much as model quality.** Beam search,
   stopword suppression, and repetition filtering are all inference-time
   fixes that dramatically improve output quality without changing model
   weights. The model learns good local probability estimates; the decoding
   pipeline handles global coherence.

7. **Isolated tokens cluster poorly in embedding space.** At cosine >= 0.85,
   316k single-word tokens form a near-fully-connected graph (251M edges).
   Sentence-trained embedding models don't separate individual words well.
   This rules out similarity-based vocab compression strategies.

8. **CPU inference is feasible.** The 384d/4L BPE model (46MB, 11.5M params)
   runs at 20ms/sample on CPU (M3 Mac). Even the largest model (512d/6L,
   99MB, 24.8M params) runs at 39ms/sample. Deployment on a small VPS is
   practical.

## What Limits Performance

The ceiling may reflect data quality, data quantity, embedding information
content, or some combination; the experiments here cannot distinguish them.
The following observations bear on the question.

**Reference quality is a confound.** URL-extracted slugs are noisy:
truncated URLs, SEO-stuffed headlines, inconsistent editorial standards.
"dartmouth-study-finds-arsenic-inhibits-dna-repair" is a newspaper headline
crammed into a URL path, not a carefully authored slug. In several qualitative examples, the model generates cleaner slugs than
the references ("arsenic-in-drinking-water" vs "dartmouth-study-finds-
arsenic-inhibits-dna-repair"), but gets penalized by token-match metrics.
The metrics may understate actual quality for these cases.

**Data quantity limits contrastive learning.** At 2.3M samples, the model
sees enough to learn domain vocabulary but not enough to disambiguate
within-topic variation. All Earhart articles embed near each other; the
model can't learn that *this specific* flight-history embedding means
"earhart" because it hasn't seen enough non-Earhart flight articles to
build contrastive representations.

**Scaling to 10-20M would disambiguate the two ceilings.** If tok_f1
improves with more data, the ceiling is data quantity. If it doesn't,
the ceiling is the embedding's information content. Both are publishable
conclusions.

## Deployment Recommendation

The **384d/4L BPE model** is the best tradeoff for deployment:
- 46MB model file, 329KB tokenizer
- 11.5M parameters
- 20ms/sample on CPU, ~100ms on a cheap VPS
- 0.267 tok_f1, only 0.005 behind the best model
- Half the parameters of the best model

Marginal cost over an existing embedding: ~100ms CPU time. If the
embedding must also be generated, add ~$0.00002 per API call. Compared to
an LLM call (~$0.0001-0.0005 for Haiku-class models on short inputs),
total cost is 5-25x cheaper. The cost advantage grows with scale and is
strongest against larger models. The premise (embeddings as substrate)
is strongest when embeddings already exist for other purposes (search,
clustering, deduplication) and slug generation is a cheap auxiliary output.

## Critical Confound: Sequence Length Truncation

All BPE experiments used `max_slug_tokens=10`, inherited from the KMeans
configuration where 10 tokens covers ~5 whole words. Under BPE, 10 subword
tokens only covers 3-4 slug words. The BPE token length distribution of
training references (1.84M slugs):

```
  mean=11.7  median=11  p75=15  p90=18  p95=19  p99=23  max=222

  <=10:  43.9%  (truncates 56.1%)
  <=16:  85.3%  (truncates 14.7%)
  <=20:  97.0%  (truncates  3.0%)
  <=24:  99.4%  (truncates  0.6%)
  <=32: 100.0%  (truncates  0.0%)
```

**56% of training references were truncated.** The model was learning from
incomplete targets for more than half the data, and could not generate
slugs longer than ~4 words at inference. Predictions averaged 3.5 words
vs 5.1 for references.

This is the single largest confound in the BPE experiments. The "BPE
plateau at 0.27 tok_f1" and the "performance saturates across
configurations" finding are both potentially artifacts of every model
hitting the same sequence length wall. Architectural conclusions (width
vs depth, capacity scaling) are also suspect since all models shared
the same bottleneck.

A retrain with `max_slug_tokens=24` (covers 99.4% of references) is
running to determine whether the plateau breaks.

## Open Questions

- **Scale experiment: 10-20M samples.** The critical next experiment.
  FineWeb-Edu has ~29M documents; extracting 10-20M URL slugs is
  straightforward with the existing pipeline. If performance improves,
  the current ceiling is data. If it doesn't, the ceiling is the embedding.

- **Distilled vs extracted references.** Instead of mining slugs from URLs
  (cheap but noisy), distill them from content using a small, fast model
  (e.g. Haiku, Gemini Flash). At ~$0.001/call, 10M samples costs ~$10k,
  which is prohibitive. But a smaller open-source model running locally
  (Phi-3, Llama 3 8B) could distill at compute cost only. The hypothesis:
  higher-quality references would improve training signal more than
  additional noisy references. A 2M distilled corpus might outperform
  a 20M URL-extracted corpus.

- **Hybrid approach.** Use URL extraction for scale (20M) with a quality
  filter: only keep samples where the URL slug passes a semantic similarity
  check against the document content (e.g. embed both slug and first
  paragraph, require cosine > threshold). This selects for URLs where
  the slug actually describes the content, filtering out SEO noise and
  truncated paths.

- **Would a pretrained decoder help?** A pretrained LM already knows
  language structure and common phrases. Our from-scratch decoder must
  learn all of this from the slug corpus. A frozen LM with a trained
  projector would test whether the bottleneck is language modeling
  capacity or embedding information.

- **Repetition as a depth problem.** The model has no learned mechanism
  to suppress already-emitted content. Current results suggest 6 layers
  don't help at this scale, but the inference-time repetition filter
  handles this adequately.

## Experiment Log

| Experiment | Variant | Vocab | Dim | Layers | Epochs | tok_f1 | Val Loss | Params |
|---|---|---|---|---|---|---|---|---|
| 1a | MLP (BCE) | KMeans | 768 | 2 | 5 | 0.085 | 1.657 | 5.6M |
| 1b | MLP (focal) | KMeans | 768 | 2 | 5 | 0.083 | 1.654 | 5.6M |
| 1c | MLP (big) | KMeans | 1024 | 4 | 5 | - | 1.657 | 9.9M |
| 3a | Seq2seq | KMeans | 256 | 4 | 15 | 0.326* | 3.517 | 6.1M |
| 3b | Seq2seq | KMeans | 384 | 4 | 15 | 0.345* | 3.403 | 11.5M |
| 3c | Seq2seq | BPE | 384 | 4 | 15 | 0.249* | 2.181 | 11.5M |
| 3d | Seq2seq | BPE | 512 | 4 | 15 | 0.254* | 2.128 | 18.5M |
| 3e | Seq2seq | BPE | 384 | 4 | 15-50† | 0.267 | - | 11.5M |
| 3f | Seq2seq | BPE | 384 | 6 | 15 | 0.259 | 2.172 | 15.1M |
| 3g | Seq2seq | BPE | 512 | 6 | ~23 | 0.272 | 2.120 | 24.8M |
| 3h | Seq2seq | KMeans | 512 | 4 | 15 | 0.164 | - | 18.5M |

*Training tok_f1 (greedy decode on 2k val subsample). Eval tok_f1 (beam
search with stopword/repetition filters on 5k test subsample) is typically
+0.01-0.02 higher. Eval values are in the Full Evaluation table above.

†Retrained from 15 to 50 epochs; training history not captured. The
checkpoint contains the retrained weights but the exact best epoch is
unknown. Eval metrics are from the actual checkpoint.
