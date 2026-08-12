//! Owns one DuckDB database per integration. All statements serialize through
//! a dedicated OS thread (DuckDB calls block; connections are not
//! concurrency-safe), with an async facade over a channel: the tokio
//! equivalent of the GenServer store. Hardening mirrors the TS/Elixir
//! engines: autoinstall/autoload off, community extensions off, allowed
//! directories as the only filesystem exceptions, external access disabled,
//! configuration locked. Resource limits (memory, temp spill, threads) are
//! always set by the caller from the derived node budget.

use std::path::PathBuf;
use std::sync::mpsc;

use error_stack::{Report, ResultExt as _};
use serde_json::Value;
use tokio::sync::oneshot;

use crate::error::StoreError;

/// Quote a DuckDB identifier (state-table names contain `/`).
pub fn qi(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

/// Quote a SQL string literal.
pub fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[derive(Debug, Clone, Default)]
pub struct StoreOptions {
    /// `None` = in-memory.
    pub path: Option<PathBuf>,
    /// `None` = sandbox off (tests); `Some` = the only filesystem exceptions.
    pub allowed_directories: Option<Vec<PathBuf>>,
    pub extensions: Vec<String>,
    pub memory_limit: Option<String>,
    pub max_temp_directory_size: Option<String>,
    /// Includes the database file, WAL and DuckDB's `<database>.tmp` tree.
    /// Human-readable binary/decimal units are accepted, e.g. `4GiB`, `10GB`.
    pub max_database_size: Option<String>,
    /// Node-wide active workspace root and ceiling. This catches concurrent
    /// growth that per-database limits cannot see.
    pub aggregate_workspace_root: Option<PathBuf>,
    pub max_aggregate_workspace_size: Option<String>,
    pub min_free_space: Option<String>,
    pub threads: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

impl QueryResult {
    pub fn single(&self) -> Option<&Value> {
        self.rows.first().and_then(|row| row.first())
    }

    pub fn single_i64(&self) -> i64 {
        self.single().and_then(Value::as_i64).unwrap_or(0)
    }

    pub fn row_maps(&self) -> Vec<crate::value::Row> {
        self.rows
            .iter()
            .map(|row| {
                self.columns
                    .iter()
                    .cloned()
                    .zip(row.iter().cloned())
                    .collect()
            })
            .collect()
    }
}

enum Command {
    Query {
        sql: String,
        params: Vec<Value>,
        reply: oneshot::Sender<Result<QueryResult, String>>,
    },
    Exec {
        sql: String,
        params: Vec<Value>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Snapshot {
        target: PathBuf,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Close {
        reply: oneshot::Sender<()>,
    },
}

/// Cloneable async handle; the connection thread exits (checkpointing the
/// WAL) when the last handle drops.
#[derive(Clone)]
pub struct Store {
    tx: mpsc::Sender<Command>,
}

impl Store {
    pub fn open(options: StoreOptions) -> Result<Self, Report<StoreError>> {
        let denied: Vec<_> = options
            .extensions
            .iter()
            .filter(|ext| !crate::config::duckdb_extension_allowlist().contains(&ext.as_str()))
            .cloned()
            .collect();
        if !denied.is_empty() {
            return Err(Report::new(StoreError)
                .attach_printable(format!("extensions not allowlisted: {}", denied.join(", "))));
        }

        let (tx, rx) = mpsc::channel::<Command>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        std::thread::Builder::new()
            .name("duckdb-store".to_owned())
            .spawn(move || connection_thread(options, rx, ready_tx))
            .change_context(StoreError)?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self { tx }),
            Ok(Err(message)) => Err(Report::new(StoreError).attach_printable(message)),
            Err(_) => {
                Err(Report::new(StoreError).attach_printable("store thread died during open"))
            }
        }
    }

    pub async fn query(&self, sql: &str) -> Result<QueryResult, Report<StoreError>> {
        self.query_params(sql, vec![]).await
    }

    pub async fn query_params(
        &self,
        sql: &str,
        params: Vec<Value>,
    ) -> Result<QueryResult, Report<StoreError>> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::Query {
            sql: sql.to_owned(),
            params,
            reply,
        })?;
        Self::wait(rx, sql).await
    }

    pub async fn exec(&self, sql: &str) -> Result<(), Report<StoreError>> {
        self.exec_params(sql, vec![]).await
    }

    pub async fn exec_params(
        &self,
        sql: &str,
        params: Vec<Value>,
    ) -> Result<(), Report<StoreError>> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::Exec {
            sql: sql.to_owned(),
            params,
            reply,
        })?;
        Self::wait(rx, sql).await
    }

    /// Creates a transactionally-consistent, independently-openable DuckDB
    /// copy while all other commands remain serialized behind the connection
    /// thread. Callers can then fsync and upload the copy without racing live
    /// database writes.
    pub async fn snapshot(&self, target: PathBuf) -> Result<(), Report<StoreError>> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::Snapshot {
            target: target.clone(),
            reply,
        })?;
        Self::wait(rx, &format!("snapshot {}", target.display())).await
    }

    /// Checkpoints and closes the sole DuckDB connection before local files
    /// are reclaimed. Other clones become unusable after this call.
    pub async fn close(self) -> Result<(), Report<StoreError>> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::Close { reply })?;
        rx.await.map_err(|_recv_error| {
            Report::new(StoreError).attach_printable("store thread died while closing DuckDB")
        })
    }

    /// Column names of a table (`None` when it does not exist).
    pub async fn schema_of(&self, table: &str) -> Result<Option<Vec<String>>, Report<StoreError>> {
        match self
            .query(&format!("SELECT * FROM {} LIMIT 0", qi(table)))
            .await
        {
            Ok(result) => Ok(Some(result.columns)),
            Err(_) => Ok(None),
        }
    }

    fn send(&self, command: Command) -> Result<(), Report<StoreError>> {
        self.tx
            .send(command)
            .map_err(|_send_error| Report::new(StoreError).attach_printable("store thread is gone"))
    }

    async fn wait<T>(
        rx: oneshot::Receiver<Result<T, String>>,
        sql: &str,
    ) -> Result<T, Report<StoreError>> {
        match rx.await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(message)) => Err(Report::new(StoreError)
                .attach_printable(message)
                .attach_printable(format!(
                    "sql: {}",
                    sql.chars().take(200).collect::<String>()
                ))),
            Err(_) => Err(Report::new(StoreError).attach_printable("store thread died mid-call")),
        }
    }
}

