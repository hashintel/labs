# Petrinaut x Patchwork

Packages the [Petrinaut](https://www.npmjs.com/package/@hashintel/petrinaut) Petri
net editor as a Patchwork tool and datatype, plus two skills:

- **`patchwork:skill`** — `SKILL.md` and the typed API in `skill-api.ts`, for
  agents that can call a real API.
- **`llm:skill`** — `llm-skill.ts`, an instruction pack for Patchwork's chat
  computer, which has only generic `read_doc` / `automerge_op` tools and so
  needs the net's schema spelled out. It activates automatically when a
  Petrinaut document is focused.

## Installation

`pnpm install`

## Sync to Patchwork

`pnpm push` builds the tool and syncs the directory to the Patchwork sync
server via [pushwork](https://www.npmjs.com/package/pushwork). `pnpm watch`
does the same on every change to `src`.

`pnpm exec pushwork url` prints this checkout's automerge URL. Add the tool to
your profile on `gaios.sgai.uk` or `patchwork.inkandswitch.com` by pasting that
URL (the UI for doing so varies between the two).

`.pushwork/` is gitignored, so it holds one checkout's link to one published
copy rather than something shared. A fresh clone has no `.pushwork/` and needs
`pnpm exec pushwork init --artifact-dir dist` once, which publishes a new root
document under a new URL.

## Notes

`vite.config.ts` marks the modules in
`@inkandswitch/patchwork-bootloader/externals` as external, because the
Patchwork host supplies them through its importmap. Keep the bootloader version
in step with the host: a stale list bundles a second copy of a module the host
already provides. React is deliberately not on that list, so this tool ships
its own.

The editor renders through Petrinaut's handle-driven API: `tool.tsx` adapts the
Automerge handle Patchwork supplies into a `PetrinautDocHandle` over the
`petriNetDefinition` field, leaving `title` and `@patchwork` untouched around
it. The three worker factories come from `@hashintel/petrinaut-core/workers/*`,
which is what a consumer of the published dist is meant to pass; Petrinaut's
own fallback workers are only reliable for source builds. Those exports are
factory functions, not worker entry scripts — importing them with Vite's
`?worker` suffix silently produces empty 1-byte workers.

`@hashintel/ds-helpers` is pinned to `0.1.2`, the only version published with
its `styled-system` directory intact. Newer releases, `0.2.1` included, ship
only the README and `package.json`, so `@hashintel/ds-helpers/css` fails to
resolve at build time. `@hashintel/ds-components` is likewise pinned forward to
`^0.2.2`, which is what `@hashintel/petrinaut` 0.0.16 expects.

Both pins are direct dependencies rather than just `pnpm.overrides` entries. An
override alone does not bite here, because each package reaches this one as an
auto-installed peer, and pnpm resolves those before overrides apply. This is
also why `@hashintel/petrinaut` cannot move past 0.0.16 on its own: its peer
range wants a `ds-helpers` release that has not been published intact.
