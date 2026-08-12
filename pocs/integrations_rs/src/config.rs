//! Single resolution point for runtime settings: an explicit environment map
//! (process env by default; tests pass their own), safe or derived defaults
//! everywhere. The set of settings stays small; an empty
//! environment produces a working single-node configuration.

use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct Env {
    vars: HashMap<String, String>,
}

impl Env {
    pub fn process() -> Self {
        Self {
            vars: std::env::vars().collect(),
        }
    }

    pub fn from_map(vars: HashMap<String, String>) -> Self {
        Self { vars }
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.vars.get(name).map(String::as_str)
    }

    /// Preserve operational settings while making definition interpolation
    /// default-deny. Direct, operator-invoked runs retain TS-compatible open
    /// interpolation; durable receipts and desired stream state call this
    /// before resolving user-authored definitions.
    pub(crate) fn durable_interpolation_scope(&self) -> Self {
        let mut scoped = self.clone();
        scoped
            .vars
            .entry("INTEGRATIONS_ENV_ALLOWLIST".to_owned())
            .or_default();
        scoped
    }

    fn int(&self, name: &str, default: u64) -> u64 {
        self.opt_int(name).unwrap_or(default)
    }

    fn opt_int(&self, name: &str) -> Option<u64> {
        self.get(name)
            .and_then(|value| value.trim().parse::<u64>().ok())
            .map(|n| n.max(1))
    }

    fn flag(&self, name: &str) -> bool {
        self.get(name) == Some("1")
    }
}

pub fn graph_concurrency(env: &Env) -> usize {
    env.int("HASH_GRAPH_CONCURRENCY", 16) as usize
}

pub fn graph_bulk_size(env: &Env) -> usize {
    env.int("HASH_GRAPH_BULK_SIZE", 128) as usize
}

/// The journal-cursored executor uses the same Graph bulk size as the
/// reference pipeline unless an operator explicitly tunes it separately.
pub fn durable_graph_bulk_size(env: &Env) -> usize {
    env.get("INTEGRATIONS_DURABLE_GRAPH_BULK_SIZE")
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or_else(|| graph_bulk_size(env))
}

pub fn graph_max_failed_batches(env: &Env) -> u32 {
    env.int("HASH_GRAPH_MAX_FAILED_BATCHES", 5) as u32
}

pub fn graph_timeout_ms(env: &Env) -> u64 {
    env.int("HASH_GRAPH_TIMEOUT_MS", 120_000).max(1000)
}

/// Deadline for opening or reading the durable control journal. Control-layer
/// commands must fail closed rather than hang indefinitely on broken storage.
pub fn control_read_timeout_ms(env: &Env) -> u64 {
    env.int("INTEGRATIONS_CONTROL_READ_TIMEOUT_MS", 10_000)
        .max(100)
}

/// Deadline for opening, closing, and confirming durability on the canonical
/// shard journal. Large remote journals may need more than the 60-second
/// floor to rebuild their SlateDB view during a fenced takeover.
pub fn durability_timeout_ms(env: &Env) -> u64 {
    env.int("INTEGRATIONS_DURABILITY_TIMEOUT_MS", 60_000)
        .max(60_000)
}

/// New journal events between control-projection snapshots. Snapshot payloads
/// are derived accelerators; a graceful shutdown still captures a smaller
/// suffix so quiet shards are not forced to replay from zero.
pub fn projection_snapshot_events(env: &Env) -> u64 {
    env.int("INTEGRATIONS_PROJECTION_SNAPSHOT_EVENTS", 128)
}

/// How often an owned shard checks whether the event threshold was reached.
pub fn projection_snapshot_interval_seconds(env: &Env) -> u64 {
    env.int("INTEGRATIONS_PROJECTION_SNAPSHOT_INTERVAL_SECONDS", 30)
}

/// Bounded process-wide memory assigned to SlateDB control-log data blocks.
/// The storage layer divides this across the configured shard capacity.
pub fn slatedb_block_cache_bytes(env: &Env) -> Result<u64, String> {
    storage_size_env(env, "INTEGRATIONS_SLATE_BLOCK_CACHE_BYTES", 512 << 20)
}

/// Bounded process-wide memory assigned to SlateDB indexes and filters.
pub fn slatedb_meta_cache_bytes(env: &Env) -> Result<u64, String> {
    storage_size_env(env, "INTEGRATIONS_SLATE_META_CACHE_BYTES", 64 << 20)
}

