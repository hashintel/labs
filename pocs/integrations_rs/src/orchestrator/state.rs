//! Journal-owned integration state.
//!
//! The shard projection is the only current-state authority. State records and
//! DuckDB snapshots are immutable evidence named by that projection; no mutable
//! object-store pointer participates in recovery.

use std::collections::BTreeSet;
use std::fmt;
#[cfg(test)]
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use error_stack::{Report, ResultExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(test)]
use super::events::{JournalEvent, JournalEventV1, JournalRecordV1, StateCheckpointCommittedV1};
use super::ids::CanonicalIntegrationId;
#[cfg(test)]
use super::ids::RunId;
use super::ids::TenantNamespace;
use super::record_io::{self, InspectedRecord};
use super::registry::{
    reject_unknown_fields, CompatError, DurabilityClass, DurableRecord, MigrationPolicy,
    RebuildableRecord, RecordFamily,
};
use super::routing::{self, ROUTING_VERSION};
#[cfg(test)]
use super::shard_log::ShardCommandOutcome;
use super::shard_log::{ShardCommandErrorKind, ShardCommandHandle, StateChangeFeed};
use super::work::{StateVersion, StateVersionRef, StateVersionV1, MAX_STATE_VERSION_BYTES};
use crate::blob::{ArtifactStore, BlobNamespace, BlobRef, CasVersion, CasWrite};

const STATE_VERSION_MEDIA_TYPE: &str = "application/vnd.integrations.state-version+json";
const MAX_CURRENT_STATE_HINT_BYTES: usize = 16 * 1024;
const MAX_HINT_CAS_ATTEMPTS: usize = 8;

pub(crate) static CURRENT_STATE_HINT_FAMILY: RecordFamily = RecordFamily {
    name: "current_state_hint",
    owning_module: "orchestrator::state",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[],
    durability: DurabilityClass::Derived,
    migration: MigrationPolicy::Rebuild,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub(crate) enum CurrentStateHint {
    V1(CurrentStateHintV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CurrentStateHintV1 {
    pub(crate) integration_id: CanonicalIntegrationId,
    pub(crate) routing_version: u32,
    pub(crate) shard: u16,
    pub(crate) state: Option<StateVersionRef>,
    pub(crate) source_log_sequence: u64,
}

impl CurrentStateHint {
    fn from_cursor(integration_id: CanonicalIntegrationId, cursor: &StateCursor) -> Option<Self> {
        cursor.established_at_sequence.map(|source_log_sequence| {
            Self::V1(CurrentStateHintV1 {
                shard: u16::from(routing::shard(&integration_id).get()),
                integration_id,
                routing_version: ROUTING_VERSION,
                state: cursor.state.clone(),
                source_log_sequence,
            })
        })
    }

    fn current(&self) -> &CurrentStateHintV1 {
        match self {
            Self::V1(value) => value,
        }
    }
}

impl super::registry::sealed::Sealed for CurrentStateHint {}

impl DurableRecord for CurrentStateHint {
    const FAMILY: &'static RecordFamily = &CURRENT_STATE_HINT_FAMILY;
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::Rebuild;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_hint(self.current())?;
        serde_json::to_vec(self).map_err(|error| hint_malformed(error.to_string()))
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        if bytes.len() > MAX_CURRENT_STATE_HINT_BYTES {
            return Err(hint_malformed(format!(
                "record is {} bytes; maximum is {MAX_CURRENT_STATE_HINT_BYTES}",
                bytes.len()
            )));
        }
        let value: Value =
            serde_json::from_slice(bytes).map_err(|error| hint_malformed(error.to_string()))?;
        reject_unknown_fields(Self::FAMILY.name, "", &value, &["version", "data"])?;
        let version = value
            .get("version")
            .and_then(Value::as_str)
            .ok_or_else(|| hint_malformed("version must be a string".to_owned()))?;
        if version != "v1" {
            return Err(CompatError::UnsupportedVersion {
                family: Self::FAMILY.name,
                version: version.to_owned(),
            });
        }
        let data = value
            .get("data")
            .ok_or_else(|| hint_malformed("data is required".to_owned()))?;
        reject_unknown_fields(
            Self::FAMILY.name,
            "data",
            data,
            &[
                "integration_id",
                "routing_version",
                "shard",
                "state",
                "source_log_sequence",
            ],
        )?;
        if let Some(state) = data.get("state").filter(|state| !state.is_null()) {
            reject_state_ref_shape(state)?;
        }
        let hint: Self =
            serde_json::from_value(value).map_err(|error| hint_malformed(error.to_string()))?;
        validate_hint(hint.current())?;
        Ok(hint)
    }
}

impl RebuildableRecord for CurrentStateHint {}

fn reject_state_ref_shape(value: &Value) -> Result<(), CompatError> {
    reject_unknown_fields(
        CurrentStateHint::FAMILY.name,
        "data.state",
        value,
        &["id", "artifact"],
    )?;
    let artifact = value
        .get("artifact")
        .ok_or_else(|| hint_malformed("data.state.artifact is required".to_owned()))?;
    reject_unknown_fields(
        CurrentStateHint::FAMILY.name,
        "data.state.artifact",
        artifact,
        &["version", "value"],
    )?;
    let artifact_value = artifact
        .get("value")
        .ok_or_else(|| hint_malformed("data.state.artifact.value is required".to_owned()))?;
    reject_unknown_fields(
        CurrentStateHint::FAMILY.name,
        "data.state.artifact.value",
        artifact_value,
        &[
            "key",
            "sha256",
            "size",
            "mediaType",
            "eTag",
            "providerVersion",
        ],
    )
}

fn validate_hint(hint: &CurrentStateHintV1) -> Result<(), CompatError> {
    if hint.routing_version != ROUTING_VERSION {
        return Err(hint_malformed(format!(
            "routing_version must be {ROUTING_VERSION}, found {}",
            hint.routing_version
        )));
    }
    let expected_shard = routing::shard(&hint.integration_id);
    if hint.shard != u16::from(expected_shard.get()) {
        return Err(hint_malformed(format!(
            "shard must be {}, found {}",
            expected_shard.get(),
            hint.shard
        )));
    }
    if let Some(state) = &hint.state {
        validate_hint_blob(&state.artifact)?;
        let artifact = state.artifact.current();
        let expected_suffix = format!(
            "/integrations/{}/state-versions/sha256/{}/{}.json",
            routing::integration_path(&hint.integration_id),
            artifact.sha256.get(..2).unwrap_or_default(),
            artifact.sha256
        );
        if !artifact.key.ends_with(&expected_suffix)
            || artifact.media_type != STATE_VERSION_MEDIA_TYPE
        {
            return Err(hint_malformed(
                "state artifact is not in the integration's canonical state-version namespace"
                    .to_owned(),
            ));
        }
    }
    Ok(())
}

fn validate_hint_blob(reference: &BlobRef) -> Result<(), CompatError> {
    let value = reference.current();
    if value.key.is_empty() || value.media_type.is_empty() {
        return Err(hint_malformed(
            "state artifact key and media_type must be non-empty".to_owned(),
        ));
    }
    if value.sha256.len() != 64
        || !value
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(hint_malformed(
            "state artifact sha256 must be 64 lowercase hexadecimal characters".to_owned(),
        ));
    }
    Ok(())
}

fn hint_malformed(message: String) -> CompatError {
    CompatError::Malformed {
        family: CurrentStateHint::FAMILY.name,
        message,
    }
}

/// Bounded authoritative state view captured at the shard command loop's
/// serialization point.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StateCursor {
    pub(crate) state: Option<StateVersionRef>,
    pub(crate) established_at_sequence: Option<u64>,
    pub(crate) projected_through_sequence: Option<u64>,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StateCommitDisposition {
    Applied,
    AlreadyDurable,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StateCommitOutcome {
    pub(crate) disposition: StateCommitDisposition,
    pub(crate) committed: StateVersionRef,
    /// The state current when the post-commit query serialized. Another valid
    /// transition may already have superseded `committed`.
    pub(crate) current: StateCursor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StateAuthorityError {
    #[cfg(test)]
    UnknownIntegration,
    InvalidState,
    #[cfg(test)]
    StaleParent,
    ArtifactPublication,
    ArtifactIntegrity,
    InvalidCandidate,
    Fenced,
    JournalRecovery,
    JournalUnavailable,
}

impl fmt::Display for StateAuthorityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            #[cfg(test)]
            Self::UnknownIntegration => "integration has no authoritative journal projection",
            Self::InvalidState => "state version is invalid",
            #[cfg(test)]
            Self::StaleParent => "state version does not extend the authoritative cursor",
            Self::ArtifactPublication => "state artifact publication failed",
            Self::ArtifactIntegrity => "state artifact integrity validation failed",
            Self::InvalidCandidate => "state checkpoint was rejected by the authoritative fold",
            Self::Fenced => "state checkpoint owner was fenced",
            Self::JournalRecovery => "state checkpoint journal recovery failed",
            Self::JournalUnavailable => "state checkpoint journal is unavailable",
        })
    }
}

