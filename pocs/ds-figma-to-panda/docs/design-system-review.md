# Design System Review and Recommendations

**Date**: 2025-11-27
**Packages Reviewed**:

- `@hashintel/ds-components`
- `@hashintel/ds-theme`
- `@hashintel/ds-helpers`

---

## Executive Summary

The current design system has a solid foundation (PandaCSS, Ark UI, Figma integration) but suffers from:

1. An overcomplicated, non-standard Figma export pipeline
2. Unnecessary package separation creating dependency complexity
3. PandaCSS lock-in with no portable token format
4. Component styling patterns that won't scale

This document outlines ticketable tasks to address these issues.

---

## Current Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   ds-theme      │────▶│   ds-helpers    │────▶│  ds-components  │
│                 │     │                 │     │                 │
│ PandaCSS preset │     │ Generated CSS   │     │ React + Ark UI  │
│ (1,662 lines)   │     │ utilities       │     │ components      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        ▲
        │
┌───────┴───────┐
│ Figma Plugin  │  "Variables Exporter for Dev Mode" (third-party)
│ + toPanda.ts  │  Custom transformation script (~320 lines)
└───────────────┘
```

### Current Figma Workflow (Manual)

1. Open Figma file
2. Run third-party "Variables Exporter for Dev Mode" plugin
3. Copy JSON output to a file
4. Run `yarn generate:panda ./path/to/file.json`
5. Commit generated `src/index.ts`

**Problems**: Manual, non-standard format, no automation, plugin could break/disappear.

---

## Task 1: Establish Standard Token Format (W3C DTCG)

### Problem

Tokens are stored as a PandaCSS-specific TypeScript preset (`ds-theme/src/index.ts`), not a portable format. This:

- Locks the system to PandaCSS
- Prevents use in plain CSS, Tailwind, native apps, etc.
- Makes the Figma sync script unnecessarily complex

### Recommendation

Adopt the [W3C Design Tokens Community Group (DTCG) format](https://tr.designtokens.org/format/) as the source of truth.

**Example structure**:

```
tokens/
├── colors.light.json    # Core color primitives (light mode values)
├── colors.dark.json     # Core color primitives (dark mode values)
├── semantic.json        # Semantic aliases (text.primary → core.gray.90)
├── spacing.json
├── typography.json
└── radii.json
```

**Example token file** (`tokens/colors.light.json`):

```json
{
  "core": {
    "gray": {
      "50": {
        "$type": "color",
        "$value": "#737373"
      },
      "90": {
        "$type": "color",
        "$value": "#171717"
      }
    }
  }
}
```

### Acceptance Criteria

- [ ] Tokens stored as W3C DTCG JSON files
- [ ] One file per collection/mode from Figma
- [ ] Human-readable and diffable in PRs
- [ ] Validated against DTCG schema

### Estimated Scope

Medium - Requires converting existing preset to JSON format

---

## Task 2: Replace Custom Script with Style Dictionary

### Problem

The custom `toPanda.ts` script (~320 lines) manually handles:

- Type inference from Figma scopes
- Alias resolution
- Mode-to-condition mapping
- Name sanitization

This reinvents what [Style Dictionary](https://amzn.github.io/style-dictionary/) does out of the box.

### Recommendation

Use Style Dictionary with [@tokens-studio/sd-transforms](https://www.npmjs.com/package/@tokens-studio/sd-transforms) to generate outputs.

**Example `style-dictionary.config.js`**:

```javascript
import StyleDictionary from 'style-dictionary';
import { registerTransforms } from '@tokens-studio/sd-transforms';

registerTransforms(StyleDictionary);