pub fn configured_shard_capacity(env: &Env) -> u64 {
    env.int("INTEGRATIONS_SHARD_CAPACITY", 256)
}

/// Maximum concurrent shard acquisition handshakes. Each handshake still
/// completes its own fenced open, replay, and two lease revalidations before
/// publishing a usable handle.
pub fn shard_acquisition_concurrency(env: &Env) -> usize {
    env.int("INTEGRATIONS_SHARD_ACQUISITION_CONCURRENCY", 4) as usize
}

/// How quickly a running worker observes blob-backed operational controls.
pub fn runtime_settings_refresh_ms(env: &Env) -> u64 {
    env.int("INTEGRATIONS_RUNTIME_SETTINGS_REFRESH_MS", 2_000)
        .max(100)
}

/// Maximum graceful shutdown window. After it expires, in-flight futures are
/// aborted and their journaled `attempt_started` state is replayed next boot.
pub fn worker_drain_timeout_seconds(env: &Env) -> u64 {
    env.int("INTEGRATIONS_WORKER_DRAIN_TIMEOUT_SECONDS", 30)
}

pub fn sync_window(env: &Env) -> u64 {
    env.int("HASH_SYNC_WINDOW", 20_000)
}

/// Successful stream batches between remote DuckDB snapshots. The durable
/// cursor may lag: crash recovery replays from the older cursor
/// for at-least-once delivery without one large object PUT per source batch.
pub fn stream_state_snapshot_batches(env: &Env) -> u64 {
    env.int("STREAM_STATE_SNAPSHOT_BATCHES", 100)
}

pub fn stream_state_snapshot_seconds(env: &Env) -> u64 {
    env.int("STREAM_STATE_SNAPSHOT_SECONDS", 60)
}

/// Hard application-level ceiling for one DuckDB database, its WAL and its
/// DuckDB temp directory. DuckDB itself limits temp spill but does not expose
/// a maximum persistent database size, so the store enforces this after every
/// serialized statement and before opening an existing workspace.
pub fn duckdb_max_database_size(env: &Env) -> String {
    env.get("DUCKDB_MAX_DATABASE_SIZE")
        .unwrap_or("4GiB")
        .to_owned()
}

pub fn duckdb_max_database_bytes(env: &Env) -> Result<u64, String> {
    parse_storage_size(&duckdb_max_database_size(env))
        .map_err(|message| format!("invalid DUCKDB_MAX_DATABASE_SIZE: {message}"))
}

pub fn parse_storage_size(value: &str) -> Result<u64, String> {
    let value = value.trim();
    let split = value
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(value.len());
    let (number, unit) = value.split_at(split);
    let number = number.parse::<u64>().map_err(|_parse_error| {
        format!("expected a non-negative integer and unit, got {value:?}")
    })?;
    let multiplier = match unit.trim().to_ascii_lowercase().as_str() {
        "" | "b" => 1,
        "kb" => 1_000,
        "mb" => 1_000_000,
        "gb" => 1_000_000_000,
        "tb" => 1_000_000_000_000,
        "kib" => 1 << 10,
        "mib" => 1 << 20,
        "gib" => 1 << 30,
        "tib" => 1_u64 << 40,
        _ => {
            return Err(format!(
                "unsupported unit in {value:?}; use B, KB, MB, GB, KiB, MiB, GiB or TiB"
            ));
        }
    };
    number
        .checked_mul(multiplier)
        .ok_or_else(|| format!("{value:?} exceeds the supported byte range"))
}

pub fn max_concurrent_integrations(env: &Env) -> usize {
    env.opt_int("MAX_CONCURRENT_INTEGRATIONS")
        .map(|n| n as usize)
        .unwrap_or_else(|| (available_parallelism() / 2).max(1))
}

fn available_parallelism() -> usize {
    std::thread::available_parallelism()
        .map(std::num::NonZeroUsize::get)
        .unwrap_or(2)
}

pub fn allow_mass_archive(env: &Env) -> bool {
    env.flag("HASH_ALLOW_MASS_ARCHIVE")
}

pub fn allow_state_mismatch(env: &Env) -> bool {
    env.flag("HASH_ALLOW_STATE_MISMATCH")
}

pub fn allow_private_hosts(env: &Env) -> bool {
    env.flag("INTEGRATIONS_ALLOW_PRIVATE_HOSTS")
}

