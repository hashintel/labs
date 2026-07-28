# integrations_rs

Rust integration engine and durable runner for HASH Graph pipelines.

The control plane is PostgreSQL-free. Blob storage holds immutable inputs,
state, desired projections, effects, receipts, leases, and snapshots. One
OpenData/SlateDB log per used shard is the ordered source of truth. Local DuckDB
files are disposable workspaces and caches.

## Development

Enter the reproducible shell from this directory:

```sh
nix develop path:./nix/devshell
```

Run the standard checks:

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo nextest run
cargo test --doc
```

Or run one command without entering the shell:

```sh
nix develop path:./nix/devshell -c cargo nextest run
```

Runtime files belong under `state/`, which is ignored by Git. Set
`RUNNER_BASE_DIR` to move disposable workspaces and caches elsewhere.

## V1 command surface

```text
integrations_rs submit <definition> [--links-only] [--replay-bronze source[=ts]] [--json]
integrations_rs status <run-id> [--json]
integrations_rs cancel <run-id> [--json]
integrations_rs tune
integrations_rs tune concurrency <count|default>
integrations_rs tune graph-rps <requests-per-second|default>
integrations_rs doctor
integrations_rs verify-store [--full]
integrations_rs worker --activate-baseline
```

`submit` writes immutable V1 input and policy artifacts, then create-writes a
ready receipt and arbitrates the integration admission pointer. Pipeline YAML
contains only pipeline concerns. Run IDs, retry policy, trace context, and
invocation options live in internal versioned metadata.

`status` uses a read-only shard-log reader. It never acquires a lease, opens a
writer, or advances a SlateDB epoch.

`cancel` publishes a deterministic `ControlRequest` to the owning shard inbox.
Success means the request is durably queued. The shard owner resolves it through
the serialized command loop.

`verify-store` validates the V1 baseline and canonical tenant inventory.

The production worker remains fail-closed until the explicit activation gate is
complete. The only accepted activation form is:

```text
integrations_rs worker --activate-baseline
```

That flag authorizes baseline initialization and leased worker construction only
after registry, migration-capability, configuration, provider-attestation, Graph
permission, and baseline checks succeed.

Continuous stream definitions are outside protocol V1 and are rejected at
admission.

## Required configuration

The durable command surface requires:

```text
HASH_WEB_ID=<web UUID or validated tenant namespace>
INTEGRATIONS_BLOB_URL=file:///absolute/path
```

For S3:

```text
INTEGRATIONS_BLOB_URL=s3://bucket/prefix
AWS_REGION=<region>
```

Standard AWS credential resolution applies.

Graph delivery requires:

```text
HASH_GRAPH_URL=<Graph base URL>
HASH_ACTOR_ID=<machine actor UUID>
```

The activation permission preflight additionally accepts optional managed
entity and link canaries:

```text
INTEGRATIONS_GRAPH_PERMISSION_ENTITY_ID=<managed entity canary>
INTEGRATIONS_GRAPH_PERMISSION_LINK_ID=<managed link canary>
```

When both canaries are configured, the permission preflight sends only bounded
`POST /entities/permissions` requests. It does not fetch entity payloads or
mutate Graph. A proven denial or a configured but failed preflight blocks
activation. Missing canaries report `Unverified`, warn, and proceed.

Useful operational settings include:

```text
INTEGRATIONS_GRAPH_REQUESTS_PER_SECOND
INTEGRATIONS_CONFIGURED_RUNNERS
INTEGRATIONS_RECONCILIATION_BASIS_POINTS
HASH_GRAPH_CONCURRENCY
HASH_GRAPH_BULK_SIZE
HASH_GRAPH_TIMEOUT_MS
MAX_CONCURRENT_INTEGRATIONS
DUCKDB_MAX_DATABASE_SIZE
RUNNER_MAX_WORKSPACE_BYTES
RUNNER_MIN_FREE_BYTES
INTEGRATIONS_BLOB_CACHE
INTEGRATIONS_BLOB_CACHE_MAX_BYTES
RUNNER_MAX_STAGING_BYTES
RUNNER_MAX_STAGING_AGE_SECONDS
```

All lease, request-budget, DRR, and disk settings are validated before worker
activation.

`INTEGRATIONS_GRAPH_REQUESTS_PER_SECOND` is the fleet-wide ceiling for actual
Graph HTTP requests per second (default: 500). It is divided into static
worker shares using `INTEGRATIONS_CONFIGURED_RUNNERS`; foreground and
reconciliation traffic are both charged against each worker's shared parent
ceiling. The limit can be changed while workers are running, normally within
two seconds:

```text
integrations_rs tune graph-rps <requests-per-second>
integrations_rs tune graph-rps default
```

The command uses `HASH_WEB_ID` to select the tenant. `default` restores the
worker's validated `INTEGRATIONS_GRAPH_REQUESTS_PER_SECOND` startup value.
`HASH_GRAPH_BULK_SIZE` controls operations inside one request and
`HASH_GRAPH_CONCURRENCY` controls the number of requests in flight; neither
bypasses the request-rate ceiling.

## Durable model

Each canonical integration routes to one of 256 fixed shards. Every used shard
has:

- one immutable known-shard marker;
- one renewable V1 lease;
- one append-capable OpenData/SlateDB log;
- a pure projection reconstructed from the log or a validated snapshot;
- one serialized command loop as the only append path.

The runner distinguishes three identities:

```text
RunId          one admitted user invocation
StateVersionId one immutable integration state and desired projection
WorkId         one resumable external-effect batch
```

Apply, Restore, and Reconcile use immutable work manifests and the same chunked
executor. A cursor advances only for the contiguous acknowledged effect prefix.
Graph delivery is at least once. A lost acknowledgement may resend an effect;
deterministic identities and operation-specific conflict handling make the
resend convergent. Create conflicts include HTTP 409 and the live Graph's
bounded duplicate-key/`ALREADY_EXISTS` diagnostics; body-based inference never
applies to Patch or Archive.

Recovery order is:

1. restore the complete durable log prefix;
2. resume incomplete work;
3. resolve control requests;
4. promote admitted ready receipts;
5. plan or execute new work;
6. run background Reconcile when foreground work permits.

No local file contains unique durable state. Published state and effect objects
are content-addressed, size-checked, digest-checked, and restored into bounded
local workspaces. Verified cache entries may be evicted when they are not being
materialized.

## Metadata versioning

Every production record family currently emits and supports V1 only. Records are
enum-wrapped and normalized through a typed current-domain boundary. The
registry declares each family's durability class, supported versions, algorithm
versions, and migration policy.

After V1 freezes, an incompatible change adds a new variant and follows one of
the compiler-enforced policies:

- pure upcast for immutable records;
- conditional rewrite for mutable CAS records;
- rebuild for derived records;
- retained decoder support for untrimmed journal records.

Unknown future versions fail closed. The independent manifest at
`tests/golden/expected-record-families-v1.json` must exactly match the compiled
registry before activation.

## Validation

Hermetic tests cover the projection transition table, crash recovery, ambiguous
append handling, fencing, lease churn, state restoration, Graph request budgets,
DRR fairness, disk pressure, snapshots, GC marking, permission response hygiene,
and backend-neutral conformance.

Credentialed release suites separately prove:

- S3 conditional create/update and read-after-write;
- multipart completion, abort, and process interruption;
- tenant and shard prefix isolation;
- SlateDB durable append and writer fencing;
- Graph conflict, throttling, and error classification;
- machine-actor permissions and isolated mutation behavior.

The owning design documents are under `local/docs/`.