impl std::error::Error for StateAuthorityError {}

#[async_trait]
pub(crate) trait StateAuthority: Send + Sync {
    async fn current(
        &self,
        integration_id: &CanonicalIntegrationId,
    ) -> Result<Option<StateCursor>, Report<StateAuthorityError>>;

    /// Publishes and journals one state checkpoint in a single capability
    /// call. The production Apply lifecycle commits through `WorkPlanned` and
    /// the fold instead; the state capability conformance tests keep this
    /// contract independently proven for the backend-neutral port.
    #[cfg(test)]
    async fn commit(
        &self,
        integration_id: &CanonicalIntegrationId,
        run_id: &RunId,
        state: StateVersion,
    ) -> Result<StateCommitOutcome, Report<StateAuthorityError>>;

    /// Publishes immutable state evidence without advancing the journal cursor.
    /// Apply planning uses this before `WorkPlanned`; the fold remains the only
    /// authority that can make the candidate current.
    async fn publish_candidate(
        &self,
        integration_id: &CanonicalIntegrationId,
        state: StateVersion,
    ) -> Result<StateVersionRef, Report<StateAuthorityError>>;

    async fn load(
        &self,
        integration_id: &CanonicalIntegrationId,
        reference: &StateVersionRef,
    ) -> Result<StateVersion, Report<StateAuthorityError>>;

    /// Verified local materialization of one immutable state's DuckDB bytes.
    /// Production planning materializes through its workspace admission path;
    /// the conformance tests keep this capability independently proven.
    #[cfg(test)]
    async fn materialize_duckdb(
        &self,
        integration_id: &CanonicalIntegrationId,
        reference: &StateVersionRef,
    ) -> Result<PathBuf, Report<StateAuthorityError>>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StateHintRepairOutcome {
    NoSourceEvent,
    Current,
    /// The hint names a later journal sequence than this repairer's
    /// authoritative view. It is left untouched so a delayed owner cannot
    /// regress a newer derived observation.
    AheadUnverified,
    Created,
    Replaced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StateHintError {
    AuthorityQuery,
    Encode,
    Read,
    Create,
    Update,
    OversizedExisting,
    ConflictLimit,
}

impl fmt::Display for StateHintError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AuthorityQuery => "authoritative state query for hint repair failed",
            Self::Encode => "current-state hint encoding failed",
            Self::Read => "current-state hint read failed",
            Self::Create => "current-state hint conditional create failed",
            Self::Update => "current-state hint conditional update failed",
            Self::OversizedExisting => "existing current-state hint is oversized",
            Self::ConflictLimit => "current-state hint did not stabilize within the retry bound",
        })
    }
}

impl std::error::Error for StateHintError {}