fn connection_thread(
    options: StoreOptions,
    rx: mpsc::Receiver<Command>,
    ready: mpsc::Sender<Result<(), String>>,
) {
    let database_path = options.path.clone();
    let max_database_size = match options
        .max_database_size
        .as_deref()
        .map(crate::config::parse_storage_size)
        .transpose()
    {
        Ok(value) => value,
        Err(message) => {
            let _ = ready.send(Err(message));
            return;
        }
    };
    let max_aggregate_workspace_size = match options
        .max_aggregate_workspace_size
        .as_deref()
        .map(crate::config::parse_storage_size)
        .transpose()
    {
        Ok(value) => value,
        Err(message) => {
            let _ = ready.send(Err(message));
            return;
        }
    };
    let min_free_space = match options
        .min_free_space
        .as_deref()
        .map(crate::config::parse_storage_size)
        .transpose()
    {
        Ok(value) => value,
        Err(message) => {
            let _ = ready.send(Err(message));
            return;
        }
    };
    let connection = match open_hardened(&options) {
        Ok(connection) => connection,
        Err(message) => {
            let _ = ready.send(Err(message));
            return;
        }
    };
    let enforce = || {
        enforce_disk_bounds(
            &connection,
            database_path.as_deref(),
            max_database_size,
            options.aggregate_workspace_root.as_deref(),
            max_aggregate_workspace_size,
            min_free_space,
        )
    };
    if let Err(message) = enforce() {
        let _ = ready.send(Err(message));
        return;
    }
    let _ = ready.send(Ok(()));

    while let Ok(command) = rx.recv() {
        match command {
            Command::Query { sql, params, reply } => {
                let result = enforce().and_then(|()| run_query(&connection, &sql, &params));
                let quota = enforce();
                let _ = reply.send(quota.and(result));
            }
            Command::Exec { sql, params, reply } => {
                let result =
                    enforce().and_then(|()| run_query(&connection, &sql, &params).map(|_| ()));
                let quota = enforce();
                let _ = reply.send(quota.and(result));
            }
            Command::Snapshot { target, reply } => {
                let result = enforce().and_then(|()| {
                    snapshot_database(&connection, database_path.as_deref(), &target)
                });
                let quota = enforce();
                let _ = reply.send(quota.and(result));
            }
            Command::Close { reply } => {
                drop(connection);
                let _ = reply.send(());
                return;
            }
        }
    }
    // Dropping the connection checkpoints the WAL: state survives
    // interruption mid-flush.
}

