# vec2slug: Research Findings

## Summary

This project investigates whether single pooled sentence embeddings can drive slug generation without re-feeding source text through a language model. The slug task is the concrete vehicle; the general claim is that embeddings serve as a reusable substrate for cheap auxiliary outputs.

A multi-label classifier (MLP) over KMeans-compressed vocabulary collapsed to high-frequency function words across three ablations, reaching 0.07 to 0.08 Token F1. The architecture predicts tokens independently and cannot model co-occurrence or sequence structure; the failure is fundamental, not a training deficiency.

A prefix-conditioned transformer decoder over BPE-tokenized slugs reached 0.306 Token F1 on 5,000 held-out test samples after four targeted interventions: vocabulary redesign (KMeans to BPE), training-data truncation correction (max length 10 to 24), EOS calibration via position-aware loss weighting, and length-aware beam search termination. Each intervention addressed a specific diagnosed failure mode. The model produces slugs at training-distribution length (mean 4.9 words against a reference mean of 5.1) and runs in 115ms on a budget VPS. Scaling from 11.5M to 24.8M parameters adds only +0.008 Token F1, a difference that does not exceed the ±0.008 95% confidence interval.

## Corpus

Two corpora were prepared.

**Feasibility corpus (10k).** 10,000 samples from FineWeb-Edu (50%), arXiv (25%), and GitHub issues (25%). Slugs distilled via the Anthropic Haiku batch API at temperature 0 (98.3% valid). The distillation cost of $5.25 per 10,000 documents does not scale to larger corpora.

**URL corpus (2.3M).** 2,298,564 samples from FineWeb-Edu with slugs extracted from source URLs. The extraction pipeline filters on language (fasttext), slug format (kebab-case regex, length, numeric density, stopword ratio), Gopher repetition, and token count (50 to 1,000 tokens). Slug extraction drops 62% of documents; the remaining filters account for a further 37%. The resulting slugs are noisy (truncated URLs, SEO-stuffed headlines, inconsistent editorial standards) but available at zero labeling cost.

All downstream training and evaluation uses the URL corpus.

## Vocabulary

The URL corpus contains 315,929 unique slug tokens, 62% hapax legomena. Two compression strategies were evaluated.

### KMeans compression (5,000 clusters)

Three graph-based approaches failed. At cosine similarity 0.85, single-word tokens form a near-fully-connected graph (316k nodes, 251M edges, approximately 800 neighbors per token). Embedding models trained on full sentences do not separate individual words well in vector space; cosine thresholding, Louvain community detection, and HDBSCAN all degenerate. KMeans does not require pairwise similarity to be meaningful, only distance from centroids. At k=5,000 it compresses the vocabulary 63x.

The compression is lossy: 47.2% of reference slug tokens map to a different representative after quantization. A perfect model over this vocabulary can reach at most 50.2% raw Token F1. The KMeans seq2seq model achieved 70% of this ceiling (0.197 eval-pipeline Token F1), confirming that the model extracts most of the available signal given the vocabulary constraint.

### BPE tokenizer (5,000 subwords)

Byte-pair encoding trained on the slug corpus with `-` as a special token. The pre-tokenizer splits on hyphens so BPE learns subword units within slug words, never merging across word boundaries. Average encoded length: 11.7 subwords per slug. Reconstruction is lossless: any slug roundtrips perfectly through encode and decode. The tradeoff is that BPE outputs are ordered subword sequences, requiring autoregressive decoding.

## Variant 1: MLP multi-label classifier

Architecture: embedding (1536d) projected through a 2-layer MLP to sigmoid activations over 5,000 KMeans cluster tokens, with a separate length head.

| Experiment | Loss | Params | Tok F1 |
|------------|------|--------|--------|
| 1a | BCE | 5.6M | 0.071 |
| 1b | Focal (gamma=2) | 5.6M | 0.082 |
| 1c | BCE, 4L/1024h | 9.8M | 0.068 |

All three ablations converge to the same regime. The model collapses to predicting high-frequency tokens regardless of input: `of-the-in` (27,439 times across 229k test predictions), `of-the-a` (19,780 times). BCE loss rewards predicting common tokens when 4,995 of 5,000 outputs should be zero; the gradient landscape favors the common-token equilibrium. Vocab diversity drops to 1.6% in the worst case (80 unique slugs across 5,000 test samples).

