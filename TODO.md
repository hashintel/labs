# Technical Debt & Modernization TODO

This document tracks outdated dependencies, deprecated patterns, and proposed upgrades for the HASH Labs monorepo.

**Last Updated**: February 2026  
**Analysis Scope**: sim-core, sim-engine, hash-agents

---

## Executive Summary

| Area | Severity | Effort | Notes |
|------|----------|--------|-------|
| ~~React & React Ecosystem~~ | ✅ Done | — | React 18.2, @react-three/fiber 8, drei 9, Recoil removed |
| ~~Redux Removal~~ | ✅ Done | — | Redux entirely removed; replaced with React Context + reduxCompat.ts |
| ~~Feature Removal~~ | ✅ Done | — | Cloud/auth/sharing features removed |
| ~~Sentry Removal~~ | ✅ Done | — | Sentry + FullStory analytics removed |
| ~~Dev Tooling Cleanup~~ | ✅ Done | — | why-did-you-render removed |
| ~~Build Tooling~~ | ✅ Done | — | Migrated to Vite 7.3 |
| ~~Rust Toolchain~~ | ✅ Done | — | Updated to nightly-2024-12-01, edition 2021 |
| Python/LangChain | 🔴 Critical | Medium | Complete API rewrites |
| ~~Deprecated Packages~~ | ✅ Done | — | All deprecated packages replaced or removed |

---

## Application Architecture Change

**New Model**: Free, fully-featured, local-first simulation IDE

### Storage Strategy
- **Current State**: Cloud-based with user accounts, hCloud, server-side storage
- **Target State**: Local-first with browser storage (localStorage/IndexedDB)
- **Future Enhancement**: GitHub sync for project persistence (post-migration)

### Features to KEEP

| Category | Features |
|----------|----------|
| **Simulation Execution** | Step, Play/Pause, Reset, Timeline, Speed Control |
| **Viewer Tabs** | 3D Viewer, Geospatial, Analysis/Plots, Process Chart, Raw Output, Step Explorer |
| **Code Editing** | Monaco Editor, Multi-file tabs, Syntax highlighting, Diff view, Search |
| **File Management** | File tree, Create behaviors, Create datasets, Import/Export .zip, Behavior keys |
| **Experiments** | Local experiment runner (parameter sweeps, values, linspace, optimization) |
| **Dependencies** | hIndex shared behaviors library |
| **UI/UX** | Onboarding tour, Toasts, Loading states, Error boundaries, Keyboard shortcuts |
| **Data/Analysis** | Output metrics, Plots configuration |

### Features to REMOVE

#### ❌ User & Cloud Features (Item 6) - REMOVE ENTIRELY
| Feature | Files to Delete |
|---------|-----------------|
| User Authentication | `ModalSignin`, `ModalSignup`, auth flows |
| User Accounts | `features/user/` slice (simplify to local prefs only) |
| Cloud Credits | `CloudUsage` modal and tracking |
| Project Sharing | `ModalShare*` components |
| Access Codes | Access code system |
| hCloud Integration | Cloud experiment runners |

**Rationale**: App becomes free and fully-featured, no accounts needed.

#### ❌ Project Management (Item 7) - REMOVE ENTIRELY
| Feature | Files to Delete |
|---------|-----------------|
| New Project (server) | `ModalNewProject` (replace with local template) |
| Fork Project | Fork functionality |
| Server Save | Save to HASH servers |
| Releases/Versioning | `ModalRelease*` components |
| Project Metadata Sync | Server-side metadata |

**Rationale**: Projects stored locally; GitHub sync added post-migration.

#### ❌ Integrations (Item 10) - REMOVE MOST
| Feature | Action |
|---------|--------|
| Sentry | REMOVE (already planned) |
| FullStory | REMOVE (already planned) |
| Discord Widget | REMOVE |
| hIndex Dependencies | **KEEP** - shared behaviors library |

### Simplified Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    sim-core (Local-First)                       │
├─────────────────────────────────────────────────────────────────┤
│  React Frontend           │    WASM Engine (Web Workers)       │
│  ─────────────────        │    ─────────────────────────       │
│  • HashCore (IDE shell)   │    • engine-web bindings           │
│  • SimulationRunner       │    • Rust → WASM compilation       │
│  • AgentScene (3D)        │    • Local execution only          │
│  • Monaco Editor          │                                     │
├─────────────────────────────────────────────────────────────────┤
│  Local State Only:                                              │
│  • React Context + useState for UI state                        │
│  • localStorage for project persistence                         │
│  • IndexedDB for larger datasets (future)                       │
├─────────────────────────────────────────────────────────────────┤
│  Future: GitHub Integration                                     │
│  • Save/load projects from user's GitHub repos                  │
│  • No HASH account required                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Migration Phases for Feature Removal

#### Phase 1: Remove Analytics & Widgets
- [x] Remove Sentry (`@sentry/*` packages)
- [x] Remove FullStory (`@fullstory/browser`)
- [x] Remove Discord widget
- [x] Remove why-did-you-render

#### Phase 2: Remove Auth & User System
- [x] Remove `ModalSignin`, `ModalSignup`
- [x] Remove user authentication flows
- [x] Simplify `features/user/` to local preferences only
- [x] Remove cloud credits tracking

#### Phase 3: Remove Cloud Features  
- [x] Remove hCloud experiment runners (keep local runner)
- [x] Remove server-side project save
- [x] Remove sharing features (`ModalShare*`)
- [x] Remove access code system

#### Phase 4: Remove Project Management
- [x] Remove `ModalRelease*` components
- [x] Remove fork functionality (replaced with local fork)
- [x] Simplify new project to local templates
- [x] Remove server metadata sync

#### Phase 5: Simplify to Local Storage
- [x] Implement localStorage-based project persistence
- [x] Implement local project templates
- [x] Ensure import/export .zip works standalone
- [ ] Test fully offline operation (requires running the app)

### Packages to Remove (Feature-Related)

```
# Auth/Cloud related
- (Done) Removed dead API query files: canUserEditProject, createNewSimulationProject,
  forkProjectQuery, forkAndReleaseBehaviorsQuery, projectReleaseTags,
  requestPrivateProjectAccessCode, userForks, commitActions,
  createReleaseWithUpdate, registerEvents
- (Done) Analytics no-opped (trackEvent/trackEvents are stubs)
- (Done) getReleaseMeta returns empty data locally

# Sharing
- (Done) ModalShare components deleted

# Analytics (already in plan)
- @sentry/browser (removed)
- @sentry/integrations (removed)
- @sentry/tracing (removed)
- @sentry/fullstory (removed)
- @sentry/webpack-plugin (removed)
- @fullstory/browser (removed)
```

---

## sim-core Frontend

