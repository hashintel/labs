//! One canonical OpenData log per stable routing shard.
//!
//! The append handle stays private to this module. Until baseline activation,
//! constructors are reachable only through the test-prefix capability below.
use std::fmt;
use std::ops::Bound;
use std::time::Duration;

use bytes::Bytes;
use error_stack::{Report, ResultExt as _};
use opendata_common::storage::config::{
    AwsObjectStoreConfig, BlockCacheConfig, FoyerMemoryCacheConfig, LocalObjectStoreConfig,
    ObjectStoreConfig, SlateDbStorageConfig,
};
use opendata_common::StorageConfig;
use opendata_log::{
    Config, LogDb, LogDbReader, LogRead, ReadVisibility, ReaderConfig, Record, Sequence,
};

use super::registry::{require_registered, DurableRecord, UntrimmedJournalRecord};
use super::DurableError;

mod command_loop;

#[cfg(test)]
pub(crate) use command_loop::start_recovered;
pub(crate) use command_loop::{
    ControlRequestSnapshot, OpenedShard, RecoveredShard, RunView, ShardCommandConfig,
    ShardCommandError,
    ShardCommandErrorKind, ShardCommandHandle, ShardCommandOutcome, StartedShard, StartupRecovery,
    StateChangeFeed, WorkRecoveryIntent,
};

const EVENTS_KEY: &[u8] = b"events";
const PROJECTION_SNAPSHOTS_KEY: &[u8] = b"projection-snapshots";
const APPEND_TIMEOUT: Duration = Duration::from_secs(30);
const DURABILITY_TIMEOUT: Duration = Duration::from_secs(60);
/// Watermark-wait attempts before an append is declared ambiguous. Ambiguity
/// is shard-fatal under a lease, so one stalled subscription gets bounded
/// retries first.
const DURABILITY_WAIT_ATTEMPTS: u32 = 3;
const PINNED_FENCE_MESSAGE: &str = "detected newer db client";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AppendDisposition {
    DefinitelyNotCommitted,
    CommitUnknown,
    Fenced,
}

#[derive(Debug)]
pub(crate) struct ShardAppendError {
    pub(crate) disposition: AppendDisposition,
    pub(crate) source: Report<DurableError>,
}

impl fmt::Display for ShardAppendError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "shard append failed with {:?}: {:?}",
            self.disposition, self.source
        )
    }
}

impl std::error::Error for ShardAppendError {}

#[derive(Debug, Clone)]
pub(crate) struct ShardLogLocation {
    shard: super::routing::Shard,
    storage: StorageConfig,
    read_timeout: Duration,
    durability_timeout: Duration,
}

impl ShardLogLocation {
    pub(crate) fn production(
        env: &crate::config::Env,
        shard: super::routing::Shard,
        tenant: &super::ids::TenantNamespace,
    ) -> Result<Self, Report<DurableError>> {
        Ok(Self {
            shard,
            read_timeout: Duration::from_millis(crate::config::control_read_timeout_ms(env))
                .max(DURABILITY_TIMEOUT),
            durability_timeout: Duration::from_millis(crate::config::durability_timeout_ms(env)),
            storage: storage_for_control_path(
                env,
                &super::routing::Keyspace::for_tenant(tenant).shard_log(shard),
            )?,
        })
    }

    #[cfg(test)]
    pub(crate) fn disposable_local(
        shard: super::routing::Shard,
        tenant: &super::ids::TenantNamespace,
        object_store_root: &std::path::Path,
    ) -> Self {
        use opendata_common::storage::config::{
            LocalObjectStoreConfig, ObjectStoreConfig, SlateDbStorageConfig,
        };

        Self {
            shard,
            read_timeout: DURABILITY_TIMEOUT,
            durability_timeout: DURABILITY_TIMEOUT,
            storage: StorageConfig::SlateDb(SlateDbStorageConfig {
                path: super::routing::Keyspace::for_tenant(tenant).shard_log(shard),
                object_store: ObjectStoreConfig::Local(LocalObjectStoreConfig {
                    path: object_store_root.display().to_string(),
                }),
                settings_path: None,
                block_cache: None,
                meta_cache: None,
            }),
        }
    }
}