#[derive(Debug)]
enum ObservedHint {
    Missing,
    Valid(CurrentStateHint, CasVersion),
    Invalid(CasVersion),
    TooLarge { actual_bytes: u64, maximum: usize },
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum HintDecision {
    Current,
    Create,
    Replace(CasVersion),
    RefreshAuthority(CurrentStateHint),
    Oversized { actual_bytes: u64, maximum: usize },
}

fn decide_hint(expected: &CurrentStateHint, observed: ObservedHint) -> HintDecision {
    match observed {
        ObservedHint::Missing => HintDecision::Create,
        ObservedHint::Invalid(version) => HintDecision::Replace(version),
        ObservedHint::TooLarge {
            actual_bytes,
            maximum,
        } => HintDecision::Oversized {
            actual_bytes,
            maximum,
        },
        ObservedHint::Valid(actual, _version) if actual == *expected => HintDecision::Current,
        ObservedHint::Valid(actual, _version)
            if actual.current().source_log_sequence > expected.current().source_log_sequence =>
        {
            HintDecision::RefreshAuthority(actual)
        }
        ObservedHint::Valid(_actual, version) => HintDecision::Replace(version),
    }
}

fn current_state_hint_key(
    tenant: &TenantNamespace,
    integration_id: &CanonicalIntegrationId,
) -> Result<String, Report<StateHintError>> {
    BlobNamespace::v1(tenant, &routing::integration_path(integration_id))
        .key("state/current-hint.json")
        .change_context(StateHintError::Encode)
}

async fn read_current_state_hint(
    store: &ArtifactStore,
    key: &str,
) -> Result<ObservedHint, Report<StateHintError>> {
    match record_io::inspect::<CurrentStateHint>(store, key, MAX_CURRENT_STATE_HINT_BYTES)
        .await
        .change_context(StateHintError::Read)?
    {
        InspectedRecord::Missing => Ok(ObservedHint::Missing),
        InspectedRecord::Present(hint, version) => Ok(ObservedHint::Valid(hint, version)),
        InspectedRecord::Malformed(_error, version) => Ok(ObservedHint::Invalid(version)),
        InspectedRecord::TooLarge {
            actual_bytes,
            maximum_bytes,
        } => Ok(ObservedHint::TooLarge {
            actual_bytes,
            maximum: maximum_bytes,
        }),
    }
}

/// Rebuilds the optional human/tooling hint exclusively from the authoritative
/// journal cursor. No engine recovery or planning path calls a hint reader.
pub(crate) async fn repair_current_state_hint(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    authority: &dyn StateAuthority,
    integration_id: &CanonicalIntegrationId,
) -> Result<StateHintRepairOutcome, Report<StateHintError>> {
    let key = current_state_hint_key(tenant, integration_id)?;
    let mut cursor = authority
        .current(integration_id)
        .await
        .change_context(StateHintError::AuthorityQuery)?;
    let Some(mut expected) = cursor
        .as_ref()
        .and_then(|cursor| CurrentStateHint::from_cursor(integration_id.clone(), cursor))
    else {
        return Ok(StateHintRepairOutcome::NoSourceEvent);
    };

    for _attempt in 0..MAX_HINT_CAS_ATTEMPTS {
        let observed = read_current_state_hint(store, &key).await?;
        match decide_hint(&expected, observed) {
            HintDecision::Current => return Ok(StateHintRepairOutcome::Current),
            HintDecision::Create => {
                match record_io::create(store, &key, &expected)
                    .await
                    .change_context(StateHintError::Create)?
                {
                    CasWrite::Written(_) => return Ok(StateHintRepairOutcome::Created),
                    CasWrite::Conflict => {}
                }
            }
            HintDecision::Replace(version) => {
                match record_io::compare_and_swap(store, &key, &version, &expected)
                    .await
                    .change_context(StateHintError::Update)?
                {
                    CasWrite::Written(_) => return Ok(StateHintRepairOutcome::Replaced),
                    CasWrite::Conflict => {}
                }
            }
            HintDecision::RefreshAuthority(actual) => {
                let refreshed_cursor = authority
                    .current(integration_id)
                    .await
                    .change_context(StateHintError::AuthorityQuery)?;
                let Some(refreshed) = refreshed_cursor.as_ref().and_then(|cursor| {
                    CurrentStateHint::from_cursor(integration_id.clone(), cursor)
                }) else {
                    return Ok(StateHintRepairOutcome::NoSourceEvent);
                };
                if refreshed == actual {
                    return Ok(StateHintRepairOutcome::Current);
                }
                if refreshed.current().source_log_sequence < actual.current().source_log_sequence {
                    return Ok(StateHintRepairOutcome::AheadUnverified);
                }
                if refreshed != expected {
                    cursor = refreshed_cursor;
                    expected = refreshed;
                    continue;
                }
                return Ok(StateHintRepairOutcome::AheadUnverified);
            }
            HintDecision::Oversized {
                actual_bytes,
                maximum,
            } => {
                return Err(Report::new(StateHintError::OversizedExisting)
                    .attach_printable(format!("actual bytes: {actual_bytes}"))
                    .attach_printable(format!("maximum bytes: {maximum}")));
            }
        }
    }
    let projected_through = cursor.and_then(|cursor| cursor.projected_through_sequence);
    Err(Report::new(StateHintError::ConflictLimit)
        .attach_printable(format!("integration: {integration_id}"))
        .attach_printable(format!("projected through: {projected_through:?}")))
}

/// Starts the best-effort, coalescing publisher for the derived hint. The
/// command loop only emits bounded in-memory notifications; object-store I/O
/// and retries remain outside its serialized append path.
pub(crate) fn start_state_hint_repairer(
    store: ArtifactStore,
    tenant: TenantNamespace,
    authority: Arc<dyn StateAuthority>,
    feed: StateChangeFeed,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let StateChangeFeed {
            initial,
            mut receiver,
        } = feed;
        let mut pending = initial.into_iter().collect::<BTreeSet<_>>();
        let mut receiver_open = true;
        loop {
            if pending.is_empty() {
                if !receiver_open {
                    break;
                }
                match receiver.recv().await {
                    Some(integration_id) => {
                        pending.insert(integration_id);
                    }
                    None => {
                        receiver_open = false;
                        continue;
                    }
                }
            }
            while let Ok(integration_id) = receiver.try_recv() {
                pending.insert(integration_id);
            }
            let Some(integration_id) = pending.pop_first() else {
                continue;
            };
            if let Err(error) =
                repair_current_state_hint(&store, &tenant, authority.as_ref(), &integration_id)
                    .await
            {
                tracing::warn!(
                    integration_id = %integration_id,
                    error = ?error,
                    "derived current-state hint repair failed"
                );
            }
        }
    })
}

/// Object-store artifact publication composed with the shard's sole mutation
/// path. Neither component can independently select the current state.
#[derive(Debug, Clone)]
pub(crate) struct JournalStateAuthority {
    artifacts: ArtifactStore,
    tenant: TenantNamespace,
    commands: ShardCommandHandle,
}

impl JournalStateAuthority {
    pub(crate) fn new(
        artifacts: ArtifactStore,
        tenant: TenantNamespace,
        commands: ShardCommandHandle,
    ) -> Self {
        Self {
            artifacts,
            tenant,
            commands,
        }
    }

    fn namespace(&self, integration_id: &CanonicalIntegrationId) -> BlobNamespace {
        BlobNamespace::v1(&self.tenant, &routing::integration_path(integration_id))
    }

    fn state_versions_prefix(
        &self,
        integration_id: &CanonicalIntegrationId,
    ) -> Result<String, Report<StateAuthorityError>> {
        self.namespace(integration_id)
            .key("state-versions")
            .change_context(StateAuthorityError::ArtifactPublication)
    }

    fn validate_reference_key(
        &self,
        integration_id: &CanonicalIntegrationId,
        reference: &StateVersionRef,
    ) -> Result<(), Report<StateAuthorityError>> {
        let prefix = format!(
            "{}/state-versions/sha256/",
            self.namespace(integration_id).root()
        );
        let artifact = reference.artifact.current();
        let expected_key = format!(
            "{}{}/{}.json",
            prefix,
            artifact.sha256.get(..2).unwrap_or_default(),
            artifact.sha256
        );
        if artifact.key != expected_key {
            return Err(
                Report::new(StateAuthorityError::ArtifactIntegrity).attach_printable(format!(
                    "state artifact key {:?} is not canonical; expected {expected_key:?}",
                    artifact.key
                )),
            );
        }
        if artifact.media_type != STATE_VERSION_MEDIA_TYPE {
            return Err(
                Report::new(StateAuthorityError::ArtifactIntegrity).attach_printable(format!(
                    "state artifact media type {:?} does not match {STATE_VERSION_MEDIA_TYPE:?}",
                    artifact.media_type
                )),
            );
        }
        Ok(())
    }

    fn validate_record_scope(
        &self,
        integration_id: &CanonicalIntegrationId,
        state: &StateVersionV1,
        context: StateAuthorityError,
    ) -> Result<(), Report<StateAuthorityError>> {
        if let Some(parent) = &state.parent {
            self.validate_reference_key(integration_id, parent)
                .change_context(context)?;
        }
        let root = format!("{}/", self.namespace(integration_id).root());
        let snapshot = state.snapshot.current();
        let references = std::iter::once(&snapshot.duckdb)
            .chain(snapshot.accepted_batches.iter())
            .chain(std::iter::once(&state.desired_projection.artifact));
        for reference in references {
            if !reference.current().key.starts_with(&root) {
                return Err(Report::new(context).attach_printable(format!(
                    "state evidence key {:?} is outside integration prefix {root:?}",
                    reference.current().key
                )));
            }
        }
        Ok(())
    }
}

#[async_trait]
impl StateAuthority for JournalStateAuthority {
    async fn current(
        &self,
        integration_id: &CanonicalIntegrationId,
    ) -> Result<Option<StateCursor>, Report<StateAuthorityError>> {
        match self.commands.inspect_state(integration_id.clone()).await {
            Ok(cursor) => Ok(cursor),
            Err(error) => {
                let context = match error.kind {
                    ShardCommandErrorKind::InvalidCandidate => {
                        StateAuthorityError::InvalidCandidate
                    }
                    ShardCommandErrorKind::Fenced => StateAuthorityError::Fenced,
                    ShardCommandErrorKind::Recovery | ShardCommandErrorKind::CommitUnknown => {
                        StateAuthorityError::JournalRecovery
                    }
                    ShardCommandErrorKind::DefinitelyNotCommitted
                    | ShardCommandErrorKind::Closed => StateAuthorityError::JournalUnavailable,
                };
                Err(error).change_context(context)
            }
        }
    }

