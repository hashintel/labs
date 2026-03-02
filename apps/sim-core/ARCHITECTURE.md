# sim-core Architecture

This document provides technical architecture documentation for **sim-core** (hCore), a free, fully-featured, local-first simulation IDE.

> **Scope**: This document covers `apps/sim-core/` only. sim-engine, hash-agents, and other monorepo contents are out of scope. sim-core will be extracted into its own repository at the end of this project.

## Table of Contents

- [Repository Overview](#repository-overview)
- [sim-core Architecture](#sim-core-architecture)
  - [Application Structure](#application-structure)
  - [Build System](#build-system)
  - [State Management](#state-management)
  - [Component Architecture](#component-architecture)
  - [Engine Integration](#engine-integration)
  - [Data Flow](#data-flow)
- [Deployment](#deployment)
  - [Build Pipeline](#build-pipeline)
  - [Build Output](#build-output)
  - [Hosting Requirements](#hosting-requirements)
  - [Environment Configuration](#environment-configuration)
  - [Embed Mode](#embed-mode)
  - [External Dependencies](#external-dependencies)
- [sim-engine Architecture](#sim-engine-architecture)
- [Key Files Reference](#key-files-reference)
- [Feature Development Guide](#feature-development-guide)
- [Common Patterns](#common-patterns)

---

## Repository Overview

```
hashintel-labs/
├── apps/
│   ├── sim-core/                    # Primary: React/TypeScript simulation IDE
│   │   ├── packages/
│   │   │   ├── core/                # Main frontend application
│   │   │   ├── engine/              # Legacy Rust simulation engine (WASM)
│   │   │   ├── engine-web/          # WASM bindings and TypeScript API
│   │   │   ├── sim-engine-types/    # Shared Rust types
│   │   │   └── utils/               # Shared utilities
│   │   └── example_projects/        # Sample simulation projects (.zip)
│   ├── sim-engine/                  # Standalone Rust simulation engine
│   │   ├── bin/                     # CLI and engine binaries
│   │   ├── lib/                     # Core library crates
│   │   ├── stdlib/                  # Standard library (JS/Python)
│   │   └── tests/                   # Integration tests
│   └── sim-core-plugins/            # hCore plugins
│       └── process-modeler/         # Business process modeling plugin
└── pocs/                            # Proof of concepts
    ├── hash-agents/                 # Python LLM agents (LangChain/FastAPI)
    ├── distributed_collab/          # Elixir distributed system
    └── hash_helm_chart/             # Kubernetes Helm charts
```

---

## sim-core Architecture

### Application Structure

```mermaid
flowchart TB
    subgraph Entry[Application Entry]
        Index[index.tsx]
        Boot[boot.ts]
    end
    
    subgraph Providers[Context Providers]
        VP[ViewerProvider]
        UP[UserProvider]
        PP[ProjectProvider]
        FP[FilesProvider]
        TP[ToastProvider]
        EP[ExamplesProvider]
        SP[SimulatorProvider]
    end
    
    subgraph Core[Core Application]
        App[App Component]
        HashRouter[HashRouter]
        HashCore[HashCore]
    end
    
    subgraph Views[Main Views]
        Editor[TabbedEditor<br/>Monaco]
        Viewer[SimulationViewer]
        Analysis[Analysis]
        Scene[AgentScene<br/>Three.js / R3F]
    end
    
    subgraph Controls[Simulation Controls]
        Runner[SimulationRunner]
        PlayPause[PlayPause]
        Timeline[Timeline]
    end
    
    Index --> Boot
    Boot --> Providers
    Providers --> App
    App --> HashRouter
    HashRouter --> HashCore
    HashCore --> Editor
    HashCore --> Viewer
    HashCore --> Runner
    Viewer --> Scene
    Runner --> PlayPause
    Runner --> Timeline
```

#### Entry Points

**`src/index.tsx`** — Application bootstrap:
```typescript
// 1. Handle version caching for staging
// 2. Call boot() to initialize services
// 3. Render React app wrapped in Context Providers
```

**`src/boot.ts`** — Service initialization:
```typescript
export const boot = async (forExperiments: boolean) => {
  configureTheme();                          // CSS variables
  enableMapSet();                            // Immer support
  configureMonaco();                         // Code editor
  buildSimulationProvider(forExperiments);   // WASM workers
};
```

### Build System

sim-core uses **Vite 7** for both development and production builds:

| Tool | Version | Purpose |
|------|---------|---------|
| Vite | 7.3 | Dev server + production bundler (Rollup) |
| TypeScript | 5.3 | Type checking |
| Babel | 7 | Jest test transformation |
| Jest | 29.7 | Unit tests (118 suites, 310 tests) |
| Playwright | — | E2E tests (66 tests across 8 spec files) |
| Node.js | 24 LTS | Runtime |

Key config files:
- `vite.config.ts` — Vite config with WASM, Monaco, and React plugins
- `tsconfig.json` — TypeScript config (strict mode, `useUnknownInCatchVariables: true`)
- `babel.config.js` — Babel presets for Jest (React, Env, TypeScript)
- `playwright.config.ts` — E2E test configuration

### State Management

sim-core uses **React built-in state management** (Context + hooks) for all application state, with a lightweight custom store for the performance-critical simulator.

```mermaid
flowchart LR
    subgraph AppContexts[React Context Providers]
        direction TB
        Files[FilesContext<br/>useReducer + Immer]
        Project[ProjectContext<br/>useReducer]
        User[UserContext<br/>useReducer]
        Viewer[ViewerContext<br/>useReducer]
        Search[SearchContext<br/>useState]
        Toast[ToastContext<br/>useState]
        Examples[ExamplesContext<br/>useState]
    end
    
    subgraph SimStore[Simulator Store]
        direction TB
        Simulator[SimpleStore<br/>reduxCompat.ts]
        Middleware[middleware chain]
        Subscribers[store subscribers]
    end
    
    subgraph Sync[Context → Store Sync]
        StoreSync[StoreSync component<br/>useEffect hooks]
    end
    
    AppContexts --> StoreSync
    StoreSync --> SimStore
```

#### App State (React Context)

All general UI state is managed through React Context providers. Each provider is pure React with no external dependencies:

| Context | Hook | State Mechanism | Purpose |
|---------|------|-----------------|---------|
| `FilesContext` | `useFiles()` | `useReducer` + Immer | File tree, open files, editor state |
| `ProjectContext` | `useProject()` | `useReducer` | Current project, access gates |
| `UserContext` | `useUser()` | `useReducer` | Tour progress, preferences |
| `ViewerContext` | `useViewer()` | `useReducer` | Tabs, editor/activity visibility |
| `SearchContext` | `useSearch()` | `useState` | Search query state |
| `ToastContext` | `useToast()` | `useState` | Toast notifications |
| `ExamplesContext` | `useExamples()` | `useState` | Example project list |

#### Simulator Store (`src/features/simulator/store.ts`)

The simulator uses a lightweight custom store (`reduxCompat.ts`) for high-frequency simulation updates. This store provides Redux-compatible APIs (`dispatch`, `getState`, `subscribe`) without the Redux dependency:

```typescript
import { createStore } from "../reduxCompat";

export const simulatorStore = createStore(rootReducer, [
  simulatorMiddleware,        // Provider message handling
  observeMiddleware(...),     // Action observability
  simulatorAnalysisMiddleware // Plot data computation
]);
```

Components access simulation state via `useSyncExternalStore`:

```typescript
import { useSimulatorSelector, useSimulatorDispatch } from "../features/simulator/context";

const running = useSimulatorSelector(selectRunning);
const dispatch = useSimulatorDispatch();
```

**Simulator State:**

| Property | Type | Purpose |
|----------|------|---------|
| `simulationData` | `Record<string, SimulationData>` | All simulation runs |
| `currentSimulation` | `string \| null` | Active simulation ID |
| `analysisMode` | `AnalysisMode` | Current analysis view |
| `history` | Entity state | Project history items |
| `stepsPerSecond` | `number` | Playback speed |

#### Context ↔ Store Synchronization

The `StoreSync` component (`src/features/simulator/simulate/StoreSync.tsx`) bridges React contexts to the simulator store using `useEffect` hooks:

- Project changes → reset simulation
- Globals file changes → update runner (when running)
- Tab changes → toggle analysis visibility
- Analysis source changes → clear cached plot data

#### Compatibility Layer (`src/features/reduxCompat.ts`)

A thin utility providing Redux-compatible APIs using only Immer and Reselect:

| API | Purpose |
|-----|---------|
| `createSlice` | Generates reducer + action creators (Immer-wrapped) |
| `createAction` | Typed action creator with `.type` and `.match()` |
| `createEntityAdapter` | Sorted entity CRUD with selectors |
| `createStore` | Minimal store with middleware chain + thunk support |
| `createSelector` | Re-exported from Reselect |

### Component Architecture

#### Directory Structure

```
src/components/
├── HashCore/           # Main IDE shell
│   ├── HashCore.tsx    # Root component
│   ├── Header/         # Top navigation bar
│   ├── Main/           # Main content area
│   ├── Files/          # File tree and management
│   ├── AccessGate/     # Permission checks
│   └── Tour/           # Onboarding tour
├── SimulationRunner/   # Playback controls
│   ├── SimulationRunner.tsx
│   └── Controls/       # PlayPause, Reset, Timeline, etc.
├── AgentScene/         # 3D visualization (@react-three/fiber)
│   ├── AgentScene.tsx  # Three.js scene
│   └── README.md       # Visualization docs
├── TabbedEditor/       # Monaco integration
├── Modal/              # Dialog system
├── Analysis/           # Analysis views
└── PlotViewer/         # Plotly charts
```

#### Key Components

**HashCore** (`src/components/HashCore/HashCore.tsx`):
```typescript
export const HashCore: FC = memo(function HashCore() {
  const { currentProject } = useProject();
  const { accessGate } = useProject();
  
  useParameterisedUi();     // URL parameter handling
  useKeyboardShortcuts();   // Global shortcuts
  useSaveOrFork();          // Cmd+S handling
  useShouldUnload();        // Unsaved changes warning

  return (
    <>
      <HashCoreAccessGate accessGate={accessGate}>
        <HashCoreHeader />
        <HashCoreMain />
      </HashCoreAccessGate>
      <ToastManager />
      <HashCoreTour />
    </>
  );
});
```

**SimulationRunner** (`src/components/SimulationRunner/SimulationRunner.tsx`):
```typescript
export const SimulationRunner: FC = () => {
  const dispatch = useSimulatorDispatch();

  useKeyboardShortcuts({
    meta: { Enter: () => dispatch(toggleCurrentSimulator()) },
    alt: { Enter: () => dispatch(pauseAndNew()) },
    metaShift: { Enter: () => dispatch(stepSimulator()) },
  });

  return (
    <div className="SimulationRunner">
      <Reset />
      <ExperimentsRunner />
      <StepButton />
      <PlayPause />
      <Timeline />
    </div>
  );
};
```

### Engine Integration

```mermaid
sequenceDiagram
    participant UI as React UI
    participant Store as Simulator Store
    participant Provider as SimulationProvider
    participant Worker as Web Worker
    participant WASM as WASM Engine
    
    UI->>Store: dispatch(runSimulation)
    Store->>Provider: handleRequest
    Provider->>Worker: postMessage
    Worker->>WASM: wasm.step()
    WASM-->>Worker: SimulationStates
    Worker-->>Provider: RunnerStatus
    Provider-->>Store: alertSubscribers
    Store-->>UI: state update
```

#### SimulationProvider (`src/features/simulator/simulate/provider.ts`)

Manages connections to simulation runners:

```typescript
export class SimulationProvider implements ExperimentRunner {
  targets: Record<ProviderTargetEnv, ProviderTarget> | null = null;
  
  build(workerFileName: string, numWorkers = 4, devMode = false) {
    const dedicatedRunner = new WebWorkerRunner(
      "worker-web-dedicated", workerFileName, devMode
    );
    this.targets = {
      web: {
        target: "web",
        dedicatedRunner,
        experimentRunners: new Map([
          ["experimenter-web-0", new WebExperimentRunner(numWorkers, devMode, workerFileName)],
        ]),
      },
    };
  }
}
```

#### Web Worker (`src/workers/simulation-worker/index.ts`)

Runs WASM engine in background thread:

```typescript
import { RunnerState, WasmRequestHandler, wasm } from "@hashintel/engine-web";

const runner: Promise<RunnerState> = (async () => ({
  wasmlib: await wasm(),      // Load WASM module
  datasetCache: new Map(),
  pyodide: null,              // Python runtime (lazy loaded)
  parsedSimulation: null,
  running: false,
  stepsLeft: 0,
}))();

RegisterPromiseWorker(async (message) => {
  return typeof message === "object"
    ? await WasmRequestHandler(message, await runner)
    : null;
});
```

### Data Flow

#### File System Abstraction

Simulations use a virtual file system stored in React Context:

```mermaid
flowchart LR
    subgraph Files[File Types]
        Behavior[HcBehaviorFile]
        Dataset[HcDatasetFile]
        Analysis[HcAnalysisFile]
        Shared[HcSharedBehaviorFile]
    end
    
    subgraph Storage[Storage Layer]
        Context[FilesContext<br/>useReducer]
        LocalStorage[localStorage]
    end
    
    subgraph Operations[Operations]
        Import[Import .zip]
        Export[Export .zip]
        Edit[Edit in Monaco]
    end
    
    Import --> Context
    Context --> LocalStorage
    Edit --> Context
    Context --> Export
```

**File Types** (`src/features/files/types.ts`):

| Type | Kind | Purpose |
|------|------|---------|
| `HcBehaviorFile` | `Behavior` | Agent behaviors (JS/Python) |
| `HcSharedBehaviorFile` | `SharedBehavior` | Dependencies from hIndex |
| `HcDatasetFile` | `Dataset` | JSON/CSV data files |
| `HcAnalysisFile` | `Analysis` | Analysis definitions |

---

## Deployment

sim-core is a **fully static single-page application**. It compiles to HTML, JavaScript, CSS, and WASM files that can be served from any static file host. There is no application server — the simulation engine runs entirely in the browser via WebAssembly.

### Build Pipeline

```mermaid
flowchart LR
    subgraph Prebuild[Pre-build]
        Rust[Rust Engine<br/>Cargo.toml]
        WasmPack[wasm-pack build<br/>→ .wasm + JS bindings]
        Codegen[graphql-codegen<br/>→ auto-types.ts]
    end

    subgraph Build[Vite Build]
        Vite[vite build<br/>Rollup bundler]
        TS[TypeScript<br/>→ JS]
        SCSS[SCSS<br/>→ CSS]
        Workers[Web Workers<br/>→ worker bundles]
        WASM[WASM bindings<br/>→ asset chunks]
    end

    subgraph Output[dist/]
        HTML[index.html<br/>embed.html]
        Assets[assets/*.js<br/>assets/*.css<br/>assets/*.wasm]
        WorkerOut[worker bundles]
    end

    Rust --> WasmPack
    WasmPack --> Vite
    Codegen --> Vite
    Vite --> TS
    Vite --> SCSS
    Vite --> Workers
    Vite --> WASM
    TS --> Output
    SCSS --> Output
    Workers --> Output
    WASM --> Output
```

The full build sequence:

```bash
# 1. Build WASM (runs automatically as engine-web prebuild hook)
cd apps/sim-core/packages/engine-web
wasm-pack build --target bundler --out-dir wasm/bundler --out-name hash

# 2. Build the frontend
cd apps/sim-core/packages/core
yarn build          # runs: yarn codegen && vite build
```

`yarn codegen` generates TypeScript types from the GraphQL schema (`codegen.yml`). `vite build` compiles the entire app — TypeScript, SCSS, WASM bindings, and workers — into the `dist/` directory.

### Build Output

```
dist/
├── index.html                    # Main app (SPA entry)
├── embed.html                    # Embed mode entry
└── assets/
    ├── index-[hash].js           # Main app bundle (ES module)
    ├── index-[hash].css          # Combined styles
    ├── hash_bg-[hash].wasm       # Simulation engine (compiled from Rust)
    ├── vendor-[hash].js          # Third-party libraries
    ├── monaco-[hash].js          # Code editor (large; ~3MB)
    ├── worker-[hash].js          # Simulation worker
    ├── analyzer-[hash].js        # Analysis worker
    ├── editor.worker-[hash].js   # Monaco editor worker
    ├── ts.worker-[hash].js       # Monaco TypeScript worker
    ├── json.worker-[hash].js     # Monaco JSON worker
    └── ...                       # Additional code-split chunks
```

The total build size is large (~15–25 MB uncompressed) due to Monaco Editor, Plotly, Three.js, deck.gl, and the WASM engine. With gzip/brotli compression, the initial download is ~5–8 MB.

### Hosting Requirements

Any static file server works. The key requirements:

#### SPA Fallback Routing (Required)

The app uses client-side routing. All paths must serve `index.html` (except actual static files).

```nginx
# nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

```apache
# Apache (.htaccess)
FallbackResource /index.html
```

```
# Netlify (_redirects)
/*    /index.html   200
```

```json
// Vercel (vercel.json)
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

For embed mode, requests to `/embed*` should serve `embed.html`:

```nginx
location /embed {
    try_files $uri /embed.html;
}
```

#### WASM MIME Type (Required)

`.wasm` files must be served with `Content-Type: application/wasm`. Most modern servers handle this automatically. For older servers:

```nginx
# nginx
types {
    application/wasm wasm;
}
```

#### Recommended Headers

```
Cache-Control: public, max-age=31536000, immutable   # For hashed assets (assets/*.js, assets/*.wasm)
Cache-Control: no-cache                               # For index.html, embed.html
```

Optionally, for maximum WASM performance:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers enable `SharedArrayBuffer`, which allows WASM to use threads. Not currently required but would improve simulation performance if threading is added.

### Environment Configuration

sim-core is configured entirely at **build time**. No runtime environment variables are needed.

| Variable | Build-Time | Default | Purpose |
|----------|-----------|---------|---------|
| `MAPBOX_API_TOKEN` | Optional | `null` | Enables geospatial map viewer. Without it, the map tab shows a placeholder. |
| `NODE_ENV` | Set by Vite | `production` | Controls dev/prod mode |

To set the Mapbox token:

```bash
MAPBOX_API_TOKEN=pk.your_token_here yarn build
```

All other configuration is hardcoded or derived from the build mode:

| Config | Value | Source |
|--------|-------|--------|
| `LOCAL_API` | `true` | `vite.config.ts` — hardcoded for local-first |
| `WEBPACK_BUILD_STAMP` | `hash-{mode}-{timestamp}` | Generated at build time |
| `WEBPACK_PUBLIC_PATH` | `"/"` | `vite.config.ts` |

> **Note**: The `WEBPACK_*` variable names are legacy from the Webpack era. They will be renamed to `BUILD_STAMP` and `PUBLIC_PATH` in a future cleanup (see TODO.md Phase 4b).

### Embed Mode

The app supports an embed mode for displaying simulations in iframes on other sites:

```html
<iframe src="https://your-host.com/embed.html?project=@namespace/project&ref=main"
        width="800" height="600" frameborder="0"></iframe>
```

Embed mode:
- Uses `embed.html` as the entry point (separate from `index.html`)
- Loads `EmbedApp` instead of the full IDE
- Fetches the project by path from URL parameters
- Applies the `embed` CSS class to `<html>` for a compact layout
- Hides IDE chrome (file tree, activity panel, some controls)

### External Dependencies

The app is designed to work offline, but currently references some external resources:

| Resource | URL | Required? | Notes |
|----------|-----|-----------|-------|
| Favicons | `cdn-us1.hash.ai/assets/img/brand/` | No | Cosmetic; page works without them |
| Web manifest | `cdn-us1.hash.ai/assets/other/site.webmanifest` | No | PWA manifest |
| Twitter card | `cdn-us1.hash.ai/assets/hash-card.png` | No | Social media preview |
| hIndex API | `api.hash.ai/graphql` | Partial | Required only for searching/adding shared behaviors from the hIndex library. Simulations run without it. |
| Mapbox tiles | `api.mapbox.com` | No | Only for geospatial viewer; requires `MAPBOX_API_TOKEN` |

For fully offline deployments:
1. Copy favicon/icon assets to the `public/` directory and update `index.html`
2. The hIndex search will show errors but the rest of the app functions normally
3. The geospatial viewer will be unavailable without Mapbox

### Deployment Examples

#### Local Preview

```bash
cd apps/sim-core/packages/core
yarn build
yarn start          # vite preview on http://localhost:4173
```

#### Docker (Nginx)

```dockerfile
FROM node:24 AS build
WORKDIR /app
COPY . .
RUN cd apps/sim-core && yarn install
RUN cd apps/sim-core/packages/core && yarn build

FROM nginx:alpine
COPY --from=build /app/apps/sim-core/packages/core/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

```nginx
# nginx.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    types {
        application/wasm wasm;
    }
}
```

#### GitHub Pages

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: cd apps/sim-core && yarn install
      - run: cd apps/sim-core/packages/core && yarn build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: apps/sim-core/packages/core/dist
```

> **Note**: GitHub Pages doesn't natively support SPA routing. You'll need a `404.html` workaround or use a service like Netlify/Vercel instead.

### CI/CD Status

#### What Exists

**Rust CI** (`.github/workflows/rust.yml`) — the only active workflow:
- Triggers on PRs, pushes to `main`/`dev/**`, and merge group
- Smart crate detection: only lints/tests crates with changed files
- Lint: `cargo fmt --check`, `cargo clippy` (with SARIF upload to GitHub code scanning), doc checks
- Test: `cargo nextest run`, plus miri for nightly toolchains
- Uses `Swatinem/rust-cache` and Turbo remote caching
- Concurrency: cancels in-progress runs for the same PR
- Gate: `merging-enabled` job blocks merge if lint or test fails

**Renovate** (`.github/renovate.json`) — dependency update bot:
- Configured with `dependencyDashboardApproval: true` (manual approval required)
- Groups packages by ecosystem (Jest, ESLint, GraphQL, Cargo crates, etc.)
- Stale: references teams/packages from a parent monorepo that don't apply here (Block Protocol, ProseMirror, Sentry, OpenTelemetry)

#### What's Missing

There is **no CI for the frontend** (sim-core). The following are not automated:

| Check | Status | Impact |
|-------|--------|--------|
| TypeScript type checking | Not in CI | Type errors can reach `main` |
| Jest unit tests (310 tests) | Not in CI | Regressions go undetected |
| Vite production build | Not in CI | Build failures go undetected |
| Playwright E2E tests (66 tests) | Not in CI | Functional regressions go undetected |
| ESLint / Prettier | Not in CI | Style drift |
| WASM build (engine-web) | Not in CI | WASM compilation failures go undetected |
| Deployment | Not in CI | Manual process only |

#### Outdated Action Versions

| Action | Current | Latest |
|--------|---------|--------|
| `actions/checkout` | v3.6.0 | v4 |
| `actions/setup-python` | v4.7.0 | v5 |
| `Swatinem/rust-cache` | v2.6.2 | v2.7+ |
| `taiki-e/install-action` | v2.17.7 | v2.26+ |
| `github/codeql-action` | v2.21.5 | v3 |

#### Recommended CI Architecture

```
.github/workflows/
├── rust.yml           # ✅ Exists — Rust lint + test
├── frontend.yml       # 🆕 TypeScript + Jest + build
├── e2e.yml            # 🆕 Playwright E2E tests
└── deploy.yml         # 🆕 Static site deployment
```

**`frontend.yml`** (recommended):
```yaml
name: Frontend
on:
  pull_request:
    paths: ['apps/sim-core/**', '!apps/sim-engine/**']
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: cd apps/sim-core && yarn install --frozen-lockfile
      - run: cd apps/sim-core/packages/core && npx tsc --noEmit  # Type check
      - run: cd apps/sim-core/packages/core && yarn test          # Jest (310 tests)
      - run: cd apps/sim-core/packages/core && yarn build         # Vite build
```

**`e2e.yml`** (recommended):
```yaml
name: E2E
on:
  pull_request:
    paths: ['apps/sim-core/**']

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: cd apps/sim-core && yarn install --frozen-lockfile
      - run: cd apps/sim-core/packages/core && yarn build
      - run: cd apps/sim-core/packages/core && npx playwright install --with-deps
      - run: cd apps/sim-core/packages/core && yarn test:e2e
```

---

## sim-engine Architecture

The standalone Rust simulation engine:

```mermaid
flowchart TB
    subgraph CLI[CLI Binary]
        Args[Argument Parsing]
        Manifest[Project Manifest]
        Orchestrator[Orchestrator]
    end
    
    subgraph Engine[Engine Binary]
        ExpControl[experiment-control]
        SimControl[simulation-control]
        Execution[execution]
    end
    
    subgraph Core[Core Libraries]
        Stateful[stateful<br/>Agent State]
        Memory[memory<br/>Apache Arrow]
        Runners[runners<br/>JS/Python]
    end
    
    CLI --> Engine
    Engine --> Core
    Args --> Manifest
    Manifest --> Orchestrator
    Orchestrator --> ExpControl
    ExpControl --> SimControl
    SimControl --> Execution
    Execution --> Stateful
    Execution --> Memory
    Execution --> Runners
```

### Library Crates

| Crate | Purpose |
|-------|---------|
| `execution` | Simulation execution logic, runner management |
| `experiment-control` | Experiment lifecycle management |
| `experiment-structure` | Configuration and manifest parsing |
| `simulation-control` | Individual simulation management |
| `stateful` | Agent state and field management |
| `memory` | Apache Arrow-based memory management |
| `flatbuffers_gen` | Generated FlatBuffers types |
| `nano` | IPC communication |
| `orchestrator` | Process orchestration |

---

## Key Files Reference

### Entry Points

| File | Purpose |
|------|---------|
| `apps/sim-core/packages/core/src/index.tsx` | React app entry |
| `apps/sim-core/packages/core/src/boot.ts` | Service initialization |
| `apps/sim-engine/bin/cli/src/main.rs` | CLI entry |
| `apps/sim-engine/bin/hash_engine/src/main.rs` | Engine entry |

### State Management

| File | Purpose |
|------|---------|
| `src/features/files/FilesContext.tsx` | File state (useReducer + Immer reducer) |
| `src/features/files/slice.ts` | Files reducer and action creators |
| `src/features/files/adapter.ts` | Pure entity adapter for file CRUD |
| `src/features/project/ProjectContext.tsx` | Project state (useReducer) |
| `src/features/viewer/ViewerContext.tsx` | Viewer/UI state (useReducer) |
| `src/features/user/UserContext.tsx` | User preferences (useReducer) |
| `src/features/toast/ToastContext.tsx` | Toast notifications (useState) |
| `src/features/search/SearchContext.tsx` | Search state (useState) |
| `src/features/examples/ExamplesContext.tsx` | Examples list (useState) |
| `src/features/simulator/store.ts` | Simulator store (SimpleStore) |
| `src/features/simulator/simulate/slice.ts` | Simulator reducer (1800+ lines) |
| `src/features/simulator/simulate/StoreSync.tsx` | Context → store sync |
| `src/features/reduxCompat.ts` | Redux-compatible utilities |

### Components

| Directory | Purpose |
|-----------|---------|
| `src/components/HashCore/` | Main IDE shell |
| `src/components/SimulationRunner/` | Playback controls |
| `src/components/AgentScene/` | 3D visualization (@react-three/fiber) |
| `src/components/Modal/` | Dialog system |
| `src/components/TabbedEditor/` | Code editor (Monaco) |
| `src/components/Analysis/` | Analysis views |
| `src/components/PlotViewer/` | Plotly charts |

### Engine Integration

| File | Purpose |
|------|---------|
| `src/features/simulator/simulate/provider.ts` | Simulation runner management |
| `src/features/simulator/simulate/buildprovider.ts` | Worker initialization |
| `src/workers/simulation-worker/index.ts` | WASM worker |
| `packages/engine-web/src/` | WASM bindings |

---

## Feature Development Guide

### Adding New State

Use React's built-in state management. Choose the simplest approach that works:

```typescript
// 1. Local state (preferred — use when state is component-local)
const [value, setValue] = useState(initialValue);

// 2. Shared state via Context (use when state crosses component boundaries)
const { currentProject } = useProject();
const { allFiles, updateFile } = useFiles();

// 3. localStorage for persistence
localStorage.setItem('preferences', JSON.stringify(prefs));
```

**Do NOT** add new state management libraries. The project uses only React built-ins plus a thin compatibility layer (`reduxCompat.ts`) for the simulator store.

### Adding New Components

Follow the existing `src/components/[Name]/` structure:

```typescript
// src/components/MyFeature/MyFeature.tsx
import React, { FC } from "react";
import { useFiles } from "../../features/files/FilesContext";
import { useProject } from "../../features/project/ProjectContext";
import "./MyFeature.scss";

export const MyFeature: FC = () => {
  const { currentFile } = useFiles();
  const { currentProject } = useProject();
  
  return (
    <div className="MyFeature">
      {/* ... */}
    </div>
  );
};
```

```scss
// src/components/MyFeature/MyFeature.scss
.MyFeature {
  color: var(--theme-dark);
  background: var(--theme-light);
}
```

---

## Common Patterns

### Navigation / Routing

The app uses custom lightweight routing utilities (replacing the abandoned `hookrouter` package):

```typescript
// Programmatic navigation
import { navigate, setQueryParams } from "../util/navigation";

navigate("/path/to/page");                    // Push navigation
navigate("/path", true);                      // Replace current entry
navigate("/path", false, { key: "value" });   // With query params
setQueryParams({ view: "3d" });               // Update query params only

// Route matching in components
import { usePathRouter, RouteMap } from "../util/usePathRouter";

const routes: RouteMap = {
  "/": () => <Home />,
  "/project/:id": ({ id }) => <Project id={id} />,
  "/@*": () => <ProjectByPath />,
};

const element = usePathRouter(routes);
```

### Accessing State

```typescript
// App state — use context hooks
import { useFiles } from "../../features/files/FilesContext";
import { useProject } from "../../features/project/ProjectContext";
import { useViewer } from "../../features/viewer/ViewerContext";

const { allFiles, currentFile, updateFile } = useFiles();
const { currentProject } = useProject();
const { currentTab, toggleEditor } = useViewer();

// Simulation state — use simulator hooks
import { useSimulatorSelector, useSimulatorDispatch } from "../../features/simulator/context";

const running = useSimulatorSelector(selectRunning);
const dispatch = useSimulatorDispatch();
```

### Scopes (Permissions)

The scopes system determines what actions are available:

```typescript
import { Scope, useScope, useScopes } from "../../features/scopes";

const canEdit = useScope(Scope.edit);
const { canSave, canEdit } = useScopes(Scope.save, Scope.edit);
```

### Modal System

```typescript
import { useModal } from "react-modal-hook";

const [showModal, hideModal] = useModal(() => (
  <ModalBase onClose={hideModal}>
    <ModalHeader>Title</ModalHeader>
    <ModalContent>Content</ModalContent>
    <ModalFooter>
      <Button onClick={hideModal}>Close</Button>
    </ModalFooter>
  </ModalBase>
));
```

---

## Additional Resources

- [sim-core README](apps/sim-core/README.md) — Setup and running instructions
- [sim-engine README](apps/sim-engine/README.md) — Rust engine documentation
- [TODO.md](TODO.md) — Technical debt and modernization roadmap
- [CONTRIBUTING.md](.github/CONTRIBUTING.md) — Contribution guidelines
- [.cursor/rules/hash-labs.mdc](.cursor/rules/hash-labs.mdc) — AI agent guidelines
