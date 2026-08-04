//! Bounded, replay-safe delivery of immutable Graph effects.
//!
//! The executor is deliberately split into artifact verification and one
//! bounded delivery turn. It may overlap effects within one dependency class,
//! advances only a contiguous acknowledged prefix, and holds the integration
//! lane until that cursor is authoritative in the shard journal.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use error_stack::{Report, ResultExt as _};
use futures::StreamExt as _;
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use tokio::sync::{Mutex, OwnedMutexGuard};
use tokio::time::Instant;

use super::artifacts::{
    DesiredDispositionV1, DesiredObjectKeyV1, EffectRepository, GraphObjectKindV1,
    ResolvedDesiredObjectV1, DESIRED_PROJECTION_SCHEMA_VERSION,
};
use super::effects::{
    GraphEffectV1, GraphOperationV1, EFFECT_ENCODING_VERSION, EFFECT_IDENTITY_VERSION,
};
use super::planner::{GraphDeliveryPayload, GraphDeliveryRequestV1};
use crate::blob::{ArtifactStore, BlobRef};
use crate::orchestrator::events::{
    JournalEvent, JournalEventV1, JournalRecordV1, WorkChunkCompletedV1,
};
use crate::orchestrator::ids::{CanonicalIntegrationId, EffectId, WorkId};
use crate::orchestrator::registry::DurableRecord;
use crate::orchestrator::shard_log::{ShardCommandHandle, WorkRecoveryIntent};
use crate::orchestrator::work::{
    StateVersion, StateVersionRef, WorkKind, WorkManifest, WorkManifestV1, MAX_STATE_VERSION_BYTES,
    MAX_WORK_MANIFEST_BYTES,
};
use crate::throttle::{GraphRequestCharge, GraphRequestsUsed};

const MAX_DIAGNOSTIC_BYTES: usize = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EffectExecutorError {
    InvalidConfiguration,
    WorkNotRunnable,
    ArtifactIntegrity,
    CursorCommit,
}

impl fmt::Display for EffectExecutorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidConfiguration => "Graph effect executor configuration is invalid",
            Self::WorkNotRunnable => "Graph effect work is not runnable",
            Self::ArtifactIntegrity => "Graph effect execution artifact is invalid",
            Self::CursorCommit => "Graph effect cursor commit failed",
        })
    }
}

impl std::error::Error for EffectExecutorError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ChunkBudget {
    maximum_requests: u32,
}

