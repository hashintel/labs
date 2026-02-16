# Technical Debt & Modernization TODO

This document tracks outdated dependencies, deprecated patterns, and proposed upgrades for the HASH Labs monorepo.

**Last Updated**: February 2026  
**Analysis Scope**: sim-core, sim-engine, hash-agents

---

## Executive Summary

| Area | Severity | Effort | Notes |
|------|----------|--------|-------|
| React & React Ecosystem | 🔴 Critical | High | React 16 → 18 is a major migration |
| **Redux Removal** | 🔴 Critical | High | **Remove Redux entirely** (use React state/context) |
| **Feature Removal** | 🟠 High | Medium | Remove cloud/auth/sharing features |
| **Sentry Removal** | 🟠 High | Low | Remove Sentry + FullStory analytics |
| **Dev Tooling Cleanup** | 🟢 Low | Low | Remove why-did-you-render, etc. |
| Build Tooling | 🟠 High | Medium | Webpack 4 → 5/Vite |
| Rust Toolchain | 🟠 High | Low | 3+ year old nightly |
| Python/LangChain | 🔴 Critical | Medium | Complete API rewrites |
| Deprecated Packages | 🟠 High | Medium | Several abandoned dependencies |

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
- [ ] Remove access code system (partially: UI removed, parsing kept for URL compat)

#### Phase 4: Remove Project Management
- [x] Remove `ModalRelease*` components
- [x] Remove fork functionality (replaced with local fork)
- [x] Simplify new project to local templates
- [x] Remove server metadata sync

#### Phase 5: Simplify to Local Storage
- [x] Implement localStorage-based project persistence
- [x] Implement local project templates
- [ ] Ensure import/export .zip works standalone
- [ ] Test fully offline operation

### Packages to Remove (Feature-Related)

```
# Auth/Cloud related
- Remove API calls to HASH servers
- Remove GraphQL queries for user data

# Sharing
- (ModalShare components deleted)

# Analytics (already in plan)
- @sentry/browser
- @sentry/integrations  
- @sentry/tracing
- @sentry/fullstory
- @sentry/webpack-plugin
- @fullstory/browser
```

---

## sim-core Frontend

### 🔴 Critical: React Ecosystem (Major Version Behind)

| Package | Current | Latest | Action |
|---------|---------|--------|--------|
| `react` | 16.14.0 | 18.2+ | Upgrade |
| `react-dom` | 16.14.0 | 18.2+ | Upgrade |
| `react-redux` | 7.2.4 | - | **REMOVE** (see Redux Removal below) |
| `@reduxjs/toolkit` | 1.5.0 | - | **REMOVE** (see Redux Removal below) |
| `redux` | * | - | **REMOVE** |
| `recoil` | 0.4.1 | - | **REMOVE** |

**React Migration Path**:
1. Update React 16 → 17 (minimal changes, prep for 18)
2. Update React 17 → 18 (createRoot, Concurrent features)

**Blockers**:
- Many class components may need refactoring
- Legacy lifecycle methods (componentWillMount, etc.)
- String refs need conversion to createRef/useRef

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

**Packages to Remove**:
- `@reduxjs/toolkit`
- `react-redux`
- `redux` (implicit dependency)
- `recoil` (unused/redundant)
- `rxjs` (if only used for Redux store sync)

**Packages to Add**:
- None (React 18 built-ins are sufficient)

---

### 🟠 High: Sentry Removal

**Decision**: Remove Sentry and related analytics integrations.

**Packages to Remove**:
- `@sentry/browser` (6.2.0)
- `@sentry/integrations` (6.2.0)
- `@sentry/tracing` (6.3.6)
- `@sentry/fullstory` (1.1.5)
- `@sentry/webpack-plugin` (1.15.0)
- `@fullstory/browser` (1.4.5) - FullStory integration

**Files to Update**:
- `src/boot.ts` - Remove `initSentry()` call
- `src/util/initSentry.ts` - Delete file
- `webpack.config.js` - Remove Sentry webpack plugin
- Any error boundary components using Sentry

