# Petri net IR

The net's input format: a Petri net written in YAML as the Petri net IR. This folder was a compiler from the IR to Zeroth reactive modules. The constraint playground keeps only the IR: its schema, its parser and its accessors. The compiler is cut.

`index.ts` is the public API: the playground, `constraints/` and the examples import nothing else from this folder.

| Path | Holds |
| --- | --- |
| `ir/schema.ts` | the schema and the types inferred from it (`PetriNetIr`) |
| `ir/parse.ts` | `parsePetriNetIr(text)`: YAML, then the schema, then the references between sections. One diagnostic per issue, each at the line of its key |
| `ir/references.ts` | the checks across sections: arcs and the marking name declared places, and so on |
| `ir/accessors.ts` | `arcKind`, `arcWeight`, `initialTokens`, `conflictingTransitions` |
| `ir/net-item.ts` | `NetItem`, the place, transition or colour a diagnostic or a drawing names |
| `ir/yaml-keys.ts` | the YAML key scan that gives each key its line |
| `diagnostics.ts` | `DIAGNOSTIC_CODES` and the `Diagnostic` type |

`ir/reserved-names.ts` and most diagnostic codes are left from the compiler and are not used here.

## What the playground runs

The constraint playground runs uncoloured nets: plain transitions, and stochastic transitions with a numeric rate. A guard, a kernel, a coloured place or a rate written as code is refused by the run with a diagnostic, as the playground has no code parser.

`compiler/tsconfig.json` sets `rootDir` to this folder, so `tsc -p compiler`, run by `pnpm lint:tsc`, fails on an import that leaves it. The folder imports only js-yaml and zod.
