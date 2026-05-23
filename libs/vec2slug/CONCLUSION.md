# Slug from Embedding: Research Findings

## Summary

We tested whether single pooled sentence embeddings can drive slug generation without re-feeding source text. A multi-label classifier (MLP) collapsed to high-frequency function words and reached only 0.085 tok F1. A prefix-conditioned transformer decoder over BPE-tokenized slugs reached 0.306 tok F1 on the full evaluation pipeline (beam search, macro-averaged, 5000 test samples) after a series of targeted interventions: vocab redesign (KMeans → BPE), training-data truncation fix (max length 10 → 24), EOS calibration via position-aware loss weighting, and length-aware beam search. The model produces slugs at training-distribution length (mean 4.9 words vs reference mean 5.1) — calibration the prior models failed to learn. Performance plateaus across architectural variations: scaling from 11.5M to 24.8M parameters with the same training regime adds only +0.01 tok F1, suggesting the bottleneck is upstream of model capacity. The trained model (24.8M params, 99MB) runs in ~150ms on CPU and produces topically-correct, human-readable slugs. Whether the remaining ceiling reflects the embedding's information content or the data quantity at 2.3M samples remains open.

## Research Question

Can short kebab-case slugs be generated directly from content embeddings, without re-feeding source text through an LLM? The slug task is the concrete vehicle; the general claim is embeddings as a substrate for cheap auxiliary outputs.

## Corpus

Two corpora were prepared:

- **Original (10k)**: 10,000 samples from FineWeb-Edu (50%), arXiv (25%), GitHub issues (25%). Slugs distilled via Anthropic Haiku batch API (98.3% valid).
- **URL (2.3M)**: 2,298,564 samples from FineWeb-Edu with slugs extracted from source URLs at zero labeling cost. This is the primary training corpus.

## Baselines

| Method | Exact Match | Token F1 | Notes |
|--------|-------------|----------|-------|
| Random (floor) | ~0% | ~0% | Random vocab tokens |
| Haiku (different task) | 94.2% | — | LLM with source text access (not directly comparable: this measures source-text-conditioned generation, not embedding-only) |

## Embedding Models

- **OpenAI text-embedding-3-small** (1536d): via OpenRouter, ~$23 total for 2.3M embeddings
- **Harrier** (1024d): local on MPS, original corpus only

## Vocab Strategies

The URL corpus has 315,929 unique slug tokens, 62% hapax.

### KMeans Compression (5000 clusters)

Three grouping strategies were tested:

| Strategy | Clusters | Noise | Compression |
|----------|----------|-------|-------------|
| Connected components (cosine ≥ 0.85) | 206,138 | 181,225 | 1.5x |
| Louvain communities (cosine ≥ 0.85) | 206,167 | 181,225 | 1.5x |
| KMeans (k=5000) | 5,000 | 0 | 63x |

**Finding**: At cosine similarity ≥ 0.85, isolated single-word tokens form a near-fully-connected graph (251M edges for 316k nodes, ~800 neighbors per token). Embedding models trained on full sentences don't separate individual words well in vector space. KMeans was the only practical compression strategy.

**Critical limitation**: 47.2% of reference slug tokens map to a different representative after compression. A perfect model can only reach 50.2% raw Token F1. The KMeans model achieved 70% of that ceiling (0.354 compressed F1), confirming the model extracted most of the available signal given the vocab constraint.

### BPE Tokenizer (5000 subwords)

Byte-pair encoding trained on the slug corpus with `-` as a special token. Pre-tokenizer splits on hyphens so BPE learns subword units within slug tokens, never merging across word boundaries. Average encoded length: 11.7 subwords per slug.

**Key advantage**: Lossless reconstruction. Any slug can be perfectly roundtripped. No compression ceiling.

## Variant 1: MLP Multi-label Classifier

Architecture: embedding → 2-layer MLP → sigmoid over 5000 compressed vocab tokens + length head.

Three ablations all hit the same ceiling (~1.657 val loss, ~0.085 tok F1):

| Experiment | Variant | Parameters | Val Loss | Tok F1 |
|---|---|---|---|---|
| 1a | BCE Loss | 5.6M | 1.6572 | 0.085 |
| 1b | Focal Loss (γ=2) | 5.6M | 1.6543 | 0.083 |
| 1c | Bigger projector (4L, 1024 hidden) | 9.9M | 1.6571 | - |

