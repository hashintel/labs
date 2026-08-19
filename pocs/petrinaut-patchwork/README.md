# Petrinaut x Patchwork

Packages the [Petrinaut](https://www.npmjs.com/package/@hashintel/petrinaut) Petri
net editor as a Patchwork tool, datatype and skill.

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

`@hashintel/ds-helpers` is pinned to `0.1.2`, the only version published with
its `styled-system` directory intact. Newer releases, `0.2.1` included, ship
only the README and `package.json`, so `@hashintel/ds-helpers/css` fails to
resolve at build time. The pin is both a direct dependency and a `pnpm.overrides`
entry: the override alone does not bite, because `ds-helpers` reaches this
package as an auto-installed peer of `@hashintel/ds-components`.
