//! Durable submission receipts and admission pointers.

use crate::orchestrator::routing::TenantKeyspace as _;
use error_stack::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::blob::{ArtifactStore, CasWrite};

use super::baseline::ensure_control_baseline;
use super::events::{
    immutable_input_digest, InputRef, JournalEvent, JournalEventV1, JournalRecordV1, PolicyRef,
    RunAcceptedV1,
};
use super::ids::{CanonicalIntegrationId, EventId, RunId, TenantNamespace};
use super::internal_metadata::{RunLocatorRecord, MAX_RUN_LOCATOR_RECORD_BYTES};
use super::record_io::{
    compare_and_swap as compare_and_swap_record, create as create_record,
    read_mutable as read_mutable_record, read_strict as read_record,
};
use super::registry::{
    reject_unknown_fields, AlgorithmVersion, CompatError, DurabilityClass, DurableRecord,
    MigrationPolicy, MutableCasRecord, PureUpcastRecord, RecordDeclaration, VersionedRecord,
};
use super::routing::{self, shard_path, Keyspace, Shard, ROUTING_VERSION};
use super::DurableError;

const MAX_KNOWN_SHARD_MARKER_BYTES: usize = 4 * 1024;
const MAX_READY_RECEIPT_BYTES: usize = 256 * 1024;
const MAX_ADMISSION_POINTER_BYTES: usize = 16 * 1024;
const MAX_ADMISSION_ATTEMPTS: usize = 8;

pub(crate) static ADMISSION_POINTER_DECLARATION: RecordDeclaration = RecordDeclaration {
    name: "admission_pointer",
    owning_module: "orchestrator::submission",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[
        AlgorithmVersion {
            name: "immutable_input_digest",
            version: 1,
        },
        AlgorithmVersion {
            name: "run_accepted_event_identity",
            version: 1,
        },
    ],
    durability: DurabilityClass::MutableCas,
    migration: MigrationPolicy::MutableCas,
};

pub(crate) static KNOWN_SHARD_MARKER_DECLARATION: RecordDeclaration = RecordDeclaration {
    name: "known_shard_marker",
    owning_module: "orchestrator::submission",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[AlgorithmVersion {
        name: "routing",
        version: ROUTING_VERSION,
    }],
    durability: DurabilityClass::ImmutableArtifact,
    migration: MigrationPolicy::PureUpcast,
};