### 🔴 Critical: React Ecosystem (Major Version Behind)

| Package | Current | Latest | Action |
|---------|---------|--------|--------|
| `react` | ~~16.14.0~~ **18.2.0** | ✅ Done | Upgraded via 16→17→18 |
| `react-dom` | ~~16.14.0~~ **18.2.0** | ✅ Done | createRoot migrated |
| `react-redux` | ~~7.2.4~~ | ✅ Removed | Replaced with `useSyncExternalStore` |
| `@reduxjs/toolkit` | ~~1.5.0~~ | ✅ Removed | Replaced with `reduxCompat.ts` |
| `redux` | ~~*~~ | ✅ Removed | Transitive dep of RTK, no longer needed |
| `recoil` | ~~0.4.1~~ | ✅ Removed | Replaced with React Context |

**React Migration**: ✅ COMPLETE (16 → 17 → 18.2)
- No legacy lifecycle methods found (0 instances)
- Only 2 class components (ErrorBoundary, StepExplorer) — both compatible
- Entry points migrated to createRoot API
- Test files still use legacy ReactDOM.render (deprecated warnings; clean up with Jest 29)

---

### 🔴 Critical: Redux Removal

**Decision**: Remove Redux entirely. Use React's built-in state management (no replacement library).

**Rationale**:
- Redux adds massive boilerplate for what this application needs
- Modern React 18 has excellent built-in state management
- No additional libraries needed
- Dramatically simpler codebase
- Easier onboarding for contributors

**Current Redux Architecture (TO BE DELETED)**:
```
┌─────────────────────────────────────────────────────────┐
│ App Store (features/store.ts)                           │
│ ├── files slice (1200+ lines)                          │
│ ├── project slice                                       │
│ ├── user slice                                          │
│ ├── viewer slice                                        │
│ ├── search slice                                        │
│ ├── toast slice                                         │
│ └── examples slice                                      │
├─────────────────────────────────────────────────────────┤
│ Simulator Store (features/simulator/store.ts)           │
│ └── simulator slice (1800+ lines)                      │
├─────────────────────────────────────────────────────────┤
│ Middleware: localStorage, analytics, RxJS sync          │
├─────────────────────────────────────────────────────────┤
│ Async: createAppAsyncThunk                              │
└─────────────────────────────────────────────────────────┘
```

**Target Architecture (React Built-ins Only)**:
```
┌─────────────────────────────────────────────────────────┐
│ React Context + Hooks (where truly needed)              │
│ ├── ProjectContext - project state                     │
│ ├── SimulatorContext - simulation state                │
│ └── Component-local state for everything else          │
├─────────────────────────────────────────────────────────┤
│ Simple hooks for persistence                            │
│ └── useLocalStorage() for persistence                  │
├─────────────────────────────────────────────────────────┤
│ Async: Regular async functions                          │
└─────────────────────────────────────────────────────────┘
```

**Packages Removed**:
- ~~`@reduxjs/toolkit`~~ ✅ Removed — replaced with `reduxCompat.ts`
- ~~`react-redux`~~ ✅ Removed — replaced with `useSyncExternalStore`
- ~~`redux`~~ ✅ Removed — transitive dep of RTK
- ~~`recoil`~~ ✅ Removed — replaced with React Context
- `rxjs` — still used (analysis middleware, experiment queueing, search)

**Redux Slice Migration Progress**:
- [x] `search` (4 consumers) → `SearchContext` — fully removed from Redux
- [x] `viewer` (22 consumers) → `ViewerContext` — pure React (useReducer), no Redux dependency
- [x] `user` (15 consumers) → `UserContext` — pure React (useReducer), no Redux dependency
- [x] `toast` (4 consumers) → `ToastContext` — pure React (useState), no Redux dependency
- [x] `examples` (2 consumers) → `ExamplesContext` — pure React (useState), no Redux dependency
- [x] `project` (88 consumers) → `ProjectContext` — pure React (useReducer), no Redux dependency
- [x] `files` (80 consumers) → `FilesContext` — pure Immer reducer with useReducer, no RTK dependency
- [x] `simulator` store (35 consumers) → still uses Redux (useSimulatorSelector/useSimulatorDispatch)
- [x] Swap context facade internals from Redux to pure React state (useReducer)
  - App Store completely removed; all 7 app contexts are pure React
  - Files slice converted from RTK `createSlice` to pure Immer reducer
  - Entity adapter replaced with pure TypeScript implementation
  - Actions converted from `createAction` to plain action creators
  - Selectors use `reselect` directly (no RTK re-export)
  - `immer` and `reselect` added as direct dependencies
- [x] Rebuild scopes system as context-aware hooks
- [x] Rebuild localStorage persistence and auto-save as useEffect hooks
- [x] Convert simulator store from configureStore to pure SimpleStore
  - Created `reduxCompat.ts` compatibility layer (createSlice, createAction, createEntityAdapter, createStore)
  - Replaced configureStore with createStore (minimal Redux-compatible store with middleware/thunk support)
  - Replaced react-redux Provider with useSyncExternalStore
  - Zero source files import from @reduxjs/toolkit or redux
  - Only .spec.tsx test files still reference react-redux (pre-existing)
- [x] Remove `@reduxjs/toolkit`, `react-redux` packages from package.json
- [x] Re-enable `useUnknownInCatchVariables` in tsconfig (fixed 3 catch clauses)
- [x] Update .spec.tsx test files to remove react-redux usage (done with Jest 29 upgrade)

**Packages to Add**:
- None (React 18 built-ins are sufficient)

---

### ✅ Done: Sentry Removal

Sentry and related analytics integrations have been removed:
- `@sentry/browser`, `@sentry/integrations`, `@sentry/tracing`, `@sentry/fullstory`, `@sentry/webpack-plugin` removed
- `@fullstory/browser` removed
- `initSentry()` removed from `boot.ts`; `src/util/initSentry.ts` deleted
- Sentry webpack plugin removed from `webpack.config.js`
- `trackEvent`/`trackEvents` converted to no-op stubs

---

### ✅ Done: Dev Tooling Cleanup

- `@welldone-software/why-did-you-render` removed
- Initialization code removed from `src/index.tsx`
- Discord widget removed from HashCore

---

### Redux Migration Strategy

#### Step 1: Audit state usage
Analyze each Redux slice and categorize:
- **Truly global**: Needs Context (project, user auth)
- **Component tree local**: Lift to common ancestor with useState
- **Single component**: Keep as local state

#### Step 2: Create minimal Context for truly global state
```typescript
// contexts/ProjectContext.tsx
import { createContext, useContext, useState, ReactNode } from 'react';

interface ProjectContextValue {
  project: Project | null;
  setProject: (project: Project | null) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project | null>(null);
  return (
    <ProjectContext.Provider value={{ project, setProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export const useProject = () => {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be within ProjectProvider');
  return ctx;
};
```