**Code to Remove**:
```typescript
// boot.ts - remove this line
initSentry();

// Remove all Sentry imports and usage
import * as Sentry from '@sentry/browser';
Sentry.captureException(error);
Sentry.addBreadcrumb({ ... });
```

**Estimated Effort**: 1-2 days

---

### 🟢 Low: Unnecessary Dev Tooling Removal

**Decision**: Remove dev tools that add complexity without sufficient value.

**Packages to Remove**:

| Package | Version | Reason for Removal |
|---------|---------|-------------------|
| `@welldone-software/why-did-you-render` | 6.0.3 | Primarily useful for Redux re-render debugging; unnecessary after Redux removal |

**Files to Update**:
- `src/index.tsx` - Remove why-did-you-render initialization

**Code to Remove**:
```typescript
// src/index.tsx - remove this block
if (IS_LOCAL) {
  const whyDidYouRender = require("@welldone-software/why-did-you-render");
  whyDidYouRender(React, {
    collapseGroups: true,
  });
}
```

**Estimated Effort**: 1 hour

**Note**: React DevTools (browser extension) provides sufficient debugging capabilities for modern React development.

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
| `hookrouter` 1.2.3 | ⚠️ Abandoned (no updates since 2019) | `react-router` 6.x or `@tanstack/router` |
| `request` 2.88.2 | ⚠️ Deprecated | `fetch` API or `axios` |
| `request-promise-native` | ⚠️ Deprecated | `fetch` API or `axios` |
| `@material-ui/core` 4.11.4 | ⚠️ Renamed/Deprecated | `@mui/material` 5.x |
| `@material-ui/lab` | ⚠️ Renamed/Deprecated | `@mui/lab` 5.x |
| `react-three-fiber` 5.0.6 | ⚠️ Renamed | `@react-three/fiber` 8.x |
| `drei` 1.5.7 | ⚠️ Renamed | `@react-three/drei` 9.x |
| `recoil` 0.4.1 | ⚠️ Unused | **Remove** (part of Redux removal) |

**Action Items**:
- [ ] Replace `hookrouter` with `react-router` 6.x
- [ ] Replace `request`/`request-promise-native` with fetch or axios
- [ ] Migrate `@material-ui/*` to `@mui/*` 5.x
- [ ] Migrate `react-three-fiber` to `@react-three/fiber`
- [ ] Migrate `drei` to `@react-three/drei`
- [ ] Evaluate replacing `recoil` with `jotai` or removing if underused

### 🟠 High: Build Tooling

| Package | Current | Latest | Notes |
|---------|---------|--------|-------|
| `webpack` | 4.44.2 | 5.90+ | Module federation, better tree-shaking |
| `webpack-cli` | 3.3.12 | 5.1+ | |
| `webpack-dev-server` | 3.11.0 | 4.15+ | |
| `typescript` | 4.1.3 | 5.3+ | `satisfies`, const type params, decorators |
| `jest` | 26.6.3 | 29.7+ | Or migrate to Vitest |
| `ts-jest` | 26.4.4 | 29.1+ | |
| `babel-loader` | 8.2.1 | 9.1+ | Or consider SWC/esbuild |

**Recommended Approach**:
- Option A: Upgrade Webpack 4 → 5 (lower risk, more work)
- Option B: Migrate to Vite (higher risk, better DX, faster builds)

**Build Script Issues**:
```bash
# Current workaround indicates OpenSSL issues:
NODE_OPTIONS=--openssl-legacy-provider
```
This suggests Node.js version conflicts. Upgrading to Webpack 5+ may resolve this.

### 🟠 High: Significant Version Gaps