The failure is architectural. Bag-of-tokens prediction treats each output as independent and cannot model the joint distribution over slug tokens. Neither loss function changes nor capacity increases alter this.

## Variant 3: Seq2seq transformer decoder

Architecture: embedding (1536d) linearly projected to the decoder's hidden dimension, placed as a prefix token at position 0. A standard causal transformer decoder autoregressively generates slug tokens, each attending to the prefix (global context from the embedding) and all previous outputs (local context from the generated sequence).

Four interventions, each motivated by a diagnosed failure mode, progressively improved both quantitative metrics and qualitative outputs.

### Intervention 1: KMeans to BPE vocabulary

The KMeans seq2seq captured topic but could not produce specific lexical content. For an article about Amelia Earhart, the model predicted `anne-essex-fly`: `amelia` mapped to `anne` (female-names cluster), `earhart` mapped to `harry` (surnames cluster), and `fly` was the aviation-cluster representative. The model recovered the correct semantic neighborhoods but the vocabulary compression destroyed the lexical signal.

BPE eliminated this ceiling. The same architecture generated `emma-j-amelia-ear` for the Earhart article, recovering "amelia" and the start of "earhart" through subword composition. The eval-pipeline gain was +0.072 Token F1 (KMeans seq2seq 0.197 to BPE seq2seq 0.269).

### Intervention 2: Training-data truncation correction

Initial BPE experiments inherited `max_slug_tokens=10` from the KMeans configuration. With BPE-encoded sequences averaging 11.7 subwords, this truncated 56.1% of training targets at the subword level and stripped the EOS token from those examples. The model learned that sequences terminate without a termination signal, skewing EOS prediction toward the positions where it was present (after 2 to 3 words).

The BPE length distribution drops steeply: 85% of slugs fit in 16 subwords, 97% in 20, 99.4% in 24. Setting `max_slug_tokens=24` (filtering 0.6% of slugs that exceed it) improved Token F1 by +0.018 (0.269 to 0.290, comparing matched configurations at d=384 L=4). Mid-word truncations disappeared: `facts-about-blood-don` became `facts-about-blood-donation`.

### Intervention 3: EOS calibration via position-aware loss

After the truncation correction, the model still under-generated relative to the training distribution: predictions averaged 3.6 words against a training mean of 5.1.

Three diagnostic experiments isolated the cause. Beam width sweeps (4, 8, 16) produced identical length distributions: the bias was not a search artifact. Length penalty sweeps had no effect on output length: the model's EOS confidence dominated any penalty. Forcing one additional word improved Token F1 by +0.012; forcing two dropped it back. The model had useful content available at position 4 but terminated prematurely.

The hypothesis: under standard cross-entropy with teacher forcing, EOS at common positions (subword position 5 to 7) receives more gradient signal than EOS at rare positions (position 15 to 20). The model becomes overconfident about early termination.

The correction combines label smoothing (0.1) with position-aware EOS loss weighting. For each position, the EOS loss weight is `min(1.0, median_rate / position_rate)`. Over-represented EOS positions are dampened; rare positions stay at weight 1.0. The ceiling at 1.0 prevents the dual error of amplifying EOS at rare positions.

Mean predicted word count shifted from 3.6 to 4.9 (training mean 5.1). The aggregate Token F1 gain was marginal (+0.008), but this intervention was foundational: it enabled the compound improvement from the larger model and length-aware beam search, which together produced +0.022 Token F1.

### Intervention 4: Length-aware beam search termination

Standard beam search fills its completion pool with the first k sequences that emit EOS, biasing toward short sequences. Shorter sequences hit EOS sooner, fill the pool first, and prevent longer alternatives from developing.

The correction implements score-based stopping (Huang et al. 2017): the algorithm continues as long as any active beam could plausibly outscore the best completed beam under length-normalized scoring. Future log-probability increments are bounded above by 0, and the length reward is capped, so the upper bound is tight. In practice this runs at approximately 1.6x the cost of standard early stopping and recovers the full length distribution.

### Experiment log