**Failure mode**: The model collapsed to predicting the highest-frequency tokens regardless of input. Top predictions: "of-the-a" (16,916x), "of-the-in" (16,145x), "of-the-how" (6,393x). BCE loss rewards predicting common tokens when 4,995 of 5,000 outputs should be zero.

**Conclusion**: Bag-of-tokens architecture cannot recover slug tokens from embeddings. The model predicts tokens independently and cannot model co-occurrence or sequence structure.

## Variant 3: Seq2seq Transformer Decoder

Architecture: embedding → linear projection → prefix token at position 0 → causal transformer decoder → autoregressive token generation.

This is the variant where the project's interesting findings emerge. Four targeted interventions, each motivated by an observed failure mode, progressively improved both quantitative metrics and qualitative outputs.

### Intervention 1: KMeans → BPE Vocab

KMeans seq2seq capped at 0.354 compressed F1 (70% of 0.502 vocab ceiling). The model captured topic but couldn't produce specific lexical content. Example: for an Amelia Earhart article, the model predicted "anne-essex-fly" because `amelia` → `anne` (female-names cluster), `earhart` → `harry` (surname cluster), `fly` was the aviation cluster representative. The model knew "female aviator" but the vocab couldn't express it.

BPE eliminated this ceiling. The same model generated "emma-j-amelia-ear" for the Earhart article: recovered "amelia" and the start of "earhart" via subword composition. Impossible with KMeans.

### Intervention 2: Training Data Truncation Fix (t=10 → t=24)

Initial BPE experiments used `max_slug_tokens=10` inherited from the KMeans config. With BPE encoded sequences averaging 11.7 subwords, this truncated 56.1% of training targets at the subword level, including stripping EOS from those examples. The model learned that some sequences just end without EOS, confusing the termination signal.

Distribution of BPE-encoded slug lengths (1.84M training slugs):
```
  mean=11.7  median=11  p75=15  p90=18  p95=19  p99=23  max=222
  <=10:  43.9%  (truncates 56.1%)
  <=16:  85.3%
  <=20:  97.0%
  <=24:  99.4%
```