fn enforce_disk_bounds(
    connection: &duckdb::Connection,
    database_path: Option<&std::path::Path>,
    database_limit: Option<u64>,
    aggregate_root: Option<&std::path::Path>,
    aggregate_limit: Option<u64>,
    min_free_space: Option<u64>,
) -> Result<(), String> {
    let violation = disk_violation(
        database_path,
        database_limit,
        aggregate_root,
        aggregate_limit,
        min_free_space,
    )?;
    if violation.is_none() {
        return Ok(());
    }

    // A meaningful DuckDB boundary can fold WAL pages back into the database
    // and release temp spill. It is attempted exactly once before the hard
    // resource failure is returned; work is never allowed to grow past the
    // boundary indefinitely.
    connection.execute_batch("CHECKPOINT").map_err(|error| {
        format!("local disk limit reached and DuckDB CHECKPOINT failed: {error}")
    })?;
    match disk_violation(
        database_path,
        database_limit,
        aggregate_root,
        aggregate_limit,
        min_free_space,
    )? {
        None => Ok(()),
        Some(message) => Err(format!(
            "{message}; DuckDB CHECKPOINT was attempted; free local space, reduce retained state, or raise the corresponding runner limit"
        )),
    }
}

fn disk_violation(
    database_path: Option<&std::path::Path>,
    database_limit: Option<u64>,
    aggregate_root: Option<&std::path::Path>,
    aggregate_limit: Option<u64>,
    min_free_space: Option<u64>,
) -> Result<Option<String>, String> {
    if let (Some(database), Some(root), Some(maximum), Some(reserve)) = (
        database_path,
        aggregate_root,
        aggregate_limit,
        min_free_space,
    ) {
        let checkpoint_bytes = database_footprint(database)?;
        let workspace = database
            .parent()
            .ok_or_else(|| "DuckDB database path has no workspace parent".to_owned())?;
        let reservation = workspace.join(".disk-reservation");
        if let Err(error) = crate::local_disk::refresh_checkpoint_reservation(
            root,
            &reservation,
            checkpoint_bytes,
            maximum,
            reserve,
        ) {
            if error.current_context() == &crate::local_disk::LocalDiskError::Capacity {
                return Ok(Some(format!("{error:?}")));
            }
            return Err(format!("refresh checkpoint disk reservation: {error:?}"));
        }
    }
    if let (Some(path), Some(limit)) = (database_path, database_limit) {
        let used = database_footprint(path)?;
        if used > limit {
            return Ok(Some(format!(
                "DuckDB local footprint exceeded DUCKDB_MAX_DATABASE_SIZE: {used} bytes used, {limit} bytes allowed"
            )));
        }
    }
    if let (Some(root), Some(limit)) = (aggregate_root, aggregate_limit) {
        let used = tree_size(root)?;
        if used > limit {
            return Ok(Some(format!(
                "active workspace footprint exceeded RUNNER_MAX_WORKSPACE_BYTES: {used} bytes used, {limit} bytes allowed"
            )));
        }
    }
    if let (Some(root), Some(reserve)) = (aggregate_root, min_free_space) {
        let available = fs4::available_space(root)
            .map_err(|error| format!("inspect workspace filesystem free space: {error}"))?;
        if available < reserve {
            return Ok(Some(format!(
                "workspace filesystem fell below RUNNER_MIN_FREE_BYTES: {available} bytes available, {reserve} bytes reserved"
            )));
        }
    }
    Ok(None)
}