| Exp | Vocab | Dim | Layers | Epochs | Tok F1 | Params | Notes |
|-----|-------|-----|--------|--------|--------|--------|-------|
| 1a | KMeans | 768 | 2 | 5 | 0.071 | 5.6M | MLP, BCE |
| 1b | KMeans | 768 | 2 | 5 | 0.082 | 5.6M | MLP, focal |
| 1c | KMeans | 1024 | 4 | 5 | 0.068 | 9.8M | MLP, bigger |
| 3a | KMeans | 256 | 4 | 15 | 0.189 | 6.1M | Seq2seq |
| 3b | KMeans | 384 | 4 | 15 | 0.197 | 11.5M | Seq2seq |
| 3d | BPE | 512 | 4 | 15 | 0.269 | 18.5M | t=10 |
| 3e | BPE | 384 | 4 | 50 | 0.267 | 11.5M | t=10 |
| 3f | BPE | 384 | 6 | 15 | 0.259 | 15.1M | t=10 |
| 3g | BPE | 512 | 6 | 23 | 0.272 | 24.8M | t=10 |
| 3h | BPE | 384 | 4 | 50 | 0.290 | 11.5M | t=24 |
| 3i | BPE | 384 | 4 | 30 | 0.298 | 11.5M | t=24 + EOS (smaller canonical) |
| 3j | BPE | 512 | 6 | 36 | **0.306** | 24.8M | t=24 + EOS (canonical) |

All Token F1 values are eval-pipeline macro F1 with beam search (width=4) and the full decoding pipeline, scored on 5,000 held-out test samples. At this sample size, the 95% confidence interval on Token F1 is approximately ±0.008.

### Full evaluation of the canonical model

Experiment 3j: BPE vocabulary, d=512, L=6, t=24, position-aware EOS loss, beam search with length-aware termination.

```
Validity:            100.0%
Exact match:           2.1%
Token P / R / F1:    0.335 / 0.299 / 0.306
ROUGE-1 / L:         0.304 / 0.284
BERTScore P / R / F1: 0.879 / 0.865 / 0.872
Distinctiveness:     0.885
Vocab diversity:      97.8% (4,888 unique slugs in 5,000 samples)
```

Per length bucket (document token count):

```
short   (n=495,  avg 151 tok)  exact=3.4%  tok_f1=0.327  rouge_l=0.306  distinct=0.898
medium  (n=2041, avg 345 tok)  exact=2.2%  tok_f1=0.300  rouge_l=0.278  distinct=0.887
long    (n=2462, avg 720 tok)  exact=1.7%  tok_f1=0.306  rouge_l=0.284  distinct=0.882
```

Token F1 is higher on short documents (0.327 vs 0.306 for long). Short documents produce embeddings with less semantic spread, concentrating slug-relevant signal. Exact match is low in absolute terms (2.1%) because URL slugs are noisy and the model often produces cleaner slugs than the reference.

### Architectural saturation

| Model | Params | Tok F1 |
|-------|--------|--------|
| d=384 L=4 t=24 + EOS | 11.5M | 0.298 |
| d=512 L=6 t=24 + EOS | 24.8M | 0.306 |

Doubling the parameter count adds +0.008 Token F1, which falls within the ±0.008 95% confidence interval on 5,000 test samples. Both models converge to mean output length 4.9. By comparison, the truncation correction alone (a data fix, not a model change) gained +0.018, and the KMeans-to-BPE vocabulary switch gained +0.072. Within this experiment, parameter scaling did not produce a statistically convincing gain; data quality, data scale, and embedding information content remain more likely next levers than model capacity.

### Decoding pipeline

The final decoding configuration:

- Beam search (width=4) with bounded additive length reward: `score = log_prob + r × min(word_count, B)` where `r = 1.5`, `B = 6` (reference P75 word count)
- Score-based stopping (Huang et al. 2017) rather than count-based early stop
- Hard EOS suppression after stopwords
- Trailing stopword penalty on completed beams (-1.0)
- Repetition filter in final beam selection
- UNK suppression
- Minimum 3 subword tokens and 3 slug words before EOS is permitted

Greedy decoding produced repetition pathologies (`turtle-of-turtle`, `audio-video-sync-audio-video`) that beam search eliminates. The remaining constraints handle edge cases in the output distribution.

## Attention structure

To introspect the model's use of global and local context, we recorded attention weights across 500 test samples using teacher-forced forward passes conditioned on the model's own predicted output tokens. For each token position in each layer, we measured the fraction of attention allocated to the prefix embedding.

### Hyphen-routing

The central finding is that hyphens serve as dedicated embedding readers. At layer 1, hyphen tokens allocate 53% of their attention to the prefix; subword tokens allocate 9.3%, a 5.7x ratio. The effect is consistent: across 1,742 hyphen positions, the interquartile range spans 0.518 to 0.542.