export default {
  source: ['tokens/**/*.json'],
  platforms: {
    css: {
      transformGroup: 'tokens-studio',
      buildPath: 'dist/',
      files: [{
        destination: 'tokens.css',
        format: 'css/variables',
      }]
    },
    panda: {
      transformGroup: 'tokens-studio',
      buildPath: 'dist/',
      files: [{
        destination: 'panda-preset.ts',
        format: 'panda/preset', // custom format
      }]
    }
  }
};
```

### Benefits

- Industry-standard tooling with large community
- Multi-platform output (CSS, iOS, Android, Tailwind, PandaCSS)
- Built-in alias resolution
- Extensible via custom transforms/formats

### Acceptance Criteria

- [ ] Style Dictionary configured with tokens-studio transforms
- [ ] Generates CSS custom properties file
- [ ] Generates PandaCSS preset (if still needed)
- [ ] Custom `toPanda.ts` script deleted

### Estimated Scope

Medium - Style Dictionary setup, custom format for PandaCSS if needed

---

## Task 3: Automate Figma Sync with GitHub Actions

### Problem

Current workflow is manual:

1. Designer updates Figma
2. Developer manually exports via plugin
3. Developer runs script
4. Developer commits

No automation, easy to forget, drift between Figma and code.

### Recommendation

**Option A: Figma REST API (requires Enterprise)**

Use [Figma's official GitHub Action example](https://github.com/figma/variables-github-action-example) for bi-directional sync.

```yaml
# .github/workflows/sync-figma-tokens.yml
name: Sync Figma Variables to Tokens
on:
  workflow_dispatch:
  schedule:
    - cron: '0 9 * * 1' # Weekly on Mondays

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Fetch Figma variables
        run: node scripts/fetch-figma-variables.js
        env:
          FIGMA_ACCESS_TOKEN: ${{ secrets.FIGMA_ACCESS_TOKEN }}
          FIGMA_FILE_KEY: ${{ secrets.FIGMA_FILE_KEY }}
      - name: Create PR if changed
        uses: peter-evans/create-pull-request@v5
        with:
          title: 'chore: sync design tokens from Figma'
          branch: chore/sync-figma-tokens
```

**Option B: Tokens Studio (no Enterprise required)**

Use [Tokens Studio plugin](https://tokens.studio/) which can sync directly to GitHub.

### Acceptance Criteria

- [ ] Automated workflow fetches tokens from Figma
- [ ] Changes create PR for review
- [ ] Works on schedule or manual trigger
- [ ] Supports bi-directional sync (nice-to-have)

### Estimated Scope

Medium - Depends on Figma plan (Enterprise vs not)

### Open Question

Does HASH have Figma Enterprise? This determines whether REST API is available.

---

## Task 4: Consolidate Packages

### Problem

Three packages with tight coupling:

- `ds-theme` - Just a TypeScript file (no build)
- `ds-helpers` - PandaCSS codegen output
- `ds-components` - Actual components

This creates:

- Unnecessary npm package overhead
- Complex dependency chain
- Confusing for consumers

### Recommendation

**Option A: Single package**

```
@hashintel/design-system/
├── tokens/              # W3C DTCG JSON source
├── dist/
│   ├── tokens.css       # CSS custom properties
│   ├── tokens.js        # JS constants
│   └── components/      # React components
├── src/
│   └── components/
└── style-dictionary.config.js
```

**Option B: Two packages**

```
@hashintel/ds-tokens/    # Tokens only (JSON + CSS + JS exports)
@hashintel/ds-components/ # React components (depends on ds-tokens)
```

### Acceptance Criteria

- [ ] Decide on package structure (1 vs 2 packages)
- [ ] Consolidate code
- [ ] Update all internal consumers
- [ ] Publish to npm (if public)

### Estimated Scope

Large - Requires updating all consumers, potential breaking changes

---

## Task 5: Generate CSS Custom Properties

### Problem

Tokens are only usable via PandaCSS `css()` function. No standalone CSS file with custom properties.

This means:

- Can't use tokens in plain CSS
- Can't share with non-React apps
- No CSS-native dark mode via `[data-theme="dark"]`

### Recommendation

Generate a CSS file with all tokens as custom properties:

```css
:root {
  /* Core primitives */
  --color-core-gray-50: #737373;
  --color-core-gray-90: #171717;

  /* Semantic tokens (reference primitives) */
  --color-text-primary: var(--color-core-gray-90);
  --color-text-secondary: var(--color-core-gray-70);

  /* Spacing */
  --spacing-1: 1px;
  --spacing-2: 2px;
  /* ... */
}

[data-theme="dark"] {
  --color-core-gray-50: #9ca3af;
  --color-core-gray-90: #f6f8f9;
}
```

### Benefits

- Works everywhere (React, Vue, plain HTML)
- Native dark mode support
- Browser DevTools can inspect/modify
- Smaller JS bundle (no runtime token resolution)

### Acceptance Criteria

- [ ] CSS file generated with all tokens
- [ ] Semantic tokens reference core tokens via `var()`
- [ ] Dark mode values in `[data-theme="dark"]` selector
- [ ] Exported from package for consumers

### Estimated Scope

Small - Style Dictionary can do this with minimal config

---

## Task 6: Refactor Component Styling Patterns

### Problem

Components have massive inline style blocks. Example from `button.tsx`:

```typescript
// 222 lines of css() in a single call
css({
  "&[data-variant='primary'][data-color-scheme='brand']": {
    backgroundColor: "bg.brand.bold.default",
    // ...
  },
  "&[data-variant='primary'][data-color-scheme='neutral']": {
    // ...
  },
  // ... repeated for every variant/size/state combination
})
```

This is:

- Hard to read and review
- Difficult to maintain as variants grow
- Not using PandaCSS's recipe system

### Recommendation

Use PandaCSS [recipes](https://panda-css.com/docs/concepts/recipes) (`cva`) or [slot recipes](https://panda-css.com/docs/concepts/slot-recipes) (`sva`):

```typescript
import { cva } from '@hashintel/ds-helpers/css';