#### Step 3: Simple localStorage hook
```typescript
// hooks/useLocalStorage.ts
import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : initial;
  });
  
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  
  return [value, setValue] as const;
}
```

#### Step 4: Migrate components
```typescript
// Before (Redux)
import { useSelector, useDispatch } from 'react-redux';
import { selectCurrentProject } from '../features/project/selectors';

const MyComponent = () => {
  const dispatch = useDispatch();
  const project = useSelector(selectCurrentProject);
  const handleClick = () => dispatch(setProject(newProject));
};

// After (React Context)
import { useProject } from '../contexts/ProjectContext';

const MyComponent = () => {
  const { project, setProject } = useProject();
  const handleClick = () => setProject(newProject);
};
```

#### Step 5: Delete Redux infrastructure

**Files to Delete** (entire `features/` directory structure):
- `src/features/store.ts`
- `src/features/rootReducer.ts`
- `src/features/simulator/store.ts`
- `src/features/simulator/context.tsx`
- `src/features/*/slice.ts`
- `src/features/*/selectors.ts`
- `src/features/middleware/*`
- `src/features/actionObservable.ts`
- `src/features/createAppAsyncThunk.ts`
- `src/features/types.ts`

**Files to Update**:
- `src/components/App/App.tsx` - Remove Provider, add Context providers
- `src/boot.ts` - Remove store setup
- All components using `useSelector`/`useDispatch`

**Estimated Effort**: 4-6 weeks for complete removal

**Benefits**:
- ~15KB+ bundle reduction (RTK + react-redux + redux)
- No Redux DevTools, actions, reducers, selectors, thunks, middleware
- Standard React patterns - no learning curve
- Dramatically simpler mental model

### 🔴 Critical: Abandoned/Deprecated Packages

| Package | Status | Replacement |
|---------|--------|-------------|
| `hookrouter` 1.2.3 | ✅ Removed | Custom `usePathRouter` + `navigate` utilities |
| `request` 2.88.2 | ✅ Removed | `fetch` API |
| `request-promise-native` | ✅ Removed | `fetch` API |
| `@material-ui/core` 4.11.4 | ⚠️ Renamed/Deprecated | `@mui/material` 5.x |
| `@material-ui/lab` | ⚠️ Renamed/Deprecated | `@mui/lab` 5.x |
| `react-three-fiber` 5.0.6 | ✅ Migrated | `@react-three/fiber` 8.18.0 |
| `drei` 1.5.7 | ✅ Migrated | `@react-three/drei` 9.122.0 |
| `recoil` 0.4.1 | ✅ Removed | Replaced with React Context (`SceneContext.tsx`) |

**Action Items**:
- [x] Replace `hookrouter` with custom `usePathRouter` + `navigate` utilities
- [x] Replace `request`/`request-promise-native` with fetch
- [x] Remove `@material-ui/*` (only used by deleted staging deploy tool)
- [x] Migrate `react-three-fiber` 5.0.6 to `@react-three/fiber` 8.18.0
- [x] Migrate `drei` 1.5.7 to `@react-three/drei` 9.122.0
- [x] Upgrade `three` 0.119.1 to 0.170.0
- [x] Remove `recoil` 0.4.1 (replaced with React Context in SceneContext.tsx)

### ✅ Done: Build Tooling — Migrate Webpack 4 → Vite

| Package | Current | Action | Notes |
|---------|---------|--------|-------|
| `webpack` | ~~4.44.2~~ **removed** | ✅ Done | Replaced by Vite 7 |
| `webpack-cli` | ~~3.3.12~~ **removed** | ✅ Done | |
| `webpack-dev-server` | ~~3.11.0~~ **removed** | ✅ Done | Vite dev server replaces this |
| `typescript` | ~~4.1.3~~ **5.3.3** | ✅ Done | `satisfies`, const type params, decorators |
| `jest` | 26.6.3 | 29.7+ | Or migrate to Vitest |
| `ts-jest` | ~~26.4.4~~ **removed** | ✅ Done | Switched to `babel-jest` (ts-jest 26 incompatible with TS 5) |
| `babel-loader` | ~~8.2.1~~ **removed** | ✅ Done | Vite uses esbuild for dev, Rollup for prod |
| `Node.js` | ~~20.8.0~~ **24.13.1** | ✅ Done | Upgraded to 24 LTS |

**Decision**: ✅ COMPLETE - Migrated to Vite 7. Benefits achieved:
- Sub-second dev server startup (vs 30s+ with Webpack 4)
- Native ESM, HMR via esbuild
- Eliminates `--openssl-legacy-provider` workaround
- Modern toolchain, better DX
- Simpler config (~30 lines vs ~300 lines)

**Migration completed**: All steps completed successfully:
1. ✅ Upgraded Node.js 20 → 24 LTS
2. ✅ Installed Vite + plugins (`@vitejs/plugin-react`, `vite-plugin-wasm`, `vite-plugin-top-level-await`, `vite-plugin-monaco-editor`)
3. ✅ Created `vite.config.ts` with resolve aliases, define globals, SCSS support
4. ✅ Moved HTML entry to project root (Vite convention), added module script tags
5. ✅ Replaced `!!raw-loader!` imports with Vite `?raw` suffix
6. ✅ Refactored worker loading for Vite
7. ✅ Verified WASM loading works via `vite-plugin-wasm`
8. ✅ Removed webpack magic comments from dynamic imports
9. ✅ Simplified build stamp system
10. ✅ Updated npm scripts, verified build + tests, removed all webpack infrastructure

**Packages to add**: `vite`, `@vitejs/plugin-react`, `vite-plugin-wasm`, `vite-plugin-top-level-await`, `vite-plugin-monaco-editor`

**Packages removed**: `webpack`, `webpack-cli`, `webpack-dev-server`, `html-webpack-plugin`, `webpack-manifest-plugin`, `webpack-messages`, `webpack-retry-chunk-load-plugin`, `unused-modules-webpack-plugin`, `url-loader`, `file-loader`, `raw-loader`, `css-loader`, `style-loader`, `babel-loader`, `source-map-loader`, `null-loader`, `monaco-editor-webpack-plugin`, `postcss-loader`, `sass-loader`, and many `@babel/*` packages (Vite uses esbuild).

**Note**: `engine-web/webpack.config.js` (stdlib build) is a separate concern — can stay on Webpack or be converted to esbuild later.

### 🟠 High: Significant Version Gaps