impl ChunkBudget {
    pub(crate) fn new(maximum_requests: u32) -> Result<Self, Report<EffectExecutorError>> {
        if maximum_requests < 2 {
            return Err(Report::new(EffectExecutorError::InvalidConfiguration)
                .attach_printable("maximum_requests must be at least 2 for create-409-patch"));
        }
        Ok(Self { maximum_requests })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EffectRequestV1 {
    Create(Value),
    Patch(Value),
    Archive(Value),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EffectResponseV1 {
    Success,
    Http {
        status: u16,
        retry_after: Option<Duration>,
        diagnostic: String,
    },
    Transport(TransportFailureV1),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TransportFailureV1 {
    Throttle,
    Timeout,
    Request,
}

#[async_trait]
pub(crate) trait GraphEffectTransport: Send + Sync {
    async fn send(&self, request: EffectRequestV1) -> EffectResponseV1;

    async fn send_as(&self, _actor_id: &str, request: EffectRequestV1) -> EffectResponseV1 {
        self.send(request).await
    }

    /// Sends one physical Graph bulk-create request. `None` means the
    /// transport has no bulk capability and the executor uses individual
    /// requests. A rejected batch is resolved per effect by the executor so
    /// lease checks, actual request charging, and the contiguous cursor stay
    /// under one authority.
    async fn send_create_batch(&self, _requests: Vec<Value>) -> Option<EffectResponseV1> {
        None
    }

    async fn send_create_batch_as(
        &self,
        _actor_id: &str,
        requests: Vec<Value>,
    ) -> Option<EffectResponseV1> {
        self.send_create_batch(requests).await
    }

    fn max_create_batch_size(&self) -> usize {
        0
    }

    /// Maximum independent requests the provider can usefully process at once.
    /// The executor still bounds the selected prefix by worst-case request
    /// cost and never overlaps different dependency classes.
    fn max_in_flight(&self) -> usize {
        1
    }
}

#[async_trait]
pub(crate) trait RetryDelay: Send + Sync {
    async fn wait(&self, delay: Duration);
}

#[derive(Debug, Default)]
pub(crate) struct TokioRetryDelay;

#[async_trait]
impl RetryDelay for TokioRetryDelay {
    async fn wait(&self, delay: Duration) {
        tokio::time::sleep(delay).await;
    }
}

#[async_trait]
pub(crate) trait WorkCursorCommitter: Send + Sync {
    async fn commit(
        &self,
        integration_id: &CanonicalIntegrationId,
        cursor: WorkChunkCompletedV1,
    ) -> Result<(), Report<EffectExecutorError>>;
}

/// Cooperative admission for one already-budgeted delivery turn. This limits
/// ordinary overlap after lease loss; it cannot fence a Graph request the
/// server has already accepted.
#[async_trait]
pub(crate) trait EffectTurnPermit: Send + Sync {
    fn send_allowed(&self) -> bool;
    fn cursor_allowed(&self) -> bool;

    fn send_deadline(&self) -> Option<Instant> {
        None
    }

    fn cursor_deadline(&self) -> Option<Instant> {
        None
    }

    /// Admits the next Graph request of this turn. The process-wide paced
    /// permit consumes one parent+class token here (the turn's first request
    /// is prepaid by admission); a `false` return yields the turn at its
    /// durable cursor. Unpaced permits admit unconditionally.
    async fn acquire_request(&self) -> bool {
        true
    }
}

#[derive(Debug)]
struct UnleasedTurnPermit;

impl EffectTurnPermit for UnleasedTurnPermit {
    fn send_allowed(&self) -> bool {
        true
    }

    fn cursor_allowed(&self) -> bool {
        true
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ShardWorkCursorCommitter {
    handle: ShardCommandHandle,
}

impl ShardWorkCursorCommitter {
    pub(crate) fn new(handle: ShardCommandHandle) -> Self {
        Self { handle }
    }
}

#[async_trait]
impl WorkCursorCommitter for ShardWorkCursorCommitter {
    async fn commit(
        &self,
        integration_id: &CanonicalIntegrationId,
        cursor: WorkChunkCompletedV1,
    ) -> Result<(), Report<EffectExecutorError>> {
        let record = JournalRecordV1::new(
            integration_id.clone(),
            JournalEvent::V1(JournalEventV1::WorkChunkCompleted(cursor)),
        )
        .change_context(EffectExecutorError::CursorCommit)
        .attach_printable("construct work cursor record")?;
        self.handle
            .propose(record)
            .await
            .change_context(EffectExecutorError::CursorCommit)
            .attach_printable("serialized shard cursor proposal failed")?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PreparedDeliveryV1 {
    Upsert { create: Value, patch: Value },
    Archive { archive: Value },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreparedEffectV1 {
    effect: GraphEffectV1,
    delivery: PreparedDeliveryV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PreparedWorkV1 {
    integration_id: CanonicalIntegrationId,
    owner_actor_id: String,
    work_id: WorkId,
    manifest_digest: String,
    completed_effect_count: u64,
    total_effect_count: u64,
    effects: Vec<PreparedEffectV1>,
}

#[derive(Clone)]
pub(crate) struct ExecutionPlanLoader {
    artifacts: ArtifactStore,
    effects: Arc<dyn EffectRepository>,
}

impl ExecutionPlanLoader {
    pub(crate) fn new(artifacts: ArtifactStore, effects: Arc<dyn EffectRepository>) -> Self {
        Self { artifacts, effects }
    }

    pub(crate) async fn load(
        &self,
        intent: &WorkRecoveryIntent,
        budget: ChunkBudget,
    ) -> Result<PreparedWorkV1, Report<EffectExecutorError>> {
        let load_started = std::time::Instant::now();
        let manifest: WorkManifest = self
            .load_record(&intent.manifest.artifact, MAX_WORK_MANIFEST_BYTES)
            .await?;
        let manifest = manifest
            .into_current_for(&intent.integration_id)
            .change_context(EffectExecutorError::ArtifactIntegrity)
            .attach_printable("validate work manifest identity")?;
        validate_manifest(intent, &manifest)?;

        let maximum = usize::try_from(budget.maximum_requests).map_err(|_error| {
            Report::new(EffectExecutorError::InvalidConfiguration)
                .attach_printable("request budget does not fit in memory")
        })?;
        let window = self
            .effects
            .load_effect_window(&manifest.effects, intent.completed_effect_count, maximum)
            .await
            .change_context(EffectExecutorError::ArtifactIntegrity)?;
        let effect_window_elapsed = load_started.elapsed();
        if window.effect_count != manifest.effect_count {
            return Err(
                Report::new(EffectExecutorError::ArtifactIntegrity).attach_printable(
                    "loaded effect count disagrees with the verified work manifest",
                ),
            );
        }
        let expected_window = usize::try_from(
            window
                .effect_count
                .saturating_sub(intent.completed_effect_count)
                .min(u64::from(budget.maximum_requests)),
        )
        .map_err(|_error| {
            Report::new(EffectExecutorError::InvalidConfiguration)
                .attach_printable("bounded effect window does not fit in memory")
        })?;
        if window.effects.len() != expected_window {
            return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("effect repository returned an incomplete bounded window"));
        }
        validate_recovery_cursor(
            intent,
            window.effect_count,
            window.previous_effect_id.as_ref(),
        )?;
        let expected_target = work_target_digest(&manifest.kind);
        if window
            .effects
            .iter()
            .any(|resolved| resolved.effect.target_state_digest != expected_target)
        {
            return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("effect target state disagrees with the verified work kind"));
        }

        let desired_keys = window
            .effects
            .iter()
            .map(|resolved| DesiredObjectKeyV1 {
                kind: resolved.effect.operation.kind(),
                graph_identity: resolved.effect.graph_identity.clone(),
            })
            .collect::<Vec<_>>();
        let desired_started = std::time::Instant::now();
        let (target, contaminated) = self.desired_sources(&manifest.kind, &desired_keys).await?;
        let desired_elapsed = desired_started.elapsed();
        let target = desired_map(target)?;
        let contaminated = desired_map(contaminated)?;
        let mut effects = Vec::with_capacity(window.effects.len());
        for resolved in window.effects {
            let key = (
                resolved.effect.operation.kind(),
                resolved.effect.graph_identity.clone(),
            );
            let desired = target.get(&key).or_else(|| contaminated.get(&key));
            let delivery = match resolved.effect.operation {
                GraphOperationV1::UpsertEntity | GraphOperationV1::UpsertLink => {
                    let desired = desired.ok_or_else(|| {
                        Report::new(EffectExecutorError::ArtifactIntegrity)
                            .attach_printable("upsert effect has no matching desired object")
                    })?;
                    if !matches!(
                        desired.object.disposition,
                        DesiredDispositionV1::Live { .. }
                    ) {
                        return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
                            .attach_printable("upsert effect resolves to an archived object"));
                    }
                    let payload = resolved.payload.as_ref().ok_or_else(|| {
                        Report::new(EffectExecutorError::ArtifactIntegrity)
                            .attach_printable("upsert effect has no verified payload")
                    })?;
                    if payload != &desired.payload {
                        return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
                            .attach_printable("effect payload differs from desired projection"));
                    }
                    delivery_from_payload(payload, &resolved.effect, false)?
                }
                GraphOperationV1::ArchiveLink | GraphOperationV1::ArchiveEntity => {
                    let desired = desired.ok_or_else(|| {
                        Report::new(EffectExecutorError::ArtifactIntegrity).attach_printable(
                            "archive effect has no matching target or contaminated desired object",
                        )
                    })?;
                    delivery_from_payload(&desired.payload, &resolved.effect, true)?
                }
            };
            effects.push(PreparedEffectV1 {
                effect: resolved.effect,
                delivery,
            });
        }
        tracing::info!(
            work_id = %intent.work_id,
            start = intent.completed_effect_count,
            effects = effects.len(),
            effect_window_ms = effect_window_elapsed.as_millis(),
            desired_lookup_ms = desired_elapsed.as_millis(),
            total_ms = load_started.elapsed().as_millis(),
            "prepared bounded Graph delivery window"
        );
        Ok(PreparedWorkV1 {
            integration_id: intent.integration_id.clone(),
            owner_actor_id: manifest.owner_actor_id,
            work_id: intent.work_id.clone(),
            manifest_digest: intent.manifest.manifest_digest.clone(),
            completed_effect_count: intent.completed_effect_count,
            total_effect_count: intent.effect_count,
            effects,
        })
    }

    async fn desired_sources(
        &self,
        kind: &WorkKind,
        keys: &[DesiredObjectKeyV1],
    ) -> Result<
        (Vec<ResolvedDesiredObjectV1>, Vec<ResolvedDesiredObjectV1>),
        Report<EffectExecutorError>,
    > {
        match kind {
            WorkKind::Apply(apply) => {
                Ok((self.load_desired(&apply.candidate, keys).await?, vec![]))
            }
            WorkKind::Reconcile(reconcile) => {
                Ok((self.load_desired(&reconcile.target, keys).await?, vec![]))
            }
            WorkKind::Restore(restore) => {
                let target = match &restore.target {
                    Some(target) => self.load_desired(target, keys).await?,
                    None => vec![],
                };
                Ok((
                    target,
                    self.load_desired(&restore.contaminated, keys).await?,
                ))
            }
        }
    }

    async fn load_desired(
        &self,
        reference: &StateVersionRef,
        keys: &[DesiredObjectKeyV1],
    ) -> Result<Vec<ResolvedDesiredObjectV1>, Report<EffectExecutorError>> {
        let state: StateVersion = self
            .load_record(&reference.artifact, MAX_STATE_VERSION_BYTES)
            .await?;
        let state = state
            .into_current()
            .change_context(EffectExecutorError::ArtifactIntegrity)
            .attach_printable("validate state-version identity")?;
        if state.id != reference.id {
            return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("state-version record disagrees with its reference"));
        }
        if state.desired_projection_schema_version != DESIRED_PROJECTION_SCHEMA_VERSION {
            return Err(
                Report::new(EffectExecutorError::ArtifactIntegrity).attach_printable(
                    "state-version desired projection schema is unsupported by this executor",
                ),
            );
        }
        self.effects
            .load_desired_objects(&state.desired_projection, keys)
            .await
            .change_context(EffectExecutorError::ArtifactIntegrity)
    }

    async fn load_record<T: DurableRecord>(
        &self,
        reference: &BlobRef,
        maximum: usize,
    ) -> Result<T, Report<EffectExecutorError>> {
        let path = self
            .artifacts
            .materialize(reference)
            .await
            .change_context(EffectExecutorError::ArtifactIntegrity)?;
        let bytes = tokio::fs::read(path)
            .await
            .change_context(EffectExecutorError::ArtifactIntegrity)
            .attach_printable("read materialized durable record")?;
        if bytes.len() > maximum {
            return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("materialized durable record exceeds its size bound"));
        }
        T::decode(&bytes)
            .change_context(EffectExecutorError::ArtifactIntegrity)
            .attach_printable("decode materialized durable record")
    }
}

fn validate_manifest(
    intent: &WorkRecoveryIntent,
    manifest: &WorkManifestV1,
) -> Result<(), Report<EffectExecutorError>> {
    if intent.status != crate::orchestrator::projection::WorkStatus::Planned {
        return Err(Report::new(EffectExecutorError::WorkNotRunnable)
            .attach_printable("only Planned work may enter the Graph effect lane"));
    }
    let reference = intent.manifest.artifact.current();
    if manifest.work_id != intent.work_id
        || manifest.work_id != intent.manifest.work_id
        || manifest.kind != intent.kind
        || manifest.effect_count != intent.effect_count
        || manifest.effect_identity_version != EFFECT_IDENTITY_VERSION
        || manifest.effect_encoding_version != EFFECT_ENCODING_VERSION
        || reference.sha256 != intent.manifest.manifest_digest
    {
        return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
            .attach_printable("work recovery intent disagrees with its immutable manifest"));
    }
    Ok(())
}

fn work_target_digest(kind: &WorkKind) -> &str {
    match kind {
        WorkKind::Apply(apply) => apply.candidate.id.as_str(),
        WorkKind::Restore(restore) => restore
            .target
            .as_ref()
            .map_or("", |value| value.id.as_str()),
        WorkKind::Reconcile(reconcile) => reconcile.target.id.as_str(),
    }
}

fn validate_recovery_cursor(
    intent: &WorkRecoveryIntent,
    effect_count: u64,
    previous_effect_id: Option<&EffectId>,
) -> Result<(), Report<EffectExecutorError>> {
    if intent.completed_effect_count > effect_count {
        return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
            .attach_printable("completed effect cursor exceeds the immutable effect count"));
    }
    match (intent.completed_effect_count, &intent.last_completed_effect) {
        (0, None) => Ok(()),
        (0, Some(_)) => Err(Report::new(EffectExecutorError::ArtifactIntegrity)
            .attach_printable("zero cursor unexpectedly names a last effect")),
        (_, Some(expected)) if previous_effect_id == Some(expected) => Ok(()),
        (_, Some(_)) => Err(Report::new(EffectExecutorError::ArtifactIntegrity)
            .attach_printable("last completed effect disagrees with the immutable cursor")),
        (_, None) => Err(Report::new(EffectExecutorError::ArtifactIntegrity)
            .attach_printable("non-zero cursor has no last completed effect")),
    }
}

fn desired_map(
    objects: Vec<ResolvedDesiredObjectV1>,
) -> Result<
    BTreeMap<(GraphObjectKindV1, String), ResolvedDesiredObjectV1>,
    Report<EffectExecutorError>,
> {
    let mut values = BTreeMap::new();
    for object in objects {
        let key = (object.object.kind, object.object.graph_identity.clone());
        if values.insert(key, object).is_some() {
            return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("desired projection contains a duplicate Graph identity"));
        }
    }
    Ok(values)
}

fn delivery_from_payload(
    payload: &[u8],
    effect: &GraphEffectV1,
    archive: bool,
) -> Result<PreparedDeliveryV1, Report<EffectExecutorError>> {
    let delivery = GraphDeliveryPayload::decode(payload)
        .change_context(EffectExecutorError::ArtifactIntegrity)
        .attach_printable("decode exact Graph delivery payload")?
        .into_current()
        .change_context(EffectExecutorError::ArtifactIntegrity)
        .attach_printable("upcast exact Graph delivery payload")?;
    if delivery.graph_identity != effect.graph_identity {
        return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
            .attach_printable("delivery payload identity disagrees with effect identity"));
    }
    match (archive, delivery.request) {
        (false, GraphDeliveryRequestV1::Upsert { create, patch, .. }) => {
            Ok(PreparedDeliveryV1::Upsert { create, patch })
        }
        (
            true,
            GraphDeliveryRequestV1::Upsert { archive, .. }
            | GraphDeliveryRequestV1::Archive { archive },
        ) => Ok(PreparedDeliveryV1::Archive { archive }),
        (false, GraphDeliveryRequestV1::Archive { .. }) => {
            Err(Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("upsert effect resolves to archive-only delivery bytes"))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TurnOutcomeV1 {
    Progressed {
        completed_effect_count: u64,
        work_exhausted: bool,
        requests_used: u32,
    },
    Yielded {
        completed_effect_count: u64,
        requests_used: u32,
        retry_after: Option<Duration>,
    },
    PermanentFailure {
        completed_effect_count: u64,
        requests_used: u32,
        failed_effect_id: EffectId,
        status: Option<u16>,
        diagnostic: String,
    },
}

impl GraphRequestCharge for TurnOutcomeV1 {
    fn graph_requests_used(&self) -> u32 {
        match self {
            Self::Progressed { requests_used, .. }
            | Self::Yielded { requests_used, .. }
            | Self::PermanentFailure { requests_used, .. } => *requests_used,
        }
    }
}

#[derive(Default)]
pub(crate) struct EffectLaneRegistry {
    lanes: Mutex<BTreeMap<CanonicalIntegrationId, Arc<Mutex<()>>>>,
}

impl EffectLaneRegistry {
    async fn acquire(&self, integration: &CanonicalIntegrationId) -> OwnedMutexGuard<()> {
        let lane = {
            let mut lanes = self.lanes.lock().await;
            Arc::clone(
                lanes
                    .entry(integration.clone())
                    .or_insert_with(|| Arc::new(Mutex::new(()))),
            )
        };
        lane.lock_owned().await
    }
}

pub(crate) struct BoundedEffectExecutor {
    transport: Arc<dyn GraphEffectTransport>,
    committer: Arc<dyn WorkCursorCommitter>,
    delay: Arc<dyn RetryDelay>,
    lanes: Arc<EffectLaneRegistry>,
    telemetry: Option<crate::progress::OperationalTelemetry>,
    /// Effects whose create already answered Conflict, scoped to the durable
    /// work item whose retry they accelerate. Later attempts go
    /// PATCH-first: re-proving the conflict on every retry both wastes a
    /// charged request and can phase-lock with a periodic provider throttle
    /// (create consumes the good slot, the patch always lands on a 429).
    /// In-memory only: after a restart one extra create re-proves the
    /// conflict, which at-least-once delivery already tolerates.
    proven_conflicts: std::sync::Mutex<
        std::collections::BTreeMap<
            crate::orchestrator::ids::WorkId,
            std::collections::BTreeSet<crate::orchestrator::ids::EffectId>,
        >,
    >,
}

impl BoundedEffectExecutor {
    pub(crate) fn new(
        transport: Arc<dyn GraphEffectTransport>,
        committer: Arc<dyn WorkCursorCommitter>,
        delay: Arc<dyn RetryDelay>,
        lanes: Arc<EffectLaneRegistry>,
    ) -> Self {
        Self {
            transport,
            committer,
            delay,
            lanes,
            telemetry: None,
            proven_conflicts: std::sync::Mutex::new(std::collections::BTreeMap::new()),
        }
    }

    pub(crate) fn with_telemetry(
        mut self,
        telemetry: crate::progress::OperationalTelemetry,
    ) -> Self {
        self.telemetry = Some(telemetry);
        self
    }

    pub(crate) async fn execute_turn(
        &self,
        work: &PreparedWorkV1,
        budget: ChunkBudget,
    ) -> Result<TurnOutcomeV1, Report<EffectExecutorError>> {
        self.execute_permitted_turn(work, budget, &UnleasedTurnPermit)
            .await
    }

    pub(crate) async fn execute_permitted_turn(
        &self,
        work: &PreparedWorkV1,
        budget: ChunkBudget,
        permit: &dyn EffectTurnPermit,
    ) -> Result<TurnOutcomeV1, Report<EffectExecutorError>> {
        let _lane = self.lanes.acquire(&work.integration_id).await;
        let integration_path =
            crate::orchestrator::routing::integration_path(&work.integration_id).to_string();
        let start = usize::try_from(work.completed_effect_count).map_err(|_error| {
            Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("work cursor does not fit in memory")
        })?;
        let remaining = work
            .total_effect_count
            .checked_sub(work.completed_effect_count)
            .ok_or_else(|| {
                Report::new(EffectExecutorError::ArtifactIntegrity)
                    .attach_printable("work cursor exceeds total effect count")
            })?;
        if work.effects.len() as u64 > remaining {
            return Err(Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("prepared effect window exceeds remaining work"));
        }
        let mut state = TurnState {
            maximum: budget.maximum_requests,
            used: 0,
            completed: start,
            last_effect: None,
        };
        if self.transport.max_in_flight() > 1 {
            return self
                .execute_parallel_turn(work, permit, &integration_path, state)
                .await;
        }
        let mut terminal = None;
        for effect in &work.effects {
            if !permit.send_allowed() {
                terminal = Some(Terminal::Yield(None));
                break;
            }
            if !state.can_start(effect.request_cost()) {
                terminal = Some(Terminal::Yield(None));
                break;
            }
            loop {
                match self
                    .deliver_once(work, effect, &mut state, permit, &integration_path)
                    .await
                {
                    DeliveryAttempt::Acknowledged => {
                        state.completed += 1;
                        state.last_effect = Some(effect.effect.effect_id.clone());
                        break;
                    }
                    DeliveryAttempt::Retryable { retry_after } => {
                        let retry_after = retry_after
                            .map(|delay| delay.min(Duration::from_secs(30)))
                            .unwrap_or_else(|| retry_delay(state.used));
                        if state.can_start(effect.request_cost()) {
                            if !self.wait_retry(permit, retry_after).await {
                                terminal = Some(Terminal::Yield(None));
                                break;
                            }
                            if !permit.send_allowed() {
                                terminal = Some(Terminal::Yield(None));
                                break;
                            }
                            if let Some(telemetry) = &self.telemetry {
                                telemetry.record_resend(&integration_path);
                            }
                            continue;
                        }
                        terminal = Some(Terminal::Yield(Some(retry_after)));
                        break;
                    }
                    DeliveryAttempt::Permanent { status, diagnostic } => {
                        terminal = Some(Terminal::Permanent {
                            effect_id: effect.effect.effect_id.clone(),
                            status,
                            diagnostic,
                        });
                        break;
                    }
                    DeliveryAttempt::Yield => {
                        terminal = Some(Terminal::Yield(None));
                        break;
                    }
                }
            }
            if terminal.is_some() {
                break;
            }
        }

        if state.completed > start {
            if !permit.cursor_allowed() {
                return Ok(TurnOutcomeV1::Yielded {
                    completed_effect_count: work.completed_effect_count,
                    requests_used: state.used,
                    retry_after: None,
                });
            }
            let completed_effect_count = u64::try_from(state.completed).map_err(|_error| {
                Report::new(EffectExecutorError::ArtifactIntegrity)
                    .attach_printable("completed effect count overflow")
            })?;
            let cursor = WorkChunkCompletedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest_digest.clone(),
                completed_effect_count,
                last_effect_id: state
                    .last_effect
                    .clone()
                    .expect("advanced prefix always has a last effect"),
            };
            let commit = self.committer.commit(&work.integration_id, cursor);
            let result = if let Some(deadline) = permit.cursor_deadline() {
                match tokio::time::timeout_at(deadline, commit).await {
                    Ok(result) => result,
                    Err(_elapsed) => Err(Report::new(EffectExecutorError::CursorCommit)
                        .attach_printable("lease-budgeted cursor commit reached its deadline")),
                }
            } else {
                commit.await
            };
            if let Err(error) = result {
                return Err(error.attach(GraphRequestsUsed::new(state.used)));
            }
        }

        let completed_effect_count = u64::try_from(state.completed).map_err(|_error| {
            Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("completed effect count overflow")
        })?;
        Ok(match terminal {
            Some(Terminal::Yield(retry_after)) => TurnOutcomeV1::Yielded {
                completed_effect_count,
                requests_used: state.used,
                retry_after,
            },
            Some(Terminal::Permanent {
                effect_id,
                status,
                diagnostic,
            }) => TurnOutcomeV1::PermanentFailure {
                completed_effect_count,
                requests_used: state.used,
                failed_effect_id: effect_id,
                status,
                diagnostic,
            },
            None => TurnOutcomeV1::Progressed {
                completed_effect_count,
                work_exhausted: completed_effect_count == work.total_effect_count,
                requests_used: state.used,
            },
        })
    }

    async fn execute_parallel_turn(
        &self,
        work: &PreparedWorkV1,
        permit: &dyn EffectTurnPermit,
        integration_path: &str,
        state: TurnState,
    ) -> Result<TurnOutcomeV1, Report<EffectExecutorError>> {
        let Some(first) = work.effects.first() else {
            return Ok(TurnOutcomeV1::Progressed {
                completed_effect_count: u64::try_from(state.completed).map_err(|_error| {
                    Report::new(EffectExecutorError::ArtifactIntegrity)
                        .attach_printable("completed effect count overflow")
                })?,
                work_exhausted: work.completed_effect_count == work.total_effect_count,
                requests_used: 0,
            });
        };
        let dependency_class = first.effect.operation;
        let batch_capable = matches!(
            dependency_class,
            GraphOperationV1::UpsertEntity | GraphOperationV1::UpsertLink
        ) && self.transport.max_create_batch_size() > 1
            && state.maximum >= 4
            && !self.conflict_proven(&work.work_id, &first.effect.effect_id);
        let selected = self.select_parallel_prefix(work, dependency_class, state.maximum, false);
        let batch = batch_capable
            .then(|| self.select_parallel_batch_prefix(work, dependency_class, state.maximum));
        if let Some(batch) = batch.filter(|batch| batch.len() > 1) {
            return self
                .execute_create_batches(work, permit, integration_path, state, batch)
                .await;
        }
        self.execute_parallel_prefix(work, permit, integration_path, state, selected)
            .await
    }

    fn select_parallel_prefix<'a>(
        &self,
        work: &'a PreparedWorkV1,
        dependency_class: GraphOperationV1,
        maximum_requests: u32,
        reject_proven_conflicts: bool,
    ) -> Vec<&'a PreparedEffectV1> {
        let mut reserved = 0_u32;
        work.effects
            .iter()
            .take_while(|effect| {
                if effect.effect.operation != dependency_class
                    || (reject_proven_conflicts
                        && self.conflict_proven(&work.work_id, &effect.effect.effect_id))
                {
                    return false;
                }
                let Some(next) = reserved.checked_add(effect.request_cost()) else {
                    return false;
                };
                if next > maximum_requests {
                    return false;
                }
                reserved = next;
                true
            })
            .collect()
    }