const buttonRecipe = cva({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'medium',
    cursor: 'pointer',
  },
  variants: {
    variant: {
      primary: { /* ... */ },
      secondary: { /* ... */ },
      ghost: { /* ... */ },
    },
    colorScheme: {
      brand: { /* ... */ },
      neutral: { /* ... */ },
      critical: { /* ... */ },
    },
    size: {
      xs: { height: '24px', px: 'spacing.5', fontSize: 'size.textsm' },
      sm: { height: '28px', px: 'spacing.5', fontSize: 'size.textsm' },
      md: { height: '32px', px: 'spacing.6', fontSize: 'size.textsm' },
      lg: { height: '40px', px: 'spacing.8', fontSize: 'size.textbase' },
    },
  },
  compoundVariants: [
    {
      variant: 'primary',
      colorScheme: 'brand',
      css: {
        backgroundColor: 'bg.brand.bold.default',
        color: 'text.inverted',
        _hover: { backgroundColor: 'bg.brand.bold.hover' },
      },
    },
    // ... other combinations
  ],
  defaultVariants: {
    variant: 'primary',
    colorScheme: 'brand',
    size: 'md',
  },
});
```

### Acceptance Criteria

- [ ] Button refactored to use `cva`
- [ ] Other components follow same pattern
- [ ] Consistent disabled state handling across components
- [ ] Consistent focus ring pattern across components

### Estimated Scope

Medium - Refactor each component, establish patterns

---

## Task 7: Clean Up Token Naming Issues

### Problem

Several naming issues in the current token structure:

1. **Redundant nesting**: `spacing.spacing.0` (double "spacing")
2. **Unclear aliases**: `spacing.spacing.default.0` vs `spacing.spacing.0`
3. **Placeholder values**: `colors.color.accent.*` has many `#ffffff` placeholders
4. **Suspicious names**: `fonts.weight.normaldelete`, `fonts.weight.mediumdelete`
5. **Overcomplicated radii**: `radii.core.full.0` through `radii.core.full.10` all equal `9999px`

### Recommendation

Clean up during DTCG migration:

```json
// Before (current)
"spacing.spacing.default.0": "0px"
"spacing.spacing.0": "{spacing.spacing.default.0}"

// After (cleaned)
"spacing.0": "0px"
```

### Acceptance Criteria

- [ ] Remove redundant nesting
- [ ] Remove placeholder/unused tokens
- [ ] Fix suspicious token names
- [ ] Simplify radii scale
- [ ] Document token naming conventions

### Estimated Scope

Small-Medium - Part of DTCG migration

---

## Task 8: Add Missing Token Categories

### Problem

Current tokens are missing common design system categories:

| Category    | Status  | Used In Components As |
| ----------- | ------- | --------------------- |
| Colors      | Present | Tokens                |
| Spacing     | Present | Tokens                |
| Radii       | Present | Tokens                |
| Typography  | Partial | Tokens                |
| Shadows     | Missing | Hardcoded or absent   |
| Z-indices   | Missing | Hardcoded             |
| Transitions | Missing | `"[all 0.2s ease]"`   |
| Borders     | Missing | Inline values         |

### Recommendation

Add missing categories to Figma variables (source of truth) or manually to token files:

```json
{
  "shadow": {
    "sm": {
      "$type": "shadow",
      "$value": "0 1px 2px 0 rgb(0 0 0 / 0.05)"
    },
    "focus-ring": {
      "$type": "shadow",
      "$value": "0 0 0 2px var(--color-core-custom-30)"
    }
  },
  "transition": {
    "fast": {
      "$type": "duration",
      "$value": "150ms"
    },
    "normal": {
      "$type": "duration",
      "$value": "200ms"
    }
  }
}
```

### Acceptance Criteria

- [ ] Shadow tokens defined
- [ ] Transition/duration tokens defined
- [ ] Z-index scale defined
- [ ] Components updated to use new tokens
- [ ] No more hardcoded `"[...]"` escape values in components

### Estimated Scope

Medium - Define tokens, update components

---