Mean attention to the prefix, by source token kind:

| Source | L1 | L2 | L3 | L4 | L5 | L6 |
|--------|------|------|------|------|------|------|
| BOS | 0.624 | 0.289 | 0.398 | 0.373 | 0.529 | 0.604 |
| Hyphen | 0.530 | 0.136 | 0.187 | 0.176 | 0.339 | 0.352 |
| Subword | 0.093 | 0.120 | 0.097 | 0.122 | 0.079 | 0.067 |
| EOS | 0.050 | 0.030 | 0.018 | 0.038 | 0.074 | 0.041 |

Three regimes are visible across layers. Layer 1 spreads the embedding: BOS (0.62) and hyphens (0.53) both read the prefix heavily; subwords receive the embedding's information indirectly. Layers 2 through 4 perform local processing: all positions reduce prefix attention as the model composes subwords into words. Layers 5 and 6 re-consult: BOS climbs back to 0.60 and hyphens to 0.35 before final predictions. Subword-to-prefix attention remains below 12% across all layers.

### Head specialization at layer 1

The layer-averaged 53% masks near-binary specialization across heads. Four of eight heads (H0, H3, H4, H6) allocate 96 to 99% of their attention from hyphens to the prefix. Three heads (H1, H2, H5) allocate under 2%. H7 sits at 29%. The max-min spread is 0.987.

| H0 | H1 | H2 | H3 | H4 | H5 | H6 | H7 |
|----|----|----|----|----|----|----|-----|
| 0.982 | 0.015 | 0.011 | 0.993 | 0.958 | 0.007 | 0.988 | 0.286 |

The specialization migrates across depth: H2 becomes the dominant router at layers 2 through 4, different heads take over at layers 5 and 6. The embedding-reading responsibility passes through specific heads at specific layers. For subword sources, no comparable specialization exists: subword-to-prefix attention is uniformly low across all heads (max-min spread of 0.10 to 0.20 at every layer). The routing is specifically a hyphen-token phenomenon.

### Position independence

Hyphens classified by position within the slug (first, middle, last) show no meaningful position effect. At layer 1, the three classes fall within 1% of each other (0.535, 0.530, 0.525). Only at the late re-consultation layers does a modest gradient emerge. The routing is a structural property of the hyphen token, not a function of sequence position.

### Implications

The routing structure emerged from training without architectural instruction. The BPE vocabulary preserves `-` as a discrete token at every word boundary, giving the model stable structural anchors. The model organized its entire attention pattern around them. A SentencePiece-style encoding, which merges hyphens into surrounding subwords, would likely foreclose this organization.

## Findings

1. **Bag-of-tokens classifiers fail for slug generation.** The MLP collapsed to high-frequency function words across three ablations. The failure is architectural: independent token prediction cannot model the joint distribution required for slug composition.

2. **Autoregressive decoders extract structured content from embeddings.** The seq2seq model produces topically relevant, human-readable slugs with 100% structural validity and 97%+ vocab diversity.

3. **Vocabulary strategy imposes a hard ceiling.** KMeans compression maps 47% of reference tokens to a different representative, capping Token F1 at 50.2%. BPE eliminates this ceiling through lossless reconstruction, gaining +0.072 Token F1. The choice of output vocabulary was the single largest source of quality improvement.

4. **Three separate calibration artifacts compounded.** Training-data truncation at subword position 10 stripped EOS from 56% of examples. Position-uniform cross-entropy caused EOS overconfidence at short positions. Standard beam search early-stop biased toward short sequences. Each was diagnosable with targeted experiments. Each fix was small (a parameter change, a loss modification, an algorithmic substitution). Cumulatively they moved the model from "topically correct but truncated" to "topically correct at appropriate length."

5. **Parameter scaling did not produce statistically convincing gains.** Within each regime, parameter scaling accounts for at most +0.013 Token F1 (2.2x parameter increase), which does not exceed the ±0.008 confidence interval. Every clearly significant improvement corresponds to a regime change, not a capacity increase. Data quality, data scale, and embedding information content are more likely bottlenecks, though the current experiments do not conclusively rule out model capacity.