fn database_footprint(path: &std::path::Path) -> Result<u64, String> {
    let mut total = file_size(path)?;
    total = total.saturating_add(file_size(&path.with_extension(format!(
        "{}wal",
        path.extension()
            .and_then(|value| value.to_str())
            .map_or_else(String::new, |value| format!("{value}."))
    )))?);
    let temp = std::path::PathBuf::from(format!("{}.tmp", path.display()));
    total = total.saturating_add(tree_size(&temp)?);
    Ok(total)
}

fn file_size(path: &std::path::Path) -> Result<u64, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.file_type().is_dir() => Ok(metadata.len()),
        Ok(_) => Ok(0),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(format!("inspect local DuckDB footprint: {error}")),
    }
}

fn tree_size(path: &std::path::Path) -> Result<u64, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(format!("inspect DuckDB temp directory: {error}")),
    };
    if !metadata.file_type().is_dir() {
        return Ok(metadata.len());
    }
    if !metadata.file_type().is_dir() {
        return Ok(0);
    }
    let mut total = 0_u64;
    for entry in
        std::fs::read_dir(path).map_err(|error| format!("read DuckDB temp directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("read DuckDB temp entry: {error}"))?;
        total = total.saturating_add(tree_size(&entry.path())?);
    }
    Ok(total)
}

fn snapshot_database(
    connection: &duckdb::Connection,
    source: Option<&std::path::Path>,
    target: &std::path::Path,
) -> Result<(), String> {
    let source = source.ok_or_else(|| "cannot snapshot an in-memory DuckDB store".to_owned())?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create snapshot directory: {error}"))?;
    }
    match std::fs::remove_file(target) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("remove previous snapshot: {error}")),
    }

    // No command can race this block: it runs on the sole connection thread.
    // CHECKPOINT folds the WAL into the database before the byte copy. This
    // also works with the hardened store, where ATTACH is
    // unavailable after external access and configuration are locked.
    connection
        .execute_batch("CHECKPOINT")
        .map_err(|error| format!("checkpoint DuckDB before snapshot: {error}"))?;
    std::fs::copy(source, target).map_err(|error| format!("copy DuckDB snapshot: {error}"))?;

    let file = std::fs::File::open(target)
        .map_err(|error| format!("open completed DuckDB snapshot: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("fsync DuckDB snapshot: {error}"))
}

fn open_hardened(options: &StoreOptions) -> Result<duckdb::Connection, String> {
    let connection = match &options.path {
        Some(path) => duckdb::Connection::open(path),
        None => duckdb::Connection::open_in_memory(),
    }
    .map_err(|err| format!("duckdb open failed: {err}"))?;

    let mut settings = vec![
        "SET allow_community_extensions = false".to_owned(),
        "SET autoinstall_known_extensions = false".to_owned(),
        "SET autoload_known_extensions = false".to_owned(),
    ];
    if let Some(limit) = &options.memory_limit {
        settings.push(format!("SET memory_limit = {}", lit(limit)));
    }
    if let Some(size) = &options.max_temp_directory_size {
        settings.push(format!("SET max_temp_directory_size = {}", lit(size)));
    }
    if let Some(threads) = options.threads {
        settings.push(format!("SET threads = {threads}"));
    }
    for statement in &settings {
        connection
            .execute_batch(statement)
            .map_err(|err| format!("{statement}: {err}"))?;
    }

    // json and parquet are compiled into the bundled build; further
    // allowlisted extensions load here, before the sandbox blocks INSTALL.
    for extension in &options.extensions {
        if !["core_functions", "json", "parquet"].contains(&extension.as_str()) {
            connection
                .execute_batch(&format!("INSTALL {extension}; LOAD {extension};"))
                .map_err(|err| format!("extension {extension}: {err}"))?;
        }
    }

    // Sandbox last, then lock so pipeline SQL cannot reopen anything.
    if let Some(directories) = &options.allowed_directories {
        let list = directories
            .iter()
            .map(|dir| lit(&dir.display().to_string()))
            .collect::<Vec<_>>()
            .join(", ");
        connection
            .execute_batch(&format!("SET allowed_directories = [{list}]"))
            .map_err(|err| format!("allowed_directories: {err}"))?;
        connection
            .execute_batch("SET enable_external_access = false")
            .map_err(|err| format!("enable_external_access: {err}"))?;
    }
    connection
        .execute_batch("SET lock_configuration = true")
        .map_err(|err| format!("lock_configuration: {err}"))?;

    Ok(connection)
}

fn run_query(
    connection: &duckdb::Connection,
    sql: &str,
    params: &[Value],
) -> Result<QueryResult, String> {
    let mut statement = connection.prepare(sql).map_err(|err| err.to_string())?;

    let duck_params: Vec<duckdb::types::Value> = params.iter().map(to_duckdb).collect();
    let mut rows = statement
        .query(duckdb::params_from_iter(duck_params))
        .map_err(|err| err.to_string())?;

    let mut out = QueryResult::default();
    let mut first = true;

    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let statement = row.as_ref();
        if first {
            out.columns = statement.column_names().into_iter().collect();
            first = false;
        }
        let mut cells = Vec::with_capacity(out.columns.len());
        for index in 0..statement.column_count() {
            let value: duckdb::types::Value = row
                .get(index)
                .map_err(|err| format!("column {index}: {err}"))?;
            cells.push(from_duckdb(value));
        }
        out.rows.push(cells);
    }

    if first {
        if let Some(statement) = rows.as_ref() {
            out.columns = statement.column_names().into_iter().collect();
        }
    }

    Ok(out)
}