    fn select_parallel_batch_prefix<'a>(
        &self,
        work: &'a PreparedWorkV1,
        dependency_class: GraphOperationV1,
        maximum_requests: u32,
    ) -> Vec<&'a PreparedEffectV1> {
        let batch_size = self.transport.max_create_batch_size();
        let mut reserved = 0_u32;
        let mut selected = Vec::new();
        for effect in &work.effects {
            if effect.effect.operation != dependency_class
                || self.conflict_proven(&work.work_id, &effect.effect.effect_id)
            {
                break;
            }
            let batch_request = u32::from(selected.len() % batch_size == 0);
            // A rejected batch may require PATCH, Create after PATCH 404, and
            // one final PATCH if that Create races another writer.
            let Some(next) = reserved
                .checked_add(batch_request)
                .and_then(|value| value.checked_add(3))
            else {
                break;
            };
            if next > maximum_requests {
                break;
            }
            reserved = next;
            selected.push(effect);
        }
        selected
    }

    async fn execute_create_batches(
        &self,
        work: &PreparedWorkV1,
        permit: &dyn EffectTurnPermit,
        integration_path: &str,
        mut state: TurnState,
        selected: Vec<&PreparedEffectV1>,
    ) -> Result<TurnOutcomeV1, Report<EffectExecutorError>> {
        let batch_size = self.transport.max_create_batch_size();
        let pending = selected
            .chunks(batch_size)
            .map(<[_]>::to_vec)
            .map(|batch| async move {
                let outcome = self
                    .execute_create_batch_group(work, permit, integration_path, &batch)
                    .await;
                (batch, outcome)
            })
            .collect::<Vec<_>>();
        let outcomes = futures::stream::iter(pending)
            .buffered(self.transport.max_in_flight().max(1))
            .collect::<Vec<_>>()
            .await;

        let mut terminal = None;
        for (batch, outcome) in outcomes {
            state.used = state.used.saturating_add(outcome.requests_used);
            if terminal.is_some() {
                continue;
            }
            for effect in batch.iter().take(outcome.completed) {
                state.completed += 1;
                state.last_effect = Some(effect.effect.effect_id.clone());
            }
            terminal = outcome.terminal;
        }
        self.finish_turn(work, permit, state, terminal).await
    }

    async fn execute_create_batch_group(
        &self,
        work: &PreparedWorkV1,
        permit: &dyn EffectTurnPermit,
        integration_path: &str,
        selected: &[&PreparedEffectV1],
    ) -> BatchGroupOutcome {
        let creates = selected
            .iter()
            .map(|effect| match &effect.delivery {
                PreparedDeliveryV1::Upsert { create, .. } => create.clone(),
                PreparedDeliveryV1::Archive { .. } => {
                    unreachable!("batch prefix contains only upsert effects")
                }
            })
            .collect();
        let mut state = TurnState {
            maximum: u32::MAX,
            used: 0,
            completed: 0,
            last_effect: None,
        };
        let Some(classified) = self
            .charged_create_batch(
                &work.owner_actor_id,
                &mut state,
                permit,
                creates,
                integration_path,
            )
            .await
        else {
            return BatchGroupOutcome {
                completed: 0,
                terminal: Some(Terminal::Yield(None)),
                requests_used: state.used,
            };
        };
        match classified {
            Classified::Success => BatchGroupOutcome {
                completed: selected.len(),
                terminal: None,
                requests_used: state.used,
            },
            Classified::Retryable { retry_after } => BatchGroupOutcome {
                completed: 0,
                terminal: Some(Terminal::Yield(retry_after)),
                requests_used: state.used,
            },
            classification @ (Classified::Conflict | Classified::Permanent { .. }) => {
                let patch_first = matches!(classification, Classified::Conflict);
                let mut completed = 0;
                let mut terminal = None;
                for effect in selected {
                    let outcome = if patch_first {
                        self.execute_patch_first_effect(work, effect, permit, integration_path)
                            .await
                    } else {
                        self.execute_parallel_effect(work, effect, permit, integration_path)
                            .await
                    };
                    state.used = state.used.saturating_add(outcome.requests_used);
                    match outcome.terminal {
                        None => completed += 1,
                        Some(effect_terminal) => {
                            terminal = Some(effect_terminal);
                            break;
                        }
                    }
                }
                BatchGroupOutcome {
                    completed,
                    terminal,
                    requests_used: state.used,
                }
            }
        }
    }

    async fn execute_parallel_prefix(
        &self,
        work: &PreparedWorkV1,
        permit: &dyn EffectTurnPermit,
        integration_path: &str,
        mut state: TurnState,
        selected: Vec<&PreparedEffectV1>,
    ) -> Result<TurnOutcomeV1, Report<EffectExecutorError>> {
        let mut pending = Vec::with_capacity(selected.len());
        for effect in selected {
            pending.push(self.execute_parallel_effect(work, effect, permit, integration_path));
        }
        let outcomes = futures::stream::iter(pending)
            .buffered(self.transport.max_in_flight().max(1))
            .collect::<Vec<_>>()
            .await;

        let mut terminal = None;
        for (effect, outcome) in work.effects.iter().zip(outcomes) {
            state.used = state.used.saturating_add(outcome.requests_used);
            if terminal.is_some() {
                continue;
            }
            match outcome.terminal {
                None => {
                    state.completed += 1;
                    state.last_effect = Some(effect.effect.effect_id.clone());
                }
                Some(effect_terminal) => terminal = Some(effect_terminal),
            }
        }

        self.finish_turn(work, permit, state, terminal).await
    }

    async fn charged_create_batch(
        &self,
        owner_actor_id: &str,
        state: &mut TurnState,
        permit: &dyn EffectTurnPermit,
        requests: Vec<Value>,
        integration_path: &str,
    ) -> Option<Classified> {
        if !self.admit_send(permit).await {
            return None;
        }
        state.used += 1;
        let send = self
            .transport
            .send_create_batch_as(owner_actor_id, requests);
        let response = match permit.send_deadline() {
            Some(deadline) => tokio::time::timeout_at(deadline, send).await.ok()?,
            None => send.await,
        }?;
        if matches!(response, EffectResponseV1::Http { status: 429, .. }) {
            if let Some(telemetry) = &self.telemetry {
                telemetry.record_graph_429(integration_path);
            }
        }
        Some(classify(response, true))
    }

    async fn execute_parallel_effect(
        &self,
        work: &PreparedWorkV1,
        effect: &PreparedEffectV1,
        permit: &dyn EffectTurnPermit,
        integration_path: &str,
    ) -> ParallelEffectOutcome {
        let mut state = TurnState {
            maximum: effect.request_cost(),
            used: 0,
            completed: 0,
            last_effect: None,
        };
        let terminal = if permit.send_allowed() {
            match self
                .deliver_once(work, effect, &mut state, permit, integration_path)
                .await
            {
                DeliveryAttempt::Acknowledged => None,
                DeliveryAttempt::Retryable { retry_after } => Some(Terminal::Yield(retry_after)),
                DeliveryAttempt::Yield => Some(Terminal::Yield(None)),
                DeliveryAttempt::Permanent { status, diagnostic } => Some(Terminal::Permanent {
                    effect_id: effect.effect.effect_id.clone(),
                    status,
                    diagnostic,
                }),
            }
        } else {
            Some(Terminal::Yield(None))
        };
        ParallelEffectOutcome {
            terminal,
            requests_used: state.used,
        }
    }

    async fn execute_patch_first_effect(
        &self,
        work: &PreparedWorkV1,
        effect: &PreparedEffectV1,
        permit: &dyn EffectTurnPermit,
        integration_path: &str,
    ) -> ParallelEffectOutcome {
        let PreparedDeliveryV1::Upsert { create, patch } = &effect.delivery else {
            return self
                .execute_parallel_effect(work, effect, permit, integration_path)
                .await;
        };
        let effect_id = &effect.effect.effect_id;
        let mut state = TurnState {
            maximum: 3,
            used: 0,
            completed: 0,
            last_effect: None,
        };
        let Some(patch_result) = self
            .charged_send(
                &work.owner_actor_id,
                &mut state,
                permit,
                EffectRequestV1::Patch(patch.clone()),
                integration_path,
            )
            .await
        else {
            return ParallelEffectOutcome {
                terminal: Some(Terminal::Yield(None)),
                requests_used: state.used,
            };
        };
        let terminal = match patch_result {
            Classified::Success => None,
            Classified::Retryable { retry_after } => Some(Terminal::Yield(retry_after)),
            Classified::Conflict => Some(Terminal::Permanent {
                effect_id: effect_id.clone(),
                status: Some(409),
                diagnostic: "PATCH returned conflict; only create 409 is authoritative".to_owned(),
            }),
            Classified::Permanent {
                status: Some(404), ..
            } => {
                let Some(create_result) = self
                    .charged_send(
                        &work.owner_actor_id,
                        &mut state,
                        permit,
                        EffectRequestV1::Create(create.clone()),
                        integration_path,
                    )
                    .await
                else {
                    return ParallelEffectOutcome {
                        terminal: Some(Terminal::Yield(None)),
                        requests_used: state.used,
                    };
                };
                match create_result {
                    Classified::Success => None,
                    Classified::Retryable { retry_after } => Some(Terminal::Yield(retry_after)),
                    Classified::Permanent { status, diagnostic } => Some(Terminal::Permanent {
                        effect_id: effect_id.clone(),
                        status,
                        diagnostic,
                    }),
                    Classified::Conflict => {
                        self.record_proven_conflict(&work.work_id, effect_id);
                        let Some(final_patch) = self
                            .charged_send(
                                &work.owner_actor_id,
                                &mut state,
                                permit,
                                EffectRequestV1::Patch(patch.clone()),
                                integration_path,
                            )
                            .await
                        else {
                            return ParallelEffectOutcome {
                                terminal: Some(Terminal::Yield(None)),
                                requests_used: state.used,
                            };
                        };
                        match final_patch {
                            Classified::Success => {
                                self.forget_proven_conflict(&work.work_id, effect_id);
                                None
                            }
                            Classified::Retryable { retry_after } => {
                                Some(Terminal::Yield(retry_after))
                            }
                            Classified::Conflict => {
                                self.forget_proven_conflict(&work.work_id, effect_id);
                                Some(Terminal::Permanent {
                                    effect_id: effect_id.clone(),
                                    status: Some(409),
                                    diagnostic:
                                        "PATCH returned conflict; only create 409 is authoritative"
                                            .to_owned(),
                                })
                            }
                            Classified::Permanent { status, diagnostic } => {
                                self.forget_proven_conflict(&work.work_id, effect_id);
                                Some(Terminal::Permanent {
                                    effect_id: effect_id.clone(),
                                    status,
                                    diagnostic,
                                })
                            }
                        }
                    }
                }
            }
            Classified::Permanent { status, diagnostic } => Some(Terminal::Permanent {
                effect_id: effect_id.clone(),
                status,
                diagnostic,
            }),
        };
        ParallelEffectOutcome {
            terminal,
            requests_used: state.used,
        }
    }

    async fn finish_turn(
        &self,
        work: &PreparedWorkV1,
        permit: &dyn EffectTurnPermit,
        state: TurnState,
        terminal: Option<Terminal>,
    ) -> Result<TurnOutcomeV1, Report<EffectExecutorError>> {
        let start = usize::try_from(work.completed_effect_count).map_err(|_error| {
            Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("work cursor does not fit in memory")
        })?;
        if state.completed > start {
            if !permit.cursor_allowed() {
                return Ok(TurnOutcomeV1::Yielded {
                    completed_effect_count: work.completed_effect_count,
                    requests_used: state.used,
                    retry_after: None,
                });
            }
            let cursor = WorkChunkCompletedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest_digest.clone(),
                completed_effect_count: u64::try_from(state.completed).map_err(|_error| {
                    Report::new(EffectExecutorError::ArtifactIntegrity)
                        .attach_printable("completed effect count overflow")
                })?,
                last_effect_id: state
                    .last_effect
                    .clone()
                    .expect("advanced prefix always has a last effect"),
            };
            let commit = self.committer.commit(&work.integration_id, cursor);
            let result = if let Some(deadline) = permit.cursor_deadline() {
                match tokio::time::timeout_at(deadline, commit).await {
                    Ok(result) => result,
                    Err(_elapsed) => Err(Report::new(EffectExecutorError::CursorCommit)
                        .attach_printable("lease-budgeted cursor commit reached its deadline")),
                }
            } else {
                commit.await
            };
            if let Err(error) = result {
                return Err(error.attach(GraphRequestsUsed::new(state.used)));
            }
        }

        let completed_effect_count = u64::try_from(state.completed).map_err(|_error| {
            Report::new(EffectExecutorError::ArtifactIntegrity)
                .attach_printable("completed effect count overflow")
        })?;
        Ok(match terminal {
            Some(Terminal::Yield(retry_after)) => TurnOutcomeV1::Yielded {
                completed_effect_count,
                requests_used: state.used,
                retry_after,
            },
            Some(Terminal::Permanent {
                effect_id,
                status,
                diagnostic,
            }) => TurnOutcomeV1::PermanentFailure {
                completed_effect_count,
                requests_used: state.used,
                failed_effect_id: effect_id,
                status,
                diagnostic,
            },
            None => TurnOutcomeV1::Progressed {
                completed_effect_count,
                work_exhausted: completed_effect_count == work.total_effect_count,
                requests_used: state.used,
            },
        })
    }

    async fn deliver_once(
        &self,
        work: &PreparedWorkV1,
        effect: &PreparedEffectV1,
        state: &mut TurnState,
        permit: &dyn EffectTurnPermit,
        integration_path: &str,
    ) -> DeliveryAttempt {
        match &effect.delivery {
            PreparedDeliveryV1::Upsert { create, patch } => {
                let effect_id = &effect.effect.effect_id;
                // PATCH-first once a conflict is proven: re-proving it every
                // retry would waste charged requests and can phase-lock with
                // a periodic provider throttle.
                if !self.conflict_proven(&work.work_id, effect_id) {
                    let Some(classified) = self
                        .charged_send(
                            &work.owner_actor_id,
                            state,
                            permit,
                            EffectRequestV1::Create(create.clone()),
                            integration_path,
                        )
                        .await
                    else {
                        return DeliveryAttempt::Yield;
                    };
                    match classified {
                        Classified::Success => return DeliveryAttempt::Acknowledged,
                        Classified::Conflict => {
                            self.record_proven_conflict(&work.work_id, effect_id);
                        }
                        Classified::Retryable { retry_after } => {
                            return DeliveryAttempt::Retryable { retry_after };
                        }
                        Classified::Permanent { status, diagnostic } => {
                            return DeliveryAttempt::Permanent { status, diagnostic };
                        }
                    }
                }
                let Some(classified) = self
                    .charged_send(
                        &work.owner_actor_id,
                        state,
                        permit,
                        EffectRequestV1::Patch(patch.clone()),
                        integration_path,
                    )
                    .await
                else {
                    return DeliveryAttempt::Yield;
                };
                match classified {
                    Classified::Success => {
                        self.forget_proven_conflict(&work.work_id, effect_id);
                        DeliveryAttempt::Acknowledged
                    }
                    Classified::Retryable { retry_after } => {
                        DeliveryAttempt::Retryable { retry_after }
                    }
                    Classified::Conflict => {
                        self.forget_proven_conflict(&work.work_id, effect_id);
                        DeliveryAttempt::Permanent {
                            status: Some(409),
                            diagnostic: "PATCH returned conflict; only create 409 is authoritative"
                                .to_owned(),
                        }
                    }
                    Classified::Permanent { status, diagnostic } => {
                        self.forget_proven_conflict(&work.work_id, effect_id);
                        DeliveryAttempt::Permanent { status, diagnostic }
                    }
                }
            }
            PreparedDeliveryV1::Archive { archive } => {
                let Some(classified) = self
                    .charged_send(
                        &work.owner_actor_id,
                        state,
                        permit,
                        EffectRequestV1::Archive(archive.clone()),
                        integration_path,
                    )
                    .await
                else {
                    return DeliveryAttempt::Yield;
                };
                match classified {
                    Classified::Success => DeliveryAttempt::Acknowledged,
                    Classified::Retryable { retry_after } => {
                        DeliveryAttempt::Retryable { retry_after }
                    }
                    // Archiving is monotonic: a conflict on an archive means
                    // the object already reached the requested terminal
                    // state, exactly the situation an at-least-once replay of
                    // an acknowledged-but-uncursored archive produces. It
                    // converges like create-conflict; treating it as a
                    // permanent failure would wedge Restore behind its own
                    // successful first delivery.
                    Classified::Conflict => DeliveryAttempt::Acknowledged,
                    Classified::Permanent { status, diagnostic } => {
                        DeliveryAttempt::Permanent { status, diagnostic }
                    }
                }
            }
        }
    }

    fn conflict_proven(
        &self,
        work_id: &crate::orchestrator::ids::WorkId,
        effect_id: &crate::orchestrator::ids::EffectId,
    ) -> bool {
        self.proven_conflicts
            .lock()
            .expect("proven-conflict set is never poisoned")
            .get(work_id)
            .is_some_and(|effects| effects.contains(effect_id))
    }

    fn record_proven_conflict(
        &self,
        work_id: &crate::orchestrator::ids::WorkId,
        effect_id: &crate::orchestrator::ids::EffectId,
    ) {
        self.proven_conflicts
            .lock()
            .expect("proven-conflict set is never poisoned")
            .entry(work_id.clone())
            .or_default()
            .insert(effect_id.clone());
    }

    fn forget_proven_conflict(
        &self,
        work_id: &crate::orchestrator::ids::WorkId,
        effect_id: &crate::orchestrator::ids::EffectId,
    ) {
        let mut proven = self
            .proven_conflicts
            .lock()
            .expect("proven-conflict set is never poisoned");
        if let Some(effects) = proven.get_mut(work_id) {
            effects.remove(effect_id);
            if effects.is_empty() {
                proven.remove(work_id);
            }
        }
    }

    /// A settled or superseded work item can never reuse this retry hint.
    /// Purging at the lifecycle boundary bounds the cache even when an effect
    /// exits without reaching PATCH.
    pub(crate) fn forget_work_conflicts(&self, work_id: &WorkId) {
        self.proven_conflicts
            .lock()
            .expect("proven-conflict set is never poisoned")
            .remove(work_id);
    }

    /// One admitted, charged, classified transmission. `None` yields the
    /// turn. The pairing this owns is the delivery accounting invariant:
    /// a request is charged exactly when its admission succeeded, and a
    /// deadline elapsing after admission stays charged because the request
    /// was really transmitted.
    async fn charged_send(
        &self,
        owner_actor_id: &str,
        state: &mut TurnState,
        permit: &dyn EffectTurnPermit,
        request: EffectRequestV1,
        integration_path: &str,
    ) -> Option<Classified> {
        let duplicate_body_proves_conflict = matches!(&request, EffectRequestV1::Create(_));
        tracing::trace!("admitting one charged Graph request");
        if !self.admit_send(permit).await {
            tracing::trace!("request suppressed before transmission");
            return None;
        }
        state.used += 1;
        let response = self
            .send(owner_actor_id, permit, request, integration_path)
            .await?;
        match &response {
            EffectResponseV1::Success => tracing::trace!("charged Graph request succeeded"),
            EffectResponseV1::Http { status, .. } => {
                tracing::trace!(status, "charged Graph request answered");
            }
            EffectResponseV1::Transport(failure) => {
                tracing::trace!(failure = ?failure, "charged Graph request transport failure");
            }
        }
        Some(classify(response, duplicate_body_proves_conflict))
    }

    /// Admission for the next request of this turn: lease permission plus
    /// one process-wide token. Runs before the request is charged, so a
    /// refusal here never settles against the lane.
    async fn admit_send(&self, permit: &dyn EffectTurnPermit) -> bool {
        permit.send_allowed() && permit.acquire_request().await && permit.send_allowed()
    }

    /// One charged transmission. A deadline elapsing here still consumed
    /// real provider capacity, so the caller keeps the charge.
    async fn send(
        &self,
        owner_actor_id: &str,
        permit: &dyn EffectTurnPermit,
        request: EffectRequestV1,
        integration_path: &str,
    ) -> Option<EffectResponseV1> {
        let send = self.transport.send_as(owner_actor_id, request);
        let response = match permit.send_deadline() {
            Some(deadline) => tokio::time::timeout_at(deadline, send).await.ok(),
            None => Some(send.await),
        };
        if response
            .as_ref()
            .is_some_and(|response| matches!(response, EffectResponseV1::Http { status: 429, .. }))
        {
            if let Some(telemetry) = &self.telemetry {
                telemetry.record_graph_429(integration_path);
            }
        }
        response
    }

    async fn wait_retry(&self, permit: &dyn EffectTurnPermit, delay: Duration) -> bool {
        let wait = self.delay.wait(delay);
        match permit.send_deadline() {
            Some(deadline) => tokio::time::timeout_at(deadline, wait).await.is_ok(),
            None => {
                wait.await;
                true
            }
        }
    }
}