fn storage_for_control_path(
    env: &crate::config::Env,
    control_path: &str,
) -> Result<StorageConfig, Report<DurableError>> {
    let url = crate::config::blob_store_url(env);
    let (object_store, prefix) = if let Some(path) = url.strip_prefix("file://") {
        std::fs::create_dir_all(path)
            .change_context(DurableError)
            .attach_printable(format!("create local OpenData root {path:?}"))?;
        (
            ObjectStoreConfig::Local(LocalObjectStoreConfig {
                path: path.to_owned(),
            }),
            String::new(),
        )
    } else if let Some(value) = url.strip_prefix("s3://") {
        let (bucket, prefix) = value.split_once('/').unwrap_or((value, ""));
        if bucket.is_empty() {
            return Err(
                Report::new(DurableError).attach_printable("blob URL has an empty S3 bucket")
            );
        }
        let region = env
            .get("AWS_REGION")
            .or_else(|| env.get("AWS_DEFAULT_REGION"))
            .unwrap_or("us-east-1")
            .to_owned();
        (
            ObjectStoreConfig::Aws(AwsObjectStoreConfig {
                region,
                bucket: bucket.to_owned(),
            }),
            prefix.trim_matches('/').to_owned(),
        )
    } else {
        return Err(Report::new(DurableError)
            .attach_printable(format!("unsupported shard-log blob URL {url:?}")));
    };
    let path = if prefix.is_empty() {
        control_path.to_owned()
    } else {
        format!("{prefix}/{control_path}")
    };
    let shard_capacity = crate::config::configured_shard_capacity(env).max(1);
    let block_cache_capacity = crate::config::slatedb_block_cache_bytes(env)
        .map_err(|message| Report::new(DurableError).attach_printable(message))?
        .checked_div(shard_capacity)
        .unwrap_or(0)
        .max(64 * 1024);
    let meta_cache_capacity = crate::config::slatedb_meta_cache_bytes(env)
        .map_err(|message| Report::new(DurableError).attach_printable(message))?
        .checked_div(shard_capacity)
        .unwrap_or(0)
        .max(64 * 1024);
    Ok(StorageConfig::SlateDb(SlateDbStorageConfig {
        path,
        object_store,
        settings_path: None,
        block_cache: Some(BlockCacheConfig::FoyerMemory(FoyerMemoryCacheConfig {
            capacity: block_cache_capacity,
            shards: None,
        })),
        meta_cache: Some(BlockCacheConfig::FoyerMemory(FoyerMemoryCacheConfig {
            capacity: meta_cache_capacity,
            shards: None,
        })),
    }))
}

/// Reconstructs a point-in-time projection through a read-only LogDb handle.
/// Operator queries must never open a writer, advance a SlateDB epoch, acquire a
/// lease, or mutate the shard they inspect.
pub(crate) async fn read_projection(
    location: &ShardLogLocation,
) -> Result<super::projection::Projection, Report<DurableError>> {
    let reader = tokio::time::timeout(
        location.read_timeout,
        LogDbReader::open(ReaderConfig {
            storage: location.storage.clone(),
            ..ReaderConfig::default()
        }),
    )
    .await
    .change_context(DurableError)
    .attach_printable("open read-only shard projection timed out")?
    .change_context(DurableError)
    .attach_printable("open read-only shard projection")?;
    let result = async {
        let records = scan_records(&reader, (Bound::Unbounded, Bound::Unbounded), None).await?;
        let mut projection = super::projection::Projection::default();
        for (sequence, record) in records {
            let input = super::events::SequencedJournalRecord::try_new(sequence, record)
                .change_context(DurableError)
                .attach_printable(format!(
                    "validate shard projection record at sequence {sequence}"
                ))?;
            if super::routing::shard(&input.record().integration_id) != location.shard {
                return Err(Report::new(DurableError).attach_printable(format!(
                    "record at sequence {sequence} routes outside shard {}",
                    super::routing::shard_path(location.shard)
                )));
            }
            super::projection::apply(&mut projection, input)
                .change_context(DurableError)
                .attach_printable(format!(
                    "fold shard projection record at sequence {sequence}"
                ))?;
        }
        Ok(projection)
    }
    .await;
    reader.close().await;
    result
}

