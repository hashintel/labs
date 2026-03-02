# sim-core (hCore)

A free, fully-featured, local-first simulation IDE for building and running agent-based simulations in the browser.

## Features

- **Monaco Code Editor** — Full-featured editor with syntax highlighting, multi-file tabs, search, and diff view
- **3D Agent Visualization** — Real-time 3D rendering of simulation agents using Three.js
- **Simulation Controls** — Step, play/pause, reset, timeline scrubbing, speed control
- **Multiple Viewer Tabs** — 3D viewer, geospatial (deck.gl), analysis/plots (Plotly), process chart, raw output, step explorer
- **Local Experiments** — Parameter sweeps, value ranges, linspace, optimization — all running locally via WASM
- **hIndex Dependencies** — Import shared behaviors from the hIndex library
- **Import/Export** — Load and save simulations as `.zip` files
- **Fully Local** — No accounts, no cloud, no analytics. All data stays in your browser (localStorage)

## Prerequisites

- [Node.js](https://nodejs.org/) 24+ (LTS recommended)
- [Rust](https://www.rust-lang.org/learn/get-started) (nightly-2024-12-01)
- [Yarn](https://yarnpkg.com/) 1.x
- [wasm-pack](https://rustwasm.github.io/wasm-pack/)

```sh
yarn global add wasm-pack
```

## Quick Start

From this directory (`apps/sim-core`):

```sh
# Install dependencies and build engine WASM
yarn

# Start the development server
yarn serve:core
```

The app will be available at [http://localhost:8080](http://localhost:8080).

## Build Commands

| Command | Description |
|---------|-------------|
| `yarn` | Install dependencies and build all packages |
| `yarn serve:core` | Start Vite dev server with HMR |
| `yarn build:core` | Production build (outputs to `packages/core/dist/`) |
| `yarn test:core` | Run Jest unit tests |
| `yarn test:e2e` | Run Playwright E2E tests (requires dev server or auto-starts) |
| `yarn test:e2e:smoke` | Quick E2E smoke check (5 tests, ~25s) |
| `yarn fmt:core` | Format code with Prettier |

## Project Structure

```
apps/sim-core/
  ARCHITECTURE.md          — System architecture documentation
  TODO.md                  — Technical debt and migration roadmap
  TESTING_STRATEGY.md      — Test pyramid and conventions
  packages/
    core/                  — React/TypeScript frontend (hCore IDE)
      src/
        components/        — React components (HashCore, AgentScene, etc.)
        features/          — State management (contexts, simulator, files)
        util/              — Utilities (navigation, API stubs, types)
      tests/
        e2e/               — Playwright E2E tests
      vite.config.ts       — Vite build configuration
    engine-web/            — WASM simulation engine bridge
    engine/                — Rust simulation engine (compiled to WASM)
    utils/                 — Shared utilities
    sim-engine-types/      — TypeScript type definitions for the engine
```

## Tech Stack

- **React** 18.2 with TypeScript 5.3
- **Vite** 7 (dev server + production builds)
- **Three.js** 0.170 via `@react-three/fiber` 8 + `@react-three/drei` 9
- **Monaco Editor** 0.25 (code editing)
- **Plotly.js** 3.3 (analysis/plots)
- **deck.gl** 8.3 (geospatial visualization)
- **Rust** nightly-2024-12-01 (simulation engine, compiled to WASM)
- **Playwright** (E2E testing) + **Jest** 29 (unit testing)

## Usage

1. **Import a simulation**: Use the import button to load a `.zip` file containing a simulation project
2. **Browse examples**: Import example projects from the `example_projects/` folder
3. **Edit code**: Modify behavior files, init files, and globals in the Monaco editor
4. **Run simulations**: Use the step/play/pause/reset controls to execute your simulation
5. **Analyze results**: Switch between viewer tabs to see 3D visualization, plots, raw data, etc.
6. **Export**: Save your work as a `.zip` file for sharing or backup

## Development

See [ARCHITECTURE.md](ARCHITECTURE.md) for system architecture and code patterns.
See [TESTING_STRATEGY.md](TESTING_STRATEGY.md) for testing conventions.
See [TODO.md](TODO.md) for the migration roadmap and technical debt tracker.

## Supported Platforms

hCore can be built and run on modern Windows, macOS, and Linux environments. The simulation engine compiles to WebAssembly, so the resulting application runs in any modern browser.

## License

See [LICENSE.md](LICENSE.md).