pub(crate) static READY_RECEIPT_DECLARATION: RecordDeclaration = RecordDeclaration {
    name: "ready_receipt",
    owning_module: "orchestrator::submission",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[
        AlgorithmVersion {
            name: "immutable_input_digest",
            version: 1,
        },
        AlgorithmVersion {
            name: "run_accepted_event_identity",
            version: 1,
        },
    ],
    durability: DurabilityClass::ImmutableArtifact,
    migration: MigrationPolicy::PureUpcast,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum KnownShardMarker {
    V1(KnownShardMarkerV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KnownShardMarkerV1 {
    pub shard: u16,
    pub routing_version: u32,
}

impl KnownShardMarker {
    pub fn canonical(shard: Shard) -> Self {
        Self::V1(KnownShardMarkerV1 {
            shard: u16::from(shard.get()),
            routing_version: ROUTING_VERSION,
        })
    }

    fn wire(&self) -> &KnownShardMarkerV1 {
        match self {
            Self::V1(marker) => marker,
        }
    }

    fn into_current(self) -> Result<KnownShardMarkerV1, CompatError> {
        validate_known_shard(self.wire())?;
        let Self::V1(marker) = self;
        Ok(marker)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum ReadyReceipt {
    V1(ReadyReceiptV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadyReceiptV1 {
    pub integration_id: CanonicalIntegrationId,
    pub run_id: RunId,
    pub immutable_input: InputRef,
    pub immutable_input_digest: String,
    pub policy: PolicyRef,
    pub submitted_at: String,
}

impl ReadyReceiptV1 {
    pub fn new(
        integration_id: CanonicalIntegrationId,
        run_id: RunId,
        immutable_input: InputRef,
        policy: PolicyRef,
        submitted_at: String,
    ) -> Result<Self, CompatError> {
        let immutable_input_digest = immutable_input_digest(&immutable_input)?;
        let receipt = Self {
            integration_id,
            run_id,
            immutable_input,
            immutable_input_digest,
            policy,
            submitted_at,
        };
        validate_ready_receipt(&receipt)?;
        Ok(receipt)
    }

    pub fn run_accepted_record(&self) -> Result<JournalRecordV1, CompatError> {
        JournalRecordV1::new(
            self.integration_id.clone(),
            JournalEvent::V1(JournalEventV1::RunAccepted(RunAcceptedV1 {
                run_id: self.run_id.clone(),
                immutable_input: self.immutable_input.clone(),
                policy: self.policy.clone(),
                submitted_at: self.submitted_at.clone(),
            })),
        )
    }

    pub fn initial_revision(&self) -> Result<EventId, CompatError> {
        self.run_accepted_record().map(|record| record.event_id)
    }
}

impl ReadyReceipt {
    pub fn into_current(self) -> Result<ReadyReceiptV1, CompatError> {
        let Self::V1(receipt) = self;
        validate_ready_receipt(&receipt)?;
        Ok(receipt)
    }

    pub fn try_current(&self) -> Result<&ReadyReceiptV1, CompatError> {
        let receipt = self.wire();
        validate_ready_receipt(receipt)?;
        Ok(receipt)
    }

    fn wire(&self) -> &ReadyReceiptV1 {
        match self {
            Self::V1(receipt) => receipt,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum AdmissionPointer {
    V1(AdmissionPointerV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdmissionPointerV1 {
    pub integration_id: CanonicalIntegrationId,
    pub run_id: RunId,
    pub receipt_key: String,
    pub immutable_input_digest: String,
    pub initial_revision: EventId,
    pub submitted_at: String,
    pub state: AdmissionPointerStateV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionPointerStateV1 {
    Active,
    Terminal,
}

impl AdmissionPointerV1 {
    fn from_receipt(receipt: &ReadyReceiptV1, receipt_key: String) -> Result<Self, CompatError> {
        let pointer = Self {
            integration_id: receipt.integration_id.clone(),
            run_id: receipt.run_id.clone(),
            receipt_key,
            immutable_input_digest: receipt.immutable_input_digest.clone(),
            initial_revision: receipt.initial_revision()?,
            submitted_at: receipt.submitted_at.clone(),
            state: AdmissionPointerStateV1::Active,
        };
        validate_admission_pointer(&pointer)?;
        Ok(pointer)
    }
}

impl AdmissionPointer {
    pub fn into_current(self) -> Result<AdmissionPointerV1, CompatError> {
        let Self::V1(pointer) = self;
        validate_admission_pointer(&pointer)?;
        Ok(pointer)
    }

    pub fn try_current(&self) -> Result<&AdmissionPointerV1, CompatError> {
        let pointer = self.wire();
        validate_admission_pointer(pointer)?;
        Ok(pointer)
    }

    fn wire(&self) -> &AdmissionPointerV1 {
        match self {
            Self::V1(pointer) => pointer,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmitOutcome {
    pub run_id: RunId,
    pub initial_revision: EventId,
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredReadyReceipt {
    pub key: String,
    pub shard: Shard,
    pub receipt: ReadyReceiptV1,
}

pub async fn submit_durable(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    integration_id: CanonicalIntegrationId,
    immutable_input: InputRef,
    policy: PolicyRef,
    submitted_at: String,
) -> Result<SubmitOutcome, Report<DurableError>> {
    submit_durable_for_run(
        store,
        tenant,
        integration_id,
        RunId::generate(),
        immutable_input,
        policy,
        submitted_at,
    )
    .await
}

/// Lost-response-safe submission with a caller-proposed run identity.
pub(crate) async fn submit_durable_for_run(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    integration_id: CanonicalIntegrationId,
    run_id: RunId,
    immutable_input: InputRef,
    policy: PolicyRef,
    submitted_at: String,
) -> Result<SubmitOutcome, Report<DurableError>> {
    ensure_control_baseline(store, tenant)
        .await
        .change_context(DurableError)
        .attach_printable("validate control baseline before submission")?;
    ensure_run_locator(store, tenant, &run_id, &integration_id).await?;
    let routed = routing::route(&integration_id);
    let paths = Keyspace::for_tenant(tenant);
    ensure_known_shard_marker(store, &paths, routed.shard).await?;

    let receipt = ReadyReceiptV1::new(
        integration_id,
        run_id,
        immutable_input,
        policy,
        submitted_at,
    )
    .change_context(DurableError)?;
    let receipt_key = paths.ready_receipt(routed.shard, &receipt.run_id);
    let receipt_record = ReadyReceipt::V1(receipt.clone());
    create_ready_receipt(store, &receipt_key, &receipt_record).await?;

    let proposed = AdmissionPointerV1::from_receipt(&receipt, receipt_key)
        .map(AdmissionPointer::V1)
        .change_context(DurableError)?;
    let admission_key = paths.admission(&routed.integration_path);
    for _attempt in 0..MAX_ADMISSION_ATTEMPTS {
        if let Some((winner, version)) = read_mutable_record::<AdmissionPointer>(
            store,
            &admission_key,
            MAX_ADMISSION_POINTER_BYTES,
        )
        .await
        .change_context(DurableError)?
        {
            if winner.try_current().change_context(DurableError)?.state
                == AdmissionPointerStateV1::Active
            {
                return outcome_from_pointer(
                    &paths,
                    &receipt.integration_id,
                    routed.shard,
                    winner,
                    false,
                );
            }
            match compare_and_swap_record(store, &admission_key, &version, &proposed)
                .await
                .change_context(DurableError)?
            {
                CasWrite::Written(_) => {
                    return outcome_from_pointer(
                        &paths,
                        &receipt.integration_id,
                        routed.shard,
                        proposed.clone(),
                        true,
                    );
                }
                CasWrite::Conflict => continue,
            }
        }
        match create_record(store, &admission_key, &proposed)
            .await
            .change_context(DurableError)?
        {
            CasWrite::Written(_) => {
                let (winner, _version) = read_mutable_record::<AdmissionPointer>(
                    store,
                    &admission_key,
                    MAX_ADMISSION_POINTER_BYTES,
                )
                .await
                .change_context(DurableError)?
                .ok_or_else(|| {
                    Report::new(DurableError)
                        .attach_printable("admission pointer missing after successful create")
                })?;
                if winner == proposed {
                    return outcome_from_pointer(
                        &paths,
                        &receipt.integration_id,
                        routed.shard,
                        winner,
                        true,
                    );
                }
                if winner.try_current().change_context(DurableError)?.state
                    == AdmissionPointerStateV1::Active
                {
                    return outcome_from_pointer(
                        &paths,
                        &receipt.integration_id,
                        routed.shard,
                        winner,
                        false,
                    );
                }
            }
            CasWrite::Conflict => {}
        }
    }
    Err(Report::new(DurableError).attach_printable(
        "admission pointer remained unstable after eight conditional-create attempts",
    ))
}

async fn ensure_run_locator(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    run_id: &RunId,
    integration_id: &CanonicalIntegrationId,
) -> Result<(), Report<DurableError>> {
    let key = Keyspace::for_tenant(tenant).run_locator(run_id);
    let proposed = RunLocatorRecord::current(integration_id.clone());
    match create_record(store, &key, &proposed)
        .await
        .change_context(DurableError)?
    {
        CasWrite::Written(_) | CasWrite::Conflict => {}
    }
    let actual = read_record::<RunLocatorRecord>(store, &key, MAX_RUN_LOCATOR_RECORD_BYTES)
        .await
        .change_context(DurableError)?
        .ok_or_else(|| {
            Report::new(DurableError).attach_printable("run locator missing after create")
        })?
        .0
        .into_current();
    if &actual != integration_id {
        return Err(Report::new(DurableError).attach_printable("run locator integration conflict"));
    }
    Ok(())
}

/// Retires the integration's depth-one admission when it still names one of
/// the given terminal runs, so the next submission can replace it with a
/// fresh run instead of attaching to a finished one forever.
///
/// The stable key is never deleted. Retirement and replacement are exact CAS
/// transitions, so a lost response or provider retry cannot delete a newer
/// admission.
pub(crate) async fn retire_admission_for_terminal_runs(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    integration_id: &CanonicalIntegrationId,
    terminal_runs: &std::collections::BTreeSet<RunId>,
) -> Result<bool, Report<DurableError>> {
    let paths = Keyspace::for_tenant(tenant);
    let routed = routing::route(integration_id);
    let admission_key = paths.admission(&routed.integration_path);
    for _attempt in 0..MAX_ADMISSION_ATTEMPTS {
        let Some((pointer, version)) = read_mutable_record::<AdmissionPointer>(
            store,
            &admission_key,
            MAX_ADMISSION_POINTER_BYTES,
        )
        .await
        .change_context(DurableError)?
        else {
            return Ok(false);
        };
        let mut pointer = pointer.into_current().change_context(DurableError)?;
        if &pointer.integration_id != integration_id || !terminal_runs.contains(&pointer.run_id) {
            return Ok(false);
        }
        if pointer.state == AdmissionPointerStateV1::Terminal {
            return Ok(false);
        }
        pointer.state = AdmissionPointerStateV1::Terminal;
        let retired = AdmissionPointer::V1(pointer);
        match compare_and_swap_record(store, &admission_key, &version, &retired)
            .await
            .change_context(DurableError)?
        {
            CasWrite::Written(_) => return Ok(true),
            CasWrite::Conflict => {}
        }
    }
    Err(Report::new(DurableError)
        .attach_printable("admission pointer remained unstable while retiring a terminal run"))
}

pub async fn discover_ready_receipts(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
) -> Result<Vec<DiscoveredReadyReceipt>, Report<DurableError>> {
    let paths = Keyspace::for_tenant(tenant);
    let mut discovered = Vec::new();
    let mut objects = store
        .list(&paths.ready())
        .await
        .change_context(DurableError)
        .attach_printable("list ready receipts")?;
    objects.sort_by(|left, right| left.key.cmp(&right.key));
    for object in objects {
        let Some((shard, path_run_id)) = parse_ready_receipt_key(&paths, &object.key) else {
            tracing::warn!(
                key = %object.key,
                "ignoring non-canonical object under ready receipt prefix"
            );
            continue;
        };
        let Some((record, _version)) =
            read_record::<ReadyReceipt>(store, &object.key, MAX_READY_RECEIPT_BYTES)
                .await
                .change_context(DurableError)?
        else {
            continue;
        };
        let receipt = record.into_current().change_context(DurableError)?;
        if receipt.run_id != path_run_id || routing::shard(&receipt.integration_id) != shard {
            return Err(Report::new(DurableError).attach_printable(format!(
                "ready receipt {:?} disagrees with its canonical path",
                object.key
            )));
        }
        discovered.push(DiscoveredReadyReceipt {
            key: object.key,
            shard,
            receipt,
        });
    }
    Ok(discovered)
}

pub async fn discover_known_shards(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
) -> Result<Vec<Shard>, Report<DurableError>> {
    let paths = Keyspace::for_tenant(tenant);
    let prefix = format!("{}/", paths.known_shards());
    let mut shards = Vec::new();
    let mut objects = store
        .list(&paths.known_shards())
        .await
        .change_context(DurableError)
        .attach_printable("list known-shard markers")?;
    objects.sort_by(|left, right| left.key.cmp(&right.key));
    for object in objects {
        let component = object
            .key
            .strip_prefix(&prefix)
            .and_then(|value| value.strip_suffix(".json"))
            .filter(|value| !value.contains('/'))
            .ok_or_else(|| {
                Report::new(DurableError).attach_printable(format!(
                    "noncanonical object under known-shard prefix: {:?}",
                    object.key
                ))
            })?;
        let raw = u16::from_str_radix(component, 16).map_err(|error| {
            Report::new(error)
                .change_context(DurableError)
                .attach_printable(format!("invalid known-shard path {:?}", object.key))
        })?;
        let shard = Shard::try_from(raw).change_context(DurableError)?;
        if shard_path(shard) != component {
            return Err(Report::new(DurableError).attach_printable(format!(
                "known-shard path {:?} is not canonical",
                object.key
            )));
        }
        let marker =
            read_record::<KnownShardMarker>(store, &object.key, MAX_KNOWN_SHARD_MARKER_BYTES)
                .await
                .change_context(DurableError)?
                .ok_or_else(|| {
                    Report::new(DurableError).attach_printable(format!(
                        "known-shard marker {:?} disappeared",
                        object.key
                    ))
                })?
                .0
                .into_current()
                .change_context(DurableError)?;
        if marker.shard != raw || marker.routing_version != ROUTING_VERSION {
            return Err(Report::new(DurableError).attach_printable(format!(
                "known-shard marker {:?} disagrees with its canonical path",
                object.key
            )));
        }
        shards.push(shard);
    }
    Ok(shards)
}

pub async fn admitted_run_record(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    discovered: &DiscoveredReadyReceipt,
) -> Result<Option<JournalRecordV1>, Report<DurableError>> {
    if routing::shard(&discovered.receipt.integration_id) != discovered.shard {
        return Err(Report::new(DurableError)
            .attach_printable("discovered receipt integration disagrees with its shard"));
    }
    let paths = Keyspace::for_tenant(tenant);
    let admission_key = paths.admission(&routing::integration_path(
        &discovered.receipt.integration_id,
    ));
    let Some((pointer, _version)) =
        read_mutable_record::<AdmissionPointer>(store, &admission_key, MAX_ADMISSION_POINTER_BYTES)
            .await
            .change_context(DurableError)?
    else {
        return Ok(None);
    };
    let pointer = pointer.into_current().change_context(DurableError)?;
    if pointer.state != AdmissionPointerStateV1::Active
        || pointer.integration_id != discovered.receipt.integration_id
        || pointer.run_id != discovered.receipt.run_id
    {
        return Ok(None);
    }
    let initial_revision = discovered
        .receipt
        .initial_revision()
        .change_context(DurableError)?;
    if pointer.receipt_key != discovered.key
        || pointer.immutable_input_digest != discovered.receipt.immutable_input_digest
        || pointer.initial_revision != initial_revision
    {
        return Err(Report::new(DurableError)
            .attach_printable("admission pointer disagrees with the named ready receipt"));
    }
    discovered
        .receipt
        .run_accepted_record()
        .map(Some)
        .change_context(DurableError)
}

/// Resolves cancellation-before-acceptance by following the integration's
/// admission pointer to its exact immutable receipt. This deliberately avoids
/// LIST: object discovery order must never decide whether a run exists.
pub(crate) async fn exact_admitted_ready_receipt(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    integration_id: &CanonicalIntegrationId,
    run_id: &RunId,
) -> Result<Option<DiscoveredReadyReceipt>, Report<DurableError>> {
    let routed = routing::route(integration_id);
    let paths = Keyspace::for_tenant(tenant);
    let admission_key = paths.admission(&routed.integration_path);
    let Some((pointer, _version)) =
        read_mutable_record::<AdmissionPointer>(store, &admission_key, MAX_ADMISSION_POINTER_BYTES)
            .await
            .change_context(DurableError)?
    else {
        return Ok(None);
    };
    let pointer = pointer.into_current().change_context(DurableError)?;
    if pointer.state != AdmissionPointerStateV1::Active
        || &pointer.integration_id != integration_id
        || &pointer.run_id != run_id
    {
        return Ok(None);
    }
    let Some((path_shard, path_run_id)) = parse_ready_receipt_key(&paths, &pointer.receipt_key)
    else {
        return Err(Report::new(DurableError)
            .attach_printable("admission pointer contains a noncanonical receipt key"));
    };
    if path_shard != routed.shard || path_run_id != *run_id {
        return Err(Report::new(DurableError).attach_printable(
            "admission pointer receipt key disagrees with its integration shard or run ID",
        ));
    }
    let Some((receipt, _version)) =
        read_record::<ReadyReceipt>(store, &pointer.receipt_key, MAX_READY_RECEIPT_BYTES)
            .await
            .change_context(DurableError)?
    else {
        return Err(Report::new(DurableError)
            .attach_printable("admission pointer names a missing ready receipt"));
    };
    let receipt = receipt.into_current().change_context(DurableError)?;
    let discovered = DiscoveredReadyReceipt {
        key: pointer.receipt_key,
        shard: path_shard,
        receipt,
    };
    let Some(_record) = admitted_run_record(store, tenant, &discovered).await? else {
        // The admission changed while it was being resolved. The caller must
        // re-check the journal projection before deciding NotFound.
        return Ok(None);
    };
    Ok(Some(discovered))
}

/// Returns the deterministic initial revision while this exact run still owns
/// the integration's active admission. This remains available after receipt
/// deletion and bridges read-only projection visibility lag without making
/// the admission pointer an execution authority.
pub(crate) async fn active_admission_revision(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    integration_id: &CanonicalIntegrationId,
    run_id: &RunId,
) -> Result<Option<EventId>, Report<DurableError>> {
    let routed = routing::route(integration_id);
    let key = Keyspace::for_tenant(tenant).admission(&routed.integration_path);
    let Some((pointer, _version)) =
        read_mutable_record::<AdmissionPointer>(store, &key, MAX_ADMISSION_POINTER_BYTES)
            .await
            .change_context(DurableError)?
    else {
        return Ok(None);
    };
    let pointer = pointer.into_current().change_context(DurableError)?;
    if &pointer.integration_id != integration_id {
        return Err(Report::new(DurableError)
            .attach_printable("admission pointer path disagrees with its integration identity"));
    }
    if pointer.state != AdmissionPointerStateV1::Active || &pointer.run_id != run_id {
        return Ok(None);
    }
    Ok(Some(pointer.initial_revision))
}

pub async fn delete_ready_receipt(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    shard: Shard,
    run_id: &RunId,
) -> Result<(), Report<DurableError>> {
    let key = Keyspace::for_tenant(tenant).ready_receipt(shard, run_id);
    store
        .delete_control(&key)
        .await
        .change_context(DurableError)
        .attach_printable("delete remotely durable ready receipt")
}

pub(crate) async fn ensure_known_shard_marker(
    store: &ArtifactStore,
    paths: &Keyspace,
    shard: Shard,
) -> Result<(), Report<DurableError>> {
    let key = paths.known_shard(shard);
    let expected = KnownShardMarker::canonical(shard);
    match create_record(store, &key, &expected)
        .await
        .change_context(DurableError)?
    {
        CasWrite::Written(_) => {}
        CasWrite::Conflict => {}
    }
    let Some((actual, _version)) =
        read_record::<KnownShardMarker>(store, &key, MAX_KNOWN_SHARD_MARKER_BYTES)
            .await
            .change_context(DurableError)
            .attach_printable("read back known-shard marker")?
    else {
        return Err(Report::new(DurableError)
            .attach_printable("known-shard marker missing after conditional create"));
    };
    let actual = actual.into_current().change_context(DurableError)?;
    let expected = expected.into_current().change_context(DurableError)?;
    if actual != expected {
        return Err(Report::new(DurableError).attach_printable(format!(
            "known-shard marker {key:?} conflicts with the current routing identity"
        )));
    }
    Ok(())
}

fn outcome_from_pointer(
    paths: &Keyspace,
    expected_integration: &CanonicalIntegrationId,
    expected_shard: Shard,
    pointer: AdmissionPointer,
    created: bool,
) -> Result<SubmitOutcome, Report<DurableError>> {
    let pointer = pointer.into_current().change_context(DurableError)?;
    if pointer.state != AdmissionPointerStateV1::Active {
        return Err(Report::new(DurableError)
            .attach_printable("terminal admission pointer cannot accept a submission"));
    }
    if &pointer.integration_id != expected_integration {
        return Err(Report::new(DurableError)
            .attach_printable("admission pointer names a different integration"));
    }
    let Some((actual_shard, path_run_id)) = parse_ready_receipt_key(paths, &pointer.receipt_key)
    else {
        return Err(Report::new(DurableError)
            .attach_printable("admission pointer contains a noncanonical receipt key"));
    };
    if actual_shard != expected_shard || path_run_id != pointer.run_id {
        return Err(Report::new(DurableError).attach_printable(
            "admission pointer receipt key disagrees with its routed shard or run ID",
        ));
    }
    Ok(SubmitOutcome {
        run_id: pointer.run_id,
        initial_revision: pointer.initial_revision,
        created,
    })
}

fn parse_ready_receipt_key(paths: &Keyspace, key: &str) -> Option<(Shard, RunId)> {
    let relative = key.strip_prefix(&format!("{}/", paths.ready()))?;
    let mut components = relative.split('/');
    let shard = components.next()?;
    let file = components.next()?;
    if components.next().is_some()
        || shard.len() != 3
        || !shard
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }
    let shard = Shard::try_from(u16::from_str_radix(shard, 16).ok()?).ok()?;
    let run_id = RunId::parse(file.strip_suffix(".json")?).ok()?;
    Some((shard, run_id))
}

async fn create_ready_receipt(
    store: &ArtifactStore,
    key: &str,
    proposed: &ReadyReceipt,
) -> Result<(), Report<DurableError>> {
    match create_record(store, key, proposed)
        .await
        .change_context(DurableError)?
    {
        CasWrite::Written(_) | CasWrite::Conflict => {}
    }
    let (actual, _version) = read_record::<ReadyReceipt>(store, key, MAX_READY_RECEIPT_BYTES)
        .await
        .change_context(DurableError)?
        .ok_or_else(|| {
            Report::new(DurableError).attach_printable("ready receipt missing after create")
        })?;
    let proposed = proposed.try_current().change_context(DurableError)?;
    let actual = actual.into_current().change_context(DurableError)?;
    let same_semantic_receipt = actual.integration_id == proposed.integration_id
        && actual.run_id == proposed.run_id
        && actual.immutable_input_digest == proposed.immutable_input_digest
        && actual.initial_revision().change_context(DurableError)?
            == proposed.initial_revision().change_context(DurableError)?;
    if !same_semantic_receipt {
        return Err(Report::new(DurableError).attach_printable(format!(
            "immutable ready receipt at {key:?} conflicts with the proposed semantic identity"
        )));
    }
    Ok(())
}

fn validate_known_shard(marker: &KnownShardMarkerV1) -> Result<(), CompatError> {
    Shard::try_from(marker.shard)
        .map_err(|error| malformed(KnownShardMarker::declaration().name, error.to_string()))?;
    if marker.routing_version != ROUTING_VERSION {
        return Err(malformed(
            KnownShardMarker::declaration().name,
            format!(
                "routing_version must be {ROUTING_VERSION}, found {}",
                marker.routing_version
            ),
        ));
    }
    Ok(())
}

fn validate_ready_receipt(receipt: &ReadyReceiptV1) -> Result<(), CompatError> {
    validate_timestamp(
        ReadyReceipt::declaration().name,
        "submitted_at",
        &receipt.submitted_at,
    )?;
    let expected = immutable_input_digest(&receipt.immutable_input)?;
    if receipt.immutable_input_digest != expected {
        return Err(CompatError::Conflict {
            name: ReadyReceipt::declaration().name,
            message: format!(
                "immutable_input_digest mismatch: expected {expected}, found {}",
                receipt.immutable_input_digest
            ),
        });
    }
    receipt.run_accepted_record()?;
    Ok(())
}

fn validate_admission_pointer(pointer: &AdmissionPointerV1) -> Result<(), CompatError> {
    validate_sha256(
        AdmissionPointer::declaration().name,
        "immutable_input_digest",
        &pointer.immutable_input_digest,
    )?;
    validate_timestamp(
        AdmissionPointer::declaration().name,
        "submitted_at",
        &pointer.submitted_at,
    )?;
    if pointer.receipt_key.is_empty()
        || pointer.receipt_key.len() > 4096
        || pointer.receipt_key.chars().any(char::is_control)
        || pointer.receipt_key.contains("..")
        || pointer.receipt_key.contains('\\')
    {
        return Err(malformed(
            AdmissionPointer::declaration().name,
            "receipt_key is not a bounded canonical object key".to_owned(),
        ));
    }
    let Some((receipt_shard, receipt_run_id)) =
        parse_ready_receipt_key_for_validation(&pointer.receipt_key)
    else {
        return Err(malformed(
            AdmissionPointer::declaration().name,
            "receipt_key is not a canonical ready-receipt key".to_owned(),
        ));
    };
    if receipt_shard != routing::shard(&pointer.integration_id) || receipt_run_id != pointer.run_id
    {
        return Err(CompatError::Conflict {
            name: AdmissionPointer::declaration().name,
            message: "integration identity or run ID disagrees with the receipt key".to_owned(),
        });
    }
    Ok(())
}

fn parse_ready_receipt_key_for_validation(key: &str) -> Option<(Shard, RunId)> {
    let ready = key.split_once("/ready/")?.1;
    let mut components = ready.split('/');
    let shard = components.next()?;
    let run = components.next()?;
    if components.next().is_some()
        || shard.len() != 3
        || !shard
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }
    let shard = Shard::try_from(u16::from_str_radix(shard, 16).ok()?).ok()?;
    let run_id = RunId::parse(run.strip_suffix(".json")?).ok()?;
    Some((shard, run_id))
}

fn validate_timestamp(name: &'static str, field: &str, value: &str) -> Result<(), CompatError> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|_timestamp| ())
        .map_err(|error| malformed(name, format!("{field} must be RFC 3339: {error}")))
}

fn validate_sha256(name: &'static str, field: &str, value: &str) -> Result<(), CompatError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(malformed(
            name,
            format!("{field} must be 64 lowercase hexadecimal characters"),
        ))
    }
}

fn malformed(name: &'static str, message: String) -> CompatError {
    CompatError::Malformed { name, message }
}

fn decode_submission_record<T: for<'de> Deserialize<'de>>(
    bytes: &[u8],
    name: &'static str,
    maximum: usize,
) -> Result<T, CompatError> {
    if bytes.len() > maximum {
        return Err(malformed(
            name,
            format!("record is {} bytes; maximum is {maximum}", bytes.len()),
        ));
    }
    let value: Value =
        serde_json::from_slice(bytes).map_err(|error| malformed(name, error.to_string()))?;
    reject_unknown_fields(name, "", &value, &["version", "data"])?;
    let version = value
        .get("version")
        .and_then(Value::as_str)
        .ok_or_else(|| malformed(name, "version must be a string".to_owned()))?;
    if version != "v1" {
        return Err(CompatError::UnsupportedVersion {
            name,
            version: version.to_owned(),
        });
    }
    serde_json::from_value(value).map_err(|error| malformed(name, error.to_string()))
}

impl DurableRecord for KnownShardMarker {
    fn declaration() -> &'static RecordDeclaration {
        &KNOWN_SHARD_MARKER_DECLARATION
    }
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_known_shard(self.wire())?;
        serde_json::to_vec(self)
            .map_err(|error| malformed(Self::declaration().name, error.to_string()))
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        let marker: Self = decode_submission_record(
            bytes,
            Self::declaration().name,
            MAX_KNOWN_SHARD_MARKER_BYTES,
        )?;
        validate_known_shard(marker.wire())?;
        Ok(marker)
    }
}

impl VersionedRecord for KnownShardMarker {
    type Current = KnownShardMarkerV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Self::into_current(self)
    }
}

impl PureUpcastRecord for KnownShardMarker {}

impl DurableRecord for ReadyReceipt {
    fn declaration() -> &'static RecordDeclaration {
        &READY_RECEIPT_DECLARATION
    }
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_ready_receipt(self.wire())?;
        serde_json::to_vec(self)
            .map_err(|error| malformed(Self::declaration().name, error.to_string()))
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        let receipt: Self =
            decode_submission_record(bytes, Self::declaration().name, MAX_READY_RECEIPT_BYTES)?;
        validate_ready_receipt(receipt.wire())?;
        Ok(receipt)
    }
}

impl VersionedRecord for ReadyReceipt {
    type Current = ReadyReceiptV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Self::into_current(self)
    }
}

impl PureUpcastRecord for ReadyReceipt {}

impl DurableRecord for AdmissionPointer {
    fn declaration() -> &'static RecordDeclaration {
        &ADMISSION_POINTER_DECLARATION
    }
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::MutableCas;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_admission_pointer(self.wire())?;
        serde_json::to_vec(self)
            .map_err(|error| malformed(Self::declaration().name, error.to_string()))
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        let pointer: Self =
            decode_submission_record(bytes, Self::declaration().name, MAX_ADMISSION_POINTER_BYTES)?;
        validate_admission_pointer(pointer.wire())?;
        Ok(pointer)
    }
}

impl VersionedRecord for AdmissionPointer {
    type Current = AdmissionPointerV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Self::into_current(self)
    }
}

impl MutableCasRecord for AdmissionPointer {
    fn from_current(current: Self::Current) -> Result<Self, CompatError> {
        validate_admission_pointer(&current)?;
        Ok(Self::V1(current))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob::{BlobRef, BlobRefV1, BoundedCasDocument};
    use tempfile::tempdir;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct IdentityGoldens {
        immutable_input_digest: String,
        initial_run_revision: String,
    }

    fn identities() -> IdentityGoldens {
        serde_json::from_slice(include_bytes!(
            "../../tests/golden/protocol-identities-v1.json"
        ))
        .expect("valid independent identity fixture")
    }

    fn tenant() -> TenantNamespace {
        TenantNamespace::parse("alice").expect("valid tenant")
    }

    fn integration() -> CanonicalIntegrationId {
        CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration")
    }

    fn blob(key: &str, sha256: char, size: u64, e_tag: &str, provider_version: &str) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: key.to_owned(),
            sha256: sha256.to_string().repeat(64),
            size,
            media_type: "application/json".to_owned(),
            e_tag: Some(e_tag.to_owned()),
            provider_version: Some(provider_version.to_owned()),
        })
    }

    fn input() -> InputRef {
        InputRef {
            artifact: blob(
                "definitions/input.json",
                'a',
                100,
                "etag-input",
                "provider-input",
            ),
            definition_digest: "b".repeat(64),
            definition_digest_encoding_version: 1,
            planner_version: 2,
        }
    }

    fn policy() -> PolicyRef {
        PolicyRef {
            artifact: blob(
                "policies/default.json",
                'c',
                50,
                "etag-policy",
                "provider-policy",
            ),
            policy_digest: "d".repeat(64),
        }
    }

    fn fixed_receipt() -> ReadyReceiptV1 {
        ReadyReceiptV1::new(
            integration(),
            RunId::parse("00000000-0000-4000-8000-000000000001").expect("valid run ID"),
            input(),
            policy(),
            "2026-07-21T12:00:00Z".to_owned(),
        )
        .expect("valid ready receipt")
    }

    #[test]
    fn submission_wire_records_and_future_revision_match_independent_goldens() {
        let identities = identities();
        let shard = routing::shard(&integration());
        assert_eq!(shard.get(), 39);
        let marker = KnownShardMarker::canonical(shard);
        assert_eq!(
            marker.encode().expect("encode marker"),
            include_bytes!("../../tests/golden/known-shard-marker-v1.json")
                .strip_suffix(b"\n")
                .expect("fixture newline")
        );

        let receipt = fixed_receipt();
        assert_eq!(
            receipt.immutable_input_digest,
            identities.immutable_input_digest
        );
        assert_eq!(
            receipt
                .initial_revision()
                .expect("initial revision")
                .as_str(),
            identities.initial_run_revision
        );
        let receipt_record = ReadyReceipt::V1(receipt.clone());
        assert_eq!(
            receipt_record.encode().expect("encode receipt"),
            include_bytes!("../../tests/golden/ready-receipt-v1.json")
                .strip_suffix(b"\n")
                .expect("fixture newline")
        );

        let paths = Keyspace::for_tenant(&tenant());
        let pointer = AdmissionPointer::V1(
            AdmissionPointerV1::from_receipt(&receipt, paths.ready_receipt(shard, &receipt.run_id))
                .expect("valid admission pointer"),
        );
        assert_eq!(
            pointer.encode().expect("encode pointer"),
            include_bytes!("../../tests/golden/admission-pointer-v1.json")
                .strip_suffix(b"\n")
                .expect("fixture newline")
        );

        assert_eq!(
            ReadyReceipt::decode(&receipt_record.encode().expect("encode receipt"))
                .expect("decode receipt"),
            receipt_record
        );
        assert_eq!(
            AdmissionPointer::decode(&pointer.encode().expect("encode pointer"))
                .expect("decode pointer"),
            pointer
        );
    }

    #[tokio::test]
    async fn mutable_record_read_cas_migrates_to_current_canonical_bytes() {
        let cache = tempdir().expect("cache directory");
        let store = ArtifactStore::in_memory(cache.path()).expect("memory store");
        let paths = Keyspace::for_tenant(&tenant());
        let receipt = fixed_receipt();
        let shard = routing::shard(&receipt.integration_id);
        let pointer = AdmissionPointer::V1(
            AdmissionPointerV1::from_receipt(&receipt, paths.ready_receipt(shard, &receipt.run_id))
                .expect("valid admission pointer"),
        );
        let key = paths.admission(&routing::integration_path(&receipt.integration_id));
        let noncanonical = serde_json::to_vec_pretty(&pointer).expect("encode noncanonical V1");
        let initial_version = match store
            .create_cas_document(&key, noncanonical)
            .await
            .expect("seed mutable record")
        {
            CasWrite::Written(version) => version,
            CasWrite::Conflict => panic!("fresh key conflicted"),
        };

        let (migrated, migrated_version) =
            read_mutable_record::<AdmissionPointer>(&store, &key, MAX_ADMISSION_POINTER_BYTES)
                .await
                .expect("migrate mutable record")
                .expect("record exists");
        assert_eq!(migrated, pointer);
        assert_ne!(migrated_version, initial_version);
        let canonical = pointer.encode().expect("canonical current bytes");
        let stored = store
            .get_cas_document_bounded(&key, MAX_ADMISSION_POINTER_BYTES)
            .await
            .expect("read migrated bytes");
        assert!(matches!(
            stored,
            BoundedCasDocument::Present(bytes, version)
                if bytes.as_ref() == &*canonical && version == migrated_version
        ));

        let (_, stable_version) =
            read_mutable_record::<AdmissionPointer>(&store, &key, MAX_ADMISSION_POINTER_BYTES)
                .await
                .expect("repeat current read")
                .expect("record exists");
        assert_eq!(stable_version, migrated_version);
    }

    #[tokio::test]
    async fn mutable_migrator_never_rewrites_an_unknown_future_version() {
        let cache = tempdir().expect("cache directory");
        let store = ArtifactStore::in_memory(cache.path()).expect("memory store");
        let key =
            Keyspace::for_tenant(&tenant()).admission(&routing::integration_path(&integration()));
        let future = br#"{"version":"v2","data":{"opaque":true}}"#.to_vec();
        store
            .create_cas_document(&key, future.clone())
            .await
            .expect("seed unknown future record");

        let error =
            read_mutable_record::<AdmissionPointer>(&store, &key, MAX_ADMISSION_POINTER_BYTES)
                .await
                .expect_err("unknown versions fail closed");
        assert!(format!("{error:?}").contains("unsupported admission_pointer version"));
        let stored = store
            .get_cas_document_bounded(&key, MAX_ADMISSION_POINTER_BYTES)
            .await
            .expect("read untouched future record");
        assert!(matches!(
            stored,
            BoundedCasDocument::Present(bytes, _) if bytes.as_ref() == future.as_slice()
        ));
    }

    #[test]
    fn input_and_initial_revision_ignore_provider_metadata() {
        let first = fixed_receipt();
        let mut second_input = input();
        let BlobRef::V1(artifact) = &mut second_input.artifact;
        artifact.e_tag = Some("different".to_owned());
        artifact.provider_version = Some("different".to_owned());
        let mut second_policy = policy();
        let BlobRef::V1(artifact) = &mut second_policy.artifact;
        artifact.e_tag = Some("different".to_owned());
        artifact.provider_version = Some("different".to_owned());
        let second = ReadyReceiptV1::new(
            integration(),
            first.run_id.clone(),
            second_input,
            second_policy,
            "2030-01-01T00:00:00Z".to_owned(),
        )
        .expect("valid metadata-varied receipt");
        assert_eq!(first.immutable_input_digest, second.immutable_input_digest);
        assert_eq!(
            first.initial_revision().expect("first revision"),
            second.initial_revision().expect("second revision")
        );
    }

    #[tokio::test]
    async fn concurrent_submitters_attach_to_one_admission_without_receipt_dependency() {
        let cache = tempdir().expect("cache directory");
        let store = ArtifactStore::in_memory(cache.path()).expect("memory store");
        let left_store = store.clone();
        let right_store = store.clone();
        let tenant = tenant();
        let left = submit_durable(
            &left_store,
            &tenant,
            integration(),
            input(),
            policy(),
            "2026-07-21T12:00:00Z".to_owned(),
        );
        let right = submit_durable(
            &right_store,
            &tenant,
            integration(),
            input(),
            policy(),
            "2026-07-21T12:00:01Z".to_owned(),
        );
        let (left, right) = tokio::join!(left, right);
        let left = left.expect("left submission");
        let right = right.expect("right submission");
        assert_eq!(left.run_id, right.run_id);
        assert_eq!(left.initial_revision, right.initial_revision);
        assert_ne!(left.created, right.created);

        let shard = routing::shard(&integration());
        delete_ready_receipt(&store, &tenant, shard, &left.run_id)
            .await
            .expect("delete winning receipt after durable promotion");
        delete_ready_receipt(&store, &tenant, shard, &left.run_id)
            .await
            .expect("lost-delete retry is idempotent");

        let attached = submit_durable(
            &store,
            &tenant,
            integration(),
            input(),
            policy(),
            "2026-07-21T12:00:02Z".to_owned(),
        )
        .await
        .expect("attach without winner receipt");
        assert!(!attached.created);
        assert_eq!(attached.run_id, left.run_id);
        assert_eq!(attached.initial_revision, left.initial_revision);
    }

    #[tokio::test]
    async fn terminal_admission_is_retired_in_place_and_replaced_by_exact_cas() {
        let cache = tempdir().expect("cache directory");
        let store = ArtifactStore::in_memory(cache.path()).expect("memory store");
        let first = submit_durable(
            &store,
            &tenant(),
            integration(),
            input(),
            policy(),
            "2026-07-21T12:00:00Z".to_owned(),
        )
        .await
        .expect("first submission");
        let terminal = std::iter::once(first.run_id.clone()).collect();
        assert!(
            retire_admission_for_terminal_runs(&store, &tenant(), &integration(), &terminal)
                .await
                .expect("retire terminal admission")
        );

        let paths = Keyspace::for_tenant(&tenant());
        let key = paths.admission(&routing::integration_path(&integration()));
        let (retired, retired_version) =
            read_mutable_record::<AdmissionPointer>(&store, &key, MAX_ADMISSION_POINTER_BYTES)
                .await
                .expect("read retired pointer")
                .expect("stable admission key remains");
        assert_eq!(
            retired.try_current().expect("valid pointer").state,
            AdmissionPointerStateV1::Terminal
        );

        let second = submit_durable(
            &store,
            &tenant(),
            integration(),
            input(),
            policy(),
            "2026-07-21T12:00:01Z".to_owned(),
        )
        .await
        .expect("replacement submission");
        assert!(second.created);
        assert_ne!(second.run_id, first.run_id);

        // A delayed retry from the retiring owner is conditional on the exact
        // version it observed. It cannot overwrite the successor.
        assert!(matches!(
            compare_and_swap_record(&store, &key, &retired_version, &retired)
                .await
                .expect("stale retirement CAS"),
            CasWrite::Conflict
        ));
        let (current, _version) =
            read_mutable_record::<AdmissionPointer>(&store, &key, MAX_ADMISSION_POINTER_BYTES)
                .await
                .expect("read successor")
                .expect("successor admission exists");
        let current = current.into_current().expect("valid successor");
        assert_eq!(current.state, AdmissionPointerStateV1::Active);
        assert_eq!(current.run_id, second.run_id);
    }

    #[tokio::test]
    async fn run_locator_is_durable_before_admission_and_conflicting_reuse_fails_closed() {
        let cache = tempdir().expect("cache directory");
        let store = ArtifactStore::in_memory(cache.path()).expect("memory store");
        let run_id = RunId::parse("00000000-0000-4000-8000-000000000009").expect("valid run ID");
        ensure_control_baseline(&store, &tenant())
            .await
            .expect("control baseline");
        ensure_run_locator(&store, &tenant(), &run_id, &integration())
            .await
            .expect("first locator write");
        ensure_run_locator(&store, &tenant(), &run_id, &integration())
            .await
            .expect("lost-ack retry adopts identical locator");

        let paths = Keyspace::for_tenant(&tenant());
        let (locator, _version) = read_record::<RunLocatorRecord>(
            &store,
            &paths.run_locator(&run_id),
            MAX_RUN_LOCATOR_RECORD_BYTES,
        )
        .await
        .expect("read locator")
        .expect("locator exists");
        assert_eq!(locator.into_current(), integration());
        assert!(
            discover_ready_receipts(&store, &tenant())
                .await
                .expect("ready inventory")
                .is_empty(),
            "locator publication alone cannot make a run executable"
        );

        let other =
            CanonicalIntegrationId::parse("alice:other-connector").expect("other integration");
        let error = submit_durable_for_run(
            &store,
            &tenant(),
            other,
            run_id,
            input(),
            policy(),
            "2026-07-21T12:00:00Z".to_owned(),
        )
        .await
        .expect_err("one run ID cannot be rebound to another integration");
        assert!(format!("{error:?}").contains("run locator integration conflict"));
        assert!(
            discover_ready_receipts(&store, &tenant())
                .await
                .expect("ready inventory after conflict")
                .is_empty(),
            "locator conflict must fail before ready receipt publication"
        );
    }

    #[tokio::test]
    async fn discovery_filters_noncanonical_and_nested_foreign_keys() {
        let cache = tempdir().expect("cache directory");
        let store = ArtifactStore::in_memory(cache.path()).expect("memory store");
        let outcome = submit_durable(
            &store,
            &tenant(),
            integration(),
            input(),
            policy(),
            "2026-07-21T12:00:00Z".to_owned(),
        )
        .await
        .expect("submission");
        let paths = Keyspace::for_tenant(&tenant());
        let shard = routing::shard(&integration());
        store
            .create_json(
                &format!("{}/nested/foreign.json", paths.ready_shard(shard)),
                &serde_json::json!({"foreign": true}),
            )
            .await
            .expect("create nested foreign key");
        store
            .create_json(
                &format!("{}/not-a-run.json", paths.ready_shard(shard)),
                &serde_json::json!({"foreign": true}),
            )
            .await
            .expect("create malformed foreign key");

        let discovered = discover_ready_receipts(&store, &tenant())
            .await
            .expect("discover receipts");
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].receipt.run_id, outcome.run_id);
        assert_eq!(discovered[0].shard, shard);
    }

    #[tokio::test]
    async fn lost_receipt_ack_adopts_only_the_same_semantic_receipt() {
        let cache = tempdir().expect("cache directory");
        let store = ArtifactStore::in_memory(cache.path()).expect("memory store");
        let paths = Keyspace::for_tenant(&tenant());
        let first = fixed_receipt();
        let key = paths.ready_receipt(routing::shard(&integration()), &first.run_id);
        create_ready_receipt(&store, &key, &ReadyReceipt::V1(first.clone()))
            .await
            .expect("first receipt create");

        let mut equivalent = first.clone();
        equivalent.submitted_at = "2030-01-01T00:00:00Z".to_owned();
        let BlobRef::V1(artifact) = &mut equivalent.immutable_input.artifact;
        artifact.e_tag = Some("changed".to_owned());
        artifact.provider_version = Some("changed".to_owned());
        let BlobRef::V1(artifact) = &mut equivalent.policy.artifact;
        artifact.e_tag = Some("changed".to_owned());
        artifact.provider_version = Some("changed".to_owned());
        validate_ready_receipt(&equivalent).expect("equivalent receipt remains valid");
        create_ready_receipt(&store, &key, &ReadyReceipt::V1(equivalent))
            .await
            .expect("lost-ack retry adopts semantic equivalent");

        let mut conflicting = first;
        conflicting.policy.policy_digest = "e".repeat(64);
        let error = create_ready_receipt(&store, &key, &ReadyReceipt::V1(conflicting))
            .await
            .expect_err("changed future RunAccepted record must conflict");
        assert!(format!("{error:?}").contains("semantic identity"));
    }

    #[tokio::test]
    async fn canonical_shaped_malformed_receipt_fails_discovery_closed() {
        let cache = tempdir().expect("cache directory");
        let store = ArtifactStore::in_memory(cache.path()).expect("memory store");
        ensure_control_baseline(&store, &tenant())
            .await
            .expect("control baseline");
        let paths = Keyspace::for_tenant(&tenant());
        let shard = routing::shard(&integration());
        let key = paths.ready_receipt(
            shard,
            &RunId::parse("00000000-0000-4000-8000-000000000001").expect("valid path run ID"),
        );
        store
            .create_json(&key, &serde_json::json!({"malformed": true}))
            .await
            .expect("create poison receipt-shaped object");
        assert!(discover_ready_receipts(&store, &tenant()).await.is_err());
    }

    #[tokio::test]
    async fn known_shard_conflict_compares_normalized_routing_identity() {
        let cache = tempdir().expect("cache directory");
        let store = ArtifactStore::in_memory(cache.path()).expect("memory store");
        ensure_control_baseline(&store, &tenant())
            .await
            .expect("control baseline");
        let paths = Keyspace::for_tenant(&tenant());
        let shard = routing::shard(&integration());
        let noncanonical =
            br#"{ "version": "v1", "data": { "shard": 39, "routing_version": 1 } }"#.to_vec();
        assert!(matches!(
            store
                .create_cas_document(&paths.known_shard(shard), noncanonical)
                .await
                .expect("seed noncanonical marker"),
            CasWrite::Written(_)
        ));
        ensure_known_shard_marker(&store, &paths, shard)
            .await
            .expect("supported wire bytes with the same routing identity are adopted");

        let other_cache = tempdir().expect("second cache directory");
        let other = ArtifactStore::in_memory(other_cache.path()).expect("second memory store");
        let conflicting = br#"{"version":"v1","data":{"shard":38,"routing_version":1}}"#.to_vec();
        other
            .create_cas_document(&paths.known_shard(shard), conflicting)
            .await
            .expect("seed conflicting marker");
        let error = ensure_known_shard_marker(&other, &paths, shard)
            .await
            .expect_err("different routing identity must fail closed");
        assert!(format!("{error:?}").contains("routing identity"));
    }

    #[tokio::test]
    async fn every_durable_submission_boundary_is_recoverable() {
        // Death after marker publication leaves no admitted work and the next
        // complete submission safely proceeds through the existing marker.
        let marker_cache = tempdir().expect("marker cache");
        let marker_store = ArtifactStore::in_memory(marker_cache.path()).expect("marker store");
        ensure_control_baseline(&marker_store, &tenant())
            .await
            .expect("marker baseline");
        let marker_paths = Keyspace::for_tenant(&tenant());
        let shard = routing::shard(&integration());
        ensure_known_shard_marker(&marker_store, &marker_paths, shard)
            .await
            .expect("marker-only crash state");
        let after_marker = submit_durable(
            &marker_store,
            &tenant(),
            integration(),
            input(),
            policy(),
            "2026-07-21T13:00:00Z".to_owned(),
        )
        .await
        .expect("recover after marker");
        assert!(after_marker.created);

        // Death after receipt publication leaves an unreferenced immutable
        // object. A new run wins admission; the orphan never executes merely
        // because discovery can see it.
        let receipt_cache = tempdir().expect("receipt cache");
        let receipt_store = ArtifactStore::in_memory(receipt_cache.path()).expect("receipt store");
        ensure_control_baseline(&receipt_store, &tenant())
            .await
            .expect("receipt baseline");
        let receipt_paths = Keyspace::for_tenant(&tenant());
        ensure_known_shard_marker(&receipt_store, &receipt_paths, shard)
            .await
            .expect("receipt marker");
        let orphan = fixed_receipt();
        let orphan_key = receipt_paths.ready_receipt(shard, &orphan.run_id);
        create_ready_receipt(
            &receipt_store,
            &orphan_key,
            &ReadyReceipt::V1(orphan.clone()),
        )
        .await
        .expect("receipt-only crash state");
        let after_receipt = submit_durable(
            &receipt_store,
            &tenant(),
            integration(),
            input(),
            policy(),
            "2026-07-21T13:00:01Z".to_owned(),
        )
        .await
        .expect("recover after receipt");
        assert!(after_receipt.created);
        assert_ne!(after_receipt.run_id, orphan.run_id);
        let discovered = discover_ready_receipts(&receipt_store, &tenant())
            .await
            .expect("discover orphan and winner");
        let orphan_discovery = discovered
            .iter()
            .find(|candidate| candidate.receipt.run_id == orphan.run_id)
            .expect("orphan remains discoverable");
        assert!(
            admitted_run_record(&receipt_store, &tenant(), orphan_discovery)
                .await
                .expect("check orphan admission")
                .is_none()
        );
        let winner_discovery = discovered
            .iter()
            .find(|candidate| candidate.receipt.run_id == after_receipt.run_id)
            .expect("winner is discoverable");
        let run_accepted = admitted_run_record(&receipt_store, &tenant(), winner_discovery)
            .await
            .expect("validate winning admission")
            .expect("winner is admitted");
        assert_eq!(run_accepted.event_id, after_receipt.initial_revision);

        // Death after admission CAS, including before its read-back or response,
        // is recovered solely from the pointer. The retry returns the exact
        // future RunAccepted revision and never creates a second authority.
        let cas_cache = tempdir().expect("CAS cache");
        let cas_store = ArtifactStore::in_memory(cas_cache.path()).expect("CAS store");
        ensure_control_baseline(&cas_store, &tenant())
            .await
            .expect("CAS baseline");
        let cas_paths = Keyspace::for_tenant(&tenant());
        ensure_known_shard_marker(&cas_store, &cas_paths, shard)
            .await
            .expect("CAS marker");
        let winner = fixed_receipt();
        let winner_key = cas_paths.ready_receipt(shard, &winner.run_id);
        create_ready_receipt(&cas_store, &winner_key, &ReadyReceipt::V1(winner.clone()))
            .await
            .expect("CAS winner receipt");
        let pointer = AdmissionPointer::V1(
            AdmissionPointerV1::from_receipt(&winner, winner_key).expect("CAS winner pointer"),
        );
        assert!(matches!(
            create_record(
                &cas_store,
                &cas_paths.admission(&routing::integration_path(&integration())),
                &pointer,
            )
            .await
            .expect("create admission before simulated crash"),
            CasWrite::Written(_)
        ));
        let after_cas = submit_durable(
            &cas_store,
            &tenant(),
            integration(),
            input(),
            policy(),
            "2026-07-21T13:00:02Z".to_owned(),
        )
        .await
        .expect("recover after CAS/read-back boundary");
        assert!(!after_cas.created);
        assert_eq!(after_cas.run_id, winner.run_id);
        assert_eq!(
            after_cas.initial_revision,
            winner.initial_revision().expect("winner initial revision")
        );
    }
}