## Task 9: Remove `canvas` Dependency

### Problem

`ds-components` depends on `canvas: 3.2.0`, a heavy Node.js native module. This is used by WebGL filter effects in `src/lib/`:

- `filter.tsx`
- `flexible-filter.tsx`
- `surface-equations.ts`
- Various motion/animation hooks

This will cause issues for:

- SSR (server-side rendering)
- Edge runtimes (Cloudflare Workers, Vercel Edge)
- Bundle size

### Recommendation

Either:

1. **Extract to separate package**: `@hashintel/ds-effects` for WebGL components
2. **Make optional**: Dynamic import with fallback
3. **Remove if unused**: If RefractivePane isn't being used, remove it

### Acceptance Criteria

- [ ] Determine if WebGL effects are needed
- [ ] If yes, extract to optional package
- [ ] If no, remove `canvas` dependency and related code
- [ ] Verify SSR compatibility

### Estimated Scope

Small-Medium - Depends on whether effects are needed

---

## Task 10: Add Component Tests

### Problem

No test files exist despite `test:watch` script in package.json. Given the complexity of variant combinations, this is risky.

### Recommendation

Add tests for:

1. **Rendering**: Components render without errors
2. **Variants**: All variant combinations apply correct classes
3. **Accessibility**: Keyboard navigation, ARIA attributes
4. **Interactions**: Click handlers, state changes

**Example test** (`button.test.tsx`):

```typescript
import { render, screen } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button')).toHaveTextContent('Click me');
  });

  it('applies variant classes', () => {
    const { container } = render(
      <Button variant="secondary" colorScheme="critical">Delete</Button>
    );
    expect(container.firstChild).toHaveAttribute('data-variant', 'secondary');
    expect(container.firstChild).toHaveAttribute('data-color-scheme', 'critical');
  });

  it('disables when loading', () => {
    render(<Button isLoading>Loading</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

### Acceptance Criteria

- [ ] Test setup with Vitest + Testing Library
- [ ] Tests for each component
- [ ] Coverage threshold established
- [ ] Tests run in CI

### Estimated Scope

Medium - Setup + write tests for each component

---

## Suggested Task Order

Based on dependencies and impact:

### Phase 1: Foundation

1. **Task 1**: Establish W3C DTCG token format
2. **Task 7**: Clean up token naming (do alongside Task 1)
3. **Task 2**: Replace custom script with Style Dictionary

### Phase 2: Outputs

4. **Task 5**: Generate CSS custom properties
5. **Task 8**: Add missing token categories
6. **Task 3**: Automate Figma sync

### Phase 3: Components

7. **Task 6**: Refactor component styling patterns
8. **Task 9**: Remove `canvas` dependency
9. **Task 10**: Add component tests

### Phase 4: Structure

10. **Task 4**: Consolidate packages (breaking change, do last)

---

## Open Questions

1. **Does HASH have Figma Enterprise?** - Determines REST API availability
2. **Is the WebGL RefractivePane component used?** - Determines `canvas` dependency fate
3. **Should tokens be public npm packages?** - Affects versioning strategy
4. **What other apps consume these packages?** - Affects migration strategy

---

## References

- [W3C Design Tokens Format](https://tr.designtokens.org/format/)
- [Figma Variables GitHub Action Example](https://github.com/figma/variables-github-action-example)
- [Style Dictionary](https://amzn.github.io/style-dictionary/)
- [Tokens Studio](https://tokens.studio/)
- [@tokens-studio/sd-transforms](https://www.npmjs.com/package/@tokens-studio/sd-transforms)
- [PandaCSS Recipes](https://panda-css.com/docs/concepts/recipes)

## Revised References
- [Figma to Panda CSS Workflow](https://www.perplexity.ai/search/figma-to-panda-css-workflow-3SYUk2xGTNqjtrEoFMbmZQ)
- [panda-variables-config | Figma](https://www.figma.com/community/plugin/1547569940760832554/panda-variables-config)
- [variables-to-css | Figma](https://www.figma.com/community/plugin/1460027932302083848/variables-to-css)
- [Tokens | Panda CSS - Panda CSS](https://panda-css.com/docs/theming/tokens#shadows)
- [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/)
- [Splitter | Chakra UI](https://www.chakra-ui.com/docs/components/splitter)
- [Generating a Custom Chakra UI v3 Theme from Design Tokens: A Complete Guide - DEV Community](https://dev.to/kiranmantha/generating-a-custom-chakra-ui-v3-theme-from-design-tokens-a-complete-guide-1085)
- [Design Tokens Community Group](https://www.designtokens.org/)
