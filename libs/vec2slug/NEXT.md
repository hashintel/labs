# Next Steps

Status: embeddings for the 2.3M URL corpus are being generated via OpenRouter
(~7h overnight run with checkpointing). Once complete, the full pipeline
resumes from step 2.

## Immediate (once embeddings land)

1. **Split the URL corpus**: `slug-split all` with `SLUG_CORPUS` set.
   KMeans clustering on 2.3M samples will need more clusters than the
   original 200. Use `sqrt(n)` heuristic (~1500 clusters) or make it
   automatic in split_dataset.py.

2. **Re-train MLP on URL corpus**: `slug-train-mlp --encoder openai --overwrite`.
   With 2.3M samples the vocab will be ~370k tokens. The MLP output layer
   alone would be ~570M params (370k × 1536), which is too large. This is
   where vocab compression becomes necessary.

3. **Vocab compression**: embed each slug token (using the same encoder),
   cluster nearby tokens (morphological variants, synonyms), replace with
   cluster representatives. Target: reduce 370k vocab to 3-5k clusters.
   This is the idea Bilal proposed: use the embedding space itself to
   compress the vocabulary.

## After first URL corpus results

4. **Evaluate all three MLP ordering variants**: score, position, pairwise.
   Compare against the Haiku ceiling (which only exists for the 10k corpus;
   may need a small Haiku run on a URL corpus sample for comparison).

5. **Train Variant 3: from-scratch seq2seq**. 4-layer transformer decoder,
   ~5-20M params. Predicts slug tokens autoregressively from the embedding.
   Uses the same (compressed) vocabulary. Tests whether ordering information
   is recoverable from embeddings.

6. **Train Variant 2: frozen LM with trained projector**. Embedding → MLP
   projector → soft tokens → frozen decoder (Qwen3-0.6B-Base or SmolLM2-360M).
   Only the projector trains (~1-5M params). Tests whether a pretrained
   language model can decode slugs from embedding-derived soft prompts.

## Analysis & reporting

7. **Failure exemplar tool** (`slug-analyze` or similar): worst/best/disagreement
   samples from detail parquets. Helps understand what the model gets wrong.

8. **Cross-variant disagreement analysis**: reads multiple detail parquets,
   finds samples where variants disagree. Surfaces what each architecture
   captures vs misses.

9. **Salience probes**: leave-one-token-out from the encoder input, measure
   cosine shift in embedding + slug change. Tests which parts of the source
   text the embedding encodes that matter for slug generation.

## Infrastructure improvements

10. **Post-filtering for URL corpus**: the stricter regex and stopword filters
    are now in SlugExtractFilter but the current data was fetched with the old
    rules. The merge step applies frequency filtering. If we re-fetch, the
    pipeline filters are already correct.

11. **Paragraph truncation for long documents**: 1.09M documents were dropped
    for exceeding 1000 tokens. Truncating at paragraph boundaries instead of
    discarding would push the corpus from 2.3M to ~3.5M. Lever for later.

12. **Config class refactor**: the loose constants in config.py are accumulating.
    A proper config class that derives all paths from the corpus would be
    cleaner. Not blocking but worth doing before adding more variants.