fn to_duckdb(value: &Value) -> duckdb::types::Value {
    use duckdb::types::Value as Duck;
    match value {
        Value::Null => Duck::Null,
        Value::Bool(flag) => Duck::Boolean(*flag),
        Value::Number(number) => {
            if let Some(int) = number.as_i64() {
                Duck::BigInt(int)
            } else {
                Duck::Double(number.as_f64().unwrap_or(f64::NAN))
            }
        }
        Value::String(text) => Duck::Text(text.clone()),
        // Objects and arrays stage as JSON text, matching the Elixir/TS
        // fn-step param encoding.
        other => Duck::Text(other.to_string()),
    }
}

fn from_duckdb(value: duckdb::types::Value) -> Value {
    use duckdb::types::Value as Duck;
    match value {
        Duck::Null => Value::Null,
        Duck::Boolean(flag) => Value::Bool(flag),
        Duck::TinyInt(n) => Value::from(n),
        Duck::SmallInt(n) => Value::from(n),
        Duck::Int(n) => Value::from(n),
        Duck::BigInt(n) => Value::from(n),
        Duck::HugeInt(n) => i64::try_from(n)
            .map(Value::from)
            .unwrap_or_else(|_| Value::from(n as f64)),
        Duck::UTinyInt(n) => Value::from(n),
        Duck::USmallInt(n) => Value::from(n),
        Duck::UInt(n) => Value::from(n),
        Duck::UBigInt(n) => i64::try_from(n)
            .map(Value::from)
            .unwrap_or_else(|_| Value::from(n as f64)),
        Duck::Float(f) => Value::from(f64::from(f)),
        Duck::Double(f) => Value::from(f),
        Duck::Decimal(d) => {
            use std::str::FromStr as _;
            let text = d.to_string();
            serde_json::Number::from_str(&text)
                .map(Value::Number)
                .unwrap_or(Value::String(text))
        }
        Duck::Text(text) => Value::String(text),
        Duck::Blob(bytes) => Value::String(hex::encode(bytes)),
        Duck::Date32(days) => {
            let date = chrono::NaiveDate::from_num_days_from_ce_opt(days + 719_163);
            date.map(|d| Value::String(d.format("%Y-%m-%d").to_string()))
                .unwrap_or(Value::Null)
        }
        Duck::Time64(unit, amount) => {
            let micros = to_micros(unit, amount);
            let time = chrono::NaiveTime::from_num_seconds_from_midnight_opt(
                (micros / 1_000_000) as u32,
                ((micros % 1_000_000) * 1000) as u32,
            );
            time.map(|t| Value::String(t.format("%H:%M:%S%.f").to_string()))
                .unwrap_or(Value::Null)
        }
        Duck::Timestamp(unit, amount) => {
            let micros = to_micros(unit, amount);
            chrono::DateTime::from_timestamp_micros(micros)
                .map(|ts| Value::String(ts.naive_utc().format("%Y-%m-%d %H:%M:%S%.f").to_string()))
                .unwrap_or(Value::Null)
        }
        Duck::Interval { .. } => Value::String(format!("{value:?}")),
        Duck::List(items) => Value::Array(items.into_iter().map(from_duckdb).collect()),
        Duck::Struct(fields) => Value::Object(
            fields
                .iter()
                .map(|(name, item)| (name.clone(), from_duckdb(item.clone())))
                .collect(),
        ),
        other => Value::String(format!("{other:?}")),
    }
}