struct TurnState {
    maximum: u32,
    used: u32,
    completed: usize,
    last_effect: Option<EffectId>,
}

impl TurnState {
    fn can_start(&self, cost: u32) -> bool {
        self.maximum.saturating_sub(self.used) >= cost
    }
}

impl PreparedEffectV1 {
    fn request_cost(&self) -> u32 {
        match self.delivery {
            PreparedDeliveryV1::Upsert { .. } => 2,
            PreparedDeliveryV1::Archive { .. } => 1,
        }
    }
}

enum DeliveryAttempt {
    Acknowledged,
    Retryable {
        retry_after: Option<Duration>,
    },
    Yield,
    Permanent {
        status: Option<u16>,
        diagnostic: String,
    },
}

enum Terminal {
    Yield(Option<Duration>),
    Permanent {
        effect_id: EffectId,
        status: Option<u16>,
        diagnostic: String,
    },
}

struct ParallelEffectOutcome {
    terminal: Option<Terminal>,
    requests_used: u32,
}

struct BatchGroupOutcome {
    completed: usize,
    terminal: Option<Terminal>,
    requests_used: u32,
}

#[derive(Debug, PartialEq, Eq)]
enum Classified {
    Success,
    Conflict,
    Retryable {
        retry_after: Option<Duration>,
    },
    Permanent {
        status: Option<u16>,
        diagnostic: String,
    },
}

