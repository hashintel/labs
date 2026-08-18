# integrations

Data-pipeline engine PoC: connectors (Postgres, MongoDB, REST, DuckDB sources)
-> SQL/fn transform pipelines -> HASH graph sink. Engine source in `src/`; the
YAML runner and orchestration live in `../integration-runner`.

## Seed a web with synthetic SAP data

**1. Runner deps** (node 20+, once):

```sh
(cd ../integration-runner && npm install)
```

**2. Seed:**

```sh
./examples/sap-mock/seed-mock.sh --web <shortname>                   # seed that web
./examples/sap-mock/seed-mock.sh --web <shortname> --scale-factor 5  # bigger
./examples/sap-mock/seed-mock.sh                                     # dry run, stub graph
```

You're done when it prints `sync: <n> ok, 0 errors`. Worth knowing:

- `--web` looks the shortname up on your local graph (`HASH_GRAPH_URL` for a
  different one), picks the right actor, and checks the supply-chain ontology
  is present. If anything's off, it tells you exactly what and how to fix it.
- No `--web` writes nothing (stub graph) -- good first try.
- `--scale-factor` sizes the dataset (linear, rough numbers):

  | SF | orders | graph entities+links |
  |---|---|---|
  | 0.1 | 500 | ~18k |
  | 1 *(default)* | 5,000 | ~175k |
  | 5 | 25,000 | ~0.9M |
  | 10 | 50,000 | ~1.8M |

- Each run generates fresh data from a random seed (printed at start).
  `--seed <n>` pins it: same seed, same data -- and re-seeding a web is a
  no-op only when the seed (and flags) match the previous run.

Scenario catalog, standalone generator use, and the rest of the knobs:
[examples/sap-mock/README.md](examples/sap-mock/README.md).