fn to_micros(unit: duckdb::types::TimeUnit, amount: i64) -> i64 {
    use duckdb::types::TimeUnit;
    match unit {
        TimeUnit::Second => amount * 1_000_000,
        TimeUnit::Millisecond => amount * 1_000,
        TimeUnit::Microsecond => amount,
        TimeUnit::Nanosecond => amount / 1_000,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn snapshot_is_independently_openable_and_contains_committed_state() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("working.duckdb");
        let snapshot = directory.path().join("snapshot.duckdb");
        let store = Store::open(StoreOptions {
            path: Some(source),
            ..StoreOptions::default()
        })
        .unwrap();
        store
            .exec("CREATE TABLE durable_state AS SELECT 42 AS value")
            .await
            .unwrap();

        store.snapshot(snapshot.clone()).await.unwrap();
        let copy = duckdb::Connection::open(snapshot).unwrap();
        let value: i64 = copy
            .query_row("SELECT value FROM durable_state", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, 42);
    }

    #[tokio::test]
    async fn existing_database_over_the_configured_limit_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("bounded.duckdb");
        let store = Store::open(StoreOptions {
            path: Some(database.clone()),
            ..StoreOptions::default()
        })
        .unwrap();
        store
            .exec("CREATE TABLE data AS SELECT 1 AS id")
            .await
            .unwrap();
        store.close().await.unwrap();
        assert!(std::fs::metadata(&database).unwrap().len() > 1);

        let Err(error) = Store::open(StoreOptions {
            path: Some(database),
            max_database_size: Some("1B".to_owned()),
            ..StoreOptions::default()
        }) else {
            panic!("oversized existing database must not open")
        };
        let diagnostic = format!("{error:?}");
        assert!(diagnostic.contains("DUCKDB_MAX_DATABASE_SIZE"));
        assert!(diagnostic.contains("CHECKPOINT was attempted"));
    }

    #[tokio::test]
    async fn aggregate_workspace_bound_is_enforced_after_checkpoint_attempt() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("bounded.duckdb");
        std::fs::write(directory.path().join("other-workspace"), [0_u8; 32]).unwrap();
        let Err(error) = Store::open(StoreOptions {
            path: Some(database),
            aggregate_workspace_root: Some(directory.path().to_owned()),
            max_aggregate_workspace_size: Some("16B".to_owned()),
            min_free_space: Some("0B".to_owned()),
            ..StoreOptions::default()
        }) else {
            panic!("aggregate workspace limit must reject startup")
        };
        let diagnostic = format!("{error:?}");
        assert!(diagnostic.contains("RUNNER_MAX_WORKSPACE_BYTES"));
        assert!(diagnostic.contains("CHECKPOINT was attempted"));
    }

    #[test]
    fn footprint_counts_database_wal_and_nested_temp_files() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("state.duckdb");
        std::fs::write(&database, [0_u8; 10]).unwrap();
        std::fs::write(database.with_extension("duckdb.wal"), [0_u8; 4]).unwrap();
        let temp = std::path::PathBuf::from(format!("{}.tmp", database.display()));
        std::fs::create_dir_all(temp.join("nested")).unwrap();
        std::fs::write(temp.join("nested/spill"), [0_u8; 3]).unwrap();
        assert_eq!(database_footprint(&database).unwrap(), 17);
    }
}
