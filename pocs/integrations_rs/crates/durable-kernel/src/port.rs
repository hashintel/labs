//! The kernel↔domain contract for the durable command loop.
//!
//! The command loop owns the append-capable writer, retry/ambiguity
//! discipline, terminal-error handling, and sequencing. Everything it must
//! know about the records it appends and the state it folds comes through
//! this trait. A domain brings its own vocabulary and reuses
//! `CommandLoop<D>`, `ShardCommandHandle<D>`, and the recovery path
//! unchanged.

use crate::ids::EventId;
use crate::registry::{DurableRecord, UntrimmedJournalRecord};
use crate::routing::Shard;
use crate::shard_log::ShardCommandError;

/// Kernel-owned outcome of `Domain::prepare`: either the event is already
/// reflected in the projection (an idempotent duplicate) or it carries a
/// mutation to finalize after the append is durable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Prepared<T> {
    Noop,
    Mutation(T),
}

/// Recovery telemetry handed to `Domain::note_snapshot_recovery` after a
/// shard's startup or ambiguity replay completes with snapshots enabled.
#[derive(Debug, Clone)]
pub struct SnapshotRecoveryStats {
    pub replayed_events: u64,
    pub replay_elapsed: std::time::Duration,
    pub corruption_fallbacks: u64,
    pub latest_snapshot_created_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub trait Domain: Send + Sync + 'static {
    /// Journal wire codec: the full versioned enum covering every supported
    /// version.
    type Record: UntrimmedJournalRecord + Send + Sync;
    /// Verified current-version record: what producers propose, the loop
    /// appends, and the fold consumes.
    type RecordCurrent: Clone + Send;
    /// Pure fold state. `Default` is the empty pre-history projection.
    type Projection: Default + Send + Sync;
    /// Prepared mutation between `prepare` and `finalize`.
    type Delta: Send;
    /// Fold rejection; its `Display` output becomes the candidate-rejection
    /// message, so implementations must keep it self-contained.
    type FoldError: std::fmt::Display + Send;
    /// Key of the domain's state-change signal: the aggregate whose
    /// checkpoint state advanced.
    type StateKey: Clone + Send + std::fmt::Debug;
    type Query: Send;
    type QueryResult: Send;
    type ControlRequest: Send;
    /// Pre-append view of a control request against the projection.
    type ControlSnapshot: Send;
    type ControlOutcome: Clone + Send + std::fmt::Debug + PartialEq + Eq;
    /// Reason a caller-side preflight already rejected a control request.
    type ControlRejection: Send;
    /// Committed projection snapshot record (bounds replay). Appended to the
    /// shard log through the same registered-record discipline as events.
    type Snapshot: DurableRecord + Send + Sync;
    /// In-memory capture handed to the out-of-loop snapshot publisher.
    type SnapshotCapture: Send;
    /// Domain-owned context for materializing snapshot payloads during
    /// recovery — for example, an artifact store when snapshot payloads
    /// are indirected. A domain whose snapshots are self-contained uses `()`.
    type SnapshotContext: Clone + Send + Sync + 'static;
    /// Recovered live-work descriptor reported to the scheduler at startup.
    type WorkIntent: Clone + Send + std::fmt::Debug + PartialEq + Eq;

    // Records and fold.

    fn record_shard(record: &Self::RecordCurrent) -> Shard;
    /// The fold error rejecting a record proposed to the wrong shard.
    fn reject_foreign_shard(record: &Self::RecordCurrent) -> Self::FoldError;
    fn record_event_id(record: &Self::RecordCurrent) -> EventId;
    fn record_state_key(record: &Self::RecordCurrent) -> Self::StateKey;
    fn wire(record: Self::RecordCurrent) -> Self::Record;
    fn prepare(
        projection: &Self::Projection,
        record: &Self::RecordCurrent,
    ) -> Result<Prepared<Self::Delta>, Self::FoldError>;
    /// Applies a prepared mutation at its durable sequence. Only called for
    /// `Prepared::Mutation`; duplicates return before the append.
    fn finalize(
        projection: &mut Self::Projection,
        delta: Self::Delta,
        shard_sequence: u64,
    ) -> Result<(), Self::FoldError>;

