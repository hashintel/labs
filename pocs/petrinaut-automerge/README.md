# Petrinaut x Automerge

This is a POC of [Petrinaut](https://github.com/hashintel/hash/tree/main/libs/%40hashintel/petrinaut) (a Petri net editor) with an [Automerge](https://automerge.org/) backend.

## Setup

```bash
cd pocs/petrinaut-automerge
yarn
```

Run `yarn dev` and navigate to http://localhost:5173 to see the app running.

## Known issues

1. Some changes in the UI don't create a granular update and are therefore are not good candidates for exploring visual diffing.

   - **Granular updates**: add node; add connection; move node; edit net title; auto-layout (click 'layout' button, only nodes that actually move will have their x and y position updated)
   - **Coarse updates**: edit token types (overwrites entire object); edit node title (overwrites entire title, doesn't use `changeText`); edit node token markings (overwrites entire object).
2. Sometimes the app will hang at different points when trying to retrieve data from the Automerge sync server. This can typically be temporarily resolved by removing the root Automerge URL from local storage, and visiting http://localhost:5173 to start a new one (remove any Automerge URL from the address). I don't know why this happens. **This is why there are a lot of logs relating to `useDocument` – so I can see where it hangs.
3. When creating a new net, MUI Autocomplete thinks the value is undefined. Unclear why this is (it should be defined), not going to invest time in it right now.

## Questions re. Automerge
1. Why known issue (2) happens
2. What the best way is of subscribing to patches as they change (There's currently a hacky version in `petrinaut-wrapper.tsx` which logs out patches on every render if the head has changed)
3. When/why will there be more than one `head`?

## TODOs

1. Put POC into Patchwork
2. Discuss approach to visual diffing
   - have Petrinaut be aware of change history
   - ability to explore change history, with appropriate visual indicators for diffs (deletions, additions)
3. Add more granular updates
4. Allow deleting nodes / edges