fn classify(response: EffectResponseV1, duplicate_body_proves_conflict: bool) -> Classified {
    match response {
        EffectResponseV1::Success => Classified::Success,
        EffectResponseV1::Transport(_) => Classified::Retryable { retry_after: None },
        EffectResponseV1::Http {
            status: 409,
            diagnostic: _,
            retry_after: _,
        } => Classified::Conflict,
        // Parity with the reference engines: the Graph reports a duplicate
        // create as a 500 whose body names the unique-constraint violation,
        // so the body markers are part of the conflict contract. Checked
        // before the 5xx retry rule or the duplicate would retry forever.
        EffectResponseV1::Http { diagnostic, .. }
            if duplicate_body_proves_conflict
                && (diagnostic.contains("duplicate key")
                    || diagnostic.contains("ALREADY_EXISTS")) =>
        {
            Classified::Conflict
        }
        EffectResponseV1::Http {
            status,
            retry_after,
            diagnostic: _,
        } if status == 429 || (500..=599).contains(&status) => {
            Classified::Retryable { retry_after }
        }
        EffectResponseV1::Http {
            status,
            diagnostic,
            retry_after: _,
        } => Classified::Permanent {
            status: Some(status),
            diagnostic: bounded_diagnostic(diagnostic),
        },
    }
}

fn bounded_diagnostic(value: String) -> String {
    if value.is_empty() {
        return "Graph response contained no diagnostic body".to_owned();
    }
    let digest = hex::encode(Sha256::digest(value.as_bytes()));
    format!(
        "Graph response body omitted: {} bytes, sha256 {digest}",
        value.len()
    )
    .chars()
    .take(MAX_DIAGNOSTIC_BYTES)
    .collect()
}

fn retry_delay(requests_used: u32) -> Duration {
    Duration::from_millis((500u64 << requests_used.min(6)).min(30_000))
}

trait GraphOperationKind {
    fn kind(self) -> GraphObjectKindV1;
}