impl ShardLogLocation {
    pub(crate) fn shard(&self) -> super::routing::Shard {
        self.shard
    }
}

/// The only type that owns a shard's append-capable `LogDb`.
struct ShardLogWriter {
    log: LogDb,
    durability_timeout: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AppendFault {
    None,
    #[cfg(test)]
    DefinitelyNotCommitted,
    #[cfg(test)]
    AfterInvocation,
    #[cfg(test)]
    AfterAppend,
    #[cfg(test)]
    AfterFlush,
    #[cfg(test)]
    WrongSequence,
}

impl ShardLogWriter {
    async fn open(location: &ShardLogLocation) -> Result<Self, Report<DurableError>> {
        let durability_timeout = location.durability_timeout;
        let log = tokio::time::timeout(
            durability_timeout,
            LogDb::open(Config {
                storage: location.storage.clone(),
                read_visibility: ReadVisibility::Remote,
                // Remote sequential scans are request-bound with SlateDB's
                // 4 KiB default. Control records are append-only and replayed
                // in order, so 64 KiB blocks substantially reduce S3 range
                // GETs without changing the durable encoding contract.
                sst_block_size: Some(slatedb::SstBlockSize::Block64Kib),
                ..Config::default()
            }),
        )
        .await
        .change_context(DurableError)
        .attach_printable(format!(
            "open shard log timed out after {durability_timeout:?}"
        ))?
        .change_context(DurableError)
        .attach_printable("open shard log")?;
        Ok(Self {
            log,
            durability_timeout,
        })
    }

    async fn append<T: UntrimmedJournalRecord + Sync>(
        &self,
        value: &T,
    ) -> Result<u64, ShardAppendError> {
        self.append_with_fault(value, AppendFault::None).await
    }

    async fn append_projection_snapshot<T: DurableRecord + Sync>(
        &self,
        value: &T,
    ) -> Result<u64, ShardAppendError> {
        self.append_registered(PROJECTION_SNAPSHOTS_KEY, value, AppendFault::None)
            .await
    }

    /// Remote durable watermark captured from the writer opened with
    /// `ReadVisibility::Remote`. Records below this exclusive end are the
    /// complete startup-recovery window.
    fn durable_end_exclusive(&self) -> u64 {
        self.log.durable_sequence()
    }

    async fn scan_suffix<T: UntrimmedJournalRecord>(
        &self,
        through_log_sequence: Option<u64>,
        durable_end_exclusive: u64,
    ) -> Result<Vec<(u64, T)>, Report<DurableError>> {
        let range = recovery_range(through_log_sequence, durable_end_exclusive)?;
        scan_records(&self.log, range.bounds, Some(range.window)).await
    }

    async fn scan_projection_snapshots<T: DurableRecord>(
        &self,
        durable_end_exclusive: u64,
    ) -> Result<Vec<(u64, Result<T, super::registry::CompatError>)>, Report<DurableError>> {
        scan_snapshot_records(
            &self.log,
            (Bound::Unbounded, Bound::Excluded(durable_end_exclusive)),
            durable_end_exclusive,
        )
        .await
    }

    async fn append_with_fault<T: UntrimmedJournalRecord + Sync>(
        &self,
        value: &T,
        fault: AppendFault,
    ) -> Result<u64, ShardAppendError> {
        self.append_registered(EVENTS_KEY, value, fault).await
    }