| Package | Current | Latest | Gap |
|---------|---------|--------|-----|
| `monaco-editor` | 0.25.2 | 0.45+ | 20 versions |
| `three` | ~~0.119.1~~ **0.170.0** | ✅ Done | Upgraded with @react-three/fiber v8 |
| `rxjs` | 6.6.6 | 7.8+ | Major version |
| `plotly.js` | ~~1.57.1~~ **3.3.1** | ✅ Done | Upgraded to `plotly.js-dist-min` (ESM-ready) |
| `@sentry/browser` | 6.2.0 | - | **REMOVING** |
| `@deck.gl/core` | 8.3.7 | 8.9+ | |
| `graphql` | 15.5.0 | 16.8+ | Major version |
| `date-fns` | 2.17.0 | 3.3+ | Major version |

### 🟡 Medium: Build/Dev Optimizations

- [x] Silence SCSS deprecation warnings (silenceDeprecations in vite.config.ts)
- [x] Fix `?? false` esbuild warning in Analysis/modals.ts
- [x] Suppress Playwright webServer stderr for cleaner E2E output
- [x] Add `serve:quiet` script for minimal-output dev server

### 🟡 Medium: Testing Infrastructure

| Issue | Current State | Recommended |
|-------|---------------|-------------|
| Test runner | Jest 26 | Jest 29 or Vitest |
| React testing | @testing-library/react 11 | @testing-library/react 14+ |
| E2E tests | None | **Playwright** (see Migration Regression Tests below) |
| Coverage | Unknown | Add coverage requirements |

---

## Migration Regression Tests (Playwright E2E)

**Purpose**: Ensure application integrity during Redux removal and other migrations.

### Test Suite Overview

These E2E tests should pass before AND after each migration phase:

```
tests/e2e/
├── playwright.config.ts     # Playwright configuration
├── smoke.spec.ts            # Quick health check
├── simulation-run.spec.ts   # Core simulation functionality  
└── fixtures/
    └── test-helpers.ts      # Shared test utilities
```

### Critical Test Scenarios

#### 1. Smoke Test (`smoke.spec.ts`)
- [ ] Application loads without errors
- [ ] No console errors on startup
- [ ] Main UI elements render (editor, viewer, controls)

#### 2. Simulation Run Test (`simulation-run.spec.ts`)
- [ ] Load built-in "Wildfires - Regrowth" simulation
- [ ] Verify simulation initializes (step 0)
- [ ] Click "Step" button 5 times
- [ ] Verify step count increases to 5
- [ ] Verify 3D viewer or Raw Output shows agent data
- [ ] Click "Play" button
- [ ] Verify simulation runs (step count increases automatically)
- [ ] Click "Pause" button
- [ ] Verify simulation stops
- [ ] Click "Reset" button
- [ ] Verify simulation resets to step 0

#### 3. State Persistence Test
- [ ] Make changes (run simulation)
- [ ] Refresh page
- [ ] Verify appropriate state is restored

### Test Implementation

**Package to Add**:
```bash
yarn add -D @playwright/test
```

**Key Selectors** (from codebase analysis):
```typescript
// Simulation controls
const SELECTORS = {
  stepButton: '.step.simulation-control button',
  playPauseButton: '.playpause.simulation-control button',
  resetButton: '.reset.simulation-control button',
  stepCounter: '.simulation-control-container .step-display', // or timeline
  rawOutputTab: '[data-tab="raw-output"]',
  rawOutputContent: '.monaco-editor', // Raw output uses Monaco
  agentViewer: '.agent-scene', // 3D viewer
  simulationViewer: '.SimulationViewer',
};
```

**Example Test**:
```typescript
// tests/e2e/simulation-run.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Simulation Execution', () => {
  test.beforeEach(async ({ page }) => {
    // Load the app with built-in wildfires simulation
    await page.goto('/@hash/wildfires-regrowth/main');
    // Wait for app to fully load
    await page.waitForSelector('.simulation-control-container');
  });

  test('should run simulation for multiple steps', async ({ page }) => {
    // Get initial step (should be 0 or undefined)
    const timeline = page.locator('.timeline');
    
    // Click step button 5 times
    const stepButton = page.locator('.step.simulation-control button');
    for (let i = 0; i < 5; i++) {
      await stepButton.click();
      // Wait for step to complete
      await page.waitForTimeout(500);
    }
    
    // Verify we're at step 5
    await expect(timeline).toContainText('5');
  });

  test('should display agent data in viewer', async ({ page }) => {
    // Step once to generate data
    await page.locator('.step.simulation-control button').click();
    await page.waitForTimeout(1000);
    
    // Check that either 3D viewer or raw output has content
    const viewer = page.locator('.SimulationViewer');
    await expect(viewer).toBeVisible();
    
    // Switch to raw output tab if available
    const rawTab = page.locator('[data-testid="raw-output-tab"]');
    if (await rawTab.isVisible()) {
      await rawTab.click();
      const output = page.locator('.monaco-editor');
      await expect(output).toContainText('['); // JSON array of agents
    }
  });

  test('should reset simulation', async ({ page }) => {
    // Run a few steps
    const stepButton = page.locator('.step.simulation-control button');
    await stepButton.click();
    await stepButton.click();
    await page.waitForTimeout(500);
    
    // Reset
    await page.locator('.reset.simulation-control button').click();
    await page.waitForTimeout(500);
    
    // Verify reset (step should be 0)
    // Implementation depends on how step is displayed
  });
});
```

### Running Tests

```bash
# Install Playwright browsers (first time)
npx playwright install

# Run all E2E tests
yarn test:e2e

# Run with UI mode (debugging)
yarn test:e2e:ui

# Run specific test file
yarn test:e2e simulation-run.spec.ts
```

### CI Integration

Add to `.github/workflows/`:
```yaml
e2e-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '18'
    - run: yarn install
    - run: yarn build:core
    - run: npx playwright install --with-deps
    - run: yarn test:e2e
```

### Migration Checkpoints

Run E2E tests at each migration phase:

| Phase | Before | After | Notes |
|-------|--------|-------|-------|
| Analytics removal | ✓ | ✓ | Should have no impact |
| Auth/Cloud removal | ✓ | ✓ | May simplify app |
| Dev tooling removal | ✓ | ✓ | Should have no impact |
| Redux removal Step 1 | ✓ | ✓ | Create contexts |
| Redux removal Step 2 | ✓ | ✓ | Migrate components |
| Redux removal Step 3 | ✓ | ✓ | Delete Redux files |
| React 16 → 17 | ✓ | ✓ | Compatibility |
| React 17 → 18 | ✓ | ✓ | createRoot migration |

### Feature Coverage for E2E Tests

The following features are being KEPT and are now covered by E2E tests:

#### Core Simulation (HIGH priority) ✅ IMPLEMENTED
- [x] **Simulation Controls**: Step, Play/Pause, Reset (`simulation-run.spec.ts`)
- [x] **Timeline/Scrubber**: Timeline presence verified (`simulation-run.spec.ts`)
- [x] **Simulation Initialization**: Load builtin simulation (`smoke.spec.ts`)

#### Viewer Tabs (MEDIUM priority) ✅ IMPLEMENTED
- [x] **3D Viewer (AgentScene)**: Viewer displays content (`viewer-tabs.spec.ts`)
- [x] **Geospatial (MapViewer)**: Tab loads when available (`viewer-tabs.spec.ts`)
- [x] **Analysis/Plots**: Tab renders with data (`viewer-tabs.spec.ts`)
- [x] **Process Chart**: Tab presence tested (`viewer-tabs.spec.ts`)
- [x] **Raw Output**: JSON agent state displays (`viewer-tabs.spec.ts`, `simulation-run.spec.ts`)
- [ ] **Step Explorer**: Agent state inspection (TODO)

#### Code Editing (HIGH priority) ✅ IMPLEMENTED
- [x] **Monaco Editor**: Opens, content visible (`file-management.spec.ts`)
- [x] **Multi-file tabs**: Can switch files (`file-management.spec.ts`)
- [x] **File Tree**: Navigate project files (`file-management.spec.ts`)
- [x] **Create Behavior**: Add behavior action available (`dependencies.spec.ts`)
- [x] **Behavior Keys**: Context tested (`dependencies.spec.ts`)

#### File Management (MEDIUM priority) ✅ IMPLEMENTED
- [x] **File Tree Operations**: Display and click (`file-management.spec.ts`)
- [x] **Import .zip**: File input accessible (`file-management.spec.ts`)
- [x] **Export .zip**: Export option accessible (`file-management.spec.ts`)

#### Experiments (LOW priority) ✅ IMPLEMENTED
- [x] **Local Experiment Runner**: Button, menu, modal tested (`experiments.spec.ts`)
- [x] **Experiment Configuration**: Parameter sweep options (`experiments.spec.ts`)

#### Dependencies (MEDIUM priority) ✅ IMPLEMENTED
- [x] **hIndex Search**: Search functionality present (`dependencies.spec.ts`)
- [x] **Add Dependency**: Add behavior action accessible (`dependencies.spec.ts`)
- [x] **Shared Behavior Indicator**: Indicator checked (`dependencies.spec.ts`)

#### UI/UX (LOW priority) ✅ IMPLEMENTED
- [x] **Onboarding Tour**: Tour dismissible, elements render (`ui-features.spec.ts`)
- [x] **Keyboard Shortcuts**: Step, search, save tested (`ui-features.spec.ts`)
- [x] **Error Boundaries**: No render errors assertion (`all spec files`)
- [x] **Window Resize**: Graceful handling (`ui-features.spec.ts`)

#### Local Storage (HIGH priority) ✅ IMPLEMENTED
- [x] **localStorage Usage**: Values stored (`persistence.spec.ts`)
- [x] **App Reload**: State survives refresh (`persistence.spec.ts`)
- [x] **Preferences**: localStorage errors handled (`persistence.spec.ts`)
- [x] **Local Simulation**: WASM runs locally (`persistence.spec.ts`)
- [ ] **Project Persistence**: Full project save (TODO - post-migration)

### E2E Test Files Summary

| File | Tests | Status |
|------|-------|--------|
| `smoke.spec.ts` | 4 | ✅ All passing |
| `simulation-run.spec.ts` | 10 | ✅ Core passing |
| `viewer-tabs.spec.ts` | 7 | ✅ Implemented |
| `file-management.spec.ts` | 8 | ✅ Implemented |
| `experiments.spec.ts` | 5 | ✅ All passing |
| `ui-features.spec.ts` | 9 | ✅ Implemented |
| `persistence.spec.ts` | 9 | ✅ Implemented |
| `dependencies.spec.ts` | 7 | ✅ Implemented |

**Total: 66 tests covering all identified features**

### 🟢 Low: Minor Updates Needed

| Package | Current | Latest |
|---------|---------|--------|
| `classnames` | 2.3.1 | 2.5+ |
| `uuid` | 8.3.1 | 9.0+ |
| `jszip` | 3.7.0 | 3.10+ |
| `lodash-es` | 4.17.21 | 4.17.21 ✓ |
| `immer` | (via RTK) | Included in RTK 2.x |

---

## sim-engine (Rust)

### 🔴 Critical: Rust Toolchain

```toml
# Updated (rust-toolchain.toml)
channel = "nightly-2024-12-01"  # Updated from nightly-2022-08-08
```

**Status**: Toolchain updated. sim-core engine crates also updated from edition 2018 to 2021.
- [ ] Verify `cargo build` succeeds with new toolchain (sim-engine)
- [ ] Verify `wasm-pack build` succeeds (engine-web)
- [ ] Run `cargo test` to check for regressions

### 🟠 High: Dependency Updates

| Crate | Current | Latest | Notes |
|-------|---------|--------|-------|
| `tokio` | 1.19.2 | 1.36+ | Performance improvements |
| `serde` | 1.0.138 | 1.0.196+ | |
| `serde_json` | 1.0.82 | 1.0.114+ | |
| `tracing` | 0.1.35 | 0.1.40+ | |
| `tracing-subscriber` | 0.3.14 | 0.3.18+ | |
| `clap` | 3.x | 4.5+ | Major version, API changes |

### 🟡 Medium: Code Quality

- [ ] Run `cargo audit` to check for security vulnerabilities
- [ ] Run `cargo outdated` for comprehensive dependency check
- [ ] Consider adding `cargo-deny` for license/advisory checks
- [ ] Update to Rust Edition 2024 when stable (currently 2021)

### Wishlist (after migration plan): Python Runner Environment (sim-engine)

- [ ] **Repair Python runner for cross-platform testing** (consider after finishing the rest of the migration plan)  
  The engine’s Python behavior runner (e.g. `lib/execution/src/runner/python/`, `setup.sh`, `requirements.txt`) is Unix-oriented and does not run reliably on Windows (spawn via `sh`/`run.sh`, no Windows path). Rather than maintaining a Windows-specific Python setup on every developer machine, **run Python runner tests stably inside a Docker container** so CI and contributors get a consistent environment (e.g. Linux + Python 3.10 in Docker) instead of requiring a local Python/venv on Windows or macOS.

---

## hash-agents (Python POC)

### 🔴 Critical: Complete API Rewrites Required

| Package | Current | Latest | Breaking Changes |
|---------|---------|--------|------------------|
| `langchain` | 0.0.199 | 0.1.x | **Complete rewrite**: split into langchain-core, langchain-community |
| `openai` | 0.27.8 | 1.12+ | **Complete rewrite**: new client API, async support |
| `pydantic` | 1.10.7 | 2.6+ | **Major changes**: new validation syntax |

