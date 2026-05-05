# pragma

A [Claude Code plugin](https://code.claude.com/docs/en/plugins-reference) packaging the **pragma** methodology — invariant-driven tracer-bullet development for AI-assisted coding.

## Install

Clone this repo and install from the local path:

```bash
git clone https://github.com/hashintel/labs.git
cd your-project
/plugin install /path/to/labs/pocs/agent-plugins/claude-pragma
/reload-plugins
```

After installation, all skills are available as `/pragma:<name>`.

## Usage

Start with `/pragma:consult` — it assesses your project state and recommends the next skill.

### Skills

| Group | Skills | Purpose |
|-------|--------|---------|
| **Delivery** | `consult`, `capsule`, `card`, `skeleton`, `slice`, `spike`, `characterize`, `contract`, `harden`, `refactor`, `assumptions`, `feedback-loops` | Inner loop — prove and deliver one slice at a time |
| **Horizon** | `roadmap`, `milestone` | Outer loop — strategic steering across phases |
| **Shaping** | `shaping-framing`, `shaping-kickoff`, `shaping-breadboard`, `shaping-breadboard-reflect` | Pre-planning — distill discovery inputs before carding |

### Typical flow

1. `/pragma:consult` — triage and recommend
2. `/pragma:capsule` — define glossary, invariants, happy path
3. `/pragma:skeleton` — thinnest runnable end-to-end system
4. `/pragma:card` — scope one thin slice
5. `/pragma:slice` — implement it (inside-out)
6. Repeat from step 1

### Reference docs

The `docs/` directory contains the methodology's governing documents:

- **invariant-threshold.md** — first principles
- **pragma-lifecycle.md** — normative operations contract
- **pragma-skills.md** — onboarding index and skill map
- **pragma-brooks-alignment-spec.md** — Brooks alignment rationale
- **horizon-pragma-lifecycle.mmd** — lifecycle diagram
