---
name: capsule
description: Create or update a concept capsule — the conceptual anchor for a project or feature area. Use before writing code on a new project or feature, or when terms and boundaries feel unclear. Defines glossary, invariants, happy-path scenario, and non-goals.
argument-hint: "[project or feature area to define]"
---

# Concept Capsule

Create a **concept capsule** — a short, precise document that anchors all subsequent work to a shared vocabulary (ubiquitous language, DDD) and a set of constraints (design by contract).

The capsule is the durable semantic authority for a project or feature area.
It should change slowly after initial establishment.

## Authority boundary

Use the capsule for durable conceptual truths only:
- Glossary terms and boundaries
- Invariants/laws
- One concrete happy path
- Permanent non-goals

Do **not** use the capsule for:
- Phase status, candidate sequencing, or temporary deferments (milestone owns)
- Confidence tracking or uncertain hypotheses (assumptions ledger owns)
- Decision history with rationale/evidence chronology (roadmap/decisions own)

## Input

The project or feature area: $ARGUMENTS

If the user hasn't described the domain clearly enough, interview them:
1. What is this thing? (one sentence)
2. What are the key concepts / nouns / entities?
3. What rules must always hold? (invariants)
4. What is the simplest thing it should do? (happy path)
5. What should it explicitly *not* do? (non-goals)

## Output: The Capsule

Write a document with exactly these four sections. Keep it to **one screen** (~250-500 words). Each bullet should be **one sentence**.

### 1. Glossary (Ubiquitous Language)

5-15 domain terms with their **exact intended meanings** in this project. These are the names that must appear in code — types, functions, modules, test suites.

Format:
```
- **Term**: Definition (one sentence)
```

- If two terms could be confused, clarify the boundary
- Every term should eventually have a code home (type, module, function, or test suite)
- If you need more than ~15 terms, split into project capsule + feature capsule(s)

### 2. Invariants / Laws

3-10 statements that **must always be true**. Constraints, not features.

Format:
```
- An X must always have a Y
- X can never be Z while W is true
```

- Each invariant should be testable
- Decide where each lives: type system (best), constructor/validator (good), or tests (minimum)
- If an invariant can't be stated clearly, the concept isn't understood yet — stop and clarify

### 3. Happy Path (one scenario)

A single concrete **input → output** story. This becomes the first integration test.

Format:
```
Given: [concrete starting state]
When: [concrete action]
Then: [concrete observable result]
```

Must be specific ("Given a file `post.md` with front-matter...", not "Given some input...").

### 4. Non-Goals (exactly two)

Two things this project or feature **explicitly will not do**. These prevent scope creep and stop the agent from "helpfully" adding features.

Format:
```
- This will NOT do X (because Y)
- This will NOT do Z (because W)
```

These are deliberate exclusions, not "not yet" items.

## Capsule change policy

Update a capsule when one of these is true:
- A glossary term is ambiguous, conflicting, or missing
- An invariant is proven wrong, incomplete, or unverifiable
- The happy path no longer reflects the first integration scenario
- A non-goal is no longer a durable exclusion

Do not append changelogs, progress logs, milestone status, or decision journals
inside the capsule.

When an assumption stabilizes into a durable law, promote it from
`docs/assumptions.md` into capsule invariants and track enforcement via
`/pragma:contract`.

## Where to put it

- `docs/capsule.md` for project-level
- `docs/capsule-<feature>.md` for feature-level
- If a capsule already exists, update it — don't create a second one

## Validation

After writing, check:
1. Can every glossary term map to a code construct?
2. Can every invariant be tested?
3. Is the happy path specific enough to be an integration test?
4. Do the non-goals clearly exclude something the agent might otherwise build?
5. Does the document avoid milestone status, assumption confidence, and
   historical decision logs?

If any check fails, revise before proceeding.

## Lifecycle tail (required)

Append to the response:

- **State**: `foundation`
- **Next**: `/pragma:skeleton`
- **Loop**: `/pragma:consult` (default unless user explicitly continues directly)