    #[cfg(test)]
    async fn commit(
        &self,
        integration_id: &CanonicalIntegrationId,
        run_id: &RunId,
        state: StateVersion,
    ) -> Result<StateCommitOutcome, Report<StateAuthorityError>> {
        let state_value = state
            .try_current()
            .change_context(StateAuthorityError::InvalidState)?;
        self.validate_record_scope(
            integration_id,
            state_value,
            StateAuthorityError::InvalidState,
        )?;
        let before = self
            .current(integration_id)
            .await?
            .ok_or_else(|| Report::new(StateAuthorityError::UnknownIntegration))?;
        if state_value.parent != before.state
            && before
                .state
                .as_ref()
                .is_none_or(|current| current.id != state_value.id)
        {
            return Err(
                Report::new(StateAuthorityError::StaleParent).attach_printable(format!(
                    "candidate parent {:?} differs from authoritative state {:?}",
                    state_value.parent, before.state
                )),
            );
        }

        let committed = self
            .publish_candidate(integration_id, state.clone())
            .await?;
        if state_value.parent != before.state {
            if before
                .state
                .as_ref()
                .is_some_and(|current| state_ref_semantically_equal(current, &committed))
            {
                return Ok(StateCommitOutcome {
                    disposition: StateCommitDisposition::AlreadyDurable,
                    committed: before
                        .state
                        .clone()
                        .ok_or_else(|| Report::new(StateAuthorityError::JournalRecovery))?,
                    current: before,
                });
            }
            return Err(
                Report::new(StateAuthorityError::StaleParent).attach_printable(format!(
                    "candidate parent {:?} differs from authoritative state {:?}",
                    state_value.parent, before.state
                )),
            );
        }
        let record = JournalRecordV1::new(
            integration_id.clone(),
            JournalEvent::V1(JournalEventV1::StateCheckpointCommitted(
                StateCheckpointCommittedV1 {
                    run_id: run_id.clone(),
                    state_version: committed.clone(),
                    state_record: state,
                },
            )),
        )
        .change_context(StateAuthorityError::InvalidState)?;

        let proposal = match self.commands.propose(record).await {
            Ok(proposal) => proposal,
            Err(error) => {
                let context = match error.kind {
                    ShardCommandErrorKind::InvalidCandidate => {
                        StateAuthorityError::InvalidCandidate
                    }
                    ShardCommandErrorKind::Fenced => StateAuthorityError::Fenced,
                    ShardCommandErrorKind::Recovery | ShardCommandErrorKind::CommitUnknown => {
                        StateAuthorityError::JournalRecovery
                    }
                    ShardCommandErrorKind::DefinitelyNotCommitted
                    | ShardCommandErrorKind::Closed => StateAuthorityError::JournalUnavailable,
                };
                return Err(error).change_context(context);
            }
        };
        let disposition = match proposal {
            ShardCommandOutcome::Applied { .. } => StateCommitDisposition::Applied,
            ShardCommandOutcome::AlreadyDurable { .. } => StateCommitDisposition::AlreadyDurable,
        };
        let current = self
            .current(integration_id)
            .await?
            .ok_or_else(|| Report::new(StateAuthorityError::JournalRecovery))?;
        Ok(StateCommitOutcome {
            disposition,
            committed,
            current,
        })
    }

    async fn publish_candidate(
        &self,
        integration_id: &CanonicalIntegrationId,
        state: StateVersion,
    ) -> Result<StateVersionRef, Report<StateAuthorityError>> {
        let state_value = state
            .try_current()
            .change_context(StateAuthorityError::InvalidState)?;
        self.validate_record_scope(
            integration_id,
            state_value,
            StateAuthorityError::InvalidState,
        )?;
        let prefix = self.state_versions_prefix(integration_id)?;
        let artifact = self
            .artifacts
            .publish_record(
                &state,
                MAX_STATE_VERSION_BYTES,
                &prefix,
                STATE_VERSION_MEDIA_TYPE,
            )
            .await
            .change_context(StateAuthorityError::ArtifactPublication)?;
        Ok(StateVersionRef {
            id: state_value.id.clone(),
            artifact,
        })
    }

    async fn load(
        &self,
        integration_id: &CanonicalIntegrationId,
        reference: &StateVersionRef,
    ) -> Result<StateVersion, Report<StateAuthorityError>> {
        self.validate_reference_key(integration_id, reference)?;
        let path = self
            .artifacts
            .materialize(&reference.artifact)
            .await
            .change_context(StateAuthorityError::ArtifactIntegrity)?;
        let bytes = tokio::fs::read(path)
            .await
            .change_context(StateAuthorityError::ArtifactIntegrity)?;
        let state =
            StateVersion::decode(&bytes).change_context(StateAuthorityError::ArtifactIntegrity)?;
        let state_value = state
            .try_current()
            .change_context(StateAuthorityError::ArtifactIntegrity)?;
        if state_value.id != reference.id {
            return Err(Report::new(StateAuthorityError::ArtifactIntegrity)
                .attach_printable("decoded state ID disagrees with its journal reference"));
        }
        self.validate_record_scope(
            integration_id,
            state_value,
            StateAuthorityError::ArtifactIntegrity,
        )?;
        Ok(state)
    }

    #[cfg(test)]
    async fn materialize_duckdb(
        &self,
        integration_id: &CanonicalIntegrationId,
        reference: &StateVersionRef,
    ) -> Result<PathBuf, Report<StateAuthorityError>> {
        let state = self.load(integration_id, reference).await?;
        let duckdb = state
            .try_current()
            .change_context(StateAuthorityError::ArtifactIntegrity)?
            .snapshot
            .current()
            .duckdb
            .clone();
        self.artifacts
            .materialize(&duckdb)
            .await
            .change_context(StateAuthorityError::ArtifactIntegrity)
    }
}

