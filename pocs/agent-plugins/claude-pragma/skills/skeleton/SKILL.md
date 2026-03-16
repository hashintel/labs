---
name: skeleton
description: Build a walking skeleton — the thinnest runnable system that proves build, test, and runtime work end-to-end. Use when starting a new project, before any feature work. Front-loads tooling and infrastructure so every subsequent slice is cheaper.
argument-hint: "[project description and tech stack]"
---

# Walking Skeleton

Build a **walking skeleton** (Cockburn) — the thinnest possible runnable system that proves the entire pipeline works: build, test, run.

## Input

The project description and tech stack: $ARGUMENTS

**Precondition**: a concept capsule must exist. If none exists, stop and recommend `/pragma:capsule` first. Use glossary terms even for the "hello world" path.

## What a skeleton IS and IS NOT

**IS**: project builds, test runner runs with ≥1 passing test, one minimal path executes end-to-end, happy-path scenario from capsule has a placeholder.

**IS NOT**: a feature (no business logic), an architecture (no layers/patterns beyond what the single path requires), comprehensive (one path, one test, one entry point).

## Procedure

### 1. Project scaffold

Minimal project structure: init project, configure test runner, create entry point.

- Use the tech stack specified by the user — do not substitute
- Simplest configuration. No linters, formatters, or CI yet — those come with `/pragma:harden`
- Do NOT install unnecessary dependencies

### 2. One passing test

A single test proving the pipeline works: import from source, assert something trivially true, run and confirm green. This is a **pipeline test**, not a feature test.

### 3. One runnable path

Make the entry point do something minimal and observable:
- Library: export a function callable from the test
- CLI: accept trivial input, produce output
- Server: start, respond to one route, shut down
- UI: render one element

Touch the same boundaries real slices will cross, but with trivial logic. If the capsule has a happy path, create a placeholder.

### 4. Verify and commit

Run all available checks (typecheck, tests, build, run entry point). Fix before moving on — the skeleton is not done until the full pipeline is green.

## Constraints

- **No features.** The skeleton proves the pipeline, not the product.
- **No speculative structure.** No directories, modules, or abstractions "for later."
- **No dependency shopping.** Only what's needed to run. Feature deps come with their slices.
- **Tests must actually run and pass.** The entry point must actually execute and produce output.

## Output

1. **Pipeline proven**: what can now be done (build, test, run)
2. **Entry point**: what it does and how to invoke it
3. **Test**: what it checks and how to run it
4. **Files created**: list
5. **Next step**: typically `/pragma:card` → `/pragma:slice` for the first real behavior
6. **Lifecycle**: `State: foundation`, `Next: /pragma:card`, `Loop: /pragma:consult` (default unless user explicitly continues directly)
