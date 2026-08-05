//! Durable object-store transport for control commands.
//!
//! Request objects are immutable discovery hints. Only the fenced shard
//! journal outcome is authoritative; result objects are rebuildable caches.

use std::fmt;
use std::num::NonZeroUsize;
use std::sync::Arc;

use error_stack::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};

use super::baseline::ensure_control_baseline;
use super::control::{
    CancelRunV1, ControlCommandV1, ControlRequest, ControlRequestTargetV1, ControlRequestV1,
};
use super::events::{
    control_outcome_event_id, ControlRejectionReason, ControlRequestRejectedV1,
    IntegrationDesiredStateSetV1, JournalEvent, JournalEventV1, JournalRecordV1, RetryRequestedV1,
    RunTerminatedV1, TerminalOutcome,
};
use super::ids::{EventId, RequestId, TenantNamespace};
use super::projection::{
    ControlRequestOutcomeKindV1, ControlRequestOutcomeV1, InvalidTransition, MaintenanceStatus,
    Projection, WorkStatus,
};
use super::record_io::{self, InspectedRecord};
use super::registry::{
    reject_unknown_fields, CompatError, DurabilityClass, DurableRecord, MigrationPolicy,
    RebuildableRecord, RecordDeclaration,
};
use super::routing::{self, Keyspace, Shard};
use super::shard_log::{
    ControlRequestSnapshot, ShardCommandError, ShardCommandErrorKind, ShardCommandHandle,
};
use super::submission::ensure_known_shard_marker;
use super::submission::{admitted_run_record, delete_ready_receipt, exact_admitted_ready_receipt};
use super::work::WorkKind;
use crate::blob::{ArtifactStore, BoundedCasDocument, CasWrite};

const MAX_CONTROL_RESULT_BYTES: usize = 16 * 1024;
const MAX_DEFINITION_BYTES: usize = 4 * 1024 * 1024;
const MAX_RESULT_CAS_ATTEMPTS: usize = 8;

