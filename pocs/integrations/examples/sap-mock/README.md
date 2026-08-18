# sap-mock

Self-contained example integration: generates a synthetic SAP supply-chain
dataset (materials, BOMs, orders, deliveries, shipments, stock movements,
batches -- plus demo disruption scenarios) and runs the full pipeline over it:
29 entity pipelines, 36 link types.

```sh
./seed-mock.sh --web <shortname>    # seed that web
./seed-mock.sh                      # dry run: stub graph, writes nothing
```

Setup (runner `npm install`): see the [package README](../../README.md)
one level up -- devs typically run from there. The script uses whatever
toolchain it finds: uv and node on PATH, falling back to nix for either
half.

## Sizing

`--scale-factor <n>` (or positional: `./seed-mock.sh 5`) -- volumes scale
linearly. The RNG seed is random per run and printed; pin it with `--seed <n>`
for reproducible data (same seed, same bytes, within a day):

| SF | orders | graph entities+links |
|---|---|---|
| 0.1 | 500 | ~18k |
| 1 *(default)* | 5,000 | ~175k |
| 5 | 25,000 | ~0.9M |
| 10 | 50,000 | ~1.8M |

## Just the data

To use the generator without the pipeline, from the repo root:

```sh
uv run --project libs/sap-mock-data sap-mock generate /tmp/sap-data   # 44 Delta tables
uv run --project libs/sap-mock-data sap-mock generate /tmp/sap-data --scale-factor 5
```

One Delta directory per SAP table (`makt`, `vbak`, `matdoc`, ...), readable by
anything that speaks Delta:

```python
from deltalake import DeltaTable
orders = DeltaTable("/tmp/sap-data/vbak").to_pandas()
```

```sql
-- duckdb
INSTALL delta; LOAD delta;
SELECT * FROM delta_scan('/tmp/sap-data/vbak');
```

`sap-mock generate -h` lists the knobs (volumes, seed, scenarios). Unlike
`seed-mock.sh`, standalone generation defaults to the fixed seed 42.

## Writing to a real graph

```sh
./seed-mock.sh --web <shortname>
```

Resolves the web and its actor on the graph (`http://localhost:4000`; set
`HASH_GRAPH_URL` for another) and verifies the supply-chain ontology exists
before writing. Explicit `HASH_WEB_ID`/`HASH_ACTOR_ID` env still works if you
prefer to skip resolution.

Re-runs with the same `--seed` are no-ops (the engine diffs against
`.mock-state/`). A different seed is a whole new dataset: replacing an
already-seeded web means archiving the old one, which the engine's
mass-archive guard refuses unless you opt in with `HASH_ALLOW_MASS_ARCHIVE=1`.
If you wipe the target web, wipe `.mock-state/` too -- state and graph move
together. Mock entities live under the `sap-mock` connector namespace, so they
can coexist with (and never overwrite) data from the real SAP integration in
the same web.

## Scenarios

Disruption events injected on top of the base data, visible as extra stock
movements (types 344/551/311), order churn, EKBE performance shifts, and the
`scenario_config`/`scenario_metadata` tables. The eleven marked ones run by
default (`--scenarios demo`).

| id | scenario | family | demo |
|---|---|---|---|
| SCN001 | Stock Deviation | inventory | yes |
| SCN002 | Contamination | inventory | |
| SCN003 | Fire Damage | inventory | yes |
| SCN004 | Production Shutdown | inventory | |
| SCN005 | Batch Quarantine (Single) | inventory | |
| SCN006 | Batch Quarantine (All Locations) | inventory | |
| SCN007 | Product Write-off | inventory | |
| SCN008 | Temperature Issue | inventory | |
| SCN009 | Re-route | inventory | |
| SCN010 | Partial Shutdown | inventory | |
| SCN011 | Demand Increase | production | yes |
| SCN012 | New Product Introduction | production | yes |
| SCN013 | Batch Expedition | production | |
| SCN014 | Limited Capacity | production | yes |
| SCN015 | Equipment Failure | production | yes |
| SCN016 | Competing Production | production | yes |
| SCN017 | Regulatory Inspection | production | |
| SCN018 | New Production Facility | production | |
| SCN019 | Product Shortage | production | |
| SCN020 | High Volatility | production | yes |
| SCN021 | Supplier Drift | supplier | yes |
| SCN022 | CMO Deviation Increase | supplier | |
| SCN023 | FDA 483 | supplier | yes |
| SCN024 | Vendor OTIF Decline | supplier | |
| SCN025 | CAPA Failures | supplier | |
| SCN026 | CAPA Improvement | supplier | yes |

- `./seed-mock.sh --scenarios none` -- base data only
- `./seed-mock.sh --scenarios SCN003,SCN011` -- specific scenarios; each also
  needs its `SCNxxx_CONFIG` env string (upstream skips configless scenarios
  silently -- config shapes are documented in the `sap-mock-data` package,
  and some reference generated batch ids, which change with the seed)

## Layout

| path | |
|---|---|
| `seed-mock.sh` | generate + run, one command |
| `resolve-web.mjs` | web shortname -> ids + ontology preflight (used by `--web`) |
| `libs/sap-mock-data` *(repo root)* | the data generator (pandas + deltalake, no Spark; a uv project with its own flake) |
| `sap-mock.yaml` | the integration: DuckDB `delta_scan` sources + pipelines |
| `.mock-warehouse/` | generated Delta tables (gitignored) |
| `.mock-state/` | pipeline diff state per web (gitignored) |

## Provenance & quirks

`libs/sap-mock-data` is a faithful pandas port of the private
hashintel/SAP_Mock_Data notebooks (Masterdata, Transactions, Setup Scenario
Config, Inject Scenarios): logic verbatim, Databricks/pyspark shell replaced
with pandas + Delta io; byte-verified against the original at identical
seeds. Upstream behaviors preserved as-is:

- RESB / movement-type-261 consumption is always empty (upstream never stocks
  RM01); an empty `resb` table is seeded so the pipeline contract holds.
- SCN017/SCN018 hit upstream warning paths on generated data; SCN007 is
  missing from the scenario status printout (it still runs).
- Uneven manual volumes (e.g. many orders, few materials) can crash the
  hub-and-spoke simulation -- scale volumes together via the scale factor.
- Dates anchor to the current day, so byte-level determinism holds within a
  day. The dirty-data and smoke-test stages of upstream are not ported.