    // State-change signal.

    fn state_sequence(projection: &Self::Projection, key: &Self::StateKey) -> Option<u64>;

    // Queries.

    fn answer(projection: &Self::Projection, query: Self::Query) -> Self::QueryResult;

    // Control requests.

    fn control_shard(request: &Self::ControlRequest) -> Shard;
    /// Rejection message for a control request proposed to the wrong shard.
    fn describe_foreign_control(request: &Self::ControlRequest) -> String;
    fn inspect_control(
        projection: &Self::Projection,
        request: &Self::ControlRequest,
    ) -> Result<Self::ControlSnapshot, ShardCommandError>;
    fn control_prior_outcome(snapshot: &Self::ControlSnapshot) -> Option<Self::ControlOutcome>;
    /// Deterministic event identity a duplicate control resolution reports.
    fn control_event_id(request: &Self::ControlRequest) -> EventId;
    /// Promotes a not-yet-resolved control request into the journal record
    /// that durably resolves it (acceptance or rejection).
    fn promote_control(
        projection: &Self::Projection,
        request: &Self::ControlRequest,
        preflight_rejection: Option<Self::ControlRejection>,
    ) -> Result<Self::RecordCurrent, Self::FoldError>;
    /// Reads back the outcome the fold recorded for `request` and verifies it
    /// binds this exact request. `Err` is a recovery-grade inconsistency.
    fn control_outcome_after_append(
        projection: &Self::Projection,
        request: &Self::ControlRequest,
    ) -> Result<Self::ControlOutcome, String>;

    // Snapshots.

    fn capture_snapshot(
        shard: Shard,
        projection: &Self::Projection,
    ) -> Option<Self::SnapshotCapture>;
    /// Validates a committed snapshot's addressing and returns
    /// `(shard, through_log_sequence)`; `Err` rejects the candidate.
    fn snapshot_bounds(snapshot: &Self::Snapshot) -> Result<(Shard, u64), String>;
    /// Audit timestamp recorded in the snapshot, for recovery telemetry.
    fn snapshot_created_at(snapshot: &Self::Snapshot) -> String;
    /// Materializes the projection a snapshot references. `Err` falls back
    /// to an older snapshot or full replay; it never fails recovery.
    fn load_snapshot_projection(
        context: &Self::SnapshotContext,
        shard: Shard,
        snapshot: &Self::Snapshot,
    ) -> impl std::future::Future<Output = Result<Self::Projection, String>> + Send;

    // Telemetry. Both hooks default to no-ops; a domain wires them to its
    // own observability.

    /// Observes one completed snapshot-enabled recovery.
    fn note_snapshot_recovery(_context: &Self::SnapshotContext, _stats: &SnapshotRecoveryStats) {}
    /// Observes the loop stopping because its writer was fenced.
    fn note_fenced(_context: &Self::SnapshotContext) {}

    // Recovery.

    /// The projection's inclusive durable high-water mark.
    fn through_sequence(projection: &Self::Projection) -> Option<u64>;
    /// Validates and folds one scanned record during startup or ambiguity
    /// recovery. `Err` is recovery-fatal for the shard.
    fn replay(
        projection: &mut Self::Projection,
        shard: Shard,
        sequence: u64,
        record: Self::Record,
    ) -> Result<(), String>;
    /// Proves a freshly recovered prefix extends what this process already
    /// acknowledged: no sequence regression, no lost or changed event.
    fn validate_recovered_prefix(
        previous: &Self::Projection,
        recovered: &Self::Projection,
    ) -> Result<(), String>;
    /// Live (planned or blocked) work the scheduler must resume.
    fn live_work(projection: &Self::Projection) -> Vec<Self::WorkIntent>;
    /// Keys whose state-change signal should fire once at startup.
    fn initial_state_keys(projection: &Self::Projection) -> Vec<Self::StateKey>;
}