    async fn append_registered<T: DurableRecord + Sync>(
        &self,
        key: &'static [u8],
        value: &T,
        fault: AppendFault,
    ) -> Result<u64, ShardAppendError> {
        require_registered::<T>().map_err(|error| {
            definitely_not_committed("validate durable-record registration", error)
        })?;
        let bytes = value
            .encode()
            .map_err(|error| definitely_not_committed("encode durable shard record", error))?;
        let record = Record {
            key: Bytes::from_static(key),
            value: Bytes::from(bytes),
        };
        let _ = fault;

        #[cfg(test)]
        if fault == AppendFault::DefinitelyNotCommitted {
            return Err(definitely_not_committed_message(
                "append shard record",
                "injected pre-invocation failure",
            ));
        }

        // From this call onward, absence of an acknowledgement cannot prove
        // absence from durable history. Only the pinned SlateDB fence result
        // has a stronger classification.
        #[cfg(test)]
        if fault == AppendFault::AfterInvocation {
            return Err(post_invocation_message(
                "append shard record",
                "injected append-return failure",
            ));
        }
        let output = self
            .log
            .append_timeout(vec![record], APPEND_TIMEOUT)
            .await
            .map_err(|error| post_invocation_source("append shard record", error))?;
        #[cfg(test)]
        if fault == AppendFault::AfterAppend {
            return Err(post_invocation_message(
                "append shard record",
                "injected post-append failure",
            ));
        }
        self.log
            .flush()
            .await
            .map_err(|error| post_invocation_source("flush shard record", error))?;
        #[cfg(test)]
        if fault == AppendFault::AfterFlush {
            let report = Report::new(DurableError).attach_printable("injected post-flush failure");
            return Err(post_invocation_report(
                "wait for durable shard record",
                report,
            ));
        }
        wait_until_durable_with(
            &self.log,
            output.start_sequence + 1,
            self.durability_timeout,
            DURABILITY_WAIT_ATTEMPTS,
        )
        .await
        .map_err(|report| post_invocation_report("wait for durable shard record", report))?;
        #[cfg(test)]
        if fault == AppendFault::WrongSequence {
            return Ok(output.start_sequence.saturating_sub(1));
        }
        Ok(output.start_sequence)
    }

    async fn close(self) -> Result<(), Report<DurableError>> {
        let durability_timeout = self.durability_timeout;
        tokio::time::timeout(durability_timeout, self.log.close())
            .await
            .change_context(DurableError)
            .attach_printable(format!(
                "close shard log timed out after {durability_timeout:?}"
            ))?
            .change_context(DurableError)
            .attach_printable("close shard log")
    }
}

/// Read-only recovery handle. It cannot advance the writer epoch or append.
/// Tests use it to inspect durable history without competing for the writer
/// epoch; production recovery reads through its fenced writer.
#[cfg(test)]
pub(crate) struct ShardLogRecovery {
    reader: LogDbReader,
}

#[cfg(test)]
impl ShardLogRecovery {
    async fn open(location: &ShardLogLocation) -> Result<Self, Report<DurableError>> {
        let reader = tokio::time::timeout(
            DURABILITY_TIMEOUT,
            LogDbReader::open(ReaderConfig {
                storage: location.storage.clone(),
                ..ReaderConfig::default()
            }),
        )
        .await
        .change_context(DurableError)
        .attach_printable(format!(
            "open shard recovery reader timed out after {DURABILITY_TIMEOUT:?}"
        ))?
        .change_context(DurableError)
        .attach_printable("open shard recovery reader")?;
        Ok(Self { reader })
    }

    pub(crate) async fn scan<T: UntrimmedJournalRecord>(
        &self,
    ) -> Result<Vec<(u64, T)>, Report<DurableError>> {
        scan_records(&self.reader, (Bound::Unbounded, Bound::Unbounded), None).await
    }

    async fn scan_suffix<T: UntrimmedJournalRecord>(
        &self,
        through_log_sequence: Option<u64>,
        durable_end_exclusive: u64,
    ) -> Result<Vec<(u64, T)>, Report<DurableError>> {
        let range = recovery_range(through_log_sequence, durable_end_exclusive)?;
        scan_records(&self.reader, range.bounds, Some(range.window)).await
    }

