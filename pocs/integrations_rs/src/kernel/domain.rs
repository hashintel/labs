//! The kernel↔domain contract for the durable command loop.
//!
//! The command loop owns the append-capable writer, retry/ambiguity
//! discipline, terminal-error handling, and sequencing. Everything it must
//! know about the records it appends and the state it folds comes through
//! this trait. Protocol V1's `IntegrationsDomain` (in
//! `orchestrator::shard_log::command_loop`, next to its consumer) is the
//! first implementation; a second domain brings its own vocabulary and
//! reuses the loop unchanged.
//!
//! Stage 1 of the step-5 plan (`local/docs/kernel-split-step5-plan.md`): the
//! loop calls through this trait at a concrete type. Stage 2 parameterizes
//! the loop structs over `D: Domain`.

use crate::orchestrator::ids::EventId;
use crate::orchestrator::registry::UntrimmedJournalRecord;
use crate::orchestrator::routing::Shard;
use crate::orchestrator::shard_log::ShardCommandError;

/// Kernel-owned outcome of `Domain::prepare`: either the event is already
/// reflected in the projection (an idempotent duplicate) or it carries a
/// mutation to finalize after the append is durable.
pub(crate) enum Prepared<T> {
    Noop,
    Mutation(T),
}

pub(crate) trait Domain: Send + Sync + 'static {
    /// Journal wire codec (the whole versioned-enum record family).
    type Record: UntrimmedJournalRecord + Send + Sync;
    /// Verified current-version record: what producers propose, the loop
    /// appends, and the fold consumes.
    type RecordCurrent: Clone + Send;
    /// Pure fold state. `Default` is the empty pre-history projection.
    type Projection: Default + Send;
    /// Prepared mutation between `prepare` and `finalize`.
    type Delta: Send;
    /// Fold rejection; its `Display` output becomes the candidate-rejection
    /// message, so implementations must keep it self-contained.
    type FoldError: std::fmt::Display + Send;
    /// Key of the domain's state-change signal (V1: the integration ID whose
    /// checkpoint state advanced).
    type StateKey: Clone + Send;
    type Query: Send;
    type QueryResult: Send;
    type ControlRequest: Send;
    /// Pre-append view of a control request against the projection.
    type ControlSnapshot: Send;
    type ControlOutcome: Clone + Send;
    /// Reason a caller-side preflight already rejected a control request.
    type ControlRejection: Send;
    /// Committed projection snapshot record (bounds replay).
    type Snapshot: Send;
    /// In-memory capture handed to the out-of-loop snapshot publisher.
    type SnapshotCapture: Send;

    // Records and fold.

    fn record_shard(record: &Self::RecordCurrent) -> Shard;
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
}
