# Petrinaut x Patchwork

## Installation

`pnpm install`

## Sync to Patchwork

`npx pushwork@latest init`
`npx pushwork@latest sync`

You can add the petrinaut tool to your profile on `gaios.sgai.uk` or `patchwork.inkandswitch.com` by use the URL returned by `npx pushwork@latest url` (UI for doing this varies between the two).

## Using LLM commands

As of 2025-12-03 (but likely to change), you will need to register and enable the 'Satisfaction' tool in Patchwork to enable LLM actions:

1. Register `automerge:3kLVjhAVGtYDbESgjicibmR24bgP` as a module (as you did for syncing the tool itself)
2. Click the 'Satisfaction' button in the top right (you should see a new pane with registered actions)
3. Click 'Review' in the top right, then 'Bot', and ask the LLM to add things to the net