    pub(crate) async fn close(self) {
        let _ = tokio::time::timeout(DURABILITY_TIMEOUT, self.reader.close()).await;
    }
}

struct RecoveryRange {
    bounds: (Bound<Sequence>, Bound<Sequence>),
    window: (u64, u64),
}

fn recovery_range(
    through_log_sequence: Option<u64>,
    durable_end_exclusive: u64,
) -> Result<RecoveryRange, Report<DurableError>> {
    let start = match through_log_sequence {
        Some(sequence) => sequence.checked_add(1).ok_or_else(|| {
            Report::new(DurableError)
                .attach_printable("inclusive recovery sequence cannot advance past u64::MAX")
        })?,
        None => 0,
    };
    if start > durable_end_exclusive {
        return Err(Report::new(DurableError).attach_printable(format!(
            "recovery start {start} is beyond durable end {durable_end_exclusive}"
        )));
    }
    Ok(RecoveryRange {
        bounds: (
            Bound::Included(start),
            Bound::Excluded(durable_end_exclusive),
        ),
        window: (start, durable_end_exclusive),
    })
}

/// Scans and decodes one shard's journal suffix. Generic over the journal
/// record family so a non-integrations domain can replay its own vocabulary
/// through the same recovery path; protocol V1 instantiates `JournalRecord`.
async fn scan_records<T, R>(
    reader: &R,
    range: (Bound<Sequence>, Bound<Sequence>),
    expected_window: Option<(u64, u64)>,
) -> Result<Vec<(u64, T)>, Report<DurableError>>
where
    T: UntrimmedJournalRecord,
    R: LogRead + Sync,
{
    require_registered::<T>()
        .change_context(DurableError)
        .attach_printable("validate shard recovery record family")?;
    let mut iterator = reader
        .scan(Bytes::from_static(EVENTS_KEY), range)
        .await
        .change_context(DurableError)
        .attach_printable("scan shard log")?;
    let mut records = Vec::new();
    while let Some(entry) = iterator
        .next()
        .await
        .change_context(DurableError)
        .attach_printable("read shard log")?
    {
        if let Some((start, end)) = expected_window {
            if entry.sequence < start || entry.sequence >= end {
                return Err(Report::new(DurableError).attach_printable(format!(
                    "scan returned sequence {} outside recovery window [{start}, {end})",
                    entry.sequence
                )));
            }
        }
        let record = T::decode(&entry.value)
            .change_context(DurableError)
            .attach_printable(format!(
                "decode shard sequence {} as {}",
                entry.sequence,
                T::FAMILY.name
            ))?;
        records.push((entry.sequence, record));
    }
    if let Some((_start, expected_end)) = expected_window {
        let observed_end = iterator.next_sequence();
        if observed_end != expected_end {
            return Err(Report::new(DurableError).attach_printable(format!(
                "remote recovery scan covered only through {observed_end}, expected exclusive end {expected_end}"
            )));
        }
    }
    Ok(records)
}

async fn scan_snapshot_records<T, R>(
    reader: &R,
    range: (Bound<Sequence>, Bound<Sequence>),
    expected_end: u64,
) -> Result<Vec<(u64, Result<T, super::registry::CompatError>)>, Report<DurableError>>
where
    T: DurableRecord,
    R: LogRead + Sync,
{
    require_registered::<T>()
        .change_context(DurableError)
        .attach_printable("validate projection-snapshot record family")?;
    let mut iterator = reader
        .scan(Bytes::from_static(PROJECTION_SNAPSHOTS_KEY), range)
        .await
        .change_context(DurableError)
        .attach_printable("scan projection-snapshot references")?;
    let mut records = Vec::new();
    while let Some(entry) = iterator
        .next()
        .await
        .change_context(DurableError)
        .attach_printable("read projection-snapshot reference")?
    {
        if entry.sequence >= expected_end {
            return Err(Report::new(DurableError).attach_printable(format!(
                "snapshot scan returned sequence {} at or beyond durable end {expected_end}",
                entry.sequence
            )));
        }
        records.push((entry.sequence, T::decode(&entry.value)));
    }
    if iterator.next_sequence() != expected_end {
        return Err(Report::new(DurableError).attach_printable(format!(
            "snapshot scan covered only through {}, expected exclusive end {expected_end}",
            iterator.next_sequence()
        )));
    }
    Ok(records)
}

fn definitely_not_committed<E>(operation: &'static str, error: E) -> ShardAppendError
where
    E: std::error::Error + Send + Sync + 'static,
{
    ShardAppendError {
        disposition: AppendDisposition::DefinitelyNotCommitted,
        source: Report::new(error)
            .change_context(DurableError)
            .attach_printable(operation),
    }
}

#[cfg(test)]
fn definitely_not_committed_message(
    operation: &'static str,
    message: &'static str,
) -> ShardAppendError {
    ShardAppendError {
        disposition: AppendDisposition::DefinitelyNotCommitted,
        source: Report::new(DurableError)
            .attach_printable(operation)
            .attach_printable(message),
    }
}

fn post_invocation_source<E>(operation: &'static str, error: E) -> ShardAppendError
where
    E: std::error::Error + Send + Sync + 'static,
{
    let message = error.to_string();
    let disposition = post_invocation_disposition(&message);
    ShardAppendError {
        disposition,
        source: Report::new(error)
            .change_context(DurableError)
            .attach_printable(operation),
    }
}

#[cfg(test)]
fn post_invocation_message(operation: &'static str, message: &'static str) -> ShardAppendError {
    ShardAppendError {
        disposition: post_invocation_disposition(message),
        source: Report::new(DurableError)
            .attach_printable(operation)
            .attach_printable(message),
    }
}

fn post_invocation_report(
    operation: &'static str,
    report: Report<DurableError>,
) -> ShardAppendError {
    let message = format!("{report:?}");
    ShardAppendError {
        disposition: post_invocation_disposition(&message),
        source: report.attach_printable(operation),
    }
}

fn post_invocation_disposition(message: &str) -> AppendDisposition {
    if message.to_ascii_lowercase().contains(PINNED_FENCE_MESSAGE) {
        AppendDisposition::Fenced
    } else {
        AppendDisposition::CommitUnknown
    }
}

/// An ambiguous append is shard-fatal under a lease, and the append is
/// usually already durable when this wait stalls: the watermark subscription
/// lagged, not the write. Re-check and re-subscribe a bounded number of times
/// before converting a transient stall into ambiguity. The timeout and
/// attempt bound are parameters so the retry semantics are testable without
/// production-length waits; production always uses the pinned constants.
async fn wait_until_durable_with(
    log: &LogDb,
    required: Sequence,
    attempt_timeout: Duration,
    attempts: u32,
) -> Result<(), Report<DurableError>> {
    for attempt in 1..=attempts {
        if log.durable_sequence() >= required {
            return Ok(());
        }
        let mut changes = log.subscribe_durable();
        let wait = tokio::time::timeout(attempt_timeout, async {
            while *changes.borrow_and_update() < required {
                changes
                    .changed()
                    .await
                    .change_context(DurableError)
                    .attach_printable("shard durable sequence subscription closed")?;
            }
            Ok::<(), Report<DurableError>>(())
        })
        .await;
        match wait {
            Ok(result) => return result,
            Err(_elapsed) => {
                tracing::warn!(
                    attempt,
                    of = attempts,
                    required,
                    "durable watermark wait timed out; re-checking before declaring ambiguity"
                );
            }
        }
    }
    Err(Report::new(DurableError).attach_printable(format!(
        "shard durable sequence did not reach {required} within {attempts} waits of \
         {attempt_timeout:?}"
    )))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use std::path::Path;

    use opendata_common::storage::config::{
        LocalObjectStoreConfig, ObjectStoreConfig, SlateDbStorageConfig,
    };
    use tempfile::TempDir;

    use super::*;
    use crate::orchestrator::events::{
        AttemptStartedV1, JournalEvent, JournalEventV1, JournalRecord, JournalRecordV1,
    };
    use crate::orchestrator::ids::{
        derive_attempt_id, CanonicalIntegrationId, EventId, RunId, TenantNamespace,
    };
    use crate::orchestrator::routing::{Keyspace, Shard};

    struct TestPrefixCapability {
        _root: TempDir,
        object_store_root: String,
        tenant: TenantNamespace,
    }

    impl TestPrefixCapability {
        fn new(tenant: &str) -> Self {
            let root = tempfile::tempdir().expect("create test object-store root");
            Self {
                object_store_root: root.path().display().to_string(),
                _root: root,
                tenant: TenantNamespace::parse(tenant).expect("valid test tenant"),
            }
        }

        fn location(&self, shard: Shard) -> ShardLogLocation {
            let path = Keyspace::for_tenant(&self.tenant).shard_log(shard);
            ShardLogLocation {
                shard,
                read_timeout: DURABILITY_TIMEOUT,
                durability_timeout: DURABILITY_TIMEOUT,
                storage: StorageConfig::SlateDb(SlateDbStorageConfig {
                    path,
                    object_store: ObjectStoreConfig::Local(LocalObjectStoreConfig {
                        path: self.object_store_root.clone(),
                    }),
                    settings_path: None,
                    block_cache: None,
                    meta_cache: None,
                }),
            }
        }

        fn root(&self) -> &Path {
            self._root.path()
        }
    }

    fn record(integration: &str) -> JournalRecord {
        let integration =
            CanonicalIntegrationId::parse(integration).expect("valid test integration");
        let run_id =
            RunId::parse("00000000-0000-4000-8000-000000000001").expect("valid test run ID");
        JournalRecord::V1(
            JournalRecordV1::new(
                integration,
                JournalEvent::V1(JournalEventV1::AttemptStarted(AttemptStartedV1 {
                    attempt_id: derive_attempt_id(&run_id, 1),
                    run_id,
                    attempt: 1,
                })),
            )
            .expect("valid test journal record"),
        )
    }

    #[tokio::test]
    async fn shards_append_independently_and_each_append_is_one_physical_record() {
        let capability = TestPrefixCapability::new("alice");
        let shard_zero = Shard::try_from(0).unwrap();
        let shard_one = Shard::try_from(1).unwrap();
        let zero_location = capability.location(shard_zero);
        let one_location = capability.location(shard_one);
        let zero = ShardLogWriter::open(&zero_location).await.unwrap();
        let one = ShardLogWriter::open(&one_location).await.unwrap();

        let zero_sequence = zero.append(&record("zero:integration")).await.unwrap();
        let one_sequence = one.append(&record("one:integration")).await.unwrap();
        zero.close().await.unwrap();
        one.close().await.unwrap();

        let zero_reader = ShardLogRecovery::open(&zero_location).await.unwrap();
        let one_reader = ShardLogRecovery::open(&one_location).await.unwrap();
        let zero_records = zero_reader.scan::<JournalRecord>().await.unwrap();
        let one_records = one_reader.scan::<JournalRecord>().await.unwrap();
        assert_eq!(
            zero_records,
            vec![(zero_sequence, record("zero:integration"))]
        );
        assert_eq!(one_records, vec![(one_sequence, record("one:integration"))]);
        zero_reader.close().await;
        one_reader.close().await;

        assert!(capability
            .root()
            .join(Keyspace::for_tenant(&capability.tenant).shard_log(shard_zero))
            .exists());
        assert!(capability
            .root()
            .join(Keyspace::for_tenant(&capability.tenant).shard_log(shard_one))
            .exists());
    }

    #[tokio::test]
    async fn pre_invocation_encoding_failure_is_definitely_not_committed() {
        let capability = TestPrefixCapability::new("alice");
        let location = capability.location(Shard::try_from(9).unwrap());
        let writer = ShardLogWriter::open(&location).await.unwrap();
        let mut invalid = record("alice:integration");
        let JournalRecord::V1(invalid_record) = &mut invalid;
        invalid_record.event_id = EventId::parse("0".repeat(64)).unwrap();
        let error = writer.append(&invalid).await.unwrap_err();
        assert_eq!(error.disposition, AppendDisposition::DefinitelyNotCommitted);
        writer.close().await.unwrap();
    }

    #[tokio::test]
    async fn every_injected_post_invocation_failure_is_commit_unknown() {
        let capability = TestPrefixCapability::new("alice");
        for (shard, fault) in [
            (20, AppendFault::AfterInvocation),
            (21, AppendFault::AfterAppend),
            (22, AppendFault::AfterFlush),
        ] {
            let location = capability.location(Shard::try_from(shard).unwrap());
            let writer = ShardLogWriter::open(&location).await.unwrap();
            let error = writer
                .append_with_fault(&record("fault:integration"), fault)
                .await
                .unwrap_err();
            assert_eq!(error.disposition, AppendDisposition::CommitUnknown);
            let _ = writer.close().await;
        }
    }

    #[tokio::test]
    async fn durability_wait_retries_a_stalled_attempt_instead_of_declaring_ambiguity() {
        let capability = TestPrefixCapability::new("alice");
        let location = capability.location(Shard::try_from(41).unwrap());
        let writer = ShardLogWriter::open(&location).await.unwrap();
        let first = writer.append(&record("alice:stall-probe")).await.unwrap();

        // The next append's durable end. Several 20ms attempts stall before
        // the delayed append lands; the wait must keep retrying and succeed
        // rather than convert the stall into ambiguity.
        let required = first + 2;
        let (waited, appended) = tokio::join!(
            wait_until_durable_with(&writer.log, required, Duration::from_millis(20), 50,),
            async {
                tokio::time::sleep(Duration::from_millis(150)).await;
                writer.append(&record("alice:stall-probe-second")).await
            }
        );
        appended.unwrap();
        waited.expect("a stalled attempt retries until the watermark advances");

        // Exhaustion still fails closed, after exactly the bounded attempts.
        let started = std::time::Instant::now();
        let error =
            wait_until_durable_with(&writer.log, required + 1_000, Duration::from_millis(10), 3)
                .await;
        assert!(error.is_err(), "an unreachable watermark must fail closed");
        assert!(
            started.elapsed() >= Duration::from_millis(30),
            "every bounded attempt runs before ambiguity is declared"
        );
        writer.close().await.unwrap();
    }

    #[test]
    fn only_the_pinned_slate_fence_message_is_classified_as_fenced() {
        assert_eq!(
            post_invocation_message(
                "flush",
                "storage error: Closed error: detected newer DB client"
            )
            .disposition,
            AppendDisposition::Fenced
        );
        assert_eq!(
            post_invocation_message("flush", "unrelated fencing proxy timeout").disposition,
            AppendDisposition::CommitUnknown
        );
    }

    #[tokio::test]
    async fn newer_writer_fences_old_writer_with_typed_disposition() {
        let capability = TestPrefixCapability::new("alice");
        let location = capability.location(Shard::try_from(39).unwrap());
        let first = ShardLogWriter::open(&location).await.unwrap();
        first.append(&record("first:integration")).await.unwrap();
        let second = ShardLogWriter::open(&location).await.unwrap();
        second.append(&record("second:integration")).await.unwrap();

        let error = first
            .append(&record("stale:integration"))
            .await
            .unwrap_err();
        assert_eq!(error.disposition, AppendDisposition::Fenced);

        let _ = first.close().await;
        second.close().await.unwrap();
        let reader = ShardLogRecovery::open(&location).await.unwrap();
        let records = reader.scan::<JournalRecord>().await.unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].1, record("first:integration"));
        assert_eq!(records[1].1, record("second:integration"));
        reader.close().await;
    }
}