pub fn runner_base_dir(env: &Env) -> String {
    env.get("RUNNER_BASE_DIR")
        .unwrap_or("state/local")
        .to_owned()
}

/// Durable object-store root. Local filesystem is a development backend;
/// production uses `s3://bucket/prefix` with standard `AWS_*` credentials.
pub fn blob_store_url(env: &Env) -> String {
    env.get("INTEGRATIONS_BLOB_URL")
        .map(str::to_owned)
        .unwrap_or_else(|| format!("file://{}/blob-store", runner_base_dir(env)))
}

/// Disposable, verified object cache and writable upload staging area.
pub fn blob_cache_dir(env: &Env) -> std::path::PathBuf {
    env.get("INTEGRATIONS_BLOB_CACHE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(runner_base_dir(env)).join("blob-cache"))
}

/// Bounds for disposable local state. The aggregate workspace default is a
/// node-wide ceiling rather than an up-front reservation per run; admission reserves
/// only the exact restored state plus one checkpoint copy.
pub fn local_disk_limits(env: &Env) -> Result<crate::local_disk::LocalDiskLimits, String> {
    let database_bytes = duckdb_max_database_bytes(env)?;
    let default_workspace_bytes = database_bytes
        .checked_mul(max_concurrent_integrations(env) as u64)
        .ok_or_else(|| "default aggregate workspace limit exceeds u64".to_owned())?;
    let max_workspace_bytes =
        storage_size_env(env, "RUNNER_MAX_WORKSPACE_BYTES", default_workspace_bytes)?;
    let max_cache_bytes = storage_size_env(
        env,
        "INTEGRATIONS_BLOB_CACHE_MAX_BYTES",
        8 * 1024 * 1024 * 1024,
    )?;
    let min_free_bytes = storage_size_env(env, "RUNNER_MIN_FREE_BYTES", 1024 * 1024 * 1024)?;
    let max_staging_bytes =
        storage_size_env(env, "RUNNER_MAX_STAGING_BYTES", 2 * 1024 * 1024 * 1024)?;
    let max_staging_age = std::time::Duration::from_secs(
        env.opt_int("RUNNER_MAX_STAGING_AGE_SECONDS")
            .unwrap_or(24 * 60 * 60),
    );

    if max_workspace_bytes == 0 || max_cache_bytes == 0 || max_staging_bytes == 0 {
        return Err(
            "RUNNER_MAX_WORKSPACE_BYTES, INTEGRATIONS_BLOB_CACHE_MAX_BYTES and RUNNER_MAX_STAGING_BYTES must be greater than zero"
                .to_owned(),
        );
    }
    if max_staging_age.is_zero() {
        return Err("RUNNER_MAX_STAGING_AGE_SECONDS must be greater than zero".to_owned());
    }
    Ok(crate::local_disk::LocalDiskLimits {
        max_workspace_bytes,
        max_cache_bytes,
        min_free_bytes,
        max_staging_bytes,
        max_staging_age,
    })
}

fn storage_size_env(env: &Env, name: &str, default: u64) -> Result<u64, String> {
    env.get(name).map_or(Ok(default), |value| {
        parse_storage_size(value).map_err(|message| format!("invalid {name}: {message}"))
    })
}

pub fn implicitly_exposed_integration_env(name: &str) -> bool {
    matches!(name, "HASH_TYPE_BASE" | "HASH_WEB_ID" | "SOURCE_FOLDER")
}

/// The environment visible to `${KEY}` interpolation. Direct operator runs
/// remain TS-compatible when no allowlist is set. Durable entry points install
/// an empty allowlist first, exposing only the small framework-owned set of names
/// below plus names explicitly selected by the operator.
pub fn interpolation_env(env: &Env) -> HashMap<String, String> {
    match env.get("INTEGRATIONS_ENV_ALLOWLIST") {
        None => env.vars.clone(),
        Some(names) => {
            let allowed: Vec<&str> = names.split(',').map(str::trim).collect();
            env.vars
                .iter()
                .filter(|(name, _)| {
                    allowed.contains(&name.as_str())
                        || implicitly_exposed_integration_env(name.as_str())
                })
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect()
        }
    }
}

/// DuckDB extensions an integration may request. json and parquet are
/// compiled into the bundled build; excel is required for local XLSX inputs.
/// httpfs and the foreign-database scanners stay off the list: external access
/// is disabled anyway, and there is no legitimate use from inside a sandboxed
/// store.
pub fn duckdb_extension_allowlist() -> &'static [&'static str] {
    &["core_functions", "json", "parquet", "icu", "excel"]
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuckdbLimits {
    pub memory_limit: Option<String>,
    pub max_temp_directory_size: Option<String>,
    pub threads: u64,
}

/// Derived DuckDB resource bounds: each concurrently-active store gets an
/// equal share of 80% of the container's memory (cgroup v2, then v1, then
/// /proc/meminfo) and of the cores, with temp spill capped at 4x its memory
/// share. Explicit DUCKDB_* env vars override; nowhere is the default
/// unbounded when memory is determinable.
pub fn duckdb_limits(env: &Env) -> DuckdbLimits {
    let slots = max_concurrent_integrations(env) as u64;
    let share = system_memory_bytes().map(|total| total * 8 / 10 / slots);

    let memory_limit = env
        .get("DUCKDB_MEMORY_LIMIT")
        .map(str::to_owned)
        .or_else(|| share.map(mb));

    DuckdbLimits {
        max_temp_directory_size: env
            .get("DUCKDB_MAX_TEMP_SIZE")
            .map(str::to_owned)
            .or_else(|| share.map(|bytes| mb(bytes * 4))),
        memory_limit,
        threads: env
            .opt_int("DUCKDB_THREADS")
            .unwrap_or_else(|| (available_parallelism() as u64 / slots).max(1)),
    }
}

fn mb(bytes: u64) -> String {
    format!("{}MB", (bytes / (1024 * 1024)).max(256))
}

// cgroup v1 reports a huge sentinel when unlimited; anything implausible
// falls through to the next source.
const MEMORY_PLAUSIBLE_MAX: u64 = 16 * 1024 * 1024 * 1024 * 1024;

/// Container-aware total memory: cgroup v2, cgroup v1, /proc/meminfo; `None`
/// when undeterminable.
pub fn system_memory_bytes() -> Option<u64> {
    read_int(Path::new("/sys/fs/cgroup/memory.max"))
        .or_else(|| read_int(Path::new("/sys/fs/cgroup/memory/memory.limit_in_bytes")))
        .or_else(meminfo_total)
}

fn read_int(path: &Path) -> Option<u64> {
    let content = std::fs::read_to_string(path).ok()?;
    let n = content.trim().parse::<u64>().ok()?;
    (n > 0 && n < MEMORY_PLAUSIBLE_MAX).then_some(n)
}

fn meminfo_total() -> Option<u64> {
    let content = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = content.lines().find(|line| line.starts_with("MemTotal:"))?;
    let kb = line.split_whitespace().nth(1)?.parse::<u64>().ok()?;
    Some(kb * 1024)
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Env {
        Env::from_map(
            pairs
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
        )
    }

    #[test]
    fn interpolation_env_is_unrestricted_without_allowlist_scoped_with_one() {
        let open = env(&[("API_TOKEN", "t"), ("AWS_SECRET_ACCESS_KEY", "s")]);
        assert_eq!(interpolation_env(&open).len(), 2);

        let scoped = env(&[
            ("API_TOKEN", "t"),
            ("AWS_SECRET_ACCESS_KEY", "s"),
            ("INTEGRATIONS_ENV_ALLOWLIST", "API_TOKEN"),
        ]);
        let visible = interpolation_env(&scoped);
        assert_eq!(visible.get("API_TOKEN").map(String::as_str), Some("t"));
        assert!(!visible.contains_key("AWS_SECRET_ACCESS_KEY"));

        let durable = env(&[
            ("DATABASE_URL", "postgres://secret"),
            ("HASH_TYPE_BASE", "https://hash.ai/@h/types"),
        ])
        .durable_interpolation_scope();
        let visible = interpolation_env(&durable);
        assert!(!visible.contains_key("DATABASE_URL"));
        assert_eq!(
            visible.get("HASH_TYPE_BASE").map(String::as_str),
            Some("https://hash.ai/@h/types")
        );
    }

    #[test]
    fn duckdb_limits_divide_the_node_budget_and_honor_overrides() {
        let limits = duckdb_limits(&env(&[("MAX_CONCURRENT_INTEGRATIONS", "2")]));
        if let Some(total) = system_memory_bytes() {
            let expected = format!("{}MB", (total * 8 / 10 / 2 / (1024 * 1024)).max(256));
            assert_eq!(limits.memory_limit.as_deref(), Some(expected.as_str()));
        }
        assert!(limits.threads >= 1);

        let explicit = duckdb_limits(&env(&[
            ("DUCKDB_MEMORY_LIMIT", "1GB"),
            ("DUCKDB_THREADS", "3"),
        ]));
        assert_eq!(explicit.memory_limit.as_deref(), Some("1GB"));
        assert_eq!(explicit.threads, 3);
    }

    #[test]
    fn storage_size_parser_is_strict_and_overflow_safe() {
        assert_eq!(parse_storage_size("4GiB").unwrap(), 4 * (1_u64 << 30));
        assert_eq!(parse_storage_size("10 GB").unwrap(), 10_000_000_000);
        assert!(parse_storage_size("-1GB").is_err());
        assert!(parse_storage_size("4G").is_err());
        assert!(parse_storage_size("99999999999999999999TiB").is_err());
    }

    #[test]
    fn local_runtime_defaults_under_the_ignored_state_directory() {
        assert_eq!(runner_base_dir(&env(&[])), "state/local");
        assert_eq!(
            runner_base_dir(&env(&[("RUNNER_BASE_DIR", "state/my-run")])),
            "state/my-run"
        );
    }

    #[test]
    fn replay_accelerator_defaults_are_bounded_and_overridable() {
        let defaults = env(&[]);
        assert_eq!(projection_snapshot_events(&defaults), 128);
        assert_eq!(projection_snapshot_interval_seconds(&defaults), 30);
        assert_eq!(slatedb_block_cache_bytes(&defaults).unwrap(), 512 << 20);
        assert_eq!(slatedb_meta_cache_bytes(&defaults).unwrap(), 64 << 20);
        assert_eq!(configured_shard_capacity(&defaults), 256);
        assert_eq!(shard_acquisition_concurrency(&defaults), 4);

        let tuned = env(&[
            ("INTEGRATIONS_PROJECTION_SNAPSHOT_EVENTS", "32"),
            ("INTEGRATIONS_PROJECTION_SNAPSHOT_INTERVAL_SECONDS", "5"),
            ("INTEGRATIONS_SLATE_BLOCK_CACHE_BYTES", "128MiB"),
            ("INTEGRATIONS_SLATE_META_CACHE_BYTES", "16MiB"),
            ("INTEGRATIONS_SHARD_CAPACITY", "4"),
            ("INTEGRATIONS_SHARD_ACQUISITION_CONCURRENCY", "2"),
        ]);
        assert_eq!(projection_snapshot_events(&tuned), 32);
        assert_eq!(projection_snapshot_interval_seconds(&tuned), 5);
        assert_eq!(slatedb_block_cache_bytes(&tuned).unwrap(), 128 << 20);
        assert_eq!(slatedb_meta_cache_bytes(&tuned).unwrap(), 16 << 20);
        assert_eq!(configured_shard_capacity(&tuned), 4);
        assert_eq!(shard_acquisition_concurrency(&tuned), 2);
    }

    #[test]
    fn local_disk_limits_are_typed_checked_and_operator_overridable() {
        let limits = local_disk_limits(&env(&[
            ("DUCKDB_MAX_DATABASE_SIZE", "10MiB"),
            ("MAX_CONCURRENT_INTEGRATIONS", "3"),
            ("RUNNER_MAX_WORKSPACE_BYTES", "25MiB"),
            ("INTEGRATIONS_BLOB_CACHE_MAX_BYTES", "7MiB"),
            ("RUNNER_MIN_FREE_BYTES", "6MiB"),
            ("RUNNER_MAX_STAGING_BYTES", "5MiB"),
            ("RUNNER_MAX_STAGING_AGE_SECONDS", "42"),
        ]))
        .unwrap();
        assert_eq!(limits.max_workspace_bytes, 25 * 1024 * 1024);
        assert_eq!(limits.max_cache_bytes, 7 * 1024 * 1024);
        assert_eq!(limits.min_free_bytes, 6 * 1024 * 1024);
        assert_eq!(limits.max_staging_bytes, 5 * 1024 * 1024);
        assert_eq!(limits.max_staging_age, std::time::Duration::from_secs(42));

        assert!(local_disk_limits(&env(&[("RUNNER_MAX_WORKSPACE_BYTES", "0B")])).is_err());
        assert!(
            local_disk_limits(&env(&[("INTEGRATIONS_BLOB_CACHE_MAX_BYTES", "unbounded")])).is_err()
        );
    }
}
