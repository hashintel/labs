# integrations_rs

Rust integration engine and durable runner for HASH Graph pipelines.

The control layer is PostgreSQL-free. Blob storage holds immutable inputs,
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

## V1 operator commands

```text
integrations_rs submit <definition> [--links-only] [--replay-bronze source[=ts]] [--json]
integrations_rs status <run-id> [--json]
integrations_rs cancel <run-id> [--json]
integrations_rs tune
integrations_rs tune concurrency <count|default>
integrations_rs tune graph-rps <requests-per-second|default>
integrations_rs doctor
integrations_rs verify-store [--full]
integrations_rs serve --activate-baseline
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
integrations_rs serve --activate-baseline
integrations_rs worker --activate-baseline
```

`serve` is the normal deployment mode: one process exposes the HTTP API and
concurrently owns as many leased shards as its capacity permits. `worker` is
retained for operational and compatibility testing. The local `submit`,
`status`, and `cancel` commands call the same application service directly, so
they do not need a running HTTP server.

The API defaults to `127.0.0.1:3000`; set `INTEGRATIONS_HTTP_BIND` to change it.
Interactive OpenAPI documentation is at `/docs`, with the OpenAPI 3.1 document
at `/openapi.json`. V1 routes are:

```text
POST   /v1/webs/{web}/integrations/{connector}/runs
GET    /v1/webs/{web}/integrations/{connector}/runs/{run}
DELETE /v1/webs/{web}/integrations/{connector}/runs/{run}
GET    /health/live
```

The deployment boundary authenticates requests and supplies the trusted
`x-hash-actor-id` header. The HTTP module contains only strict transport DTOs,
error/status mapping, and OpenAPI generation; durable orchestration is behind a
framework-independent service interface. The current worker is configured for
one `HASH_WEB_ID`, so the API rejects another web rather than accepting work no
local worker can consume. Fleet-wide multi-web discovery is a separate rollout
step.

The authenticated actor is stored in the immutable run input and carried into
the state and work manifests. Graph requests—including retries, Restore, and
Reconcile—so use the run owner recorded by durable history rather than
the actor configured on whichever node executes the work.

Both production modes authorize baseline initialization and leased worker
construction only after registry, migration-capability, configuration,
provider-attestation, Graph permission, and baseline checks succeed.

Finite-run protocol V1 still rejects continuous definitions at run admission.
Managed webhook definitions instead use `connector.mode: webhook`, a supported
`provider`, and a non-empty `subscriptions` list. Their routes are:

```text
PUT    /v1/webs/{web}/integrations/{connector}
GET    /v1/webs/{web}/integrations/{connector}
PATCH  /v1/webs/{web}/integrations/{connector}/desired-state
POST   /v1/webs/{web}/integrations/{connector}/bindings
POST   /v1/hooks/github
POST   /v1/hooks/slack
POST   /v1/hooks/linear
POST   /v1/hooks/notion/{binding_id}
```

Webhook payloads are signature-checked as exact raw bytes, stored
content-addressed, and then create-written as tenant receipts. Only after both
objects are durable is the request acknowledged. Delivery-ID redelivery is
idempotent; reusing an ID with different bytes is rejected. Production webhook
activation remains fail-closed until a Vault-backed `SecretStore` is supplied.

## Required configuration

The durable operator commands require:

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
HASH_ACTOR_ID=<node actor UUID used for activation and direct CLI submissions>
```

Graph authorization is enforced at the trusted submission boundary and by the
Graph on each delivery. The engine does not use managed entities to probe an
actor's permissions during worker activation.

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
