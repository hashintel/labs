---
name: contract
description: Turn capsule invariants and boundary crossings into executable contracts. Use after creating a concept capsule, or when invariants need to be enforced in code. Covers preconditions, postconditions, constructor validation, domain types, and contract tests.
argument-hint: "[invariants to enforce, or 'audit' to check current coverage]"
---

# Contract Extraction

Turn capsule invariants into **executable contracts**: domain types that prevent invalid states, validation at boundaries, and tests that prove enforcement. Operationalizes "design by contract" (Meyer) and "parse, don't validate."

## Input

Invariants to enforce (or `audit` to check current coverage): $ARGUMENTS

**Preconditions**:
- A concept capsule must exist (it defines the invariants). If none → `/pragma:capsule` first.
- At least one slice of working code to attach contracts to. If at skeleton stage → `/pragma:card` + `/pragma:slice` first.

Also read: the capsule (glossary + invariants), recent cards (boundary crossings), and existing source code.

## Procedure

### 1. Build the contract map

For each capsule invariant, determine current enforcement status:

| Invariant | Enforcement | Location | Evidence |
|-----------|-------------|----------|----------|
| [from capsule] | Type system / Constructor / Test / None | [file:line or "missing"] | [test name or "none"] |

Enforcement levels (best → worst): **Type system** (invalid states unrepresentable) → **Constructor/validator** (checked at entry points) → **Test** (at least a check somewhere) → **None** (fix this).

### 2. Identify boundary contracts

For each public entry point in scope:
```
Module: [name]
  Function: [name]
    Preconditions: [what must be true on entry]
    Postconditions: [what must be true on exit]
    Errors: [what can go wrong and how it's signaled]
```

Use glossary terms. No clear pre/postconditions → design smell, module may need splitting.

### 3. Enforce incrementally

One invariant at a time. Prioritize "None" first, then upgrade "Test" → "Constructor" → "Type system":

1. **Types first**: narrower types to make invalid states impossible (branded IDs, discriminated unions, non-empty collections)
2. **Then constructors/validators**: validation where data enters the domain (factory functions, constructor guards)
3. **Then tests**: contract tests asserting invariants hold (table tests, property tests, regression tests)

Keep tests green throughout. Do not change behavior — only tighten enforcement.

### 4. Update the contract map

Write or update `docs/contracts.md` with:
- The invariant-to-enforcement table (updated)
- Boundary contracts for each module
- A **contract budget**: what's enforced now vs. what remains "English-only" and why

### 5. Verify and commit

Run full verification harness. All checks must pass. Contract extraction must not change behavior.
Commit: `Contract: enforce [invariant] at [boundary]`

## Constraints

- **No behavior changes.** Contracts tighten enforcement only. Missing behavior → `/pragma:card`.
- **Incremental.** One invariant or boundary per pass. Do not "contract the whole system" at once.
- **Types over runtime checks.** Compile-time enforcement preferred. Runtime is fallback.
- **The capsule is the authority.** Capsule wrong → update it first.
- **No heavy frameworks.** Native type system + standard assertion patterns only.

## Output

1. **Contracts enforced**: which invariants, at what level
2. **Contract budget**: what remains unenforced and why
3. **Boundary contracts**: pre/postconditions added or clarified
4. **Code changes**: types, validators, tests added
5. **Recommended next step**: more `/pragma:contract` passes, or back to `/pragma:card` + `/pragma:slice`
6. **Lifecycle**: `State: governance`, `Next: /pragma:consult` (or the explicitly recommended next step), `Loop: /pragma:consult` (default unless user explicitly continues directly)
