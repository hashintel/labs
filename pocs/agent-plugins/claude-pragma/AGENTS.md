# Pragma Plugin

Tracer-bullet development methodology for Claude Code — invariant-driven
planning, slicing, and delivery.

## Skill Organization

All skills in this plugin are invoked as `pragma:<name>`. They fall into
three groups:

| Group | Skills | Purpose |
|-------|--------|---------|
| **Delivery** (inner loop) | `consult`, `capsule`, `card`, `skeleton`, `slice`, `spike`, `characterize`, `contract`, `harden`, `refactor`, `assumptions`, `feedback-loops` | Prove and deliver one slice at a time |
| **Horizon** (outer loop) | `roadmap`, `milestone` | Strategic steering across phases |
| **Shaping** (pre-planning) | `shaping-framing`, `shaping-kickoff`, `shaping-breadboard`, `shaping-breadboard-reflect` | Distill discovery inputs before carding |

## Entrypoint

Start with `/pragma:consult` — it interviews, assesses state, and
recommends the next skill.

## Reference Documents

Located in `docs/`:

- `invariant-threshold.md` — Governing principle
- `pragma-lifecycle.md` — Normative operations contract
- `pragma-skills.md` — Onboarding index and skill map
- `pragma-brooks-alignment-spec.md` — Brooks alignment rationale
- `horizon-pragma-lifecycle.mmd` — Lifecycle diagram (non-authoritative)