impl GraphOperationKind for GraphOperationV1 {
    fn kind(self) -> GraphObjectKindV1 {
        match self {
            Self::UpsertEntity | Self::ArchiveEntity => GraphObjectKindV1::Entity,
            Self::UpsertLink | Self::ArchiveLink => GraphObjectKindV1::Link,
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::indexing_slicing)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;
    use crate::blob::{BlobRefV1, StateSnapshot, StateSnapshotV1};
    use crate::graph::artifacts::{
        ArtifactEffectRepository, DesiredObjectInputDispositionV1, DesiredObjectInputV1,
    };
    use crate::graph::effects::{BlobSliceRefV1, GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE};
    use crate::graph::planner::GraphDeliveryPayloadV1;
    use crate::orchestrator::events::{FailureSummary, WorkManifestRef};
    use crate::orchestrator::ids::{EventId, RunId};
    use crate::orchestrator::projection::WorkStatus;
    use crate::orchestrator::work::{ApplyWorkV1, StatePhase, StatePhaseV1, StateVersionV1};
    use tempfile::TempDir;

    #[test]
    fn duplicate_key_bodies_prove_conflict_only_for_create_requests() {
        for (status, diagnostic) in [
            (
                500,
                "ERROR: duplicate key value violates unique constraint \"entity_ids_pkey\"",
            ),
            (500, "ALREADY_EXISTS: entity is present"),
        ] {
            let response = || EffectResponseV1::Http {
                status,
                retry_after: None,
                diagnostic: diagnostic.to_owned(),
            };
            let classified = classify(response(), true);
            assert_eq!(classified, Classified::Conflict, "status {status}");
            assert_eq!(
                classify(response(), false),
                Classified::Retryable { retry_after: None },
                "non-create status {status}"
            );
        }
        assert_eq!(
            classify(
                EffectResponseV1::Http {
                    status: 500,
                    retry_after: None,
                    diagnostic: "internal error".to_owned(),
                },
                true,
            ),
            Classified::Retryable { retry_after: None }
        );
    }

    #[derive(Default)]
    struct ScriptedTransport {
        responses: Mutex<VecDeque<EffectResponseV1>>,
        requests: Mutex<Vec<EffectRequestV1>>,
        actors: Mutex<Vec<String>>,
    }

    impl ScriptedTransport {
        fn with(responses: Vec<EffectResponseV1>) -> Self {
            Self {
                responses: Mutex::new(responses.into()),
                requests: Mutex::new(Vec::new()),
                actors: Mutex::new(Vec::new()),
            }
        }

        async fn requests(&self) -> Vec<EffectRequestV1> {
            self.requests.lock().await.clone()
        }
    }

    #[async_trait]
    impl GraphEffectTransport for ScriptedTransport {
        async fn send(&self, request: EffectRequestV1) -> EffectResponseV1 {
            self.requests.lock().await.push(request);
            self.responses
                .lock()
                .await
                .pop_front()
                .expect("scripted transport response")
        }

        async fn send_as(&self, actor_id: &str, request: EffectRequestV1) -> EffectResponseV1 {
            self.actors.lock().await.push(actor_id.to_owned());
            self.send(request).await
        }
    }

    struct ConcurrentTransport {
        in_flight: AtomicUsize,
        max_seen: AtomicUsize,
        requests: AtomicUsize,
        fail_identity: Option<&'static str>,
    }

    struct BatchTransport {
        batch_response: EffectResponseV1,
        batch_requests: AtomicUsize,
        individual_requests: AtomicUsize,
    }

    struct ParallelBatchTransport {
        in_flight: AtomicUsize,
        max_seen: AtomicUsize,
        batch_requests: AtomicUsize,
        fail_first_batch: bool,
    }

    struct PatchMissBatchTransport {
        batches: AtomicUsize,
        patches: AtomicUsize,
        creates: AtomicUsize,
    }

    impl BatchTransport {
        fn new(batch_response: EffectResponseV1) -> Self {
            Self {
                batch_response,
                batch_requests: AtomicUsize::new(0),
                individual_requests: AtomicUsize::new(0),
            }
        }
    }

    #[async_trait]
    impl GraphEffectTransport for BatchTransport {
        async fn send(&self, _request: EffectRequestV1) -> EffectResponseV1 {
            self.individual_requests.fetch_add(1, Ordering::SeqCst);
            EffectResponseV1::Success
        }

        async fn send_create_batch(&self, _requests: Vec<Value>) -> Option<EffectResponseV1> {
            self.batch_requests.fetch_add(1, Ordering::SeqCst);
            Some(self.batch_response.clone())
        }

        fn max_create_batch_size(&self) -> usize {
            128
        }

        fn max_in_flight(&self) -> usize {
            4
        }
    }

    #[async_trait]
    impl GraphEffectTransport for ParallelBatchTransport {
        async fn send(&self, _request: EffectRequestV1) -> EffectResponseV1 {
            EffectResponseV1::Success
        }

        async fn send_create_batch(&self, requests: Vec<Value>) -> Option<EffectResponseV1> {
            self.batch_requests.fetch_add(1, Ordering::SeqCst);
            let current = self.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_seen.fetch_max(current, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(10)).await;
            self.in_flight.fetch_sub(1, Ordering::SeqCst);
            let first_identity = requests
                .first()
                .and_then(|request| request.get("identity"))
                .and_then(Value::as_str);
            Some(
                if self.fail_first_batch && first_identity == Some("entity:1") {
                    EffectResponseV1::Http {
                        status: 429,
                        retry_after: None,
                        diagnostic: "throttled".to_owned(),
                    }
                } else {
                    EffectResponseV1::Success
                },
            )
        }

        fn max_create_batch_size(&self) -> usize {
            2
        }

        fn max_in_flight(&self) -> usize {
            4
        }
    }

    #[async_trait]
    impl GraphEffectTransport for PatchMissBatchTransport {
        async fn send(&self, request: EffectRequestV1) -> EffectResponseV1 {
            match request {
                EffectRequestV1::Patch(_) => {
                    self.patches.fetch_add(1, Ordering::SeqCst);
                    EffectResponseV1::Http {
                        status: 404,
                        retry_after: None,
                        diagnostic: "not found".to_owned(),
                    }
                }
                EffectRequestV1::Create(_) => {
                    self.creates.fetch_add(1, Ordering::SeqCst);
                    EffectResponseV1::Success
                }
                EffectRequestV1::Archive(_) => panic!("unexpected archive"),
            }
        }

        async fn send_create_batch(&self, _requests: Vec<Value>) -> Option<EffectResponseV1> {
            self.batches.fetch_add(1, Ordering::SeqCst);
            Some(EffectResponseV1::Http {
                status: 409,
                retry_after: None,
                diagnostic: "conflict".to_owned(),
            })
        }

        fn max_create_batch_size(&self) -> usize {
            128
        }

        fn max_in_flight(&self) -> usize {
            4
        }
    }

    impl ConcurrentTransport {
        fn new(fail_identity: Option<&'static str>) -> Self {
            Self {
                in_flight: AtomicUsize::new(0),
                max_seen: AtomicUsize::new(0),
                requests: AtomicUsize::new(0),
                fail_identity,
            }
        }
    }

    #[async_trait]
    impl GraphEffectTransport for ConcurrentTransport {
        async fn send(&self, request: EffectRequestV1) -> EffectResponseV1 {
            self.requests.fetch_add(1, Ordering::SeqCst);
            let current = self.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_seen.fetch_max(current, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(10)).await;
            self.in_flight.fetch_sub(1, Ordering::SeqCst);
            let identity = match request {
                EffectRequestV1::Create(body)
                | EffectRequestV1::Patch(body)
                | EffectRequestV1::Archive(body) => body
                    .get("identity")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
            };
            if identity.as_deref() == self.fail_identity {
                EffectResponseV1::Http {
                    status: 400,
                    retry_after: None,
                    diagnostic: "rejected".to_owned(),
                }
            } else {
                EffectResponseV1::Success
            }
        }

        fn max_in_flight(&self) -> usize {
            4
        }
    }

    #[derive(Default)]
    struct RecordingCommitter {
        cursors: Mutex<Vec<WorkChunkCompletedV1>>,
        fail: AtomicBool,
        block_once: AtomicBool,
        commit_started: tokio::sync::Notify,
        release_commit: tokio::sync::Notify,
    }

    impl RecordingCommitter {
        async fn cursors(&self) -> Vec<WorkChunkCompletedV1> {
            self.cursors.lock().await.clone()
        }
    }

    #[async_trait]
    impl WorkCursorCommitter for RecordingCommitter {
        async fn commit(
            &self,
            _integration_id: &CanonicalIntegrationId,
            cursor: WorkChunkCompletedV1,
        ) -> Result<(), Report<EffectExecutorError>> {
            self.commit_started.notify_waiters();
            if self.block_once.swap(false, Ordering::SeqCst) {
                self.release_commit.notified().await;
            }
            if self.fail.load(Ordering::SeqCst) {
                return Err(Report::new(EffectExecutorError::CursorCommit));
            }
            self.cursors.lock().await.push(cursor);
            Ok(())
        }
    }

    #[derive(Default)]
    struct RecordingDelay {
        waits: Mutex<Vec<Duration>>,
    }

    struct MutablePermit {
        send: AtomicBool,
        cursor: AtomicBool,
    }

    impl MutablePermit {
        fn allowed() -> Self {
            Self {
                send: AtomicBool::new(true),
                cursor: AtomicBool::new(true),
            }
        }
    }

    impl EffectTurnPermit for MutablePermit {
        fn send_allowed(&self) -> bool {
            self.send.load(Ordering::SeqCst)
        }

        fn cursor_allowed(&self) -> bool {
            self.cursor.load(Ordering::SeqCst)
        }
    }

    struct ConflictThenLoseTransport {
        permit: Arc<MutablePermit>,
        requests: Mutex<Vec<EffectRequestV1>>,
    }

    struct DeadlinePermit {
        send: Instant,
        cursor: Instant,
    }

    impl EffectTurnPermit for DeadlinePermit {
        fn send_allowed(&self) -> bool {
            Instant::now() < self.send
        }

        fn cursor_allowed(&self) -> bool {
            Instant::now() < self.cursor
        }

        fn send_deadline(&self) -> Option<Instant> {
            Some(self.send)
        }

        fn cursor_deadline(&self) -> Option<Instant> {
            Some(self.cursor)
        }
    }

    #[derive(Default)]
    struct HangingTransport {
        invoked: AtomicBool,
    }

    #[async_trait]
    impl GraphEffectTransport for HangingTransport {
        async fn send(&self, _request: EffectRequestV1) -> EffectResponseV1 {
            self.invoked.store(true, Ordering::SeqCst);
            std::future::pending().await
        }
    }

    #[async_trait]
    impl GraphEffectTransport for ConflictThenLoseTransport {
        async fn send(&self, request: EffectRequestV1) -> EffectResponseV1 {
            self.requests.lock().await.push(request);
            self.permit.send.store(false, Ordering::SeqCst);
            EffectResponseV1::Http {
                status: 409,
                retry_after: None,
                diagnostic: "conflict".to_owned(),
            }
        }
    }

    #[async_trait]
    impl RetryDelay for RecordingDelay {
        async fn wait(&self, delay: Duration) {
            self.waits.lock().await.push(delay);
        }
    }

    fn digest_id(index: usize) -> EffectId {
        let character = char::from_digit((index % 10) as u32, 10).expect("digit");
        EffectId::parse(character.to_string().repeat(64)).expect("effect ID")
    }

    fn upsert(index: usize) -> PreparedEffectV1 {
        let identity = format!("entity:{index}");
        PreparedEffectV1 {
            effect: GraphEffectV1 {
                effect_id: digest_id(index),
                effect_identity_version: EFFECT_IDENTITY_VERSION,
                effect_encoding_version: EFFECT_ENCODING_VERSION,
                target_state_digest: "a".repeat(64),
                operation: GraphOperationV1::UpsertEntity,
                graph_identity: identity.clone(),
                payload_digest: Some("b".repeat(64)),
                payload: Some(BlobSliceRefV1 {
                    artifact: BlobRef::V1(BlobRefV1 {
                        key: "payload.bin".to_owned(),
                        sha256: "c".repeat(64),
                        size: 1,
                        media_type: GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE.to_owned(),
                        e_tag: None,
                        provider_version: None,
                    }),
                    offset: 0,
                    length: 1,
                }),
            },
            delivery: PreparedDeliveryV1::Upsert {
                create: serde_json::json!({"identity": identity}),
                patch: serde_json::json!({"identity": identity, "archived": false}),
            },
        }
    }

    fn archive(index: usize) -> PreparedEffectV1 {
        let identity = format!("entity:{index}");
        PreparedEffectV1 {
            effect: GraphEffectV1 {
                effect_id: digest_id(index),
                effect_identity_version: EFFECT_IDENTITY_VERSION,
                effect_encoding_version: EFFECT_ENCODING_VERSION,
                target_state_digest: "a".repeat(64),
                operation: GraphOperationV1::ArchiveEntity,
                graph_identity: identity.clone(),
                payload_digest: None,
                payload: None,
            },
            delivery: PreparedDeliveryV1::Archive {
                archive: serde_json::json!({"identity": identity, "archived": true}),
            },
        }
    }

    fn work(effects: Vec<PreparedEffectV1>, completed: u64) -> PreparedWorkV1 {
        let total_effect_count = effects.len() as u64;
        let completed_index = usize::try_from(completed).expect("completed cursor");
        PreparedWorkV1 {
            integration_id: CanonicalIntegrationId::parse("web:connector").expect("integration"),
            owner_actor_id: "actor:owner".to_owned(),
            work_id: WorkId::parse("d".repeat(64)).expect("work"),
            manifest_digest: "e".repeat(64),
            completed_effect_count: completed,
            total_effect_count,
            effects: effects.into_iter().skip(completed_index).collect(),
        }
    }

    fn executor(
        transport: Arc<ScriptedTransport>,
        committer: Arc<RecordingCommitter>,
        delay: Arc<RecordingDelay>,
        lanes: Arc<EffectLaneRegistry>,
    ) -> BoundedEffectExecutor {
        BoundedEffectExecutor::new(transport, committer, delay, lanes)
    }

    #[test]
    fn proven_conflict_hints_are_work_scoped_and_explicitly_purged() {
        let executor = executor(
            Arc::new(ScriptedTransport::default()),
            Arc::new(RecordingCommitter::default()),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        );
        let first_work = WorkId::parse("d".repeat(64)).expect("first work");
        let second_work = WorkId::parse("e".repeat(64)).expect("second work");
        let effect = digest_id(7);

        executor.record_proven_conflict(&first_work, &effect);
        assert!(executor.conflict_proven(&first_work, &effect));
        assert!(!executor.conflict_proven(&second_work, &effect));

        executor.forget_work_conflicts(&first_work);
        assert!(!executor.conflict_proven(&first_work, &effect));
    }

    fn blob(key: &str, digest: char, media_type: &str) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: key.to_owned(),
            sha256: digest.to_string().repeat(64),
            size: 1,
            media_type: media_type.to_owned(),
            e_tag: None,
            provider_version: None,
        })
    }

    #[tokio::test]
    async fn loader_materializes_and_cross_checks_manifest_state_desired_and_effects() {
        let cache = TempDir::new().expect("cache");
        let artifacts = ArtifactStore::in_memory(cache.path()).expect("artifact store");
        let repository = Arc::new(
            ArtifactEffectRepository::new(
                artifacts.clone(),
                "tenants/test/integrations/web-connector",
            )
            .expect("effect repository"),
        );
        let identity = "entity:loader".to_owned();
        let delivery = GraphDeliveryPayload::V1(
            GraphDeliveryPayloadV1::upsert(
                identity.clone(),
                serde_json::json!({"webId": "web"}),
                serde_json::json!({
                    "entityId": identity,
                    "archived": false,
                }),
                serde_json::json!({
                    "entityId": identity,
                    "archived": true,
                }),
            )
            .expect("delivery"),
        )
        .encode()
        .expect("delivery bytes");
        let desired = repository
            .publish_desired_projection(vec![DesiredObjectInputV1 {
                kind: GraphObjectKindV1::Entity,
                graph_identity: identity.clone(),
                disposition: DesiredObjectInputDispositionV1::Live(delivery.clone()),
            }])
            .await
            .expect("publish desired");
        let state = StateVersionV1::new(
            "actor:owner".to_owned(),
            None,
            StatePhase::V1(StatePhaseV1::LinksCommitted),
            StateSnapshot::V1(StateSnapshotV1 {
                generation: 1,
                duckdb: blob("snapshots/store.duckdb", 'a', "application/vnd.duckdb"),
                accepted_batches: vec![],
                created_at: "2026-07-22T12:00:00Z".to_owned(),
            }),
            desired.reference.clone(),
            "b".repeat(64),
            1,
            1,
            1,
            DESIRED_PROJECTION_SCHEMA_VERSION,
        )
        .expect("state");
        let state_artifact = artifacts
            .publish_record(
                &StateVersion::V1(state.clone()),
                MAX_STATE_VERSION_BYTES,
                "records/states",
                "application/vnd.hash.state-version+json",
            )
            .await
            .expect("publish state");
        let state_ref = StateVersionRef {
            id: state.id.clone(),
            artifact: state_artifact,
        };
        let DesiredDispositionV1::Live {
            payload_digest,
            payload,
        } = &desired.objects[0].disposition
        else {
            panic!("live desired")
        };
        let effect = GraphEffectV1::new(
            state.id.as_str().to_owned(),
            GraphOperationV1::UpsertEntity,
            identity.clone(),
            Some(payload_digest.clone()),
            Some(payload.clone()),
        )
        .expect("effect");
        let effect_index = repository
            .publish_effect_index(state.id.as_str(), vec![effect])
            .await
            .expect("publish effects");
        let integration = CanonicalIntegrationId::parse("web:connector").expect("integration ID");
        let kind = WorkKind::Apply(ApplyWorkV1 {
            run_id: RunId::generate(),
            candidate: state_ref,
        });
        let manifest = WorkManifestV1::new(
            &integration,
            "actor:owner".to_owned(),
            kind.clone(),
            effect_index,
            1,
            EFFECT_IDENTITY_VERSION,
            EFFECT_ENCODING_VERSION,
            "2026-07-22T12:00:01Z".to_owned(),
        )
        .expect("manifest");
        let manifest_artifact = artifacts
            .publish_record(
                &WorkManifest::V1(manifest.clone()),
                MAX_WORK_MANIFEST_BYTES,
                "records/manifests",
                "application/vnd.hash.work-manifest+json",
            )
            .await
            .expect("publish manifest");
        let intent = WorkRecoveryIntent {
            integration_id: integration,
            work_id: manifest.work_id.clone(),
            manifest: WorkManifestRef {
                work_id: manifest.work_id.clone(),
                manifest_digest: manifest_artifact.current().sha256.clone(),
                artifact: manifest_artifact,
            },
            kind,
            status: WorkStatus::Planned,
            effect_count: 1,
            completed_effect_count: 0,
            last_completed_effect: None,
            failure: None::<FailureSummary>,
            settings_revision: None,
            revision: EventId::parse("f".repeat(64)).expect("revision"),
        };

        let loaded = ExecutionPlanLoader::new(artifacts, repository)
            .load(&intent, ChunkBudget::new(2).expect("budget"))
            .await
            .expect("load execution plan");
        assert_eq!(loaded.work_id, manifest.work_id);
        assert_eq!(loaded.effects.len(), 1);
        assert!(matches!(
            loaded.effects[0].delivery,
            PreparedDeliveryV1::Upsert { .. }
        ));
    }

    #[tokio::test]
    async fn create_409_patch_consumes_two_requests_and_commits_only_that_prefix() {
        let transport = Arc::new(ScriptedTransport::with(vec![
            EffectResponseV1::Http {
                status: 409,
                retry_after: None,
                diagnostic: "conflict".to_owned(),
            },
            EffectResponseV1::Success,
        ]));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = executor(
            Arc::clone(&transport),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![upsert(1), archive(2)], 0),
            ChunkBudget::new(2).expect("budget"),
        )
        .await
        .expect("turn");

        assert_eq!(
            outcome,
            TurnOutcomeV1::Yielded {
                completed_effect_count: 1,
                requests_used: 2,
                retry_after: None,
            }
        );
        assert!(matches!(
            transport.requests().await.as_slice(),
            [EffectRequestV1::Create(_), EffectRequestV1::Patch(_)]
        ));
        assert_eq!(
            *transport.actors.lock().await,
            vec!["actor:owner".to_owned(), "actor:owner".to_owned()]
        );
        assert_eq!(committer.cursors().await[0].completed_effect_count, 1);
    }

    /// A throttled patch after a proven create-conflict must retry PATCH
    /// first: re-sending the create both wastes a charged request and can
    /// phase-lock with a periodic provider throttle.
    #[tokio::test]
    async fn a_proven_conflict_retries_patch_first_instead_of_recreating() {
        let transport = Arc::new(ScriptedTransport::with(vec![
            EffectResponseV1::Http {
                status: 409,
                retry_after: None,
                diagnostic: "conflict".to_owned(),
            },
            EffectResponseV1::Http {
                status: 429,
                retry_after: Some(Duration::from_millis(1)),
                diagnostic: "throttled".to_owned(),
            },
            EffectResponseV1::Success,
        ]));
        let committer = Arc::new(RecordingCommitter::default());
        executor(
            Arc::clone(&transport),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![upsert(1)], 0),
            ChunkBudget::new(8).expect("budget"),
        )
        .await
        .expect("turn");

        assert!(
            matches!(
                transport.requests().await.as_slice(),
                [
                    EffectRequestV1::Create(_),
                    EffectRequestV1::Patch(_),
                    EffectRequestV1::Patch(_)
                ]
            ),
            "the retry after a throttled patch goes patch-first"
        );
        assert_eq!(committer.cursors().await[0].completed_effect_count, 1);
    }

    #[tokio::test]
    async fn retry_never_starts_when_the_worst_case_upsert_no_longer_fits() {
        let transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Http {
            status: 503,
            retry_after: Some(Duration::from_secs(3)),
            diagnostic: "unavailable".to_owned(),
        }]));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = executor(
            Arc::clone(&transport),
            Arc::clone(&committer),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![upsert(1)], 0),
            ChunkBudget::new(2).expect("budget"),
        )
        .await
        .expect("turn");
        assert_eq!(
            outcome,
            TurnOutcomeV1::Yielded {
                completed_effect_count: 0,
                requests_used: 1,
                retry_after: Some(Duration::from_secs(3)),
            }
        );
        assert_eq!(transport.requests().await.len(), 1);
        assert!(committer.cursors().await.is_empty());
    }

    #[tokio::test]
    async fn graph_429_is_counted_from_the_existing_response_without_a_probe() {
        let telemetry = crate::progress::OperationalTelemetry::default();
        let transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Http {
            status: 429,
            retry_after: Some(Duration::from_secs(3)),
            diagnostic: "secret response body".to_owned(),
        }]));
        executor(
            transport,
            Arc::new(RecordingCommitter::default()),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .with_telemetry(telemetry.clone())
        .execute_turn(
            &work(vec![upsert(1)], 0),
            ChunkBudget::new(2).expect("budget"),
        )
        .await
        .expect("turn");

        let observation = telemetry.snapshot(chrono::Utc::now());
        assert_eq!(observation.integrations.len(), 1);
        assert_eq!(observation.integrations[0].graph_429_total, 1);
        let encoded = serde_json::to_string(&observation).expect("observation");
        assert!(!encoded.contains("secret response body"));
    }

    #[tokio::test]
    async fn transport_failure_yields_with_default_backoff_instead_of_hot_looping() {
        let transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Transport(
            TransportFailureV1::Request,
        )]));
        let outcome = executor(
            transport,
            Arc::new(RecordingCommitter::default()),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![upsert(1)], 0),
            ChunkBudget::new(2).expect("budget"),
        )
        .await
        .expect("turn");
        assert!(matches!(
            outcome,
            TurnOutcomeV1::Yielded {
                completed_effect_count: 0,
                requests_used: 1,
                retry_after: Some(delay),
            } if delay > Duration::ZERO
        ));
    }

    #[tokio::test]
    async fn duplicate_words_in_a_non_409_response_never_trigger_patch() {
        let transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Http {
            status: 400,
            retry_after: None,
            diagnostic: "duplicate conflict 409".to_owned(),
        }]));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = executor(
            Arc::clone(&transport),
            Arc::clone(&committer),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![upsert(1)], 0),
            ChunkBudget::new(2).expect("budget"),
        )
        .await
        .expect("turn");
        assert!(matches!(
            outcome,
            TurnOutcomeV1::PermanentFailure {
                status: Some(400),
                completed_effect_count: 0,
                ..
            }
        ));
        assert_eq!(transport.requests().await.len(), 1);
        assert!(committer.cursors().await.is_empty());
    }

    #[tokio::test]
    async fn retry_consumes_budget_then_converges_through_create_409_patch() {
        let transport = Arc::new(ScriptedTransport::with(vec![
            EffectResponseV1::Http {
                status: 500,
                retry_after: Some(Duration::from_millis(7)),
                diagnostic: "retry".to_owned(),
            },
            EffectResponseV1::Http {
                status: 409,
                retry_after: None,
                diagnostic: "conflict".to_owned(),
            },
            EffectResponseV1::Success,
        ]));
        let committer = Arc::new(RecordingCommitter::default());
        let delay = Arc::new(RecordingDelay::default());
        let outcome = executor(
            Arc::clone(&transport),
            Arc::clone(&committer),
            Arc::clone(&delay),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![upsert(1)], 0),
            ChunkBudget::new(4).expect("budget"),
        )
        .await
        .expect("turn");
        assert_eq!(
            outcome,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 1,
                work_exhausted: true,
                requests_used: 3,
            }
        );
        assert_eq!(*delay.waits.lock().await, vec![Duration::from_millis(7)]);
        assert_eq!(committer.cursors().await.len(), 1);
    }

    #[tokio::test]
    async fn permanent_failure_commits_the_prior_contiguous_prefix_first() {
        let transport = Arc::new(ScriptedTransport::with(vec![
            EffectResponseV1::Success,
            EffectResponseV1::Http {
                status: 400,
                retry_after: None,
                diagnostic: "x".repeat(2_000),
            },
        ]));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = executor(
            transport,
            Arc::clone(&committer),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![archive(1), upsert(2)], 0),
            ChunkBudget::new(3).expect("budget"),
        )
        .await
        .expect("turn");
        let TurnOutcomeV1::PermanentFailure {
            completed_effect_count,
            requests_used,
            status,
            diagnostic,
            ..
        } = outcome
        else {
            panic!("permanent outcome")
        };
        assert_eq!(completed_effect_count, 1);
        assert_eq!(requests_used, 2);
        assert_eq!(status, Some(400));
        assert!(diagnostic.contains("2000 bytes"));
        assert!(diagnostic.contains("sha256"));
        assert!(!diagnostic.contains("xxxxx"));
        assert_eq!(committer.cursors().await[0].completed_effect_count, 1);
    }

    #[tokio::test]
    async fn recovery_resumes_strictly_after_the_durable_exclusive_cursor() {
        let transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Success]));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = executor(
            Arc::clone(&transport),
            Arc::clone(&committer),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![archive(1), archive(2)], 1),
            ChunkBudget::new(2).expect("budget"),
        )
        .await
        .expect("resume");
        assert!(matches!(
            outcome,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 2,
                work_exhausted: true,
                ..
            }
        ));
        let requests = transport.requests().await;
        let [EffectRequestV1::Archive(body)] = requests.as_slice() else {
            panic!("only suffix archive must be sent")
        };
        assert_eq!(body["identity"], "entity:2");
    }

    #[tokio::test]
    async fn replayed_archive_conflict_converges_instead_of_failing_permanently() {
        // At-least-once redelivery: the first delivery archived the object,
        // the process died before the cursor, and the replay's archive now
        // conflicts. Archived is a terminal state, so the conflict is
        // convergence, not failure.
        let transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Http {
            status: 409,
            retry_after: None,
            diagnostic: "already archived".to_owned(),
        }]));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = executor(
            Arc::clone(&transport),
            Arc::clone(&committer),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![archive(1)], 0),
            ChunkBudget::new(2).expect("budget"),
        )
        .await
        .expect("replayed archive converges");
        assert!(matches!(
            outcome,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 1,
                work_exhausted: true,
                requests_used: 1,
            }
        ));
        assert_eq!(committer.cursors().await.len(), 1);
    }

    #[tokio::test]
    async fn failed_cursor_commit_leaves_the_effect_replayable() {
        let first_transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Success]));
        let failing = Arc::new(RecordingCommitter::default());
        failing.fail.store(true, Ordering::SeqCst);
        let work = work(vec![archive(1)], 0);
        let first = executor(
            Arc::clone(&first_transport),
            failing,
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(&work, ChunkBudget::new(2).expect("budget"))
        .await;
        assert!(first.is_err());

        let replay_transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Success]));
        let durable = Arc::new(RecordingCommitter::default());
        executor(
            Arc::clone(&replay_transport),
            Arc::clone(&durable),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(&work, ChunkBudget::new(2).expect("budget"))
        .await
        .expect("replay");
        assert_eq!(first_transport.requests().await.len(), 1);
        assert_eq!(replay_transport.requests().await.len(), 1);
        assert_eq!(durable.cursors().await.len(), 1);
    }

    #[tokio::test]
    async fn ownership_loss_between_create_conflict_and_patch_stops_the_patch() {
        let permit = Arc::new(MutablePermit::allowed());
        let transport = Arc::new(ConflictThenLoseTransport {
            permit: permit.clone(),
            requests: Mutex::new(Vec::new()),
        });
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = BoundedEffectExecutor::new(
            transport.clone(),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_permitted_turn(
            &work(vec![upsert(1)], 0),
            ChunkBudget::new(2).expect("budget"),
            permit.as_ref(),
        )
        .await
        .expect("ownership loss yields cleanly");
        assert!(matches!(
            outcome,
            TurnOutcomeV1::Yielded {
                completed_effect_count: 0,
                requests_used: 1,
                ..
            }
        ));
        assert_eq!(transport.requests.lock().await.len(), 1);
        assert!(committer.cursors().await.is_empty());
    }

    #[tokio::test]
    async fn ownership_loss_before_cursor_keeps_the_local_prefix_replayable() {
        let permit = MutablePermit::allowed();
        permit.cursor.store(false, Ordering::SeqCst);
        let transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Success]));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = executor(
            Arc::clone(&transport),
            Arc::clone(&committer),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_permitted_turn(
            &work(vec![archive(1)], 0),
            ChunkBudget::new(2).expect("budget"),
            &permit,
        )
        .await
        .expect("cursor denial yields cleanly");
        assert!(matches!(
            outcome,
            TurnOutcomeV1::Yielded {
                completed_effect_count: 0,
                requests_used: 1,
                ..
            }
        ));
        assert_eq!(transport.requests().await.len(), 1);
        assert!(committer.cursors().await.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn graph_chunk_deadline_stops_a_hung_request_without_advancing_the_cursor() {
        let now = Instant::now();
        let permit = DeadlinePermit {
            send: now + Duration::from_secs(10),
            cursor: now + Duration::from_secs(20),
        };
        let transport = Arc::new(HangingTransport::default());
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = BoundedEffectExecutor::new(
            transport.clone(),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_permitted_turn(
            &work(vec![archive(1)], 0),
            ChunkBudget::new(2).expect("budget"),
            &permit,
        )
        .await
        .expect("deadline yields instead of hanging");
        assert!(transport.invoked.load(Ordering::SeqCst));
        assert!(matches!(
            outcome,
            TurnOutcomeV1::Yielded {
                completed_effect_count: 0,
                requests_used: 1,
                ..
            }
        ));
        assert!(committer.cursors().await.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn cursor_deadline_returns_unknown_commit_as_replayable_error() {
        let now = Instant::now();
        let permit = DeadlinePermit {
            send: now + Duration::from_secs(10),
            cursor: now + Duration::from_secs(20),
        };
        let transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Success]));
        let committer = Arc::new(RecordingCommitter::default());
        committer.block_once.store(true, Ordering::SeqCst);
        let error = executor(
            transport,
            Arc::clone(&committer),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_permitted_turn(
            &work(vec![archive(1)], 0),
            ChunkBudget::new(2).expect("budget"),
            &permit,
        )
        .await
        .expect_err("cursor deadline is an unknown commit outcome");
        assert_eq!(error.current_context(), &EffectExecutorError::CursorCommit);
        assert_eq!(error.graph_requests_used(), 1);
        assert!(committer.cursors().await.is_empty());
    }

    #[tokio::test]
    async fn lane_is_held_until_the_cursor_commit_returns() {
        let transport = Arc::new(ScriptedTransport::with(vec![
            EffectResponseV1::Success,
            EffectResponseV1::Success,
        ]));
        let committer = Arc::new(RecordingCommitter::default());
        committer.block_once.store(true, Ordering::SeqCst);
        let executor = Arc::new(executor(
            Arc::clone(&transport),
            Arc::clone(&committer),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        ));
        let first_work = work(vec![archive(1)], 0);
        let second_work = work(vec![archive(2)], 0);
        let commit_started = committer.commit_started.notified();
        let first = {
            let executor = Arc::clone(&executor);
            tokio::spawn(async move {
                executor
                    .execute_turn(&first_work, ChunkBudget::new(2).expect("budget"))
                    .await
            })
        };
        commit_started.await;
        let second = {
            let executor = Arc::clone(&executor);
            tokio::spawn(async move {
                executor
                    .execute_turn(&second_work, ChunkBudget::new(2).expect("budget"))
                    .await
            })
        };
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
        assert_eq!(transport.requests().await.len(), 1);
        committer.release_commit.notify_waiters();
        first.await.expect("first join").expect("first turn");
        second.await.expect("second join").expect("second turn");
        assert_eq!(transport.requests().await.len(), 2);
    }

    #[tokio::test]
    async fn independent_effects_overlap_but_commit_one_contiguous_cursor() {
        let transport = Arc::new(ConcurrentTransport::new(None));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = BoundedEffectExecutor::new(
            transport.clone(),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work((1..=6).map(upsert).collect(), 0),
            ChunkBudget::new(12).expect("budget"),
        )
        .await
        .expect("parallel turn");
        assert_eq!(
            outcome,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 6,
                work_exhausted: true,
                requests_used: 6,
            }
        );
        assert!(transport.max_seen.load(Ordering::SeqCst) > 1);
        assert_eq!(committer.cursors().await[0].completed_effect_count, 6);
    }

    #[tokio::test]
    async fn successful_bulk_create_charges_one_actual_graph_request() {
        let transport = Arc::new(BatchTransport::new(EffectResponseV1::Success));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = BoundedEffectExecutor::new(
            transport.clone(),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work((1..=6).map(upsert).collect(), 0),
            ChunkBudget::new(19).expect("batch plus worst-case PATCH-first fallbacks"),
        )
        .await
        .expect("bulk turn");
        assert_eq!(
            outcome,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 6,
                work_exhausted: true,
                requests_used: 1,
            }
        );
        assert_eq!(transport.batch_requests.load(Ordering::SeqCst), 1);
        assert_eq!(transport.individual_requests.load(Ordering::SeqCst), 0);
        assert_eq!(committer.cursors().await[0].completed_effect_count, 6);
    }

    #[tokio::test]
    async fn rejected_bulk_create_falls_back_within_the_reserved_request_budget() {
        let transport = Arc::new(BatchTransport::new(EffectResponseV1::Http {
            status: 409,
            retry_after: None,
            diagnostic: "conflict".to_owned(),
        }));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = BoundedEffectExecutor::new(
            transport.clone(),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![upsert(1), upsert(2), upsert(3)], 0),
            ChunkBudget::new(10).expect("one batch plus worst-case PATCH-first fallbacks"),
        )
        .await
        .expect("fallback turn");
        assert_eq!(
            outcome,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 3,
                work_exhausted: true,
                requests_used: 4,
            }
        );
        assert_eq!(transport.batch_requests.load(Ordering::SeqCst), 1);
        assert_eq!(transport.individual_requests.load(Ordering::SeqCst), 3);
        assert_eq!(committer.cursors().await[0].completed_effect_count, 3);
    }

    #[tokio::test]
    async fn multiple_bulk_waves_overlap_and_commit_one_contiguous_cursor() {
        let transport = Arc::new(ParallelBatchTransport {
            in_flight: AtomicUsize::new(0),
            max_seen: AtomicUsize::new(0),
            batch_requests: AtomicUsize::new(0),
            fail_first_batch: false,
        });
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = BoundedEffectExecutor::new(
            transport.clone(),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work((1..=10).map(upsert).collect(), 0),
            ChunkBudget::new(35).expect("five worst-case two-effect batches"),
        )
        .await
        .expect("parallel bulk turn");

        assert_eq!(
            outcome,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 10,
                work_exhausted: true,
                requests_used: 5,
            }
        );
        assert_eq!(transport.batch_requests.load(Ordering::SeqCst), 5);
        assert_eq!(transport.max_seen.load(Ordering::SeqCst), 4);
        assert_eq!(committer.cursors().await[0].completed_effect_count, 10);
    }

    #[tokio::test]
    async fn a_later_successful_batch_never_advances_past_an_earlier_retry() {
        let transport = Arc::new(ParallelBatchTransport {
            in_flight: AtomicUsize::new(0),
            max_seen: AtomicUsize::new(0),
            batch_requests: AtomicUsize::new(0),
            fail_first_batch: true,
        });
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = BoundedEffectExecutor::new(
            transport.clone(),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work((1..=4).map(upsert).collect(), 0),
            ChunkBudget::new(14).expect("two worst-case two-effect batches"),
        )
        .await
        .expect("parallel bulk turn");

        assert_eq!(
            outcome,
            TurnOutcomeV1::Yielded {
                completed_effect_count: 0,
                requests_used: 2,
                retry_after: None,
            }
        );
        assert!(committer.cursors().await.is_empty());
    }

    #[tokio::test]
    async fn conflicting_batch_uses_patch_first_and_creates_only_patch_misses() {
        let transport = Arc::new(PatchMissBatchTransport {
            batches: AtomicUsize::new(0),
            patches: AtomicUsize::new(0),
            creates: AtomicUsize::new(0),
        });
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = BoundedEffectExecutor::new(
            transport.clone(),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![upsert(1), upsert(2)], 0),
            ChunkBudget::new(7).expect("batch plus worst-case PATCH-first recovery"),
        )
        .await
        .expect("PATCH-first recovery");

        assert_eq!(
            outcome,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 2,
                work_exhausted: true,
                requests_used: 5,
            }
        );
        assert_eq!(transport.batches.load(Ordering::SeqCst), 1);
        assert_eq!(transport.patches.load(Ordering::SeqCst), 2);
        assert_eq!(transport.creates.load(Ordering::SeqCst), 2);
        assert_eq!(committer.cursors().await[0].completed_effect_count, 2);
    }

    #[tokio::test]
    async fn parallel_turn_never_crosses_an_effect_dependency_class() {
        let transport = Arc::new(ConcurrentTransport::new(None));
        let committer = Arc::new(RecordingCommitter::default());
        let mut link = upsert(3);
        link.effect.operation = GraphOperationV1::UpsertLink;
        let executor = BoundedEffectExecutor::new(
            transport.clone(),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        );
        let first = executor
            .execute_turn(
                &work(vec![upsert(1), upsert(2), link.clone()], 0),
                ChunkBudget::new(6).expect("budget"),
            )
            .await
            .expect("entity turn");
        assert!(matches!(
            first,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 2,
                work_exhausted: false,
                requests_used: 2,
            }
        ));
        assert_eq!(transport.requests.load(Ordering::SeqCst), 2);

        let remaining = work(vec![upsert(1), upsert(2), link], 2);
        let second = executor
            .execute_turn(&remaining, ChunkBudget::new(6).expect("budget"))
            .await
            .expect("link turn");
        assert_eq!(
            second,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 3,
                work_exhausted: true,
                requests_used: 1,
            }
        );
    }

    #[tokio::test]
    async fn parallel_failure_commits_only_the_acknowledged_prefix() {
        let transport = Arc::new(ConcurrentTransport::new(Some("entity:2")));
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = BoundedEffectExecutor::new(
            transport.clone(),
            committer.clone(),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(
            &work(vec![upsert(1), upsert(2), upsert(3)], 0),
            ChunkBudget::new(6).expect("budget"),
        )
        .await
        .expect("bounded permanent failure");
        assert!(matches!(
            outcome,
            TurnOutcomeV1::PermanentFailure {
                completed_effect_count: 1,
                requests_used: 3,
                status: Some(400),
                ..
            }
        ));
        assert_eq!(transport.requests.load(Ordering::SeqCst), 3);
        assert_eq!(committer.cursors().await[0].completed_effect_count, 1);
    }

    #[tokio::test]
    async fn empty_work_completes_the_turn_without_inventing_a_cursor() {
        let transport = Arc::new(ScriptedTransport::default());
        let committer = Arc::new(RecordingCommitter::default());
        let outcome = executor(
            Arc::clone(&transport),
            Arc::clone(&committer),
            Arc::new(RecordingDelay::default()),
            Arc::new(EffectLaneRegistry::default()),
        )
        .execute_turn(&work(vec![], 0), ChunkBudget::new(2).expect("budget"))
        .await
        .expect("empty turn");
        assert_eq!(
            outcome,
            TurnOutcomeV1::Progressed {
                completed_effect_count: 0,
                work_exhausted: true,
                requests_used: 0,
            }
        );
        assert!(transport.requests().await.is_empty());
        assert!(committer.cursors().await.is_empty());
    }

    #[test]
    fn chunk_budget_rejects_the_one_request_livelock_configuration() {
        assert!(ChunkBudget::new(0).is_err());
        assert!(ChunkBudget::new(1).is_err());
        assert!(ChunkBudget::new(2).is_ok());
    }
}