6. **Hyphens serve as learned embedding-routing nodes.** Four of eight attention heads at layer 1 allocate 96 to 99% of their attention from hyphens to the prefix embedding. The specialization migrates across layers. The routing is position-independent and emerged from the BPE vocabulary choice of preserving `-` as a discrete token.

7. **Decoding strategy matters as much as model quality.** Beam search, stopword suppression, repetition filtering, and length-aware termination are inference-time corrections that significantly improve output quality without changing model weights.

## What limits performance

The ceiling may reflect data quality, data quantity, embedding information content, or some combination. The current experiments do not distinguish these hypotheses.

**Reference quality is a confound.** URL-extracted slugs are noisy. The model often generates cleaner slugs than the references (`arsenic-in-drinking-water` vs the reference `dartmouth-study-finds-arsenic-inhibits-dna-repair`) and is penalized by token-match metrics. A cleaner reference set would likely raise measured performance without the model changing.

**Data quantity may limit contrastive learning.** At 2.3M samples, the model learns domain vocabulary but may lack sufficient within-topic variation for fine-grained disambiguation. All Earhart articles embed near each other; the model cannot reliably learn that a specific flight-history embedding means "earhart" without enough non-Earhart flight articles to build contrastive representations.

**Embedding content may be insufficient for fine-grained lexical recovery.** Single-pooled sentence embeddings compress text into a topic-similarity space. Whether they preserve enough signal to reconstruct specific proper nouns is the open question. Token-level cross-attention would provide direct lexical access but defeats the embedding-as-substrate premise.

## Open questions

**Data scale.** Scaling to 10 to 20M samples would disambiguate data quantity from embedding content as the limiting factor. FineWeb-Edu contains approximately 1.59B documents; 10 to 20M URL slugs are straightforward to extract with the existing pipeline. If performance improves substantially, the current ceiling is data. If it does not, the ceiling is the embedding.

**Data quality.** Whether a smaller but cleaner distilled corpus outperforms a larger URL-extracted one is testable. Local-model distillation (via a self-hosted model or a reranker scoring slug-content alignment) makes this affordable.

**Input projection ablation.** The 1536-to-512 projection compresses information 3x before the attention heads see it. Running the decoder at full embedding dimension would test whether the projection discards recoverable signal. Parameter count scales quadratically with hidden dimension.

**Cross-attention architecture.** The current model uses prefix-conditioning, where the embedding occupies a single token position. A standard encoder-decoder architecture where the decoder cross-attends to an encoded representation would test whether the single-position formulation is itself a bottleneck.

**Frozen pretrained decoder.** A small pretrained LM (DistilGPT2, TinyLLaMA) with a trained embedding-to-soft-prompt projector would test whether an existing language prior improves slug quality over learning from scratch. Whether such a model rediscovers hyphen-routing or solves the task through different mechanisms is itself informative.

**Cross-embedding transfer.** Training the same architecture on a different embedding model (Nomic, Cohere) would determine whether hyphen-routing is a property of the task (BPE vocabulary + slug generation objective) or a property of the specific embedding model.

**Sequence-level training.** Next-token cross-entropy optimizes per-token accuracy, not slug-level quality. Two directions are concrete: InfoNCE on slug-document embedding pairs (aligning slug meaning with document meaning) and REINFORCE on Token F1 (adapting the model to the evaluation metric directly).

## Deployment

Two models are available.

| | d=384 L=4 | d=512 L=6 |
|---|---|---|
| Parameters | 11.5M | 24.8M |
| Size | 46 MiB | 99 MiB |
| Tok F1 | 0.298 | 0.306 |
| CPU inference (VPS) | ~115ms | ~258ms |
| CPU inference (M-series) | ~27ms | ~66ms |

The smaller model is recommended for most deployments. The capacity ablation confirms that doubling parameters adds negligible quality (+0.008 Token F1) at 2.2x the inference cost.

If embeddings already exist in the system (the intended use case), marginal cost per slug is CPU time alone. If embeddings must be generated, add one API call (~$0.000011 for OpenAI text-embedding-3-small on a 566-token document). Compared to a Haiku-class LLM call for the same task ($0.00103 average), the model is approximately 85x cheaper and 14x faster. The advantage scales with deployment volume.

An ONNX export of the smaller model (44 MiB) runs in-browser via WebAssembly with JavaScript beam search. No server, no API call. The browser demo is at [hash.dev/blog/vec2slug](https://hash.dev/blog/vec2slug).