| Package | Current | Latest | Gap |
|---------|---------|--------|-----|
| `monaco-editor` | 0.25.2 | 0.45+ | 20 versions |
| `three` | 0.119.1 | 0.160+ | 40+ versions |
| `rxjs` | 6.6.6 | 7.8+ | Major version |
| `plotly.js` | 1.57.1 | 2.29+ | Major version |
| `@sentry/browser` | 6.2.0 | - | **REMOVING** |
| `@deck.gl/core` | 8.3.7 | 8.9+ | |
| `graphql` | 15.5.0 | 16.8+ | Major version |
| `date-fns` | 2.17.0 | 3.3+ | Major version |

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
# Current (rust-toolchain.toml)
channel = "nightly-2022-08-08"  # 3+ YEARS OLD
```

**Issues**:
- Missing 3+ years of compiler improvements
- Missing 3+ years of security patches
- Potential incompatibility with newer dependencies
- Limited access to new language features

**Action**: Update to recent nightly (e.g., `nightly-2024-12-01` or newer)

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
1. [ ] **Remove Analytics & Widgets**
   - [ ] Remove Sentry (`@sentry/*` packages)
   - [ ] Remove FullStory (`@fullstory/browser`)
   - [ ] Remove Discord widget
   - [ ] Remove why-did-you-render
2. [ ] Run security audits (`cargo audit`, `npm audit`, `pip audit`)
3. [ ] Replace abandoned `hookrouter` with `react-router`
4. [ ] Replace deprecated `request` package
5. [ ] Update Rust nightly toolchain

### Phase 2: Remove Auth & Cloud Features
1. [ ] **Remove User Authentication System**
   - [ ] Remove `ModalSignin`, `ModalSignup` components
   - [ ] Remove authentication flows and API calls
   - [ ] Simplify `features/user/` to local preferences only
   - [ ] Remove cloud credits tracking (`CloudUsage`)
2. [ ] **Remove Cloud Features**
   - [ ] Remove hCloud experiment runners (keep local runner)
   - [ ] Remove server-side project save
   - [ ] Remove sharing features (`ModalShare*`)
   - [ ] Remove access code system
3. [ ] **Remove Project Management**
   - [ ] Remove `ModalRelease*` components  
   - [ ] Remove fork functionality
   - [ ] Simplify new project to local templates
   - [ ] Remove server metadata sync

### Phase 3: Build System Modernization
1. [ ] Upgrade Webpack 4 → 5 OR migrate to Vite
2. [ ] Upgrade TypeScript 4.1 → 5.x
3. [ ] Remove `--openssl-legacy-provider` workaround
4. [ ] Update Jest 26 → 29 or migrate to Vitest

### Phase 4: React & State Management
1. [ ] React 16 → 17 → 18 migration
2. [ ] **Remove Redux entirely** (see detailed plan above)
   - [ ] Audit all state usage across slices
   - [ ] Create minimal Context providers for truly global state
   - [ ] Migrate components to use Context/local state
   - [ ] Delete entire `src/features/` Redux infrastructure
   - [ ] Remove redux, react-redux, @reduxjs/toolkit packages
3. [ ] Remove Recoil (unused)
4. [ ] @material-ui → @mui migration
5. [ ] react-three-fiber → @react-three/fiber

### Phase 5: Local Storage Implementation
1. [ ] Implement localStorage-based project persistence
2. [ ] Create local project templates system
3. [ ] Ensure import/export .zip works fully offline
4. [ ] Test complete offline operation

### Phase 6: Future - GitHub Integration (Post-Migration)
- [ ] Design GitHub OAuth flow (no HASH account)
- [ ] Implement save/load from user's GitHub repos
- [ ] Add project sync functionality

### Phase 7: Python Modernization (If Needed)
1. [ ] OpenAI 0.27 → 1.x migration
2. [ ] Pydantic 1.x → 2.x migration
3. [ ] LangChain complete rewrite to 0.1.x architecture

### Ongoing Maintenance
- [ ] Establish automated dependency update process (Renovate/Dependabot)
- [ ] Add CI checks for outdated dependencies
- [ ] Document upgrade procedures for major dependencies

---

## Potential Removals

### Unused or Redundant Packages (Investigate)

| Package | Reason to Investigate |
|---------|----------------------|
| `recoil` | **REMOVING** - see Redux removal plan |
| `@fullstory/browser` | **REMOVING** - see Sentry removal plan |
| `@sentry/*` | **REMOVING** - see Sentry removal plan |
| `react-shepherd` | **KEEP** - onboarding tour is staying |
| `@msrvida/sanddance-explorer` | **KEEP** - data visualization staying |
| `gradient-path` | Specialized SVG library - investigate if needed |

### Packages Related to Removed Features

| Package/Code | Status | Reason |
|--------------|--------|--------|
| Auth-related API calls | **REMOVE** | No user accounts |
| GraphQL user queries | **REMOVE** | No server-side users |
| hCloud client code | **REMOVE** | Local-only execution |
| Sharing modals | **REMOVE** | No sharing feature |
| Discord widget code | **REMOVE** | Removing integration |

### Consolidation Opportunities

| Current | Consolidate To |
|---------|----------------|
| Redux + Recoil + RTK | **Remove entirely** - use React Context/state |
| RxJS (for store sync) | Remove if only used for Redux sync |
| Multiple date libraries | Just date-fns |
| lodash-es + fp-ts | Evaluate if both needed |
| Server project storage | **localStorage/IndexedDB** |

---

## Notes for AI Agents

When working on this codebase:

### Architecture Principles

1. **LOCAL-FIRST**: This app is becoming a free, fully-featured, local-only simulation IDE
2. **NO USER ACCOUNTS**: Don't add authentication, login flows, or user systems
3. **NO CLOUD FEATURES**: Don't add cloud storage, sharing, or server-side features
4. **NO ANALYTICS**: Don't add Sentry, FullStory, or tracking code
5. **GitHub sync is FUTURE**: Don't implement GitHub integration yet (post-migration)

### Code Guidance

1. **Don't upgrade React without a plan** - It's a major undertaking affecting the entire frontend
2. **Redux is being removed entirely** - Don't add ANY new Redux code
3. **Don't add new useSelector/useDispatch** - Redux is being deleted
4. **Test thoroughly after any dependency update** - Many packages are interconnected
5. **Check for breaking changes** before upgrading any major version
6. **The Python POC may be stale** - Verify if hash-agents is actively used before investing in updates
7. **Rust toolchain update is low-risk** - Should be done first

### Features Being REMOVED - DO NOT Extend

```
❌ User authentication (ModalSignin, ModalSignup)
❌ Cloud credits / CloudUsage
❌ Project sharing (ModalShare*)
❌ Access codes
❌ Server project storage
❌ Fork project
❌ Project releases/versioning (ModalRelease*)
❌ hCloud experiment runners
❌ Sentry / FullStory analytics
❌ Discord widget
```

### Features to KEEP

```
✓ All simulation execution (step, play, pause, reset)
✓ All viewer tabs (3D, geospatial, analysis, process chart, raw output)
✓ Code editing (Monaco, file tree, behaviors)
✓ Local experiments (parameter sweeps, linspace, optimization)
✓ hIndex shared behaviors library (dependencies)
✓ Import/Export .zip
✓ Onboarding tour
✓ Keyboard shortcuts
```

### State Management Guidance for New Code

Redux is being completely removed. For new state:

```typescript
// DON'T: Add new Redux slices ❌
// src/features/newFeature/slice.ts

// DON'T: Use any Redux hooks ❌
useSelector(), useDispatch()

// DO: Use React's built-in state management ✓
// Local state
const [value, setValue] = useState(initial);

// Shared state (if truly needed across distant components)
// Create a simple Context
const MyContext = createContext(null);

// DO: Use localStorage for persistence ✓
const [value, setValue] = useLocalStorage('key', defaultValue);
```

### Storage Strategy

```typescript
// Project persistence
localStorage.setItem('project:' + projectId, JSON.stringify(projectData));

// User preferences (no account needed)
localStorage.setItem('preferences', JSON.stringify(prefs));

// For larger data (future)
// Use IndexedDB
```

---

## References

- [React 18 Upgrade Guide](https://react.dev/blog/2022/03/08/react-18-upgrade-guide)
- [React Context Documentation](https://react.dev/reference/react/useContext)
- [LangChain 0.1.x Migration](https://python.langchain.com/docs/versions/migrating_chains)
- [OpenAI Python 1.x Migration](https://github.com/openai/openai-python/discussions/742)
- [Vite Migration from Webpack](https://vitejs.dev/guide/migration-from-v4)
