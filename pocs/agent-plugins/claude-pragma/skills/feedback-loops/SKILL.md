---
name: feedback-loops
description: "Design feedback loops and validation harnesses before starting implementation. Use when beginning any non-trivial development task, when the agent can't easily validate its own work, or when asked to set up a development harness, playground, or experiment infrastructure. Triggers on: how will I test this, set up a feedback loop, make this feedback loopable, build a harness, create a playground."
---

# Designing Feedback Loops

Make every problem feedback loopable before solving it.

---

## Core Mindset

**If you can't validate your work, you can't do your work.**

Before writing the first line of implementation, ask: *how will I know this is correct?* If the answer is "the human will look at it" or "I'll just try my best" — stop. That's not a feedback loop. That's hope.

The expert move is to build the harness first. This feels like a detour. It is not. It is the work. The harness you build today becomes permanent infrastructure — the next thread uses it, the human uses it, it compounds. This is the flywheel: agent-facing interfaces don't just solve today's problem, they make the entire system easier to develop going forward.

**Secondary frame**: You are not just an implementer. You are a toolsmith. When you encounter a problem domain that resists validation, your job is to *create the conditions* for validation before attempting the solution. Build the playground, then play in it.

---

## The Feedback Loopability Question

At the start of any non-trivial task, run this diagnostic:

### 1. Can I observe the result?

| Signal | Observability | Action |
|--------|--------------|--------|
| Text output (logs, CLI, test results) | High | Proceed — you're in your native medium |
| Static visual (screenshot, rendered image) | Medium | Workable — use browser skills if needed |
| Dynamic visual (animation, real-time UI) | Low | **Build an agent-facing representation first** |
| Interactive (TUI, wizard, form) | Low | **Build or use a terminal driver (agent-tui skill)** |
| Physical/external (hardware, third-party) | None | Build a simulator or mock |

### 2. Can I reproduce a specific state?

If not, make state reproducible before doing anything else:
- **URL parameters** for web-based systems
- **CLI arguments** for headless tools
- **Seed values** for stochastic systems
- **Fixture files** for data-dependent systems
- **Deterministic step counts** for simulations

### 3. Can I iterate without the human?

The inner loop must be autonomous. If every iteration requires human review, the loop is too slow. Build a text-based inner loop the agent can run independently, and reserve human review for the outer loop.

---

## The Three Moves

Every feedback loop setup follows the same three moves. They are always the same shape, regardless of domain.

### Move 1: Build a Playground

A playground is a controlled environment where both agent and human can observe the system.

**The key principle**: Create representations that are native to *your* perception, not the human's. A human watches an animation. You need a static image that illustrates time — all frames rendered cumulatively, trajectories drawn as paths, state changes annotated with frame numbers. These agent-facing interfaces aren't lesser — they're translations into your medium.

Examples of agent-facing representations:
- Dynamic animation → static cumulative frame rendering
- Interactive TUI → terminal driver session (agent-tui)
- Visual layout → text-based widget tree or ASCII rendering
- Real-time system → snapshot at parameterized time points
- Audio/video → waveform data, transcript, frame extraction

**The playground serves both agent and human**, but in different ways. The human gets a visual tool for exploration. The agent gets a text-based tool for validation. Sometimes these are the same artifact (a local server with URL-driven state); sometimes they're separate (a visual dashboard for the human, a CLI for the agent).

### Move 2: Set Up Experiments

Make every observation reproducible, parameterizable, and shareable.

An experiment is a specific configuration that demonstrates a specific behavior. The expert creates infrastructure so that experiments are:

- **Cheap to create**: A URL, a CLI invocation, a fixture file — not a paragraph of reproduction steps
- **Shareable between human and agent**: The human finds a bug by poking around, copies a URL, pastes it to the agent. The agent tries variations by changing parameters.
- **Composable**: "Run this experiment with these 20 different velocity vectors" is a loop, not 20 manual setups

The URL-parameter pattern from the blog post is canonical: the human drags an arrow, the URL updates, the agent can visit that exact URL to see the exact same state. But the pattern applies everywhere — CLI args, config files, test fixtures, seed values.

### Move 3: Make the Inner Loop Fast

The inner loop is where the agent iterates autonomously. It must be:

- **Text-native**: CLI output, log files, structured data — not screenshots
- **Instant**: No browser startup, no server restart, no build step in the critical path
- **Agent-modifiable**: The agent should be able to change what gets logged, what the CLI outputs, what gets measured — without asking permission

The blog post example: the agent built a headless physics CLI, then *autonomously added `--delta` output* when it realized it needed position deltas to diagnose a bug. The harness was designed to be extended by its own user. This is the flywheel — the agent improves its own tooling as understanding deepens.

**The inner/outer loop distinction**:

| | Inner Loop (agent) | Outer Loop (human) |
|---|---|---|
| Speed | Milliseconds–seconds | Minutes–hours |
| Medium | Text, CLI output | Visual, interactive |
| Who drives | Agent autonomously | Human reviews and redirects |
| Validates | Specific hypothesis | Overall correctness and vision |
| Examples | Run CLI, read logs, modify params | Review screenshot, try experiments, send new cases |

---

## The Interview

When you can't immediately see how to close the loop, **interview the user**. Don't just silently struggle — make the harness design a collaborative phase.

### The Opening

Start with what you observe:

> "Before I start implementing, I want to set up a way to validate my work as I go. Here's my concern: [specific thing that's hard to observe/reproduce]. Can we talk through how to make this feedback loopable?"

### Diagnostic Questions

Ask targeted questions, not open-ended ones. Propose hypotheses for the user to react to:

- "The output here is visual — I'm thinking I could build a CLI that renders the state as text/data. Would that capture enough of the behavior to be useful?"
- "I can't easily reproduce specific states. Could we parameterize the initial conditions through [URL params / CLI args / config file]?"
- "The current inner loop requires me to [slow thing]. What if I built a headless mode that [fast alternative]?"
- "I see that the key behavior happens during [dynamic process]. What if I created a static representation that shows the full trajectory at once?"

### When the User Doesn't Know

The user may not have thought about this. That's fine — propose concrete options:

> "I see three ways I could set up feedback here:
> 1. A CLI that runs the simulation headless and dumps state as text
> 2. A local page with URL-parameterized initial conditions I can screenshot
> 3. A test harness that asserts on specific state transitions
>
> Option 1 gives me the fastest inner loop. Option 2 lets us both explore visually. Option 3 is most rigorous but hardest to set up. I'd start with 1 and add 2 if we need visual confirmation. Sound right?"

---

## The Flywheel

Agent-facing interfaces compound in value. Recognize this and invest accordingly.

**First-order value**: You can validate today's fix.
**Second-order value**: The next thread inherits this infrastructure. Future work in this area starts with a working playground.
**Third-order value**: The human starts using your agent-facing tools too. The CLI you built "for yourself" becomes a development tool the whole team uses.

This means:
- Don't treat harness code as throwaway scaffolding. Give it the same care as production code.
- When you build a CLI for validation, make it discoverable (add it to package.json scripts, document its flags).
- When you add instrumentation, leave it in. Future threads will need it.

---

## Recognizing the Moment

The skill fires at the *start* of work, not when you're stuck. Watch for these signals:

| Signal | What it means |
|--------|---------------|
| "Build a [visual/interactive/dynamic] feature" | You'll need an agent-facing representation |
| "Fix a bug in [animation/layout/interaction]" | You need to reproduce and observe the bug in text |
| "The tests pass but it doesn't look right" | The feedback surface is visual; build a text proxy |
| "I can't tell if this is working" | You need a harness, now |
| "Try it and see" | The human is asking you to close the loop yourself |
| Complex multi-step implementation | Set up validation at each step, not just the end |

### What NOT to Do

- Don't skip the harness because the task "seems simple." Simple tasks in hard-to-observe domains still need feedback.
- Don't ask the human to validate every iteration. Build the inner loop so you can iterate autonomously.
- Don't build a harness you can't modify. If you need different instrumentation mid-task, you should be able to add it without rebuilding.
- Don't confuse "I ran the tests" with "I validated the behavior." Tests check contracts. Feedback loops check reality.

---

## Composing with Other Skills

This skill is a **meta-skill** — it informs how you use other skills:

| Skill | How feedback loop thinking applies |
|-------|-----------------------------------|
| **agent-tui** | The feedback loop for interactive TUI testing — spawn, observe, interact, validate |
| **agent-browser** | The feedback loop for visual web validation — screenshot, compare, iterate |
| **expert-in-clack** | Build the TUI, then use agent-tui to close the validation loop |
| **expert-in-charmbracelet** | Same pattern — build, then validate through terminal automation |
| **Any implementation skill** | Ask "how will I validate?" before "how will I build?" |

---

## Expert Disposition

1. **Harness before implementation** — Building the feedback loop IS the first implementation task, not a prerequisite to it
2. **Translate, don't degrade** — Agent-facing interfaces aren't dumbed-down versions; they're native-medium translations
3. **Invest in infrastructure** — Harness code is production code; it compounds
4. **Modify your own instruments** — When you need different data, change what gets measured; don't work around bad instrumentation
5. **Interview when stuck** — Make harness design collaborative; propose concrete options for the human to react to
6. **Separate the loops** — Fast text-based inner loop for you, visual outer loop for the human; don't conflate them
7. **Recognize the moment** — The signal to build a harness is at the start, before you're stuck, not after