pub(crate) static CONTROL_REQUEST_RESULT_DECLARATION: RecordDeclaration = RecordDeclaration {
    name: "control_request_result",
    owning_module: "orchestrator::inbox",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[],
    durability: DurabilityClass::Derived,
    migration: MigrationPolicy::Rebuild,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub(crate) enum ControlRequestResult {
    V1(ControlRequestResultV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ControlRequestResultV1 {
    pub request_id: RequestId,
    pub outcome: ControlRequestResultOutcomeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub(crate) enum ControlRequestResultOutcomeV1 {
    Accepted {
        promoted_event_id: EventId,
    },
    Rejected {
        reason_code: ControlRejectionReason,
        expected_revision: Option<EventId>,
        observed_revision: Option<EventId>,
    },
}

impl ControlRequestResultV1 {
    fn from_projection(request_id: RequestId, outcome: &ControlRequestOutcomeV1) -> Self {
        let outcome = match &outcome.outcome {
            ControlRequestOutcomeKindV1::Accepted { promoted_event_id } => {
                ControlRequestResultOutcomeV1::Accepted {
                    promoted_event_id: promoted_event_id.clone(),
                }
            }
            ControlRequestOutcomeKindV1::Rejected {
                reason_code,
                expected_revision,
                observed_revision,
            } => ControlRequestResultOutcomeV1::Rejected {
                reason_code: *reason_code,
                expected_revision: expected_revision.clone(),
                observed_revision: observed_revision.clone(),
            },
        };
        Self {
            request_id,
            outcome,
        }
    }
}

impl ControlRequestResult {
    fn current(&self) -> &ControlRequestResultV1 {
        match self {
            Self::V1(result) => result,
        }
    }
}

impl super::registry::sealed::Sealed for ControlRequestResult {}

impl DurableRecord for ControlRequestResult {
    fn declaration() -> &'static RecordDeclaration {
        &CONTROL_REQUEST_RESULT_DECLARATION
    }
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::Rebuild;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_result(self.current())?;
        serde_json::to_vec(self).map_err(|error| malformed_result(error.to_string()))
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        if bytes.len() > MAX_CONTROL_RESULT_BYTES {
            return Err(malformed_result(format!(
                "record is {} bytes; maximum is {MAX_CONTROL_RESULT_BYTES}",
                bytes.len()
            )));
        }
        let value: Value =
            serde_json::from_slice(bytes).map_err(|error| malformed_result(error.to_string()))?;
        reject_unknown_fields(Self::declaration().name, "", &value, &["version", "data"])?;
        if value.get("version").and_then(Value::as_str) != Some("v1") {
            return Err(CompatError::UnsupportedVersion {
                name: Self::declaration().name,
                version: value
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>")
                    .to_owned(),
            });
        }
        let result: Self =
            serde_json::from_value(value).map_err(|error| malformed_result(error.to_string()))?;
        validate_result(result.current())?;
        Ok(result)
    }
}

impl RebuildableRecord for ControlRequestResult {}

fn validate_result(result: &ControlRequestResultV1) -> Result<(), CompatError> {
    match &result.outcome {
        ControlRequestResultOutcomeV1::Accepted { promoted_event_id } => {
            let expected = control_outcome_event_id(&result.request_id);
            if promoted_event_id != &expected {
                return Err(CompatError::Conflict {
                    name: ControlRequestResult::declaration().name,
                    message: format!(
                        "promoted event ID mismatch: expected {expected}, found {promoted_event_id}"
                    ),
                });
            }
        }
        ControlRequestResultOutcomeV1::Rejected {
            reason_code,
            expected_revision,
            observed_revision,
        } => {
            if *reason_code == ControlRejectionReason::StaleRevision {
                if observed_revision == expected_revision {
                    return Err(malformed_result(
                        "stale rejection requires a distinct observed revision".to_owned(),
                    ));
                }
            } else if observed_revision.is_some() {
                return Err(malformed_result(
                    "only stale-revision results may carry observed_revision".to_owned(),
                ));
            }
        }
    }
    Ok(())
}

fn malformed_result(message: String) -> CompatError {
    CompatError::Malformed {
        name: ControlRequestResult::declaration().name,
        message,
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct InboxCursor {
    after: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DiscoveredControlRequest {
    pub(crate) key: String,
    pub(crate) request: ControlRequestV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CachePublication {
    Created,
    VerifiedExisting,
    Rebuilt,
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProcessedControlRequest {
    pub(crate) request_id: RequestId,
    pub(crate) outcome: ControlRequestOutcomeV1,
    pub(crate) cache: CachePublication,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InboxError {
    List,
    NonCanonicalRequest,
    DeleteResolvedRequest,
    AdmissionChanged,
    AdmissionStorage,
    DefinitionRead,
    InvalidRequestIdentity,
    Baseline,
    KnownShard,
    RequestCreate,
    RequestConflict,
    RequestRead,
    RequestDecode,
    RequestDisappeared,
    RequestTooLarge,
    ResultCreate,
    ResultRead,
    ResultTooLarge,
    ResultRepair,
    ShardCommand,
}

type InboxResult<T> = Result<T, Report<InboxError>>;

impl fmt::Display for InboxError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::List => "failed to list the control inbox",
            Self::NonCanonicalRequest => "control request path or routing is noncanonical",
            Self::DeleteResolvedRequest => "failed to delete a durably resolved control request",
            Self::AdmissionChanged => "admitted run changed during cancellation promotion",
            Self::AdmissionStorage => "failed to resolve cancellation admission storage",
            Self::DefinitionRead => "failed to read the immutable integration definition",
            Self::InvalidRequestIdentity => "control request identity is invalid",
            Self::Baseline => "control baseline validation failed",
            Self::KnownShard => "known-shard validation failed",
            Self::RequestCreate => "failed to create the immutable control request",
            Self::RequestConflict => "immutable control request conflicts with existing bytes",
            Self::RequestRead => "failed to read the immutable control request",
            Self::RequestDecode => "failed to decode the immutable control request",
            Self::RequestDisappeared => "control request disappeared during discovery",
            Self::RequestTooLarge => "control request exceeds its size limit",
            Self::ResultCreate => "failed to create the derived control result",
            Self::ResultRead => "failed to read the existing control result",
            Self::ResultTooLarge => "control result exceeds its size limit",
            Self::ResultRepair => "failed to rebuild the derived control result",
            Self::ShardCommand => "serialized shard control command failed",
        })
    }
}

impl std::error::Error for InboxError {}

pub(crate) trait AuthorizeControl: Send + Sync {
    fn authorize(&self, request: &ControlRequestV1) -> bool;
}

impl<F> AuthorizeControl for F
where
    F: Fn(&ControlRequestV1) -> bool + Send + Sync,
{
    fn authorize(&self, request: &ControlRequestV1) -> bool {
        self(request)
    }
}

pub(crate) struct ControlInbox {
    store: ArtifactStore,
    tenant: TenantNamespace,
    shard: Shard,
    command: ShardCommandHandle,
    authorize: Arc<dyn AuthorizeControl>,
    batch_size: NonZeroUsize,
    cursor: InboxCursor,
}

impl ControlInbox {
    pub(crate) fn new(
        store: ArtifactStore,
        tenant: TenantNamespace,
        shard: Shard,
        command: ShardCommandHandle,
        authorize: Arc<dyn AuthorizeControl>,
        batch_size: NonZeroUsize,
    ) -> Self {
        Self {
            store,
            tenant,
            shard,
            command,
            authorize,
            batch_size,
            cursor: InboxCursor::default(),
        }
    }

    pub(crate) async fn discover_batch(&mut self) -> InboxResult<Vec<DiscoveredControlRequest>> {
        let paths = Keyspace::for_tenant(&self.tenant);
        let prefix = paths.requests(self.shard);
        let mut keys = self
            .store
            .list(&prefix)
            .await
            .change_context(InboxError::List)?
            .into_iter()
            .filter_map(|object| match parse_request_key(&paths, self.shard, &object.key) {
                Some(request_id) => Some((object.key, request_id)),
                None => {
                    tracing::warn!(key = %object.key, "ignoring non-canonical object under control inbox prefix");
                    None
                }
            })
            .collect::<Vec<_>>();
        keys.sort_by(|left, right| left.0.cmp(&right.0));
        let selected = wrapping_batch(&keys, self.cursor.after.as_deref(), self.batch_size.get());
        if let Some((last, _request_id)) = selected.last() {
            self.cursor.after = Some(last.clone());
        }

        let mut discovered = Vec::with_capacity(selected.len());
        for (key, path_request_id) in selected {
            let request = read_request(&self.store, key).await?;
            if request.tenant != self.tenant
                || routing::shard(&request.integration_id) != self.shard
                || request.request_id != *path_request_id
            {
                return Err(Report::new(InboxError::NonCanonicalRequest)
                    .attach_printable(format!("offending object key: {key:?}")));
            }
            discovered.push(DiscoveredControlRequest {
                key: key.clone(),
                request,
            });
        }
        Ok(discovered)
    }

    /// Processes at most one bounded discovery batch. Returning between calls
    /// gives already-committed recovery and delivery work an explicit chance
    /// to run; an inbox flood cannot monopolize the shard owner.
    pub(crate) async fn process_batch(&mut self) -> InboxResult<Vec<ProcessedControlRequest>> {
        let discovered = self.discover_batch().await?;
        let mut processed = Vec::with_capacity(discovered.len());
        for request in discovered {
            processed.push(self.process_one(request).await?);
        }
        tokio::task::yield_now().await;
        Ok(processed)
    }

    pub(crate) async fn process_one(
        &self,
        discovered: DiscoveredControlRequest,
    ) -> InboxResult<ProcessedControlRequest> {
        let request = discovered.request;
        let expected_key =
            Keyspace::for_tenant(&self.tenant).request(self.shard, &request.request_id);
        if discovered.key != expected_key {
            return Err(Report::new(InboxError::NonCanonicalRequest)
                .attach_printable(format!("offending object key: {:?}", discovered.key)));
        }

        // Normative recovery order: durable outcome lookup comes before
        // authorization, artifact validation, target validation, or admission
        // promotion. A post-append restart must recover success, not invent a
        // stale-revision rejection against success's new revision.
        let snapshot = self
            .command
            .inspect_control(request.clone())
            .await
            .change_context(InboxError::ShardCommand)?;
        let outcome = if let Some(outcome) = snapshot.outcome {
            outcome
        } else {
            self.resolve_new_request(&request, snapshot).await?
        };

        if let ControlCommandV1::CancelRun(CancelRunV1 { run_id, .. }) = &request.command {
            if matches!(
                outcome.outcome,
                ControlRequestOutcomeKindV1::Accepted { .. }
            ) {
                let terminal = std::iter::once(run_id.clone()).collect();
                if let Err(error) = super::submission::retire_admission_for_terminal_runs(
                    &self.store,
                    &self.tenant,
                    &request.integration_id,
                    &terminal,
                )
                .await
                {
                    tracing::warn!(
                        run_id = %run_id,
                        error = ?error,
                        "admission retirement after accepted cancellation failed; the startup sweep will repair it"
                    );
                }
            }
        }
        let cache = self.publish_result(&request.request_id, &outcome).await;
        self.store
            .delete_control(&discovered.key)
            .await
            .change_context(InboxError::DeleteResolvedRequest)?;
        Ok(ProcessedControlRequest {
            request_id: request.request_id,
            outcome,
            cache,
        })
    }

    async fn resolve_new_request(
        &self,
        request: &ControlRequestV1,
        snapshot: ControlRequestSnapshot,
    ) -> InboxResult<ControlRequestOutcomeV1> {
        let mut preflight_rejection =
            (!self.authorize.authorize(request)).then_some(ControlRejectionReason::Unauthorized);
        if preflight_rejection.is_none() {
            preflight_rejection = self.validate_definition(request).await?;
        }

        if preflight_rejection.is_none() && !snapshot.target_exists {
            if let ControlCommandV1::CancelRun(CancelRunV1 { run_id, .. }) = &request.command {
                if let Some(receipt) = exact_admitted_ready_receipt(
                    &self.store,
                    &self.tenant,
                    &request.integration_id,
                    run_id,
                )
                .await
                .change_context(InboxError::AdmissionStorage)?
                {
                    let record = admitted_run_record(&self.store, &self.tenant, &receipt)
                        .await
                        .change_context(InboxError::AdmissionStorage)?
                        .ok_or_else(|| Report::new(InboxError::AdmissionChanged))?;
                    self.command
                        .propose(record)
                        .await
                        .change_context(InboxError::ShardCommand)?;
                    if let Err(error) = delete_ready_receipt(
                        &self.store,
                        &self.tenant,
                        receipt.shard,
                        &receipt.receipt.run_id,
                    )
                    .await
                    {
                        tracing::warn!(
                            run_id = %receipt.receipt.run_id,
                            error = ?error,
                            "ready receipt deletion failed after durable cancellation promotion"
                        );
                    }
                }
            }
        }

        self.command
            .resolve_control(request.clone(), preflight_rejection)
            .await
            .map(|resolution| resolution.outcome)
            .change_context(InboxError::ShardCommand)
    }

    async fn validate_definition(
        &self,
        request: &ControlRequestV1,
    ) -> InboxResult<Option<ControlRejectionReason>> {
        let ControlCommandV1::SetIntegrationDesiredState(command) = &request.command else {
            return Ok(None);
        };
        let reference = command.definition_ref.current();
        if reference.size > MAX_DEFINITION_BYTES as u64 {
            return Ok(Some(ControlRejectionReason::Malformed));
        }
        let bytes = match self
            .store
            .get_cas_document_bounded(&reference.key, MAX_DEFINITION_BYTES)
            .await
            .change_context(InboxError::DefinitionRead)?
        {
            BoundedCasDocument::Missing | BoundedCasDocument::TooLarge { .. } => {
                return Ok(Some(ControlRejectionReason::Malformed));
            }
            BoundedCasDocument::Present(bytes, _version) => bytes,
        };
        if bytes.len() as u64 != reference.size
            || hex::encode(Sha256::digest(&bytes)) != reference.sha256
        {
            return Ok(Some(ControlRejectionReason::Malformed));
        }
        let Ok(definition) = serde_json::from_slice::<Value>(&bytes) else {
            return Ok(Some(ControlRejectionReason::Malformed));
        };
        let Some(definition) = normalize_definition(definition) else {
            return Ok(Some(ControlRejectionReason::Malformed));
        };
        if definition
            .pointer("/connector/mode")
            .and_then(Value::as_str)
            .is_some_and(crate::connectors::is_stream_mode)
        {
            tracing::warn!(
                integration_id = %request.integration_id,
                "continuous stream definition rejected because protocol v1 accepts batch integrations only"
            );
            return Ok(Some(ControlRejectionReason::Malformed));
        }
        if super::metadata::reject_inline_secrets(&definition).is_err() {
            return Ok(Some(ControlRejectionReason::Malformed));
        }
        Ok(None)
    }

    async fn publish_result(
        &self,
        request_id: &RequestId,
        outcome: &ControlRequestOutcomeV1,
    ) -> CachePublication {
        let expected = ControlRequestResult::V1(ControlRequestResultV1::from_projection(
            request_id.clone(),
            outcome,
        ));
        match publish_result(&self.store, &self.tenant, self.shard, &expected).await {
            Ok(status) => status,
            Err(error) => {
                tracing::warn!(
                    request_id = %request_id,
                    error = %error,
                    "best-effort control result cache publication failed"
                );
                CachePublication::Failed(error.to_string())
            }
        }
    }
}

fn normalize_definition(definition: Value) -> Option<Value> {
    match definition {
        Value::Object(_) => Some(definition),
        Value::String(text) => serde_yaml::from_str::<Value>(&text)
            .ok()
            .filter(Value::is_object),
        _ => None,
    }
}

/// Publishes the immutable API-side request after validating the tenant
/// baseline and routing marker. A lost acknowledgement adopts only the same
/// validated request bytes; a conflicting object is never overwritten.
pub(crate) async fn publish_control_request(
    store: &ArtifactStore,
    request: &ControlRequestV1,
) -> InboxResult<String> {
    request
        .verify_identity()
        .change_context(InboxError::InvalidRequestIdentity)?;
    ensure_control_baseline(store, &request.tenant)
        .await
        .change_context(InboxError::Baseline)?;
    let routed = routing::route(&request.integration_id);
    let paths = Keyspace::for_tenant(&request.tenant);
    ensure_known_shard_marker(store, &paths, routed.shard)
        .await
        .change_context(InboxError::KnownShard)?;
    let key = paths.request(routed.shard, &request.request_id);
    let expected = ControlRequest::V1(request.clone());
    match record_io::create(store, &key, &expected)
        .await
        .change_context(InboxError::RequestCreate)?
    {
        CasWrite::Written(_) => {}
        CasWrite::Conflict => {
            let actual = read_request(store, &key).await?;
            if actual != *request {
                return Err(Report::new(InboxError::RequestConflict)
                    .attach_printable(format!("offending object key: {key:?}")));
            }
        }
    }
    Ok(key)
}

fn wrapping_batch<'a>(
    sorted: &'a [(String, RequestId)],
    after: Option<&str>,
    limit: usize,
) -> Vec<&'a (String, RequestId)> {
    if sorted.is_empty() || limit == 0 {
        return Vec::new();
    }
    let start = after
        .and_then(|cursor| sorted.iter().position(|(key, _id)| key.as_str() > cursor))
        .unwrap_or(0);
    sorted.iter().skip(start).take(limit).collect()
}

fn parse_request_key(paths: &Keyspace, shard: Shard, key: &str) -> Option<RequestId> {
    let relative = key.strip_prefix(&format!("{}/", paths.requests(shard)))?;
    if relative.contains('/') {
        return None;
    }
    RequestId::parse(relative.strip_suffix(".json")?).ok()
}

async fn read_request(store: &ArtifactStore, key: &str) -> InboxResult<ControlRequestV1> {
    match record_io::inspect::<ControlRequest>(store, key, 64 * 1024)
        .await
        .change_context(InboxError::RequestRead)?
    {
        InspectedRecord::Present(record, _version) => record
            .into_current()
            .change_context(InboxError::RequestDecode),
        InspectedRecord::Malformed(error, _version) => {
            Err(Report::new(error).change_context(InboxError::RequestDecode))
        }
        InspectedRecord::Missing => Err(Report::new(InboxError::RequestDisappeared)),
        InspectedRecord::TooLarge {
            actual_bytes,
            maximum_bytes,
        } => Err(Report::new(InboxError::RequestTooLarge)
            .attach_printable(format!("actual bytes: {actual_bytes}"))
            .attach_printable(format!("maximum bytes: {maximum_bytes}"))),
    }
}

async fn publish_result(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    shard: Shard,
    expected: &ControlRequestResult,
) -> InboxResult<CachePublication> {
    let request_id = &expected.current().request_id;
    let key = Keyspace::for_tenant(tenant).request_result(shard, request_id);
    for _attempt in 0..MAX_RESULT_CAS_ATTEMPTS {
        match record_io::create(store, &key, expected)
            .await
            .change_context(InboxError::ResultCreate)?
        {
            CasWrite::Written(_) => return Ok(CachePublication::Created),
            CasWrite::Conflict => {}
        }
        let version =
            match record_io::inspect::<ControlRequestResult>(store, &key, MAX_CONTROL_RESULT_BYTES)
                .await
                .change_context(InboxError::ResultRead)?
            {
                InspectedRecord::Present(actual, _version) if actual == *expected => {
                    return Ok(CachePublication::VerifiedExisting);
                }
                InspectedRecord::Present(_, version) | InspectedRecord::Malformed(_, version) => {
                    version
                }
                InspectedRecord::Missing => continue,
                InspectedRecord::TooLarge {
                    actual_bytes,
                    maximum_bytes,
                } => {
                    return Err(Report::new(InboxError::ResultTooLarge)
                        .attach_printable(format!("actual bytes: {actual_bytes}"))
                        .attach_printable(format!("maximum bytes: {maximum_bytes}")));
                }
            };
        // This object is only a cache. The journal projection supplied
        // `expected`, so disagreement or an obsolete/invalid wire version is
        // repaired by CAS; no existing bytes are ever adopted as authority.
        match record_io::compare_and_swap(store, &key, &version, expected)
            .await
            .change_context(InboxError::ResultRepair)?
        {
            CasWrite::Written(_) => return Ok(CachePublication::Rebuilt),
            CasWrite::Conflict => {}
        }
    }
    Err(Report::new(InboxError::ResultRepair)
        .attach_printable(format!("request ID: {request_id}"))
        .attach_printable("CAS retry budget exhausted"))
}

pub(crate) fn inspect_projection(
    projection: &Projection,
    request: &ControlRequestV1,
) -> Result<ControlRequestSnapshot, ShardCommandError> {
    request
        .verify_identity()
        .map_err(|error| ShardCommandError {
            kind: ShardCommandErrorKind::InvalidCandidate,
            message: format!("invalid control request identity: {error}"),
        })?;
    let digest = request.digest().map_err(|error| ShardCommandError {
        kind: ShardCommandErrorKind::Recovery,
        message: format!("compute control request digest: {error}"),
    })?;
    let outcome = projection
        .control_request_outcomes
        .get(&request.request_id)
        .cloned();
    if outcome
        .as_ref()
        .is_some_and(|existing| existing.request_digest != digest)
    {
        return Err(ShardCommandError {
            kind: ShardCommandErrorKind::Recovery,
            message: format!(
                "control request {} conflicts with its durable outcome digest",
                request.request_id
            ),
        });
    }
    Ok(ControlRequestSnapshot {
        outcome,
        target_exists: target_exists(projection, request),
    })
}

/// Constructs the accepted event solely from immutable request bytes. Current
/// projection state selects accepted vs rejected and supplies rejection audit
/// evidence, but never changes an accepted event body.
pub(crate) fn promote_control_request(
    projection: &Projection,
    request: &ControlRequestV1,
    preflight_rejection: Option<ControlRejectionReason>,
) -> Result<JournalRecordV1, InvalidTransition> {
    let event_id = control_outcome_event_id(&request.request_id);
    let invalid = |reason: String| InvalidTransition {
        event_id: event_id.clone(),
        reason,
    };
    if projection
        .control_request_outcomes
        .contains_key(&request.request_id)
    {
        return Err(invalid("control request already has an outcome".to_owned()));
    }
    if preflight_rejection.is_some_and(|reason| {
        !matches!(
            reason,
            ControlRejectionReason::Unauthorized | ControlRejectionReason::Malformed
        )
    }) {
        return Err(invalid(
            "preflight may only reject unauthorized or malformed immutable input".to_owned(),
        ));
    }
    let context = request
        .context()
        .map_err(|error| invalid(error.to_string()))?;
    let target = request.target();
    let event = if let Some(reason) = preflight_rejection {
        rejected(context, target, reason, None)
    } else if !target_exists(projection, request)
        && !matches!(
            request.command,
            ControlCommandV1::SetIntegrationDesiredState(_)
        )
    {
        rejected(context, target, ControlRejectionReason::NotFound, None)
    } else {
        let observed = observed_revision(projection, request);
        if observed.as_ref() != request.expected_revision() {
            rejected(
                context,
                target,
                ControlRejectionReason::StaleRevision,
                observed,
            )
        } else if !semantically_eligible(projection, request) {
            rejected(context, target, ControlRejectionReason::Conflict, None)
        } else {
            accepted_event(request, context)
        }
    };
    JournalRecordV1::new(request.integration_id.clone(), JournalEvent::V1(event))
        .map_err(|error| invalid(error.to_string()))
}

fn rejected(
    request: super::control::ControlRequestContextV1,
    target: ControlRequestTargetV1,
    reason_code: ControlRejectionReason,
    observed_revision: Option<EventId>,
) -> JournalEventV1 {
    JournalEventV1::ControlRequestRejected(ControlRequestRejectedV1 {
        request,
        target,
        reason_code,
        observed_revision,
    })
}

fn accepted_event(
    request: &ControlRequestV1,
    context: super::control::ControlRequestContextV1,
) -> JournalEventV1 {
    match &request.command {
        ControlCommandV1::CancelRun(command) => JournalEventV1::RunTerminated(RunTerminatedV1 {
            run_id: command.run_id.clone(),
            outcome: TerminalOutcome::Cancelled,
            failed_work: command.expected_failed_work.clone(),
            failure: None,
            request: Some(context),
        }),
        ControlCommandV1::RetryWork(command) => JournalEventV1::RetryRequested(RetryRequestedV1 {
            work_id: command.work_id.clone(),
            settings_revision: command.settings_revision,
            request: context,
        }),
        ControlCommandV1::SetIntegrationDesiredState(command) => {
            JournalEventV1::IntegrationDesiredStateSet(IntegrationDesiredStateSetV1 {
                integration_id: request.integration_id.clone(),
                desired: command.desired,
                definition_ref: command.definition_ref.clone(),
                actor: request.actor.clone(),
                request: context,
            })
        }
    }
}

fn target_exists(projection: &Projection, request: &ControlRequestV1) -> bool {
    match &request.command {
        ControlCommandV1::CancelRun(command) => projection
            .runs
            .get(&command.run_id)
            .is_some_and(|run| run.integration_id == request.integration_id),
        ControlCommandV1::RetryWork(command) => projection
            .work
            .get(&command.work_id)
            .is_some_and(|work| work.integration_id == request.integration_id),
        ControlCommandV1::SetIntegrationDesiredState(_) => true,
    }
}

fn observed_revision(projection: &Projection, request: &ControlRequestV1) -> Option<EventId> {
    match &request.command {
        ControlCommandV1::CancelRun(command) => projection
            .runs
            .get(&command.run_id)
            .filter(|run| run.integration_id == request.integration_id)
            .map(|run| run.revision.clone()),
        ControlCommandV1::RetryWork(command) => projection
            .work
            .get(&command.work_id)
            .filter(|work| work.integration_id == request.integration_id)
            .map(|work| work.revision.clone()),
        ControlCommandV1::SetIntegrationDesiredState(_) => projection
            .integrations
            .get(&request.integration_id)
            .and_then(|integration| integration.desired_revision.clone()),
    }
}

fn semantically_eligible(projection: &Projection, request: &ControlRequestV1) -> bool {
    match &request.command {
        ControlCommandV1::CancelRun(command) => {
            let Some(run) = projection.runs.get(&command.run_id) else {
                return false;
            };
            if run.integration_id != request.integration_id || run.status.is_terminal() {
                return false;
            }
            let Some(integration) = projection.integrations.get(&request.integration_id) else {
                return false;
            };
            let occupies_slot = integration.active_run.as_ref() == Some(&command.run_id)
                || integration.queued_run.as_ref() == Some(&command.run_id);
            occupies_slot
                && live_apply_for_run(projection, request, &command.run_id)
                    == command.expected_failed_work
        }
        ControlCommandV1::RetryWork(command) => {
            let Some(work) = projection.work.get(&command.work_id) else {
                return false;
            };
            if work.integration_id != request.integration_id || work.status != WorkStatus::Blocked {
                return false;
            }
            if matches!(work.kind, WorkKind::Restore(_)) {
                let Some(integration) = projection.integrations.get(&request.integration_id) else {
                    return false;
                };
                integration.foreground_work.as_ref() == Some(&command.work_id)
                    && integration.maintenance == MaintenanceStatus::Blocked
            } else {
                true
            }
        }
        ControlCommandV1::SetIntegrationDesiredState(_) => true,
    }
}

fn live_apply_for_run(
    projection: &Projection,
    request: &ControlRequestV1,
    run_id: &super::ids::RunId,
) -> Option<super::ids::WorkId> {
    let integration = projection.integrations.get(&request.integration_id)?;
    let work_id = integration.foreground_work.as_ref()?;
    let work = projection.work.get(work_id)?;
    match &work.kind {
        WorkKind::Apply(apply) if &apply.run_id == run_id && work.status.is_live() => {
            Some(work_id.clone())
        }
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::orchestrator::ids::{CanonicalIntegrationId, RequestDigest};

    #[test]
    fn definition_normalization_exposes_stream_mode_for_protocol_preflight() {
        let inline = Value::String(
            "connector:\n  id: stream\n  mode: cdc\nsources: {}\npipelines: {}\n".to_owned(),
        );
        let normalized = normalize_definition(inline).expect("YAML mapping");
        assert_eq!(
            normalized
                .pointer("/connector/mode")
                .and_then(Value::as_str),
            Some("cdc")
        );
        assert!(crate::connectors::is_stream_mode("cdc"));
        assert!(normalize_definition(Value::String("scalar".to_owned())).is_none());
    }

    #[test]
    fn only_direct_canonical_request_children_are_discoverable() {
        let tenant = TenantNamespace::parse("alice").expect("valid tenant");
        let paths = Keyspace::for_tenant(&tenant);
        let shard = Shard::try_from(39).expect("valid shard");
        let request_id = RequestId::parse("1".repeat(64)).expect("valid request ID");
        let canonical = paths.request(shard, &request_id);
        assert_eq!(
            parse_request_key(&paths, shard, &canonical),
            Some(request_id)
        );
        assert!(parse_request_key(
            &paths,
            shard,
            &format!("{}/nested/{}.json", paths.requests(shard), "2".repeat(64))
        )
        .is_none());
        assert!(parse_request_key(
            &paths,
            shard,
            &format!("{}/not-a-digest.json", paths.requests(shard))
        )
        .is_none());
        assert!(parse_request_key(
            &paths,
            shard,
            &format!("{}/{}.json/child", paths.requests(shard), "3".repeat(64))
        )
        .is_none());
    }

    #[test]
    fn result_codec_is_golden_stable_and_rejects_extra_fields() {
        let request_id =
            RequestId::parse("2f47eda4b41283057c1471fc03d0379f8840c84fee0aa3d79140b6ea41002e1d")
                .expect("valid golden request ID");
        let result = ControlRequestResult::V1(ControlRequestResultV1 {
            outcome: ControlRequestResultOutcomeV1::Accepted {
                promoted_event_id: control_outcome_event_id(&request_id),
            },
            request_id,
        });
        assert_eq!(
            result.encode().expect("encode result"),
            include_bytes!("../../tests/golden/control-request-result-v1.json")
                .strip_suffix(b"\n")
                .expect("fixture newline")
        );
        assert_eq!(
            ControlRequestResult::decode(&result.encode().expect("encode result"))
                .expect("decode result"),
            result
        );

        let mut value = serde_json::to_value(&result).expect("serialize result");
        value
            .as_object_mut()
            .expect("result envelope is an object")
            .insert("unexpected".to_owned(), Value::Bool(true));
        let bytes = serde_json::to_vec(&value).expect("serialize forged result");
        assert!(matches!(
            ControlRequestResult::decode(&bytes),
            Err(CompatError::ExtraField { path, .. }) if path == "unexpected"
        ));
    }

    #[tokio::test]
    async fn derived_cache_conflict_is_rebuilt_from_projection_not_adopted() {
        let cache = tempfile::tempdir().expect("create cache root");
        let store = ArtifactStore::in_memory(cache.path()).expect("create in-memory store");
        let tenant = TenantNamespace::parse("alice").expect("valid tenant");
        let shard = Shard::try_from(39).expect("valid shard");
        let request_id = RequestId::parse("4".repeat(64)).expect("valid request ID");
        let outcome = ControlRequestOutcomeV1 {
            request_digest: RequestDigest::parse("5".repeat(64)).expect("valid request digest"),
            outcome: ControlRequestOutcomeKindV1::Accepted {
                promoted_event_id: control_outcome_event_id(&request_id),
            },
        };
        let expected = ControlRequestResult::V1(ControlRequestResultV1::from_projection(
            request_id.clone(),
            &outcome,
        ));
        let conflicting = ControlRequestResult::V1(ControlRequestResultV1 {
            request_id: request_id.clone(),
            outcome: ControlRequestResultOutcomeV1::Rejected {
                reason_code: ControlRejectionReason::NotFound,
                expected_revision: Some(
                    EventId::parse("6".repeat(64)).expect("valid expected revision"),
                ),
                observed_revision: None,
            },
        });
        let key = Keyspace::for_tenant(&tenant).request_result(shard, &request_id);
        store
            .create_cas_document(&key, conflicting.encode().expect("encode conflict"))
            .await
            .expect("seed conflicting cache");

        let publication = publish_result(&store, &tenant, shard, &expected)
            .await
            .expect("authoritative projection repairs derived cache");
        assert_eq!(publication, CachePublication::Rebuilt);
        let stored = store
            .get_cas_document_bounded(&key, MAX_CONTROL_RESULT_BYTES)
            .await
            .expect("read repaired cache");
        assert!(matches!(
            stored,
            BoundedCasDocument::Present(bytes, _)
                if ControlRequestResult::decode(&bytes) == Ok(expected)
        ));
    }

    #[test]
    fn wrapping_cursor_advances_then_wraps_without_low_key_starvation() {
        let ids = ['1', '2', '3']
            .into_iter()
            .map(|value| {
                let id = RequestId::parse(value.to_string().repeat(64)).expect("valid request ID");
                (format!("{id}.json"), id)
            })
            .collect::<Vec<_>>();
        let first = wrapping_batch(&ids, None, 2);
        assert_eq!(first[0].1, ids[0].1);
        assert_eq!(first[1].1, ids[1].1);
        let second = wrapping_batch(&ids, Some(&first[1].0), 2);
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].1, ids[2].1);
        let wrapped = wrapping_batch(&ids, Some(&second[0].0), 2);
        assert_eq!(wrapped[0].1, ids[0].1);
    }

    #[test]
    fn conflicting_request_digest_fails_closed_before_target_state_is_considered() {
        let integration =
            CanonicalIntegrationId::parse("alice:missing").expect("valid integration ID");
        let request = ControlRequestV1::new(
            TenantNamespace::parse("alice").expect("valid tenant"),
            integration,
            "alice".to_owned(),
            ControlCommandV1::CancelRun(CancelRunV1 {
                run_id: super::super::ids::RunId::parse("00000000-0000-4000-8000-000000000001")
                    .expect("valid run ID"),
                expected_run_revision: EventId::parse("3".repeat(64)).expect("valid revision"),
                expected_failed_work: None,
            }),
        )
        .expect("valid request");
        let event_id = control_outcome_event_id(&request.request_id);
        let mut projection = Projection::default();
        projection.control_request_outcomes.insert(
            request.request_id.clone(),
            ControlRequestOutcomeV1 {
                request_digest: RequestDigest::parse("2".repeat(64))
                    .expect("valid conflicting request digest"),
                outcome: ControlRequestOutcomeKindV1::Accepted {
                    promoted_event_id: event_id,
                },
            },
        );
        let error = inspect_projection(&projection, &request)
            .expect_err("different immutable bytes must conflict");
        assert_eq!(error.kind, ShardCommandErrorKind::Recovery);
    }

    #[test]
    fn authorization_denial_becomes_a_fenced_outcome_not_a_result_cache_decision() {
        let request = ControlRequestV1::new(
            TenantNamespace::parse("alice").expect("valid tenant"),
            CanonicalIntegrationId::parse("alice:authorization").expect("valid integration ID"),
            "actor:denied".to_owned(),
            ControlCommandV1::CancelRun(CancelRunV1 {
                run_id: super::super::ids::RunId::parse("00000000-0000-4000-8000-000000000001")
                    .expect("valid run ID"),
                expected_run_revision: EventId::parse("8".repeat(64)).expect("valid revision"),
                expected_failed_work: None,
            }),
        )
        .expect("valid request");
        let record = promote_control_request(
            &Projection::default(),
            &request,
            Some(ControlRejectionReason::Unauthorized),
        )
        .expect("build authoritative denial");
        assert_eq!(
            record.event_id,
            control_outcome_event_id(&request.request_id)
        );
        assert!(matches!(
            record.event,
            JournalEvent::V1(JournalEventV1::ControlRequestRejected(
                ControlRequestRejectedV1 {
                    reason_code: ControlRejectionReason::Unauthorized,
                    ..
                }
            ))
        ));
    }
}