**Migration Effort**: HIGH - These are not simple version bumps.

**LangChain Migration**:
```python
# Old (0.0.x)
from langchain import LLMMathChain
from langchain.chat_models import ChatOpenAI

# New (0.1.x)
from langchain_openai import ChatOpenAI
from langchain.chains import LLMMathChain
# Or use LCEL (LangChain Expression Language)
```

**OpenAI Migration**:
```python
# Old (0.27.x)
import openai
openai.api_key = "..."
response = openai.ChatCompletion.create(...)

# New (1.x)
from openai import OpenAI
client = OpenAI()
response = client.chat.completions.create(...)
```

### 🟠 High: Other Dependencies

| Package | Current | Latest | Notes |
|---------|---------|--------|-------|
| `fastapi` | 0.95.1 | 0.109+ | |
| `uvicorn` | 0.21.1 | 0.27+ | |
| `ruff` | 0.0.262 | 0.2+ | Config format changes |
| `black` | 23.3.0 | 24.2+ | |

---

## Recommended Prioritization

### Phase 1: Cleanup & Simplification
1. [x] **Remove Analytics & Widgets**
   - [x] Remove Sentry (`@sentry/*` packages)
   - [x] Remove FullStory (`@fullstory/browser`)
   - [x] Remove Discord widget
   - [x] Remove why-did-you-render
2. [x] Run security audits (npm audit: 113 vulns, all in transitive deps - need major upgrades of vega, cypress)
3. [x] Replace abandoned `hookrouter` (custom usePathRouter + navigate utilities)
4. [x] Replace deprecated `request` package (replaced with native fetch)
5. [x] Update Rust nightly toolchain (nightly-2024-12-01, needs build verification)

### Phase 1 Review Findings (Feb 2026)

During Phase 1 verification, we discovered and fixed:
- **Orphaned files**: `Modal/Release/` had leftover `.scss`, `.spec.tsx`, `util.ts`, and `VersionPicker/` after component deletion. All cleaned up.
- **`bowser` dependency**: Was declared in `core/package.json` but only used by `engine-web`. Moved to `engine-web/package.json` where it belongs. This was a pre-existing build error.
- **TypeScript errors from hookrouter migration**: `navigate()` type signature didn't accept boolean query params (hookrouter did). `RouteHandler` type was too strict. `useScopes` called with 1 arg after `Scope.login` removal (requires 2; switched to `useScope`). All fixed.
- **Build verification**: Vite production build passes (exit 0, warnings only). Jest 124/124 suites pass, 369 tests pass.
- **Pre-existing warnings**: wasm critical dependency warning in engine-web, asset size limit warnings — resolved with Vite migration.

### Phase 2: Remove Auth & Cloud Features — ✅ COMPLETE
All items completed in Migration Phases above (Phases 2–5).
- [x] Remove user authentication, signin/signup, cloud credits
- [x] Remove hCloud runners, server-side save, sharing, access codes
- [x] Remove ModalRelease, fork, server metadata sync
- [x] Implement localStorage persistence, local templates, zip import/export

### Phase 3: Build System Modernization
1. [x] Upgrade TypeScript 4.1 → 5.3.3
   - fork-ts-checker-webpack-plugin upgraded to 6.5.3
   - Jest switched from ts-jest to babel-jest (ts-jest 26 incompatible with TS 5)
   - ~80 RTK 1.5 dispatch type errors suppressed (resolve when Redux removed)
   - `useUnknownInCatchVariables: false` set in tsconfig (re-enable after Redux removal)
2. [x] Upgrade Node.js 20 → 24 LTS
3. [x] Migrate Webpack 4 → Vite (see Build Tooling section for detailed plan)
   - [x] Install Vite + plugins, create vite.config.ts
   - [x] Create HTML entry files at project root
   - [x] Replace raw-loader imports with ?raw suffix
   - [x] Refactor worker loading for Vite
   - [x] Verify WASM loading in main thread and workers
   - [x] Remove webpack magic comments
   - [x] Simplify build stamp system
   - [x] Update scripts, verify build + tests
   - [x] Remove webpack infrastructure and dependencies
4. [x] Remove `--openssl-legacy-provider` workaround (resolved by Vite migration)
5. [x] Update Jest 26 → 29
   - Upgraded jest, @types/jest, babel-jest to 29.7.0
   - Added jest-environment-jsdom, removed ts-jest
   - Fixed ESM compatibility (nanoid, TextEncoder polyfill)
   - Cleaned up 14 test files (removed react-redux, added context mocks)
   - 118/119 suites pass, 310 tests pass

### Phase 4: React & State Management
1. [x] React 16 → 17 → 18.2 migration (no legacy lifecycle blockers; createRoot migrated)
2. [x] **Remove Redux entirely** — ✅ COMPLETE
   - [x] All 7 app context facades migrated to pure React (useState/useReducer)
   - [x] Files slice: pure Immer reducer, pure entity adapter
   - [x] Simulator store: replaced with SimpleStore (reduxCompat.ts)
   - [x] All source imports migrated from RTK to reduxCompat.ts
   - [x] `@reduxjs/toolkit` and `react-redux` removed from package.json
   - [x] `useUnknownInCatchVariables` re-enabled
   - [x] Clean up .spec.tsx test files (removed react-redux from 14 files)
3. [x] ~~Remove Recoil~~ Already removed (replaced with SceneContext.tsx)
4. [x] ~~@material-ui → @mui migration~~ Removed (only used by deleted staging tool)
5. [x] ~~react-three-fiber → @react-three/fiber~~ Migrated to v8.18.0
6. [x] ~~drei → @react-three/drei~~ Migrated to v9.122.0

### Phase 4b: Post-Migration Cleanup (Codebase Assessment Feb 2026)

Found during a comprehensive codebase audit after completing Phases 1–4.

#### 🔴 High: Dead Code Removal

- [x] **Delete dead GraphQL query files** (5 files):
  - `src/util/api/queries/trackTourProgress.ts` — tour progress stored locally
  - `src/util/api/queries/myProjects.ts` — server call never invoked (move `prepareUserProjects` to bootstrapQuery)
  - `src/util/api/queries/exampleSimulations.ts` — server call never invoked (move `prepareExamples` to bootstrapQuery)
  - `src/util/api/queries/createDatasetQuery.ts` — imported but never called
  - `src/util/api/queries/addDatasetToProject.ts` — not imported anywhere
  - Remove dead exports from `util/api/index.ts` and `util/api/queries/index.ts`
