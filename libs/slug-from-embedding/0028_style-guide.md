# Blog Post Style Guide: Slug from Embedding

Derived from the master's thesis style guide (notion/docs/style-guide.md). Same core discipline, loosened for a first-person research narrative aimed at a technical blog audience.

---

## Voice in One Sentence

Direct, technically precise, first-person research narrative that names objects, compares alternatives by what they preserve or break, and closes with consequences rather than summaries.

---

## Two Gears

The post shifts between two registers. The shift should feel natural: discovery voice sets up *why* something matters; exposition voice explains *how* it works.

1. **Discovery voice** (motivation, framing, what went wrong, what we tried next): first-person singular, direct, opinionated. Allowed to be brief, allowed to have rhythm. "I spent a weekend testing whether it could." "The model collapsed."

2. **Exposition voice** (how an architecture works, what a loss function does, what the numbers mean): closer to the thesis register. Object-centered subjects, mechanism over narrative, precise. "Position-aware loss weighting dampens the EOS gradient at over-represented positions, shifting mean output length from 3.6 to 4.9 words."

---

## What Transfers from the Thesis

### Sentence structure
- **Claim first, modifiers after.** The point comes first.
- **Contrastive framing.** The post is full of comparisons (KMeans vs BPE, MLP vs seq2seq, before vs after each intervention). Use "unlike," "by contrast," "where X fails, Y succeeds."
- **Counted decompositions.** "The model hit three separate ceilings, each an artifact of the pipeline rather than a fundamental limit."
- **Occasional short verdict sentences** after dense buildup. "The similarity is superficial." "The model collapsed."

### Paragraph architecture
- **Object → mechanism → consequence.** Open with what something is, develop with specifics, close with what it means.
- **Closers decide, not recapitulate.** End with a consequence, property, or forward pointer. Never restate the opening.
- **Openers classify or assert.** Name the object or tension. Never "In this section we will discuss..."

### Comparison and decision-making
- **Judge alternatives by properties lost or preserved.** KMeans loses 47% of tokens. BPE preserves lossless roundtrip. Don't say KMeans is "worse"; say what breaks.
- **Enumerate → diagnose → choose.** When presenting approaches, give each a failure mode, then commit.
- **No vague trade-off endings.** Not "each has pros and cons." Evaluate, then decide.

### Technical terms
- **Inline definition on first use, paired with operational consequence.** "BPE (byte-pair encoding trained on the slug corpus with `-` as a special token) eliminates the compression ceiling: any slug can be perfectly roundtripped."
- **Don't define in isolation.** State why it matters immediately.
- **Lexical stability.** If the term is "intervention," don't vary to "fix," "improvement," "tweak" unless the distinction is real.
- **First use of a metric gets a gloss.** Even common metrics (F1, ROUGE, BERTScore) deserve a parenthetical on first appearance. Not every reader trains models; some are engineers who use embeddings but haven't evaluated them. After the first definition, use the term freely.

### Tone
- **Confident through mechanism.** Sound confident because you explain *why*. "The MLP collapses because BCE loss with 4,995 negative targets per sample rewards predicting common tokens." Not: "Our powerful model dramatically outperforms the baseline."
- **Honest about limits.** 0.306 tok F1 is not state-of-the-art anything. Say what the ceiling is. Say what you don't know.

---

## What Loosens for the Blog

### Register
- **Contractions are fine.** "It's," "can't," "doesn't." Not a thesis.
- **First person singular for research decisions.** "I" not "we" for the personal research journey. "We" only for HASH context.
- **Short sentences for emphasis.** The thesis avoids fragmentation. The blog can use a short sentence after a long one for punch.

### Paragraph shape
- Paragraphs can be 2-4 sentences when making a single sharp point.
- A one-sentence paragraph is allowed occasionally for emphasis. Not habitually.
- Transitions can be implicit when the logic is obvious. Don't over-connect.

### What drops entirely
- No citations or cross-references (no `@sec:`, no `@fig:`). Use links and inline references.
- No formal definitions, equations, or algorithm displays. Explain in prose; use code blocks for concrete examples.
- No architecture-vs-implementation-status separation. The blog presents what exists.
- No "this work" or "the current implementation" phrasing.

---

## Transitions

### Use
- Logical connectives that carry weight: "because," "consequently," "the fix was," "this ruled out."
- Contrastive: "but," "unlike," "where X failed."
- Forward pointers in discovery sections: "the next question was," "that explained the length, but not the quality."

### Never use
- "This is the story of what happened in between."
- "Let's dive into..." / "Now let's look at..."
- "Interestingly, ..." / "It's worth noting that..."
- Any transition that could be deleted without losing information.

---

## Code and Data

- Code snippets are short and illustrative. Link to the repo for full implementation.
- Tables for metrics. Not prose descriptions of numbers.
- When showing model output: always show input context, reference slug, prediction. The reader needs all three to judge quality.

---

## Anti-Patterns

### From thesis guide (still apply)
- No hype language: "powerful," "robust," "novel," "revolutionary," "cutting-edge," "seamless"
- No generic filler: "it is important to note," "in today's rapidly evolving landscape"
- No em dashes or en dashes. Use colons, semicolons, periods, parentheses, or "to" for ranges. No exceptions.
- No LLM-speak: no participial connectors ("enabling X"), no stacked adjectives, no "bridge the gap," no "not only X but also Y"
- No rhetorical questions: "But how can this be achieved?"
- No wishy-washy hedging on decided matters
- No LLM balance patterns: "on the one hand..., on the other hand..."
- No paragraph endings that repeat the opening
- No varying core terminology for style
- No structure narration: "In the next section, we will..."

### Blog-specific additions
- No apologizing for the topic ("the title might sound boring")
- No performing excitement ("this is where it gets really interesting!")
- No over-explaining concepts the audience knows (embeddings, transformers, loss functions). Define project-specific terms, not general ML vocabulary.
- No uniform paragraph length or cadence. Vary the rhythm.
- No generic narrative wrapping ("this is the story of...")

---

## Distilled Rules

1. Precise before elegant.
2. Show the reasoning, not just the result.
3. Consequence-driven: every paragraph earns its place by moving the argument forward.
4. Contrastive framing for the post's many comparisons.
5. Discovery voice for the journey, exposition voice for the mechanism.
6. Judge alternatives by what they preserve or break, not by vague preference.
7. Confident through mechanism, never through inflation.
8. Honest about what worked, what didn't, and what remains unknown.
9. Lexically stable: don't vary terms for style.
10. No dead transitions. If it can be deleted without losing information, delete it.
