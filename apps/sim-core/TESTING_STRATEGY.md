# Testing Strategy

This document describes how to approach testing in sim-core, with emphasis on **test-driven bug fixes**.

> **Scope**: Covers `apps/sim-core/` only.

## Test Pyramid

| Layer | Tool | When to Use | Speed |
|-------|------|-------------|-------|
| **Unit** | Jest | Pure logic, utilities, selectors, hooks | Fast |
| **Component** | Jest + React Testing Library | React components in isolation | Fast |
| **Integration** | Jest | Multi-module flows, thunks, middleware | Medium |
| **E2E** | Playwright | Full user flows, UI, routing, simulation | Slow |

**Prefer lower layers** when they can adequately verify the behavior. Use E2E only when the bug or feature spans the full stack.

---

## Bug Fixes: TDD Approach (MANDATORY)

When fixing a bug, **always start by writing a failing test** that reproduces the issue. Then fix the code until the test passes.

### 1. Reproduce First

Before changing any production code:

1. **Write a test** that fails and demonstrates the bug.
2. **Run the test** — it must fail in a way that matches the reported behavior.
3. **Fix the code** until the test passes.
4. **Run the full suite** to ensure no regressions.

### 2. Test Type Selection

| Bug Type | Preferred Test | Fallback |
|----------|----------------|----------|
| Pure logic / util / selector | Unit test | — |
| React component behavior | Component test (`.spec.tsx`) | E2E |
| Hook or context behavior | Unit/component test | E2E |
| Multi-step user flow | E2E | — |
| UI layout / visibility | E2E | — |
| Import/export, file handling | Unit if logic-only, else E2E | — |
| Simulation execution | E2E | — |

**Rule:** If a unit or component test can reliably reproduce the bug, use it. Otherwise use E2E.

### 3. Where to Put Tests

- **Unit/component:** Co-located with source (`*.spec.ts`, `*.spec.tsx`) or in `__tests__/`
- **E2E:** `apps/sim-core/packages/core/tests/e2e/*.spec.ts`
- **Shared E2E helpers:** `tests/e2e/fixtures/test-helpers.ts`

### 4. Example Workflow

**Bug:** "Importing a project shows 'Error importing project files: undefined'"

1. Add `tests/e2e/import-project.spec.ts` that:
   - Loads the app, opens File menu, triggers import with a zip
   - Asserts no "undefined" in console errors
2. Run the test — it fails (reproduces the bug).
3. Fix error handling in `HashCoreHeaderMenuFiles.tsx` and `hooks.ts`.
4. Run the test — it passes.
5. Run full E2E suite to confirm no regressions.

---

## Running Tests

### sim-core (packages/core)

```bash
# Unit + component tests
cd apps/sim-core/packages/core
npx jest --forceExit --testPathIgnorePatterns "e2e"

# E2E smoke (quick)
yarn ws:core test:e2e:smoke

# Full E2E
yarn ws:core test:e2e

# Single E2E file
yarn ws:core test:e2e tests/e2e/import-project.spec.ts
```

### sim-engine

```bash
cd apps/sim-engine
cargo test
```

---

## Test Conventions

- **Descriptive names:** `"should import wildfires project zip without error"` not `"import works"`
- **Isolated:** Each test should be runnable in isolation; avoid shared mutable state.
- **Deterministic:** No flaky timeouts or race conditions; use `waitFor` over fixed `setTimeout` where possible.
- **Focused:** One logical assertion per test when practical.

---

## References

- [hash-labs.mdc](.cursor/rules/hash-labs.mdc) — Build & Test Verification, E2E requirements
- [tests/README.md](apps/sim-core/packages/core/tests/README.md) — Legacy E2E notes
- [test-helpers.ts](apps/sim-core/packages/core/tests/e2e/fixtures/test-helpers.ts) — Shared E2E utilities