- [x] **Remove stale hCloud UI references** (5 files):
  - `components/Modal/Experiments/ExperimentModal.tsx` — "Save and run in hCloud" button text, "in hCloud" vs "locally" text
  - `components/HashCore/Header/Menu/CloudStatus/HashCoreHeaderMenuCloudStatus.tsx` — "Contact us to use hCloud" text
  - `components/FileBanner/PythonSafari/FileBannerPythonSafari.tsx` — hCloud text reference
  - `features/simulator/simulate/provider.ts` — stale comment
- [x] **Remove stale login/signin component** (FileBannerSignIn deleted):
  - `components/FileBanner/SignIn/FileBannerSignIn.tsx` — component for deleted feature
  - `components/FileBanner/Wrapper/FileBannerWrapper.tsx` — imports and uses FileBannerSignIn
  - `features/user/utils.ts` — `navigate("/signin")` call
  - `features/scopes.ts` — `Scope.login`, `Scope.forkIfSignedIn`, `Scope.saveIfSignedIn` are dead
  - `components/HashRouter/Effect/routes.tsx` — `/signup`, `/signin` route stubs
- [x] **Remove dead release toast components**:
  - `components/Toast/ReleaseSuccess/ToastReleaseSuccess.tsx`
  - `components/Toast/ReadOnlyRelease/ToastReadOnlyRelease.tsx`
  - `components/Toast/ReleaseBehaviorSuccess/ToastReleaseBehaviorSuccess.tsx`
- [x] **Remove Discord remnants**:
  - `components/Icon/Discord/` — icon component directory
  - `styles.css` — CSS variables `--discord-button-y-offset`, `--discord-button-size`
  - `components/ActivityHistory/Inspector/Inspector.css` — uses Discord CSS variables
- [x] **Remove dead utility files**:
  - `util/postFormData.ts` — file upload utility (server uploads removed)
  - `util/prepareFormDataWithFile.ts` — file upload utility (server uploads removed)
  - Remove imports from `features/files/slice.ts`

#### 🔴 High: Module Modernization

- [x] **Replace `lodash` imports with `lodash-es`** (27 files):
  - `features/simulator/simulate/util.ts`, `features/monaco/monaco.ts`, `features/files/selectors.ts`,
    `features/files/FilesContext.tsx`, `components/Analysis/AnalysisViewer.tsx`, and 15+ more
  - Currently importing CommonJS `lodash` instead of ESM `lodash-es` — prevents tree-shaking
  - Global find-replace: `from "lodash` → `from "lodash-es` (and `from "lodash/` → `from "lodash-es/`)
- [x] ~~**Replace `process.env.NODE_ENV`**~~ — kept as-is; Vite natively replaces `process.env.NODE_ENV`
- [x] **Rename `WEBPACK_BUILD_STAMP` to `BUILD_STAMP`** — all webpack naming removed from source

#### 🟡 Medium: Commented/Stubbed Code Cleanup

- [x] **Clean up stubbed GraphQL queries** — removed commented-out server calls from 3 files
- [x] **Clean up stale SCSS comments** — ModalShare reference removed
- [x] **Remove `trackEvent` stubs** — deleted `features/analytics.ts` and all 20+ call sites
- [x] **Remove `require()` in ProjectContext.tsx** — replaced with static import

#### 🟡 Medium: Stale Dependencies

