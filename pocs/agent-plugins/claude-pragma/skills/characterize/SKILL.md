---
name: characterize
description: Create characterization tests (Golden Master) for existing code so you can refactor or replace safely. Use before refactoring, strangler-replacing, or modifying code with unclear behavior. Captures observable behavior with a minimal harness, producing tests, fixtures, and a coverage report.
argument-hint: "[subsystem / entrypoint / behavior surface to lock down]"
---

# Characterization Tests (Golden Master / Feathers)

Create **characterization tests** for an existing subsystem whose behavior is unclear, messy, or AI-generated. Pin down current observable behavior so that refactoring and incremental replacement are safe.

## Input

Subsystem / entrypoint / behavior surface to lock down: $ARGUMENTS

**Preconditions**:
- At least one runnable entry point (function, CLI command, server route, etc.)
- A concept capsule is NOT required, but use its vocabulary if one exists

## Procedure

### 1. Identify the behavior surface

List 1-3 surfaces to lock down: public functions, CLI commands, HTTP endpoints, file-in→file-out, serialized outputs. Prefer the most stable public surface available.

### 2. Minimal fixture set

- One canonical happy path
- 1-3 meaningful edge cases
- One "weird but real" case you suspect is fragile

Keep it small — a suite that's too big becomes unmaintainable.

### 3. Stabilize nondeterminism

Before capturing outputs, neutralize noise sources:
- **Timestamps**: freeze time
- **Randomness**: seed or stub
- **Ordering**: sort keys, canonicalize arrays where order is not meaningful
- **OS-dependent paths/newlines**: normalize
- **Network calls**: stub/record once — do not hit live services
- **Concurrency**: force single-threaded if needed for determinism

If behavior is inherently nondeterministic, define a **tolerant comparator** (ignore specific fields, assert shape/membership rather than equality).

### 4. Capture golden outputs

For each fixture: run the surface, record observable output (return value / stdout+stderr / exit code / HTTP status+body), store as snapshot/golden file.

- Stable, readable format (text, JSON)
- Keep goldens small
- Make it obvious how to intentionally update them (a "regenerate" command)

### 5. Write characterization tests

Assert: given fixture inputs → output matches golden (or tolerant comparator).

- Assert observable behavior only, not internal structure
- Do NOT refactor production code while writing these tests
- Few strong assertions over many weak ones

### 6. Coverage report

1. **Surfaces covered**
2. **Fixture list** (what cases are locked down)
3. **Known nondeterminism** and how it was stabilized
4. **Behavior gaps** (what remains unknown/unlocked)
5. **Recommended next step**: usually `/pragma:refactor` or strangler seams

### 7. Commit (tests only)

`Characterization: lock down current behavior of <subsystem>`

## Constraints

- **No refactor during characterization.** Don't touch production code — you're measuring the thing you're locking down.
- **Keep fixtures minimal.** Tempted to add many cases → you need a capsule + real spec work.
- **Tests must be deterministic** (or explicitly tolerant in controlled ways).
- **Golden updates must be intentional.** Accidental snapshot churn destroys trust.

## Output

1. The **coverage report**
2. The **test/fixture locations**
3. The exact **command(s)** to run the characterization suite
4. The recommended **next step** (`/pragma:refactor` or strangler approach)
5. **Lifecycle**: `State: stabilizing`, `Next: /pragma:refactor`, `Loop: /pragma:consult` (default unless user explicitly continues directly)