#[cfg(test)]
fn state_ref_semantically_equal(left: &StateVersionRef, right: &StateVersionRef) -> bool {
    let left_artifact = left.artifact.current();
    let right_artifact = right.artifact.current();
    left.id == right.id
        && left_artifact.sha256 == right_artifact.sha256
        && left_artifact.size == right_artifact.size
        && left_artifact.media_type == right_artifact.media_type
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::collections::BTreeMap;

    use sha2::{Digest as _, Sha256};
    use tokio::sync::Mutex;

    use super::*;
    use crate::blob::{
        BlobRef, BlobRefV1, CasVersion, CasVersionV1, StateSnapshot, StateSnapshotV1,
    };
    use crate::orchestrator::events::{InputRef, PolicyRef, RunAcceptedV1};
    use crate::orchestrator::ids::{RunId, StateVersionId};
    use crate::orchestrator::routing;
    use crate::orchestrator::shard_log::{
        start_recovered, ShardCommandConfig, ShardLogLocation, StartedShard,
    };
    use crate::orchestrator::work::{
        DesiredProjectionRef, StatePhase, StatePhaseV1, StateVersionV1,
    };

    struct Rig {
        _remote: tempfile::TempDir,
        _cache: tempfile::TempDir,
        store: ArtifactStore,
        tenant: TenantNamespace,
        integration: CanonicalIntegrationId,
        run_id: RunId,
        location: ShardLogLocation,
        started: StartedShard,
    }

    /// Deliberately independent state-machine implementation used to keep the
    /// state capability contract from self-certifying through the journal fold.
    struct ReferenceStateAuthority {
        store: ArtifactStore,
        tenant: TenantNamespace,
        cursors: Mutex<BTreeMap<CanonicalIntegrationId, StateCursor>>,
    }

    impl ReferenceStateAuthority {
        fn new(
            store: ArtifactStore,
            tenant: TenantNamespace,
            integration: CanonicalIntegrationId,
        ) -> Self {
            Self {
                store,
                tenant,
                cursors: Mutex::new(BTreeMap::from([(
                    integration,
                    StateCursor {
                        state: None,
                        established_at_sequence: None,
                        projected_through_sequence: Some(0),
                    },
                )])),
            }
        }

        fn namespace(&self, integration_id: &CanonicalIntegrationId) -> BlobNamespace {
            BlobNamespace::v1(&self.tenant, &routing::integration_path(integration_id))
        }
    }

    #[async_trait]
    impl StateAuthority for ReferenceStateAuthority {
        async fn current(
            &self,
            integration_id: &CanonicalIntegrationId,
        ) -> Result<Option<StateCursor>, Report<StateAuthorityError>> {
            Ok(self.cursors.lock().await.get(integration_id).cloned())
        }

        async fn commit(
            &self,
            integration_id: &CanonicalIntegrationId,
            _run_id: &RunId,
            state: StateVersion,
        ) -> Result<StateCommitOutcome, Report<StateAuthorityError>> {
            let value = state
                .try_current()
                .change_context(StateAuthorityError::InvalidState)?;
            let committed = self
                .publish_candidate(integration_id, state.clone())
                .await?;
            let mut cursors = self.cursors.lock().await;
            let current = cursors
                .get(integration_id)
                .cloned()
                .ok_or_else(|| Report::new(StateAuthorityError::UnknownIntegration))?;
            if value.parent != current.state {
                if current
                    .state
                    .as_ref()
                    .is_some_and(|existing| state_ref_semantically_equal(existing, &committed))
                {
                    return Ok(StateCommitOutcome {
                        disposition: StateCommitDisposition::AlreadyDurable,
                        committed: current
                            .state
                            .clone()
                            .ok_or_else(|| Report::new(StateAuthorityError::JournalRecovery))?,
                        current,
                    });
                }
                return Err(Report::new(StateAuthorityError::StaleParent));
            }
            let sequence = current
                .projected_through_sequence
                .unwrap_or(0)
                .checked_add(1)
                .ok_or_else(|| Report::new(StateAuthorityError::JournalRecovery))?;
            let current = StateCursor {
                state: Some(committed.clone()),
                established_at_sequence: Some(sequence),
                projected_through_sequence: Some(sequence),
            };
            cursors.insert(integration_id.clone(), current.clone());
            Ok(StateCommitOutcome {
                disposition: StateCommitDisposition::Applied,
                committed,
                current,
            })
        }

        async fn publish_candidate(
            &self,
            integration_id: &CanonicalIntegrationId,
            state: StateVersion,
        ) -> Result<StateVersionRef, Report<StateAuthorityError>> {
            let value = state
                .try_current()
                .change_context(StateAuthorityError::InvalidState)?;
            let prefix = self
                .namespace(integration_id)
                .key("state-versions")
                .change_context(StateAuthorityError::ArtifactPublication)?;
            let artifact = self
                .store
                .publish_record(
                    &state,
                    MAX_STATE_VERSION_BYTES,
                    &prefix,
                    STATE_VERSION_MEDIA_TYPE,
                )
                .await
                .change_context(StateAuthorityError::ArtifactPublication)?;
            Ok(StateVersionRef {
                id: value.id.clone(),
                artifact,
            })
        }

        async fn load(
            &self,
            integration_id: &CanonicalIntegrationId,
            reference: &StateVersionRef,
        ) -> Result<StateVersion, Report<StateAuthorityError>> {
            let expected_prefix = format!(
                "{}/state-versions/sha256/",
                self.namespace(integration_id).root()
            );
            let artifact = reference.artifact.current();
            let expected_key = format!(
                "{}{}/{}.json",
                expected_prefix,
                artifact.sha256.get(..2).unwrap_or_default(),
                artifact.sha256
            );
            if artifact.key != expected_key || artifact.media_type != STATE_VERSION_MEDIA_TYPE {
                return Err(Report::new(StateAuthorityError::ArtifactIntegrity));
            }
            let path = self
                .store
                .materialize(&reference.artifact)
                .await
                .change_context(StateAuthorityError::ArtifactIntegrity)?;
            let bytes = tokio::fs::read(path)
                .await
                .change_context(StateAuthorityError::ArtifactIntegrity)?;
            let state = StateVersion::decode(&bytes)
                .change_context(StateAuthorityError::ArtifactIntegrity)?;
            if state.try_current().map(|value| &value.id) != Ok(&reference.id) {
                return Err(Report::new(StateAuthorityError::ArtifactIntegrity));
            }
            Ok(state)
        }

        async fn materialize_duckdb(
            &self,
            integration_id: &CanonicalIntegrationId,
            reference: &StateVersionRef,
        ) -> Result<PathBuf, Report<StateAuthorityError>> {
            let state = self.load(integration_id, reference).await?;
            let duckdb = state
                .try_current()
                .change_context(StateAuthorityError::ArtifactIntegrity)?
                .snapshot
                .current()
                .duckdb
                .clone();
            self.store
                .materialize(&duckdb)
                .await
                .change_context(StateAuthorityError::ArtifactIntegrity)
        }
    }

    impl Rig {
        async fn new(name: &str) -> Self {
            let remote = tempfile::tempdir().expect("create remote root");
            let cache = tempfile::tempdir().expect("create cache root");
            let store = ArtifactStore::local(remote.path(), cache.path()).expect("open store");
            let tenant = TenantNamespace::parse("phase3-state").expect("valid tenant");
            let integration =
                CanonicalIntegrationId::parse(format!("alice:{name}")).expect("valid integration");
            let location = ShardLogLocation::disposable_local(
                routing::shard(&integration),
                &tenant,
                remote.path(),
            );
            let started = start_recovered(location.clone(), ShardCommandConfig::default())
                .await
                .expect("start recovered shard");
            let run_id = RunId::generate();
            started
                .handle
                .propose(accepted(&integration, &run_id))
                .await
                .expect("accept run");
            Self {
                _remote: remote,
                _cache: cache,
                store,
                tenant,
                integration,
                run_id,
                location,
                started,
            }
        }

        fn authority(&self) -> JournalStateAuthority {
            JournalStateAuthority::new(
                self.store.clone(),
                self.tenant.clone(),
                self.started.handle.clone(),
            )
        }

        async fn shutdown(&self) {
            self.started
                .handle
                .shutdown()
                .await
                .expect("shutdown shard");
        }
    }

    fn fake_blob(name: &str, byte: u8, media_type: &str) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: format!("fixtures/{name}"),
            sha256: format!("{byte:02x}").repeat(32),
            size: 1,
            media_type: media_type.to_owned(),
            e_tag: None,
            provider_version: None,
        })
    }

    fn hint_fixture() -> CurrentStateHint {
        CurrentStateHint::V1(CurrentStateHintV1 {
            integration_id: CanonicalIntegrationId::parse("alice:supply-chain")
                .expect("valid integration"),
            routing_version: ROUTING_VERSION,
            shard: 39,
            state: Some(StateVersionRef {
                id: StateVersionId::parse("b".repeat(64)).expect("valid state ID"),
                artifact: BlobRef::V1(BlobRefV1 {
                    key: "tenants/alice/integrations/c30cdc149537cc27c75c4516d71eb30750e27b82c61ef7fc4969d7ea4c79a69e/state-versions/sha256/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json".to_owned(),
                    sha256: "a".repeat(64),
                    size: 123,
                    media_type: STATE_VERSION_MEDIA_TYPE.to_owned(),
                    e_tag: Some("etag-state".to_owned()),
                    provider_version: Some("version-state".to_owned()),
                }),
            }),
            source_log_sequence: 42,
        })
    }

    fn cas_version(tag: &str) -> CasVersion {
        CasVersion::V1(CasVersionV1 {
            e_tag: Some(tag.to_owned()),
            provider_version: None,
        })
    }

    #[test]
    fn current_state_hint_wire_matches_independent_golden() {
        let hint = hint_fixture();
        let encoded = hint.encode().expect("encode hint");
        assert_eq!(
            encoded,
            include_bytes!("../../tests/golden/current-state-hint-v1.json")
                .strip_suffix(b"\n")
                .expect("fixture newline")
        );
        assert_eq!(
            CurrentStateHint::decode(&encoded).expect("decode hint"),
            hint
        );
    }

    #[test]
    fn current_state_hint_codec_rejects_drift_and_misrouting() {
        let hint = hint_fixture();
        let mut extra: Value =
            serde_json::from_slice(&hint.encode().expect("encode hint")).expect("parse hint");
        extra["data"]["unexpected"] = Value::Bool(true);
        assert!(matches!(
            CurrentStateHint::decode(&serde_json::to_vec(&extra).expect("encode drift")),
            Err(CompatError::ExtraField { .. })
        ));

        let mut future: Value =
            serde_json::from_slice(&hint.encode().expect("encode hint")).expect("parse hint");
        future["version"] = Value::String("v2".to_owned());
        assert!(matches!(
            CurrentStateHint::decode(&serde_json::to_vec(&future).expect("encode future")),
            Err(CompatError::UnsupportedVersion { .. })
        ));

        let CurrentStateHint::V1(mut misrouted) = hint;
        misrouted.shard = 40;
        assert!(matches!(
            CurrentStateHint::V1(misrouted).encode(),
            Err(CompatError::Malformed { .. })
        ));
    }

    #[test]
    fn hint_decision_is_monotonic_and_corruption_is_replaceable() {
        let expected = hint_fixture();
        assert_eq!(
            decide_hint(&expected, ObservedHint::Missing),
            HintDecision::Create
        );
        assert_eq!(
            decide_hint(
                &expected,
                ObservedHint::Valid(expected.clone(), cas_version("same"))
            ),
            HintDecision::Current
        );
        assert_eq!(
            decide_hint(&expected, ObservedHint::Invalid(cas_version("invalid"))),
            HintDecision::Replace(cas_version("invalid"))
        );
        assert_eq!(
            decide_hint(
                &expected,
                ObservedHint::TooLarge {
                    actual_bytes: 20_000,
                    maximum: MAX_CURRENT_STATE_HINT_BYTES,
                }
            ),
            HintDecision::Oversized {
                actual_bytes: 20_000,
                maximum: MAX_CURRENT_STATE_HINT_BYTES,
            }
        );

        let CurrentStateHint::V1(mut stale) = expected.clone();
        stale.source_log_sequence = 41;
        assert_eq!(
            decide_hint(
                &expected,
                ObservedHint::Valid(CurrentStateHint::V1(stale), cas_version("stale"))
            ),
            HintDecision::Replace(cas_version("stale"))
        );

        let CurrentStateHint::V1(mut conflicting) = expected.clone();
        conflicting.state.as_mut().expect("fixture state").id =
            StateVersionId::parse("c".repeat(64)).expect("valid conflicting state ID");
        assert_eq!(
            decide_hint(
                &expected,
                ObservedHint::Valid(
                    CurrentStateHint::V1(conflicting),
                    cas_version("conflicting")
                )
            ),
            HintDecision::Replace(cas_version("conflicting"))
        );

        let CurrentStateHint::V1(mut ahead) = expected.clone();
        ahead.source_log_sequence = 43;
        assert_eq!(
            decide_hint(
                &expected,
                ObservedHint::Valid(CurrentStateHint::V1(ahead.clone()), cas_version("ahead"))
            ),
            HintDecision::RefreshAuthority(CurrentStateHint::V1(ahead))
        );
    }

    fn accepted(integration: &CanonicalIntegrationId, run_id: &RunId) -> JournalRecordV1 {
        JournalRecordV1::new(
            integration.clone(),
            JournalEvent::V1(JournalEventV1::RunAccepted(RunAcceptedV1 {
                run_id: run_id.clone(),
                immutable_input: InputRef {
                    artifact: fake_blob("input.json", 0x11, "application/json"),
                    definition_digest: "22".repeat(32),
                    definition_digest_encoding_version: 1,
                    planner_version: 1,
                },
                policy: PolicyRef {
                    artifact: fake_blob("policy.json", 0x33, "application/json"),
                    policy_digest: "44".repeat(32),
                },
                submitted_at: "2026-07-22T00:00:00Z".to_owned(),
            })),
        )
        .expect("valid accepted record")
    }

    async fn state(
        store: &ArtifactStore,
        tenant: &TenantNamespace,
        integration: &CanonicalIntegrationId,
        parent: Option<StateVersionRef>,
        label: &str,
    ) -> (StateVersion, Vec<u8>) {
        let namespace = BlobNamespace::v1(tenant, &routing::integration_path(integration));
        let duckdb_bytes = format!("duckdb-state-{label}").into_bytes();
        let duckdb = store
            .publish_bytes(
                &duckdb_bytes,
                ".duckdb",
                &namespace.key("snapshots").expect("snapshot prefix"),
                "application/vnd.duckdb",
            )
            .await
            .expect("publish DuckDB snapshot");
        let desired = store
            .publish_bytes(
                format!("desired-{label}").as_bytes(),
                ".json",
                &namespace
                    .key("desired-projections")
                    .expect("desired prefix"),
                "application/json",
            )
            .await
            .expect("publish desired projection");
        let definition_digest = hex::encode(Sha256::digest(label.as_bytes()));
        let state = StateVersionV1::new(
            parent,
            StatePhase::V1(StatePhaseV1::SourcesCommitted),
            StateSnapshot::V1(StateSnapshotV1 {
                generation: 1,
                duckdb,
                accepted_batches: Vec::new(),
                created_at: "2026-07-22T00:00:00Z".to_owned(),
            }),
            DesiredProjectionRef { artifact: desired },
            definition_digest,
            1,
            1,
            1,
            1,
        )
        .expect("construct state version");
        (StateVersion::V1(state), duckdb_bytes)
    }

    async fn assert_state_authority_conformance(
        authority: &dyn StateAuthority,
        store: &ArtifactStore,
        tenant: &TenantNamespace,
        integration: &CanonicalIntegrationId,
        run_id: &RunId,
    ) -> (StateCommitOutcome, Vec<u8>) {
        let initial = authority
            .current(integration)
            .await
            .expect("query initial state")
            .expect("known integration exists");
        assert_eq!(initial.state, None);
        assert_eq!(initial.established_at_sequence, None);
        assert!(initial.projected_through_sequence.is_some());

        let (candidate, duckdb_bytes) = state(store, tenant, integration, None, "first").await;
        let published = authority
            .publish_candidate(integration, candidate.clone())
            .await
            .expect("publish non-authoritative candidate");
        authority
            .load(integration, &published)
            .await
            .expect("load published candidate");
        assert_eq!(
            authority
                .current(integration)
                .await
                .expect("query after candidate publication")
                .expect("known integration"),
            initial,
            "candidate publication must not advance journal authority"
        );
        let first = authority
            .commit(integration, run_id, candidate.clone())
            .await
            .expect("commit first state");
        assert_eq!(first.disposition, StateCommitDisposition::Applied);
        assert_eq!(first.current.state, Some(first.committed.clone()));
        assert!(first.current.established_at_sequence.is_some());

        let duplicate = authority
            .commit(integration, run_id, candidate)
            .await
            .expect("adopt duplicate state");
        assert_eq!(
            duplicate.disposition,
            StateCommitDisposition::AlreadyDurable
        );
        assert_eq!(duplicate.committed, first.committed);

        let (stale, _) = state(store, tenant, integration, None, "stale-sibling").await;
        let stale_error = authority
            .commit(integration, run_id, stale)
            .await
            .expect_err("non-chaining state must fail");
        assert!(matches!(
            stale_error.current_context(),
            StateAuthorityError::StaleParent | StateAuthorityError::InvalidCandidate
        ));

        authority
            .load(integration, &first.committed)
            .await
            .expect("load committed state");
        let duckdb = authority
            .materialize_duckdb(integration, &first.committed)
            .await
            .expect("materialize committed DuckDB");
        assert_eq!(
            tokio::fs::read(duckdb).await.expect("read DuckDB"),
            duckdb_bytes
        );
        (first, duckdb_bytes)
    }

    #[tokio::test]
    async fn independent_reference_implementation_passes_state_conformance() {
        let cache = tempfile::tempdir().expect("create memory-store cache");
        let store = ArtifactStore::in_memory(cache.path()).expect("open memory store");
        let tenant = TenantNamespace::parse("phase3-reference").expect("valid tenant");
        let integration =
            CanonicalIntegrationId::parse("alice:state-reference").expect("valid integration");
        let run_id = RunId::generate();
        let authority =
            ReferenceStateAuthority::new(store.clone(), tenant.clone(), integration.clone());
        assert_state_authority_conformance(&authority, &store, &tenant, &integration, &run_id)
            .await;
    }

    #[tokio::test]
    async fn initial_empty_commit_duplicate_and_remote_only_recovery() {
        let rig = Rig::new("state-recovery").await;
        let authority = rig.authority();
        let (first, duckdb_bytes) = assert_state_authority_conformance(
            &authority,
            &rig.store,
            &rig.tenant,
            &rig.integration,
            &rig.run_id,
        )
        .await;

        rig.shutdown().await;
        drop(authority);
        drop(rig.store.clone());
        let fresh_cache = tempfile::tempdir().expect("create fresh empty cache");
        let fresh_store = ArtifactStore::local(rig._remote.path(), fresh_cache.path())
            .expect("reopen artifact store");
        let reopened = start_recovered(rig.location.clone(), ShardCommandConfig::default())
            .await
            .expect("reopen from remote journal");
        let recovered =
            JournalStateAuthority::new(fresh_store, rig.tenant.clone(), reopened.handle.clone());
        let cursor = recovered
            .current(&rig.integration)
            .await
            .expect("query recovered cursor")
            .expect("integration recovered");
        assert_eq!(cursor.state, Some(first.committed.clone()));
        recovered
            .load(&rig.integration, &first.committed)
            .await
            .expect("load state record");
        let duckdb = recovered
            .materialize_duckdb(&rig.integration, &first.committed)
            .await
            .expect("materialize DuckDB");
        assert_eq!(
            tokio::fs::read(duckdb).await.expect("read DuckDB"),
            duckdb_bytes
        );
        reopened
            .handle
            .shutdown()
            .await
            .expect("shutdown reopened shard");
    }

    #[tokio::test]
    async fn hint_is_event_triggered_and_deletion_or_corruption_cannot_change_state() {
        let mut rig = Rig::new("state-hint-repair").await;
        let authority = rig.authority();
        assert_eq!(
            repair_current_state_hint(&rig.store, &rig.tenant, &authority, &rig.integration)
                .await
                .expect("initial empty state needs no hint"),
            StateHintRepairOutcome::NoSourceEvent
        );
        let key = current_state_hint_key(&rig.tenant, &rig.integration).expect("hint key");
        assert!(matches!(
            rig.store
                .get_cas_document_bounded(&key, MAX_CURRENT_STATE_HINT_BYTES)
                .await
                .expect("read absent initial hint"),
            crate::blob::BoundedCasDocument::Missing
        ));
        let (candidate, duckdb_bytes) =
            state(&rig.store, &rig.tenant, &rig.integration, None, "hint").await;
        let committed = authority
            .commit(&rig.integration, &rig.run_id, candidate)
            .await
            .expect("commit state");
        let notified = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            rig.started.state_changes.receiver.recv(),
        )
        .await
        .expect("state notification must not stall")
        .expect("state notification sender remains open");
        assert_eq!(notified, rig.integration);

        assert_eq!(
            repair_current_state_hint(&rig.store, &rig.tenant, &authority, &rig.integration)
                .await
                .expect("create derived hint"),
            StateHintRepairOutcome::Created
        );
        let remote_hint = rig._remote.path().join(&key);
        tokio::fs::remove_file(&remote_hint)
            .await
            .expect("delete derived hint");

        let after_deletion = authority
            .current(&rig.integration)
            .await
            .expect("query state without hint")
            .expect("known integration");
        assert_eq!(after_deletion, committed.current);
        assert_eq!(
            tokio::fs::read(
                authority
                    .materialize_duckdb(&rig.integration, &committed.committed)
                    .await
                    .expect("materialize without hint")
            )
            .await
            .expect("read DuckDB"),
            duckdb_bytes
        );
        assert_eq!(
            repair_current_state_hint(&rig.store, &rig.tenant, &authority, &rig.integration)
                .await
                .expect("recreate deleted hint"),
            StateHintRepairOutcome::Created
        );

        tokio::fs::write(&remote_hint, b"{corrupt")
            .await
            .expect("corrupt derived hint");
        assert_eq!(
            authority
                .current(&rig.integration)
                .await
                .expect("query state with corrupt hint"),
            Some(committed.current.clone())
        );
        assert_eq!(
            repair_current_state_hint(&rig.store, &rig.tenant, &authority, &rig.integration)
                .await
                .expect("replace corrupt hint"),
            StateHintRepairOutcome::Replaced
        );
        assert_eq!(
            repair_current_state_hint(&rig.store, &rig.tenant, &authority, &rig.integration)
                .await
                .expect("adopt current hint"),
            StateHintRepairOutcome::Current
        );
        rig.shutdown().await;
    }

    #[tokio::test]
    async fn delayed_repairer_cannot_regress_a_valid_ahead_hint() {
        let rig = Rig::new("state-hint-monotonic").await;
        let authority = rig.authority();
        let (candidate, _) =
            state(&rig.store, &rig.tenant, &rig.integration, None, "monotonic").await;
        authority
            .commit(&rig.integration, &rig.run_id, candidate)
            .await
            .expect("commit state");
        repair_current_state_hint(&rig.store, &rig.tenant, &authority, &rig.integration)
            .await
            .expect("create hint");
        let key = current_state_hint_key(&rig.tenant, &rig.integration).expect("hint key");
        let crate::blob::BoundedCasDocument::Present(bytes, version) = rig
            .store
            .get_cas_document_bounded(&key, MAX_CURRENT_STATE_HINT_BYTES)
            .await
            .expect("read hint")
        else {
            panic!("hint must exist");
        };
        let CurrentStateHint::V1(mut ahead) =
            CurrentStateHint::decode(&bytes).expect("decode current hint");
        ahead.source_log_sequence = ahead
            .source_log_sequence
            .checked_add(1)
            .expect("fixture sequence has room");
        let ahead = CurrentStateHint::V1(ahead);
        let ahead_bytes = ahead.encode().expect("encode ahead hint");
        assert!(matches!(
            rig.store
                .compare_and_swap_cas_document(&key, &version, ahead_bytes.clone())
                .await
                .expect("install ahead hint"),
            CasWrite::Written(_)
        ));

        assert_eq!(
            repair_current_state_hint(&rig.store, &rig.tenant, &authority, &rig.integration)
                .await
                .expect("evaluate ahead hint"),
            StateHintRepairOutcome::AheadUnverified
        );
        let crate::blob::BoundedCasDocument::Present(after, _) = rig
            .store
            .get_cas_document_bounded(&key, MAX_CURRENT_STATE_HINT_BYTES)
            .await
            .expect("read retained hint")
        else {
            panic!("hint must remain present");
        };
        assert_eq!(after.as_ref(), ahead_bytes.as_slice());
        rig.shutdown().await;
    }

    #[tokio::test]
    async fn restart_rebuilds_a_missing_hint_from_replayed_journal_state() {
        let rig = Rig::new("state-hint-restart").await;
        let authority = rig.authority();
        let (candidate, _) =
            state(&rig.store, &rig.tenant, &rig.integration, None, "restart").await;
        let committed = authority
            .commit(&rig.integration, &rig.run_id, candidate)
            .await
            .expect("commit state");
        rig.shutdown().await;

        let reopened = start_recovered(rig.location.clone(), ShardCommandConfig::default())
            .await
            .expect("reopen from journal");
        assert_eq!(
            reopened.state_changes.initial,
            vec![rig.integration.clone()]
        );
        let reopened_authority: Arc<dyn StateAuthority> = Arc::new(JournalStateAuthority::new(
            rig.store.clone(),
            rig.tenant.clone(),
            reopened.handle.clone(),
        ));
        assert_eq!(
            reopened_authority
                .current(&rig.integration)
                .await
                .expect("query replayed state")
                .expect("known integration"),
            committed.current
        );
        let key = current_state_hint_key(&rig.tenant, &rig.integration).expect("hint key");
        let repair_task = start_state_hint_repairer(
            rig.store.clone(),
            rig.tenant.clone(),
            reopened_authority,
            reopened.state_changes,
        );
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                if matches!(
                    rig.store
                        .get_cas_document_bounded(&key, MAX_CURRENT_STATE_HINT_BYTES)
                        .await
                        .expect("read rebuilt hint"),
                    crate::blob::BoundedCasDocument::Present(_, _)
                ) {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("startup hint repair must complete");
        reopened
            .handle
            .shutdown()
            .await
            .expect("shutdown reopened shard");
        reopened
            .task
            .await
            .expect("join shard")
            .expect("clean shard");
        repair_task.await.expect("join repairer");
    }

    #[tokio::test]
    async fn concurrent_siblings_accept_exactly_one_child() {
        let rig = Rig::new("state-siblings").await;
        let authority = rig.authority();
        let (left, _) = state(&rig.store, &rig.tenant, &rig.integration, None, "left").await;
        let (right, _) = state(&rig.store, &rig.tenant, &rig.integration, None, "right").await;
        let (left_result, right_result) = tokio::join!(
            authority.commit(&rig.integration, &rig.run_id, left),
            authority.commit(&rig.integration, &rig.run_id, right),
        );
        let successes = usize::from(left_result.is_ok()) + usize::from(right_result.is_ok());
        assert_eq!(successes, 1);
        let failure = left_result
            .err()
            .or_else(|| right_result.err())
            .expect("one failure");
        assert!(matches!(
            failure.current_context(),
            StateAuthorityError::InvalidCandidate | StateAuthorityError::StaleParent
        ));
        let cursor = authority
            .current(&rig.integration)
            .await
            .expect("query winning child")
            .expect("integration exists");
        assert!(cursor.state.is_some());
        rig.shutdown().await;
    }

    #[tokio::test]
    async fn corrupt_or_foreign_state_artifacts_fail_closed() {
        let rig = Rig::new("state-integrity").await;
        let authority = rig.authority();
        let (candidate, _) =
            state(&rig.store, &rig.tenant, &rig.integration, None, "integrity").await;
        let committed = authority
            .commit(&rig.integration, &rig.run_id, candidate)
            .await
            .expect("commit state")
            .committed;

        let mut foreign = committed.clone();
        let BlobRef::V1(foreign_artifact) = &mut foreign.artifact;
        foreign_artifact.key = "foreign/state.json".to_owned();
        let foreign_error = authority
            .load(&rig.integration, &foreign)
            .await
            .expect_err("foreign state key must fail");
        assert_eq!(
            foreign_error.current_context(),
            &StateAuthorityError::ArtifactIntegrity
        );

        rig.store
            .evict_cached(&committed.artifact)
            .await
            .expect("evict state cache");
        let remote_path = rig._remote.path().join(&committed.artifact.current().key);
        let original_size = committed.artifact.current().size;
        tokio::fs::write(
            remote_path,
            vec![b'x'; usize::try_from(original_size).expect("fixture size fits usize")],
        )
        .await
        .expect("corrupt remote state artifact");
        let corrupt_error = authority
            .load(&rig.integration, &committed)
            .await
            .expect_err("corrupt state bytes must fail");
        assert_eq!(
            corrupt_error.current_context(),
            &StateAuthorityError::ArtifactIntegrity
        );
        rig.shutdown().await;
    }

    #[tokio::test]
    async fn unknown_and_misrouted_integrations_are_not_initial_state() {
        let rig = Rig::new("state-routing").await;
        let authority = rig.authority();
        let owner_shard = routing::shard(&rig.integration);
        let same_shard = (0..10_000)
            .map(|value| {
                CanonicalIntegrationId::parse(format!("alice:unknown-{value}"))
                    .expect("valid unknown integration")
            })
            .find(|candidate| routing::shard(candidate) == owner_shard)
            .expect("find same-shard integration");
        assert_eq!(
            authority
                .current(&same_shard)
                .await
                .expect("query unknown same-shard integration"),
            None
        );

        let other_shard = (0..10_000)
            .map(|value| {
                CanonicalIntegrationId::parse(format!("bob:misrouted-{value}"))
                    .expect("valid misrouted integration")
            })
            .find(|candidate| routing::shard(candidate) != owner_shard)
            .expect("find other-shard integration");
        let error = authority
            .current(&other_shard)
            .await
            .expect_err("misrouted query must fail");
        assert_eq!(
            error.current_context(),
            &StateAuthorityError::InvalidCandidate
        );
        rig.shutdown().await;
    }
}