- [x] **Remove unused packages from workspace root** — `yarn-audit-fix`, `yarn-run-all` removed
- [x] **Move webpack-only deps to engine-web** — webpack, webpack-cli, babel-loader moved
- [x] **Upgrade Babel packages** — all @babel/* to 7.28+, removed obsolete proposal plugins, removed core-js
- [x] **Upgrade linting/formatting tools**:
  - ESLint 7.29 → 9.39, flat config format, typescript-eslint 8.56
  - Prettier 2.2 → 3.8
  - Removed eslint-plugin-react, eslint-plugin-import (simplified)
  - Fixed 87 lint errors (unused imports + short identifiers)
  - Added @types/lodash-es
- [x] **Remove GraphQL codegen infrastructure**:
  - Deleted `auto-types.ts` (21k lines, 127KB) and `graphql-schema.json` (679KB)
  - Created `apiTypes.ts` (~160 lines) with manually-defined types
  - Removed `codegen.yml` and `yarn codegen` from all build scripts
  - Removed `graphql`, `@graphql-codegen/*` packages (5 packages)
  - Deleted dead `partialProjectByPath.ts` query
  - Note: 6 queries still send GraphQL strings via fetch; the server API hasn't changed
- [x] **Upgrade @testing-library/react** 11.2 → 14.2 (+ @testing-library/dom 9)

#### 🟢 Low: Type Safety Improvements

- [x] **Audit and fix `@ts-ignore` / `@ts-expect-error` comments**:
  - Fixed 17 of 30 instances (removed 4, replaced 8 with casts, converted 5 to @ts-expect-error)
  - 10 remaining are in dead `whyDidYouRender` blocks (commented-out code)
  - 3 remaining are genuine library type gaps (deck.gl, luma.gl, gradient-path — no types)
- [x] **Fix TypeScript errors** — reduced from 45 to 40 (all remaining are library type issues)
- [x] **Migrate test files from `ReactDOM.render` to `@testing-library/react`** — 107 spec files migrated

### Phase 5: Future - GitHub Integration (Post-Migration)
- [ ] Design GitHub OAuth flow (no HASH account)
- [ ] Implement save/load from user's GitHub repos
- [ ] Add project sync functionality

### Phase 6: Python Modernization (If Needed)
1. [ ] OpenAI 0.27 → 1.x migration
2. [ ] Pydantic 1.x → 2.x migration
3. [ ] LangChain complete rewrite to 0.1.x architecture

### CI/CD (assessed Feb 2026)

**Current state**: Only Rust CI exists (`.github/workflows/rust.yml`). There is NO frontend CI — TypeScript errors, test failures, and build breakages are not caught automatically.

#### 🔴 High: Add Frontend CI

- [x] **Create `frontend.yml` workflow**: ESLint + TypeScript + Jest + Vite build
- [x] **Create `e2e.yml` workflow**: Playwright E2E tests with artifact upload

#### 🟡 Medium: Deployment Pipeline

- [ ] **Create `deploy.yml` workflow**: Deploy to static hosting
  - Options: GitHub Pages, Netlify, Vercel, Cloudflare Pages
  - Trigger: push to `main` (or manual dispatch)
  - Remove legacy `scripts/deploy.ts` (AWS S3 deployment)

#### 🟡 Medium: Clean Up Existing CI

- [x] **Update action versions** in `rust.yml` — checkout v4, setup-python v5, rust-cache v2, codeql-action v3
- [x] **Clean up Renovate config** — removed stale groups, added relevant package groups

#### 🟢 Low: Additional CI

- [ ] **Add WASM build verification** to frontend CI (or separate workflow)
  - Ensures `wasm-pack build` still succeeds after Rust changes
- [ ] **Add ESLint/Prettier check** to frontend CI
- [ ] **Add dependency audit** (`yarn audit`) as non-blocking check

### Ongoing Maintenance
- [x] ~~Establish automated dependency update process~~ Renovate is configured (needs cleanup)
- [ ] Add CI checks for outdated dependencies
- [ ] Document upgrade procedures for major dependencies

---

## Potential Removals (Updated Feb 2026)

### Package Status

| Package | Status | Notes |
|---------|--------|-------|
| `recoil` | ✅ Removed | Replaced with SceneContext |
| `@fullstory/browser` | ✅ Removed | Analytics removed |
| `@sentry/*` | ✅ Removed | Analytics removed |
| `@reduxjs/toolkit` | ✅ Removed | Replaced with reduxCompat.ts |
| `react-redux` | ✅ Removed | Replaced with useSyncExternalStore |
| `react-shepherd` | **KEEP** | Onboarding tour is staying |
| `@msrvida/sanddance-explorer` | **KEEP** | Data visualization staying |
| `gradient-path` | **KEEP** | Used in SVG visualization |
| `fp-ts` | **KEEP** | Used in PlotViewer, palette, GeospatialMap |
| `rxjs` | **KEEP** | Used in search, simulator, analysis middleware |
| `lodash-es` | **KEEP** | But fix 20+ files importing `lodash` instead |
| `yarn-audit-fix` | **REMOVE** | Not used in any script |
| `yarn-run-all` | **REMOVE** | Not used (`npm-run-all` used instead) |

### Consolidation Opportunities

| Current | Consolidate To |
|---------|----------------|
| `lodash` + `lodash-es` imports | `lodash-es` only (20+ files to fix) |
| `WEBPACK_BUILD_STAMP` variable | Rename to `BUILD_STAMP` |
| `process.env.NODE_ENV` | `import.meta.env.PROD` (Vite) |
| `yarn.lock` (sim-core) + `package-lock.json` (subdirs) | Yarn everywhere |

- [ ] **Standardize package manager to Yarn** across entire monorepo
  - Remove `package-lock.json` from `packages/core/tests/`, `sim-engine/stdlib/`, `sim-engine/apache-arrow-js-bundle/`
  - Convert those subprojects to use Yarn (or integrate into parent workspace) so all JS/TS deps use `yarn.lock` only

---

## Notes for AI Agents

When working on this codebase:

### Architecture Principles

1. **LOCAL-FIRST**: This app is becoming a free, fully-featured, local-only simulation IDE
2. **NO USER ACCOUNTS**: Don't add authentication, login flows, or user systems
3. **NO CLOUD FEATURES**: Don't add cloud storage, sharing, or server-side features
4. **NO ANALYTICS**: Don't add Sentry, FullStory, or tracking code
5. **GitHub sync is FUTURE**: Don't implement GitHub integration yet (post-migration)

### Known Build Issues

**Rollup tree-shaking crash on Windows**: Rollup 4's tree-shaking algorithm crashes silently during
production builds on Windows. The process is killed by the OS (no JavaScript error, no exit handler)
during the recursive module-graph walk with 7100+ modules. The crash persists across Node 22/24,
64MB native stacks, WASM Rollup backend, and JIT-disabled modes. Root cause is likely in Rollup's
native NAPI module corrupting the call stack during tree-shaking of deeply circular dependency chains
(`@msrvida/sanddance-explorer`, `office-ui-fabric-react`, `@fluentui/react`).

**Workaround**: `treeshake: false` in `vite.config.ts` rollupOptions. esbuild minification still
performs expression-level dead-code elimination. Manual chunks split vendor dependencies for caching.
Build completes in ~53s. Re-enabling tree-shaking is blocked on either a Rollup fix or replacing
the circular-dependency-heavy packages (`@fluentui/react` v7 → v9, `@msrvida/sanddance-explorer`).

### Monaco Model Creation (E2E Blocker)

After Redux removal, the Monaco editor's `subscribe()` was never wired to the appBridge. The monaco creates text models in response to store changes, but no code calls `subscribe(appBridge)`. As a result, `getTextModelRequired` throws "text model does not exist" when opening files, causing the app to hit the error boundary. This blocks E2E tests.

**Fix required**: Wire `subscribe` from `features/monaco` to `appBridge` in StoreSync, and add `appBridge.dispatch` that forwards `updateFile` actions to `filesDispatch`. Care must be taken to avoid infinite loops (model.setValue → onDidChangeContent → dispatch → setState → monaco listener → model.setValue).

### Code Guidance

1. **Redux is gone** — `@reduxjs/toolkit` and `react-redux` have been removed. Use React Context + hooks.
2. **Use `reduxCompat.ts` only for the simulator store** — all other state uses React Context directly.
3. **Test thoroughly after any dependency update** — many packages are interconnected.
4. **Check for breaking changes** before upgrading any major version.
5. **Import from `lodash-es`** not `lodash` — prevents tree-shaking issues.
6. **Use `import.meta.env`** not `process.env` — we use Vite, not Webpack.
7. **The Python POC may be stale** — verify if hash-agents is actively used before investing in updates.

### Features Already REMOVED (do not re-introduce)

- User authentication (ModalSignin, ModalSignup) — DELETED
- Cloud credits / CloudUsage — DELETED
- Project sharing (ModalShare*) — DELETED
- Access codes — DELETED
- Server project storage — DELETED
- Project releases/versioning (ModalRelease*) — DELETED
- hCloud experiment runners — DELETED
- Sentry / FullStory analytics — DELETED
- Discord widget — DELETED
- Redux / @reduxjs/toolkit / react-redux — DELETED

### State Management (Current)

```typescript
// App state — use context hooks
const { allFiles, updateFile } = useFiles();
const { currentProject } = useProject();
const { currentTab } = useViewer();

// Simulation state — use simulator hooks
const running = useSimulatorSelector(selectRunning);
const dispatch = useSimulatorDispatch();

// Local state
const [value, setValue] = useState(initial);

// Persistence
localStorage.setItem('project:' + projectId, JSON.stringify(projectData));
```

---

## References

- [React 18 Upgrade Guide](https://react.dev/blog/2022/03/08/react-18-upgrade-guide)
- [React Context Documentation](https://react.dev/reference/react/useContext)
- [LangChain 0.1.x Migration](https://python.langchain.com/docs/versions/migrating_chains)
- [OpenAI Python 1.x Migration](https://github.com/openai/openai-python/discussions/742)
- [Vite Migration from Webpack](https://vitejs.dev/guide/migration-from-v4)