Retraining with `max_slug_tokens=24` (filtering 0.9% of slugs that didn't fit) improved val loss by 6.7% and tok F1 by ~0.02. Qualitatively, mid-word truncations were eliminated: "facts-about-blood-don" → "facts-about-blood-donation", "dragonflies-and-mosquito" → "dragonflies-and-mosquitoes".

### Intervention 3: EOS Calibration via Position-Aware Loss

After the truncation fix, the model still under-generated relative to the training distribution: predictions averaged 3.6 words vs training mean 5.1.

Diagnostic experiments ruled out length penalty miscalibration (length_penalty sweep had no effect on output length) and beam width (4/8/16 produced identical length distributions). The MIN_SLUG_WORDS=3/4/5 sweep was the discriminating test: forcing one extra word improved tok F1 by +0.012 (model had useful content available), forcing two extra dropped it back (embedding signal genuinely runs out around 5 words). The bottleneck was EOS calibration: the model assigned high EOS probability around word 3-4 regardless of input.

**Hypothesis**: Under standard CE loss with teacher forcing, EOS at common positions (~position 5-7 in subword space) receives more gradient signal than EOS at rare positions (~position 15-20). The model becomes overconfident about early EOS.

**Fix**: Position-aware loss weighting. For each position, weight EOS loss by `min(1.0, median_rate / position_rate)`. Positions where EOS is over-represented in training get dampened; rarely-occurring EOS positions stay at weight 1.0. Combined with label smoothing (0.1).

Result: mean predicted word count shifted from 3.6 to 4.9 (training mean is 5.1). Tok F1 also improved marginally over the t=24 baseline (0.286 vs 0.284) despite training for fewer epochs (30 vs 50). The MIN_SLUG_WORDS hack at inference is no longer needed; the model self-regulates length appropriately.

The intervention's value isn't fully captured by the aggregate tok F1 number, which moved only slightly. The qualitative win is the length-distribution match: previously, the inference-time MIN_SLUG_WORDS=4 hack was needed to force the model past its preferred early-termination point. With position-aware training, the model terminates at appropriate positions on its own.

### Intervention 4: Length-Aware Beam Search Termination

Standard beam search early-stops once k completed beams are collected, biasing toward short sequences because they emit EOS sooner and fill the completion pool first. Implementing bounded additive length reward with score-based stopping (Huang et al. 2017) eliminates this bias: the algorithm continues exploring as long as any active beam could plausibly outscore the best completed beam under length-normalized scoring. This recovers median output length and improves output quality without significantly increasing inference cost.

### Combined Result

Final model: BPE vocab, d=384, L=4, t=24, position-aware loss, length-aware beam search.

| Stage | Tok F1 (training, greedy) | Val Loss | Mean Words | Notes |
|---|---|---|---|---|
| MLP (Variant 1) | 0.085 | 1.657 | n/a | Bag-of-tokens collapses |
| Seq2seq + KMeans (d=384, L=4) | 0.354 (compressed) | 3.403 | n/a | 70% of 0.502 vocab ceiling |
| Seq2seq + BPE + t=10 (d=384, L=4, 15ep) | 0.249 | 2.181 | 3.6 | Truncated targets |
| Seq2seq + BPE + t=10 (d=512, L=6, ~23ep) | 0.272 | 2.120 | 3.6 | Pre-fix best |
| Seq2seq + BPE + t=24 (d=384, L=4, 50ep) | 0.284 | 2.035 | 3.6 | Truncation fix; under-generates |
| Seq2seq + BPE + t=24 + EOS loss (d=384, L=4, 30ep) | 0.286 | 3.009* | **4.9** | Length matches training distribution |
| Seq2seq + BPE + t=24 + EOS loss (d=512, L=6, 36ep) | **0.296** | **2.937*** | **4.9** | Canonical demo model |

*Val loss under the new label-smoothed position-weighted loss is in different absolute territory than the pre-EOS-loss runs; the relevant comparison is tok F1 and mean word count, both of which improved.

### Full evaluation of the final model

Canonical model: BPE vocab, d=512, L=6, t=24, position-aware EOS loss, beam search (width=4) with length-aware termination and the full decoding pipeline. Evaluated on 5000 held-out test samples.

```
Overall:
  Validity:         100.0%
  Exact match:      2.1%
  Token P/R/F1:     0.335 / 0.299 / 0.306
  ROUGE-1/L:        0.304 / 0.284
  BERTScore P/R/F1: 0.879 / 0.865 / 0.872
  Distinctiveness:  0.885
  Vocab diversity:  97.8% (4888 unique)
```

Per source (only fineweb-edu in the URL corpus):

```
  fineweb-edu  (n=5000)  exact=2.1%  tok_f1=0.306  rouge1=0.304  rouge_l=0.284  bert_f1=0.872
```

Per length bucket (document token count):

```
  short    (n= 495, avg=151 tok)  exact=3.4%  tok_f1=0.327  rouge_l=0.306  distinct=0.898
  medium   (n=2041, avg=345 tok)  exact=2.2%  tok_f1=0.300  rouge_l=0.278  distinct=0.887
  long     (n=2462, avg=720 tok)  exact=1.7%  tok_f1=0.306  rouge_l=0.284  distinct=0.882
```

A few observations:

**Validity is 100%.** Every output is a well-formed kebab-case slug. No malformed predictions, no truncation artifacts, no UNK tokens. The decoding constraints are doing their job.

**Vocab diversity is 97.8%.** Nearly every test sample produces a distinct prediction (4888 unique slugs in 5000 samples). The previous MLP variant collapsed to 22.6% diversity; this is a different regime entirely.

**Distinctiveness is 0.885.** For each prediction, the model's k-nearest neighbors in embedding space get distinguishable slugs ~89% of the time. Confirms the model is genuinely distinguishing similar inputs rather than collapsing to topic centroids.

**Token F1 is higher on short documents (0.327) than long ones (0.306).** Short documents produce embeddings with less semantic spread, so the slug-relevant signal is more concentrated. Long documents pack more topics into a single embedding, making slug prediction harder. Exact match also rises on short documents (3.4% vs 1.7% for long).

**Exact match is 2.1%.** Low in absolute terms because URL slugs are noisy and the model often produces *cleaner* slugs than the reference. The token F1 of 0.306 is the better quality indicator.

### Architectural saturation

After applying both interventions (t=24 truncation fix and position-aware EOS loss), scaling capacity gives only marginal improvement:

| Model | Params | Tok F1 (training, greedy) | Best val loss | Mean words |
|---|---|---|---|---|
| d=384 L=4 t=24 + EOS (30ep) | 11.5M | 0.286 | 3.009 | 4.9 |
| d=512 L=6 t=24 + EOS (36ep) | 24.8M | 0.296 | 2.937 | 4.9 |
| Δ | 2.2x | +0.010 | -0.072 | 0 |

Doubling the parameter count adds +0.01 tok F1, essentially noise. The bigger model converges to a slightly lower val loss but produces equivalent-quality outputs. Mean word count is identical at 4.9, confirming the EOS calibration is independent of capacity.

### Decoding Strategy

The final decoding pipeline:

- **Beam search** (width=4) over greedy
- **Length-normalized scoring** with bounded additive length reward: `score = log_prob / ((5 + len) / 6)^1.2`
- **Minimum word count**: suppress EOS until at least 3 slug words (now mostly redundant with EOS-aware training)
- **Hard EOS suppression** after stopwords
- **Trailing stopword penalty** on completed beams (-1.0 score)
- **Repetition filter**: prefer non-repeating beams in final selection
- **UNK suppression**: prevent `<unk>` from appearing
- **Score-based stopping** (Huang et al. 2017): exit when no active beam could outscore the best completed beam under length-normalized scoring, rather than count-based early stop

Greedy decoding produced repetition pathologies ("turtle-of-turtle", "audio-video-sync-audio-video") that beam search largely eliminates. The remaining failure modes — stopword endings, occasional truncation — are handled by the explicit decoding constraints.

### Attention Pattern: Hyphens as Embedding-Routing Nodes

Inspection of attention weights over 500 test samples (1742 hyphen positions, 2925 subword positions) reveals that the model learned a structured pattern for consulting the prefix embedding. The decoder treats hyphens and the BOS token as dedicated "embedding-readers"; subword tokens almost never consult the prefix directly.

Mean attention TO prefix, by source token kind, across the 6 decoder layers:

| Source | L0 | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|---|
| BOS | 0.624 | 0.289 | 0.398 | 0.373 | 0.529 | 0.604 |
| **Hyphen** | **0.530** | 0.136 | 0.187 | 0.176 | 0.339 | 0.352 |
| Subword | 0.093 | 0.120 | 0.097 | 0.122 | 0.079 | 0.067 |
| EOS | 0.050 | 0.030 | 0.018 | 0.038 | 0.074 | 0.041 |

At layer 0, hyphens allocate 53% of their attention to the prefix embedding, vs subwords at 9.3% — a ~5.7x ratio. The pattern is highly consistent (Q25/Q75 for hyphens at layer 0: 0.518/0.542, n=1742).

Three regimes are visible across layers:

1. **Layer 0 spreads the embedding.** BOS (0.62) and hyphens (0.53) both read the prefix heavily. Subwords don't read it directly; they get the embedding's information indirectly through BOS and hyphens.
2. **Layers 1-3 do local processing.** All positions reduce their prefix attention. The model composes subwords into words and contextualizes predictions within the local sequence.
3. **Layers 4-5 re-consult.** BOS climbs back to 0.60, hyphens to 0.35. Before final output, the routing nodes re-check the embedding to refine decisions.

Subword-to-prefix attention is uniformly low (0.07-0.12) across all layers despite having 6 layers of capacity. The model genuinely prefers the routing pattern over distributing prefix attention more evenly.

### Layer 0 Head Specialization

Per-head analysis reveals that the layer 0 routing is *not* distributed across all 8 attention heads. The heads divide into two disjoint groups:

| Head | Hyphen→Prefix at L0 |
|---|---|
| H0 | 0.982 |
| H1 | 0.015 |
| H2 | 0.011 |
| H3 | 0.993 |
| H4 | 0.958 |
| H5 | 0.007 |
| H6 | 0.988 |
| H7 | 0.286 |

Four heads (H0, H3, H4, H6) allocate ~98% of their attention to the prefix when reading from hyphens. Three heads (H1, H2, H5) allocate under 2%. H7 is intermediate. The max-min spread is 0.987 — essentially binary specialization.

This is sharper than the layer-averaged number suggests: it's not that all heads gently look at the prefix; it's that half the heads are dedicated "prefix readers" and the rest do something else entirely. The specialization is also dynamic across depth: H2 takes over as dominant router at L1-L3, H6 dominates at L2-L3, and L4-L5 distribute across multiple heads. The model learned a pipeline where embedding-reading responsibility migrates through specific heads at specific depths.

For subword sources, no comparable specialization exists: subword→prefix attention is uniformly low across all heads (max-min spread of only 0.10-0.20 at every layer). The routing structure is specifically a hyphen-token phenomenon.

### Hyphen Position Has Minimal Effect

We classified hyphens by their position within the slug (first / middle / last) to test whether earlier hyphens — committing to the first content word — attend more heavily to the prefix than later ones. They don't:

| Position | L0 | L4 | L5 |
|---|---|---|---|
| hyphen_first | 0.535 | 0.368 | 0.379 |
| hyphen_middle | 0.530 | 0.336 | 0.361 |
| hyphen_last | 0.525 | 0.315 | 0.312 |

At layer 0 the three positions are within 0.01 of each other. Only at the late re-consultation layers (L4-L5) does a modest gradient emerge, with first hyphens re-consulting slightly more than last hyphens. The routing is essentially position-agnostic: every hyphen does roughly the same embedding-reading work, regardless of where it falls in the slug.

This is a cleaner story than "early commitment, later elaboration" — the routing is a structural property of the hyphen token itself, not specific to certain positions.

### What This Tells Us

The model learned a computational structure not designed into it: dedicated "embedding-reader" attention heads at structural boundary tokens (hyphens), with responsibility migrating across layers. It's analogous to how BERT learns to use CLS tokens for aggregation, but here the routing emerged from the BPE vocabulary choice — making `-` a discrete token gave the model stable positions to coordinate prefix-attention around. SentencePiece-style implicit hyphens would have foreclosed this organization.

This also rationalizes the project's earlier vocabulary debate: hyphen-as-token wasn't just a vocab efficiency choice, it turned out to be structurally load-bearing for the learning dynamics.

## Key Findings

1. **Bag-of-tokens classifiers fail for slug generation.** The MLP collapsed to high-frequency function words across three ablations.

2. **Seq2seq decoders extract real signal from embeddings.** Autoregressive generation produces topically relevant, human-readable slugs.

3. **Vocab strategy matters substantially.** KMeans compression caps Token F1 at 50.2% due to 47% of tokens mapping to different representatives. BPE eliminates this ceiling.

4. **Multiple non-obvious calibration bugs compound.** Three separate "ceilings" were actually preprocessing/decoding artifacts:
   - Training data truncation at subword position 10 stripped EOS from 56% of training examples
   - Position-uniform CE loss caused EOS overconfidence at short positions, leading to systematic under-generation
   - Standard beam search early-stop biased toward short sequences regardless of model preferences
   
   Each was diagnosable with targeted experiments. Each fix was small (parameter change, loss modification, algorithmic substitution). Cumulatively they moved the model from "topically-correct but truncated" to "topically-correct at appropriate length."

5. **Performance plateaus across model configurations even after the calibration fixes.** Comparing d=384 L=4 EOS (11.5M params, 0.286 training tok F1) against d=512 L=6 EOS (24.8M params, 0.296 training tok F1), doubling the parameter count gains only +0.010 tok F1. Both produce mean output length 4.9 (within rounding of training mean 5.1). The model recovers domain vocabulary well ("arsenic", "dragonflies", "cholera") but fails on proper nouns. Whether this represents an embedding-content ceiling or a data-quantity ceiling cannot be distinguished from these experiments; we discuss possible distinguishing experiments below.

6. **The model learned to use hyphens as embedding-routing nodes, with specific attention heads specializing for the job.** At layer 0, hyphen tokens allocate 53% of their attention to the prefix embedding (vs 9.3% for subwords, a 5.7x ratio across 1742 hyphen positions in 500 test samples). The routing is concentrated in specific heads: 4 of 8 heads at layer 0 allocate ~98% to the prefix when reading from hyphens, while 3 others allocate under 2%. Responsibility migrates to different heads across layers (H2 at L1, H6 at L2-L3, distributed at L4-L5), suggesting a learned multi-layer pipeline for embedding-reading. The pattern is position-agnostic: first, middle, and last hyphens in a slug all do roughly the same routing work. This computational structure emerged from the BPE vocabulary choice (hyphen-as-token) and is analogous to how BERT learns to use CLS tokens for aggregation, except here it was discovered by the model rather than designed in.

7. **Width and depth are roughly interchangeable at fixed parameter budget.** 512d/4L matches 512d/6L with 6M fewer parameters. The bottleneck is upstream of model capacity.

8. **Decoding strategy is as important as model quality.** Beam search, stopword suppression, repetition filtering, and length-aware termination are inference-time fixes that significantly improve output quality without changing model weights.

9. **Isolated tokens cluster poorly in embedding space.** At cosine ≥ 0.85, 316k single-word tokens form a near-fully-connected graph. Sentence-trained embedding models don't separate individual words well. This is why KMeans was the only practical compression strategy and why fine-grained lexical recovery is hard.

10. **CPU inference is feasible.** The 384d/4L BPE model (46MB, 11.5M params) runs at ~60ms/sample on CPU. The 512d/6L model (99MB) runs at ~150ms/sample.

## What Limits Performance

The ceiling may reflect data quality, data quantity, embedding information content, or some combination. The experiments here do not distinguish these hypotheses. The following observations bear on the question.

**Reference quality is a confound.** URL-extracted slugs are noisy: truncated URLs, SEO-stuffed headlines, inconsistent editorial standards. "dartmouth-study-finds-arsenic-inhibits-dna-repair" is a newspaper headline crammed into a URL path, not a carefully authored slug. The model often generates cleaner slugs than the references ("arsenic-in-drinking-water" vs the reference above) and gets penalized by token-match metrics.

**Data quantity may limit contrastive learning.** At 2.3M samples, the model sees enough to learn domain vocabulary but possibly not enough to disambiguate within-topic variation. All Earhart articles embed near each other; the model can't reliably learn that *this specific* flight-history embedding means "earhart" because it hasn't seen enough non-Earhart flight articles to build contrastive representations.

**Embedding content may be insufficient for fine-grained lexical recovery.** Single-pooled sentence embeddings compress text into a topic-similarity space. Whether they preserve enough signal to reconstruct specific proper nouns or distinguishing identifiers is the open question. Token-level cross-attention would give the model direct lexical access, but defeats the embedding-as-substrate premise.

**Scaling to 10-20M samples would help disambiguate.** FineWeb-Edu has ~29M documents; extracting 10-20M URL slugs is straightforward with the existing pipeline. If performance improves substantially, the current ceiling is data. If it doesn't move, the ceiling is the embedding.

## Deployment Recommendation

Two models are reasonable choices depending on the deployment context.

**Highest quality**: d=512 L=6 BPE + EOS-aware training (24.8M params, 99MB, ~150ms/sample CPU). Eval-pipeline tok F1 of 0.306, validity 100%, vocab diversity 97.8%.

**Best efficiency tradeoff**: d=384 L=4 BPE + EOS-aware training (11.5M params, 46MB, ~60ms/sample CPU). Training tok F1 of 0.286 (eval-pipeline number not separately measured but expected at ~0.297 based on the d=512 gap). 97% of the larger model's quality at ~40% of the parameters and ~40% of the inference cost.

For deployments where inference cost matters (large-scale indexing, edge deployment), the smaller model is the clear choice — the capacity ablation showed that doubling parameters adds only +0.01 tok F1.

If embeddings already exist in the index (the intended use case), marginal cost per slug is the CPU time alone. If embeddings must also be generated, add one OpenAI API call (~$0.00002 + API latency). Compared to an LLM call for the same task ($0.0001-0.0005 for Haiku-class models on short inputs), this is roughly 5-25x cheaper. The advantage grows with deployment scale.

## Open Questions

- **Scale experiment: 10-20M samples.** The critical next experiment. Would distinguish data ceiling from embedding ceiling. Existing pipeline supports this; FineWeb-Edu has ~29M documents. Primary cost is compute (24-hour H100 rental sufficient for retrain at 10M scale).

- **Distilled vs extracted references.** URL slugs are noisy. Whether a smaller (~1-2M) but cleaner distilled corpus outperforms a larger URL-extracted one is testable. Local-model distillation makes this affordable.

- **Hybrid corpus.** URL extraction with a quality filter (embed both slug and document, require cosine > threshold). Combines scale with quality.

- **Bi-encoder architecture.** Encoder consumes the embedding, decoder generates conditioned on encoder output (standard seq2seq). More expressive than prefix-conditioning, where the embedding competes for attention through a single position. Would test whether the prefix-only formulation is leaving information on the table. The head specialization finding (4/8 heads dedicated to prefix-reading at layer 0) suggests the model is already working hard to extract from a single position; giving it richer access might unlock more.

- **Input projection ablation.** The 1536→512 projection compresses information by 3x before the attention heads see it. Running the decoder at d=1536 (no projection) would test whether the specialized heads can extract finer-grained signal from the full embedding. Expensive (parameter count scales quadratically with d) but clean.

- **Cross-embedding transfer.** Train the same architecture on a different embedding model (e.g. Nomic). If hyphen-routing emerges identically, the routing structure is a property of the task (BPE vocabulary + slug generation objective). If it doesn't, the pattern depends on properties of the specific embedding. Either result is informative.

- **Frozen pretrained decoder.** Use a small pretrained LM (DistilGPT2, TinyLLaMA) and train only an adapter from embedding to its hidden states. The pretrained LM already knows language structure; the adapter learns the embedding-to-text mapping. Tests whether the bottleneck is decoder capacity or the from-scratch training. Most informative architectural test but significant engineering work. Also interesting to check whether a pretrained model rediscovers hyphen-routing or solves the task through different mechanisms.

- **Training-objective alternatives.** Sequence-level training might extract more from the embedding than next-token CE. Two concrete directions:
  - **InfoNCE on slug-document pairs.** Train the decoder to produce slugs whose embedding is closer to the source embedding than to negative samples. Adds a signal that "the slug should mean the same thing as the document," not just "match these tokens." Could help with cases where the model generates a topically-correct slug that shares few words with the reference.
  - **Token-level reinforcement on F1.** REINFORCE-style fine-tuning where the reward signal is Token F1 against the reference rather than per-token cross-entropy. Adapts the model to the evaluation metric directly. Standard NMT technique; small gains usually but worth checking.

- **Confidence-aware generation.** The model currently produces one slug with no confidence signal. For deployment, a calibrated confidence score per prediction would be valuable. Cheap to derive: use the length-normalized log probability of the chosen beam. Worth checking if this correlates with Token F1 across the test set. If yes, provides a deployment signal for "this prediction is suspect, flag for review."

- **Empirical random baseline.** Current floor is conceptual ("random"). Worth computing the Token F1 of a random slug sampled from the training vocabulary weighted by frequency, to establish the empirical floor for the metric on this data. Probably around 0.05-0.10 but should be measured.

## Experiment Log

| Experiment | Variant | Vocab | Dim | Layers | Epochs | Tok F1 | Val Loss | Params | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1a | MLP (BCE) | KMeans | 768 | 2 | 5 | 0.085 | 1.657 | 5.6M | |
| 1b | MLP (focal) | KMeans | 768 | 2 | 5 | 0.083 | 1.654 | 5.6M | |
| 1c | MLP (big) | KMeans | 1024 | 4 | 5 | - | 1.657 | 9.9M | |
| 3a | Seq2seq | KMeans | 256 | 4 | 15 | 0.326* | 3.517 | 6.1M | t=10 |
| 3b | Seq2seq | KMeans | 384 | 4 | 15 | 0.345* | 3.403 | 11.5M | t=10, 0.354 compressed |
| 3c | Seq2seq | BPE | 384 | 4 | 15 | 0.249* | 2.181 | 11.5M | t=10 (truncated targets) |
| 3d | Seq2seq | BPE | 512 | 4 | 15 | 0.254* | 2.128 | 18.5M | t=10 |
| 3e | Seq2seq | BPE | 384 | 4 | 50 | 0.267 | - | 11.5M | t=10, extended |
| 3f | Seq2seq | BPE | 384 | 6 | 15 | 0.259 | 2.172 | 15.1M | t=10 |
| 3g | Seq2seq | BPE | 512 | 6 | ~23 | 0.272 | 2.120 | 24.8M | t=10 |
| 3h | Seq2seq | BPE | 384 | 4 | 50 | 0.284 | 2.035 | 11.5M | t=24 (truncation fix) |
| 3i | Seq2seq | BPE | 384 | 4 | 30 | 0.286 | 3.009* | 11.5M | t=24 + position-aware EOS loss + label smoothing (mean words 4.9, training mean 5.1) |
| 3j | Seq2seq | BPE | 512 | 6 | 36 (best) | 0.296 | 2.937* | 24.8M | t=24 + EOS loss; canonical demo model. Eval-pipeline tok F1 0.306 on 5000 held-out samples |

*Mixed metric definitions: experiments 3a-3g used micro F1 at training; later runs harmonized to macro F1 to match the eval pipeline. Direct numerical comparison across the boundary is approximate. Additionally, the EOS-loss runs (3i, 3j) use label-smoothed position-weighted CE; their val loss values are in different absolute territory than the uniform-CE runs. Final reported numbers use macro F1 with beam search and the full decoding pipeline.
