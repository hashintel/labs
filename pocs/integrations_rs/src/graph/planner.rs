//! Side-effect-free Graph operation planning.
//!
//! This module owns row conversion and exact delivery bytes. It has no Graph
//! client dependency: planning can read deterministic pipeline values, but it
//! cannot perform an external request.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use super::accessor::{resolve_audited, Audit};
use super::artifacts::{
    DesiredDispositionV1, DesiredObjectInputDispositionV1, DesiredObjectInputV1, GraphObjectKindV1,
    PublishedDesiredProjectionV1, ResolvedDesiredObjectV1,
};
use super::client::{
    archive_params, entity_create_params, entity_graph_id, entity_patch_params, link_create_params,
    link_entity_ids, link_patch_params,
};
use super::effects::{GraphEffectV1, GraphOperationV1};
use super::{ArchiveOp, EntityOp, LinkOp, Provenance};
use crate::definition::{Accessor, LinkEntry, SinkConfig};
use crate::orchestrator::registry::{
    reject_unknown_fields, AlgorithmVersion, CompatError, DurabilityClass, DurableRecord,
    MigrationPolicy, PureUpcastRecord, RecordDeclaration, VersionedRecord,
};
use crate::value::{js_string, Row};

pub const GRAPH_DELIVERY_ENCODING_VERSION: u32 = 1;
const MAX_GRAPH_DELIVERY_PAYLOAD_BYTES: usize = 4 * 1024 * 1024;

pub(crate) static GRAPH_DELIVERY_PAYLOAD_DECLARATION: RecordDeclaration = RecordDeclaration {
    name: "graph_delivery_payload",
    owning_module: "graph::planner",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[AlgorithmVersion {
        name: "graph_delivery_encoding",
        version: GRAPH_DELIVERY_ENCODING_VERSION,
    }],
    durability: DurabilityClass::ImmutableArtifact,
    migration: MigrationPolicy::PureUpcast,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum GraphDeliveryPayload {
    V1(GraphDeliveryPayloadV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphDeliveryPayloadV1 {
    pub encoding_version: u32,
    pub graph_identity: String,
    pub request: GraphDeliveryRequestV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum GraphDeliveryRequestV1 {
    Upsert {
        create: Value,
        patch: Value,
        archive: Value,
    },
    Archive {
        archive: Value,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedGraphObjectV1 {
    pub desired: DesiredObjectInputV1,
    pub effect: PlannedEffectV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedEffectV1 {
    pub operation: GraphOperationV1,
    pub kind: GraphObjectKindV1,
    pub graph_identity: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GraphPlanV1 {
    pub desired: Vec<DesiredObjectInputV1>,
    pub effects: Vec<PlannedEffectV1>,
}

/// Selects whether exact desired Graph truth is diffed against A, explicitly
/// initialized from an adopted engine state, or delivered unconditionally.
/// Ordinary Apply uses `ChangesOnly`; Reconcile uses `ForceAll`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectSelectionV1 {
    ChangesOnly,
    InitializeFromExistingState,
    ForceAll,
}

/// Declares whether the generated subplans cover the full integration. Missing
/// live objects mean deletion only for a complete plan; a partial plan carries
/// them from A.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionCoverageV1 {
    Complete,
    Partial,
}

impl GraphPlanV1 {
    pub fn add(&mut self, planned: PlannedGraphObjectV1, changed: bool) {
        if changed {
            self.effects.push(planned.effect);
        }
        self.desired.push(planned.desired);
    }

    /// Combines independently planned sinks before the one global ordering
    /// pass. No caller needs to reproduce entity/link dependency ordering.
    pub fn merge(&mut self, other: Self) {
        self.desired.extend(other.desired);
        self.effects.extend(other.effects);
    }

    pub fn finish(mut self) -> Result<Self, CompatError> {
        self.desired.sort_by(|left, right| {
            (left.kind, left.graph_identity.as_str())
                .cmp(&(right.kind, right.graph_identity.as_str()))
        });
        if let Some(pair) = self.desired.windows(2).find(|pair| {
            (pair[0].kind, pair[0].graph_identity.as_str())
                == (pair[1].kind, pair[1].graph_identity.as_str())
        }) {
            return Err(malformed(format!(
                "duplicate planned Graph identity {:?}",
                pair[0].graph_identity
            )));
        }
        self.effects.sort_by(|left, right| {
            (left.operation.order(), left.graph_identity.as_str())
                .cmp(&(right.operation.order(), right.graph_identity.as_str()))
        });
        Ok(self)
    }
}

/// Reconciles a generated candidate G with the journal-applied desired
/// projection A. Suppressed objects reuse A's exact bytes, so audit timestamps
/// or physical payload-pack layout cannot create false Graph changes. Objects
/// absent from a subplan are retained from A; explicit deletes are already
/// represented by archive tombstones emitted by the owning sink planner.
///
/// This is the only boundary that converts independently planned sink deltas
/// into one complete integration projection and dependency-ordered effect set.
pub fn finalize_projection_plan(
    applied: &[ResolvedDesiredObjectV1],
    generated: GraphPlanV1,
    selection: EffectSelectionV1,
    coverage: ProjectionCoverageV1,
) -> Result<GraphPlanV1, CompatError> {
    let generated = generated.finish()?;
    let applied_by_identity = validated_applied(applied)?;
    let generated_by_identity = generated
        .desired
        .iter()
        .map(|desired| (desired_key(desired), desired))
        .collect::<BTreeMap<_, _>>();
    let mut hinted = BTreeSet::new();
    for effect in &generated.effects {
        let key = effect_key(effect);
        let desired = generated_by_identity.get(&key).ok_or_else(|| {
            malformed(format!(
                "planned effect {:?} has no generated desired object",
                effect.graph_identity
            ))
        })?;
        if effect.operation != effect_for_desired(desired).operation {
            return Err(malformed(format!(
                "planned effect operation does not match desired object {:?}",
                effect.graph_identity
            )));
        }
        if !hinted.insert(key) {
            return Err(malformed(format!(
                "duplicate planned effect for Graph identity {:?}",
                effect.graph_identity
            )));
        }
    }
    let mut desired = Vec::with_capacity(
        generated
            .desired
            .len()
            .saturating_add(applied_by_identity.len()),
    );
    let mut effects = Vec::new();
    let mut generated_keys = BTreeSet::new();

    for candidate in generated.desired {
        validate_candidate(&candidate)?;
        let key = desired_key(&candidate);
        generated_keys.insert(key.clone());
        let previous = applied_by_identity.get(&key);
        let has_hint = hinted.contains(&key);
        let same_state = previous.is_some_and(|previous| {
            disposition_is_live(&candidate.disposition)
                == published_disposition_is_live(&previous.object.disposition)
        });

        let candidate = if selection != EffectSelectionV1::ForceAll && !has_hint && same_state {
            input_from_resolved(previous.expect("same_state requires previous"))
        } else {
            candidate
        };
        let hinted_change =
            has_hint && previous.is_none_or(|previous| !logically_equal(previous, &candidate));
        let state_change = previous.is_some_and(|previous| {
            published_disposition_is_live(&previous.object.disposition)
                != disposition_is_live(&candidate.disposition)
        });
        let changed = match selection {
            EffectSelectionV1::ChangesOnly => previous.is_none() || hinted_change || state_change,
            EffectSelectionV1::InitializeFromExistingState => hinted_change || state_change,
            EffectSelectionV1::ForceAll => true,
        };
        if changed {
            effects.push(effect_for_desired(&candidate));
        }
        desired.push(candidate);
    }

    for (key, previous) in applied_by_identity {
        if generated_keys.contains(&key) {
            continue;
        }
        let was_live = published_disposition_is_live(&previous.object.disposition);
        let carried = if was_live && coverage == ProjectionCoverageV1::Complete {
            archived_input_from_resolved(previous)
        } else {
            input_from_resolved(previous)
        };
        if selection == EffectSelectionV1::ForceAll
            || was_live && coverage == ProjectionCoverageV1::Complete
        {
            effects.push(effect_for_desired(&carried));
        }
        desired.push(carried);
    }

    GraphPlanV1 { desired, effects }.finish()
}

impl GraphDeliveryPayloadV1 {
    pub fn upsert(
        graph_identity: String,
        create: Value,
        patch: Value,
        archive: Value,
    ) -> Result<Self, CompatError> {
        let value = Self {
            encoding_version: GRAPH_DELIVERY_ENCODING_VERSION,
            graph_identity,
            request: GraphDeliveryRequestV1::Upsert {
                create,
                patch,
                archive,
            },
        };
        validate_delivery(&value)?;
        Ok(value)
    }

    pub fn archive(graph_identity: String, archive: Value) -> Result<Self, CompatError> {
        let value = Self {
            encoding_version: GRAPH_DELIVERY_ENCODING_VERSION,
            graph_identity,
            request: GraphDeliveryRequestV1::Archive { archive },
        };
        validate_delivery(&value)?;
        Ok(value)
    }
}

impl GraphDeliveryPayload {
    pub fn into_current(self) -> Result<GraphDeliveryPayloadV1, CompatError> {
        let Self::V1(value) = self;
        validate_delivery(&value)?;
        Ok(value)
    }

    fn wire(&self) -> &GraphDeliveryPayloadV1 {
        match self {
            Self::V1(value) => value,
        }
    }
}

pub fn plan_entity_upsert(op: &EntityOp) -> Result<PlannedGraphObjectV1, CompatError> {
    let graph_identity = entity_graph_id(op);
    let archive = ArchiveOp {
        namespace: op.namespace.clone(),
        entity_type: op.entity_type.clone(),
        entity_id: js_string(&op.entity_id),
        provenance: op.provenance.clone(),
        web_id: op.web_id.clone(),
    };
    let payload = GraphDeliveryPayload::V1(GraphDeliveryPayloadV1::upsert(
        graph_identity.clone(),
        entity_create_params(op),
        entity_patch_params(op),
        archive_params(&archive),
    )?)
    .encode()?;
    Ok(PlannedGraphObjectV1 {
        desired: DesiredObjectInputV1 {
            kind: GraphObjectKindV1::Entity,
            graph_identity: graph_identity.clone(),
            disposition: DesiredObjectInputDispositionV1::Live(payload),
        },
        effect: PlannedEffectV1 {
            operation: GraphOperationV1::UpsertEntity,
            kind: GraphObjectKindV1::Entity,
            graph_identity,
        },
    })
}

pub fn plan_entity_archive(op: &ArchiveOp) -> Result<PlannedGraphObjectV1, CompatError> {
    let body = archive_params(op);
    let graph_identity = body
        .get("entityId")
        .and_then(Value::as_str)
        .ok_or_else(|| malformed("entity archive body has no entityId".to_owned()))?
        .to_owned();
    let payload = GraphDeliveryPayload::V1(GraphDeliveryPayloadV1::archive(
        graph_identity.clone(),
        body,
    )?)
    .encode()?;
    Ok(PlannedGraphObjectV1 {
        desired: DesiredObjectInputV1 {
            kind: GraphObjectKindV1::Entity,
            graph_identity: graph_identity.clone(),
            disposition: DesiredObjectInputDispositionV1::Archived(payload),
        },
        effect: PlannedEffectV1 {
            operation: GraphOperationV1::ArchiveEntity,
            kind: GraphObjectKindV1::Entity,
            graph_identity,
        },
    })
}

pub fn plan_link_upsert(op: &LinkOp) -> Result<PlannedGraphObjectV1, CompatError> {
    let ids = link_entity_ids(op);
    let compound_id = format!(
        "{}::{}::{}::{}",
        op.source_entity_type, op.source_entity_id, op.target_entity_type, op.target_id
    );
    let archive = ArchiveOp {
        namespace: op.namespace.clone(),
        entity_type: op.link_type.clone(),
        entity_id: compound_id,
        provenance: op.provenance.clone(),
        web_id: op.web_id.clone(),
    };
    let payload = GraphDeliveryPayload::V1(GraphDeliveryPayloadV1::upsert(
        ids.full_link_id.clone(),
        link_create_params(op),
        link_patch_params(op),
        archive_params(&archive),
    )?)
    .encode()?;
    Ok(PlannedGraphObjectV1 {
        desired: DesiredObjectInputV1 {
            kind: GraphObjectKindV1::Link,
            graph_identity: ids.full_link_id.clone(),
            disposition: DesiredObjectInputDispositionV1::Live(payload),
        },
        effect: PlannedEffectV1 {
            operation: GraphOperationV1::UpsertLink,
            kind: GraphObjectKindV1::Link,
            graph_identity: ids.full_link_id,
        },
    })
}

pub fn plan_link_archive(op: &ArchiveOp) -> Result<PlannedGraphObjectV1, CompatError> {
    let mut value = plan_entity_archive(op)?;
    value.desired.kind = GraphObjectKindV1::Link;
    value.effect.kind = GraphObjectKindV1::Link;
    value.effect.operation = GraphOperationV1::ArchiveLink;
    Ok(value)
}

type DesiredKey = (GraphObjectKindV1, String);

fn desired_key(desired: &DesiredObjectInputV1) -> DesiredKey {
    (desired.kind, desired.graph_identity.clone())
}

fn effect_key(effect: &PlannedEffectV1) -> DesiredKey {
    (effect.kind, effect.graph_identity.clone())
}

fn disposition_is_live(disposition: &DesiredObjectInputDispositionV1) -> bool {
    matches!(disposition, DesiredObjectInputDispositionV1::Live(_))
}

fn published_disposition_is_live(disposition: &DesiredDispositionV1) -> bool {
    matches!(disposition, DesiredDispositionV1::Live { .. })
}

fn effect_for_desired(desired: &DesiredObjectInputV1) -> PlannedEffectV1 {
    let operation = match (desired.kind, disposition_is_live(&desired.disposition)) {
        (GraphObjectKindV1::Entity, true) => GraphOperationV1::UpsertEntity,
        (GraphObjectKindV1::Link, true) => GraphOperationV1::UpsertLink,
        (GraphObjectKindV1::Link, false) => GraphOperationV1::ArchiveLink,
        (GraphObjectKindV1::Entity, false) => GraphOperationV1::ArchiveEntity,
    };
    PlannedEffectV1 {
        operation,
        kind: desired.kind,
        graph_identity: desired.graph_identity.clone(),
    }
}

fn input_from_resolved(previous: &ResolvedDesiredObjectV1) -> DesiredObjectInputV1 {
    let disposition = match previous.object.disposition {
        DesiredDispositionV1::Live { .. } => {
            DesiredObjectInputDispositionV1::Live(previous.payload.clone())
        }
        DesiredDispositionV1::Archived { .. } => {
            DesiredObjectInputDispositionV1::Archived(previous.payload.clone())
        }
    };
    DesiredObjectInputV1 {
        kind: previous.object.kind,
        graph_identity: previous.object.graph_identity.clone(),
        disposition,
    }
}

fn archived_input_from_resolved(previous: &ResolvedDesiredObjectV1) -> DesiredObjectInputV1 {
    DesiredObjectInputV1 {
        kind: previous.object.kind,
        graph_identity: previous.object.graph_identity.clone(),
        disposition: DesiredObjectInputDispositionV1::Archived(previous.payload.clone()),
    }
}

fn logically_equal(previous: &ResolvedDesiredObjectV1, candidate: &DesiredObjectInputV1) -> bool {
    if published_disposition_is_live(&previous.object.disposition)
        != disposition_is_live(&candidate.disposition)
    {
        return false;
    }
    let digest = hex::encode(Sha256::digest(candidate.disposition.payload()));
    previous.object.disposition.payload_digest() == digest
}

fn validate_candidate(candidate: &DesiredObjectInputV1) -> Result<(), CompatError> {
    let delivery = GraphDeliveryPayload::decode(candidate.disposition.payload())?.into_current()?;
    if delivery.graph_identity != candidate.graph_identity {
        return Err(malformed(format!(
            "candidate desired payload identity mismatch for {:?}",
            candidate.graph_identity
        )));
    }
    if disposition_is_live(&candidate.disposition)
        && !matches!(delivery.request, GraphDeliveryRequestV1::Upsert { .. })
    {
        return Err(malformed(format!(
            "live candidate desired object {:?} lacks an upsert request",
            candidate.graph_identity
        )));
    }
    Ok(())
}

fn validated_applied(
    applied: &[ResolvedDesiredObjectV1],
) -> Result<BTreeMap<DesiredKey, &ResolvedDesiredObjectV1>, CompatError> {
    let mut values = BTreeMap::new();
    for previous in applied {
        let digest = hex::encode(Sha256::digest(&previous.payload));
        if previous.object.disposition.payload_digest() != digest {
            return Err(malformed(format!(
                "applied desired payload digest mismatch for {:?}",
                previous.object.graph_identity
            )));
        }
        let delivery = GraphDeliveryPayload::decode(&previous.payload)?.into_current()?;
        if delivery.graph_identity != previous.object.graph_identity {
            return Err(malformed(format!(
                "applied desired payload identity mismatch for {:?}",
                previous.object.graph_identity
            )));
        }
        if published_disposition_is_live(&previous.object.disposition)
            && !matches!(delivery.request, GraphDeliveryRequestV1::Upsert { .. })
        {
            return Err(malformed(format!(
                "live applied desired object {:?} lacks an upsert request",
                previous.object.graph_identity
            )));
        }
        let key = (previous.object.kind, previous.object.graph_identity.clone());
        if values.insert(key, previous).is_some() {
            return Err(malformed(format!(
                "duplicate applied Graph identity {:?}",
                previous.object.graph_identity
            )));
        }
    }
    Ok(values)
}

pub fn bind_apply_effects(
    target_state_digest: &str,
    desired: &PublishedDesiredProjectionV1,
    planned: &[PlannedEffectV1],
) -> Result<Vec<GraphEffectV1>, CompatError> {
    let by_identity = desired
        .objects
        .iter()
        .map(|object| ((object.kind, object.graph_identity.as_str()), object))
        .collect::<BTreeMap<_, _>>();
    let mut effects = Vec::with_capacity(planned.len());
    for planned in planned {
        let object = by_identity
            .get(&(planned.kind, planned.graph_identity.as_str()))
            .ok_or_else(|| {
                malformed(format!(
                    "planned effect {:?} has no desired object",
                    planned.graph_identity
                ))
            })?;
        let (digest, payload) = match planned.operation {
            GraphOperationV1::UpsertEntity | GraphOperationV1::UpsertLink => {
                let DesiredDispositionV1::Live {
                    payload_digest,
                    payload,
                } = &object.disposition
                else {
                    return Err(malformed(format!(
                        "upsert effect {:?} names an archived object",
                        planned.graph_identity
                    )));
                };
                (Some(payload_digest.clone()), Some(payload.clone()))
            }
            GraphOperationV1::ArchiveLink | GraphOperationV1::ArchiveEntity => {
                if !matches!(object.disposition, DesiredDispositionV1::Archived { .. }) {
                    return Err(malformed(format!(
                        "archive effect {:?} names a live object",
                        planned.graph_identity
                    )));
                }
                (None, None)
            }
        };
        effects.push(GraphEffectV1::new(
            target_state_digest.to_owned(),
            planned.operation,
            planned.graph_identity.clone(),
            digest,
            payload,
        )?);
    }
    effects.sort_by(|left, right| {
        (left.operation.order(), left.graph_identity.as_str())
            .cmp(&(right.operation.order(), right.graph_identity.as_str()))
    });
    Ok(effects)
}

/// Builds the compensating Restore universe from immutable desired truth.
/// Objects in A are force-applied exactly as recorded. Objects present only in
/// contaminated G are archived using G's pinned archive request at execution.
pub fn plan_restore_effects(
    target_state_digest_or_empty: &str,
    applied: &[ResolvedDesiredObjectV1],
    contaminated: &[ResolvedDesiredObjectV1],
) -> Result<Vec<GraphEffectV1>, CompatError> {
    let applied = validated_applied(applied)?;
    let contaminated = validated_applied(contaminated)?;
    let mut keys = applied.keys().cloned().collect::<BTreeSet<_>>();
    keys.extend(contaminated.keys().cloned());
    let mut effects = Vec::with_capacity(keys.len());
    for key in keys {
        let (kind, graph_identity) = key;
        let (operation, payload_digest, payload) =
            match applied.get(&(kind, graph_identity.clone())) {
                Some(object) => match &object.object.disposition {
                    DesiredDispositionV1::Live {
                        payload_digest,
                        payload,
                    } => (
                        match kind {
                            GraphObjectKindV1::Entity => GraphOperationV1::UpsertEntity,
                            GraphObjectKindV1::Link => GraphOperationV1::UpsertLink,
                        },
                        Some(payload_digest.clone()),
                        Some(payload.clone()),
                    ),
                    DesiredDispositionV1::Archived { .. } => (
                        match kind {
                            GraphObjectKindV1::Entity => GraphOperationV1::ArchiveEntity,
                            GraphObjectKindV1::Link => GraphOperationV1::ArchiveLink,
                        },
                        None,
                        None,
                    ),
                },
                None => (
                    match kind {
                        GraphObjectKindV1::Entity => GraphOperationV1::ArchiveEntity,
                        GraphObjectKindV1::Link => GraphOperationV1::ArchiveLink,
                    },
                    None,
                    None,
                ),
            };
        effects.push(GraphEffectV1::new(
            target_state_digest_or_empty.to_owned(),
            operation,
            graph_identity,
            payload_digest,
            payload,
        )?);
    }
    effects.sort_by(|left, right| {
        (left.operation.order(), left.graph_identity.as_str())
            .cmp(&(right.operation.order(), right.graph_identity.as_str()))
    });
    Ok(effects)
}

/// Force-applies every object in the journal-selected desired projection.
/// Reconcile never consults mutable planner state or suppression hints.
pub fn plan_reconcile_effects(
    target_state_digest: &str,
    applied: &[ResolvedDesiredObjectV1],
) -> Result<Vec<GraphEffectV1>, CompatError> {
    let applied = validated_applied(applied)?;
    let mut effects = Vec::with_capacity(applied.len());
    for ((kind, graph_identity), object) in applied {
        let (operation, payload_digest, payload) = match &object.object.disposition {
            DesiredDispositionV1::Live {
                payload_digest,
                payload,
            } => (
                match kind {
                    GraphObjectKindV1::Entity => GraphOperationV1::UpsertEntity,
                    GraphObjectKindV1::Link => GraphOperationV1::UpsertLink,
                },
                Some(payload_digest.clone()),
                Some(payload.clone()),
            ),
            DesiredDispositionV1::Archived { .. } => (
                match kind {
                    GraphObjectKindV1::Entity => GraphOperationV1::ArchiveEntity,
                    GraphObjectKindV1::Link => GraphOperationV1::ArchiveLink,
                },
                None,
                None,
            ),
        };
        effects.push(GraphEffectV1::new(
            target_state_digest.to_owned(),
            operation,
            graph_identity,
            payload_digest,
            payload,
        )?);
    }
    effects.sort_by(|left, right| {
        (left.operation.order(), left.graph_identity.as_str())
            .cmp(&(right.operation.order(), right.graph_identity.as_str()))
    });
    Ok(effects)
}

/// Returns `(op, audits)`; audits list conversion failures for the DLQ.
pub fn row_to_entity_op(
    row: &Row,
    sink: &SinkConfig,
    namespace: &str,
    provenance: &Provenance,
    unit_maps: &Map<String, Value>,
) -> Result<(EntityOp, Vec<(String, Audit)>), String> {
    if row.get("_op").and_then(Value::as_str) == Some("delete") {
        return Err("row_to_entity_op: _op=delete reached the pipeline".to_owned());
    }

    let entity_id = row.get(&sink.entity_id).cloned().unwrap_or(Value::Null);
    let (prov, mut audits) = apply_provenance_fields(provenance, row, sink, unit_maps);
    let mut properties = vec![];
    let mut property_provenance = BTreeMap::new();

    for (url, accessor) in &sink.properties {
        let (raw_value, audit) = resolve_audited(accessor, row, unit_maps);
        let value = trimmed(raw_value);
        let field = sink
            .property_fields
            .iter()
            .find(|(field_url, _)| field_url == url)
            .map(|(_, column)| column.as_str());
        let source = match field {
            None => prov.source_json(),
            Some(field) => with_field(&prov, field).source_json(),
        };
        property_provenance.insert(url.clone(), serde_json::json!({"sources": [source]}));
        if let Some(audit) = audit {
            audits.push((url.clone(), audit));
        }
        properties.push((url.clone(), value));
    }

    Ok((
        EntityOp {
            namespace: namespace.to_owned(),
            entity_type: sink.entity_type.clone(),
            entity_id,
            properties,
            property_provenance,
            provenance: prov,
            web_id: sink.web_id.clone(),
        },
        audits,
    ))
}

pub fn row_to_link_op(
    row: &Row,
    entry: &LinkEntry,
    namespace: &str,
    provenance: &Provenance,
    unit_maps: &Map<String, Value>,
) -> (LinkOp, Vec<(String, Audit)>) {
    let source_id = row
        .get("_source_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let target_id = row
        .get("_target_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let mut properties = vec![];
    let mut audits = vec![];
    for (url, accessor) in &entry.properties {
        let (value, audit) = resolve_audited(accessor, row, unit_maps);
        if let Some(audit) = audit {
            audits.push((url.clone(), audit));
        }
        properties.push((url.clone(), trimmed(value)));
    }
    (
        LinkOp {
            op_id: super::link_pipeline::link_op_id(
                namespace,
                &entry.web_id,
                &entry.link_type,
                &source_id,
                &target_id,
            ),
            namespace: namespace.to_owned(),
            web_id: entry.web_id.clone(),
            source_entity_type: entry.from.entity_type.clone(),
            source_entity_id: source_id,
            link_type: entry.link_type.clone(),
            target_entity_type: entry.to.entity_type.clone(),
            target_id,
            properties: (!properties.is_empty()).then_some(properties),
            provenance: provenance.clone(),
        },
        audits,
    )
}

pub fn trimmed(value: Value) -> Value {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Value::Null
            } else {
                Value::String(trimmed.to_owned())
            }
        }
        other => other,
    }
}

fn apply_provenance_fields(
    base: &Provenance,
    row: &Row,
    sink: &SinkConfig,
    unit_maps: &Map<String, Value>,
) -> (Provenance, Vec<(String, Audit)>) {
    let fields = &sink.provenance_fields;
    if fields.authors.is_none() && fields.first_published.is_none() && fields.last_updated.is_none()
    {
        return (base.clone(), vec![]);
    }

    let mut audits = vec![];
    let mut resolve_text = |accessor: &Option<Accessor>, label: &str| -> Option<String> {
        let accessor = accessor.as_ref()?;
        let (value, audit) = resolve_audited(accessor, row, unit_maps);
        if let Some(audit) = audit {
            audits.push((format!("provenanceFields.{label}"), audit));
        }
        if value.is_null() {
            return None;
        }
        let text = js_string(&value).trim().to_owned();
        (!text.is_empty()).then_some(text)
    };

    let authors = resolve_text(&fields.authors, "authors");
    let first_published = resolve_text(&fields.first_published, "firstPublished").map(datestamp);
    let last_updated = resolve_text(&fields.last_updated, "lastUpdated").map(datestamp);
    if authors.is_none() && first_published.is_none() && last_updated.is_none() {
        return (base.clone(), audits);
    }
    let mut prov = base.clone();
    if let Some(authors) = authors {
        prov.authors = Some(vec![authors]);
    }
    if first_published.is_some() {
        prov.first_published = first_published;
    }
    if last_updated.is_some() {
        prov.last_updated = last_updated;
    }
    (prov, audits)
}

fn datestamp(value: String) -> String {
    let date_only = value.len() == 10
        && value.as_bytes()[4] == b'-'
        && value.as_bytes()[7] == b'-'
        && value.chars().filter(char::is_ascii_digit).count() == 8;
    if date_only {
        format!("{value}T00:00:00Z")
    } else {
        value
    }
}

fn with_field(base: &Provenance, field: &str) -> Provenance {
    let mut prov = base.clone();
    prov.location_name = if base.location_name.is_empty() {
        field.to_owned()
    } else {
        format!("{}/{field}", base.location_name)
    };
    prov
}

fn validate_delivery(value: &GraphDeliveryPayloadV1) -> Result<(), CompatError> {
    if value.encoding_version != GRAPH_DELIVERY_ENCODING_VERSION {
        return Err(malformed(format!(
            "encoding_version must be {GRAPH_DELIVERY_ENCODING_VERSION}"
        )));
    }
    if value.graph_identity.is_empty() || value.graph_identity.chars().any(char::is_whitespace) {
        return Err(malformed(
            "graph_identity must be non-empty and whitespace-free".to_owned(),
        ));
    }
    let (patch, archive) = match &value.request {
        GraphDeliveryRequestV1::Upsert {
            create,
            patch,
            archive,
        } => {
            if !create.is_object() {
                return Err(malformed("create request must be an object".to_owned()));
            }
            (Some(patch), archive)
        }
        GraphDeliveryRequestV1::Archive { archive } => (None, archive),
    };
    if let Some(patch) = patch {
        validate_request_identity("patch", patch, &value.graph_identity)?;
        if patch.get("archived").and_then(Value::as_bool) != Some(false) {
            return Err(malformed("upsert patch must revive the object".to_owned()));
        }
    }
    validate_request_identity("archive", archive, &value.graph_identity)?;
    if archive.get("archived").and_then(Value::as_bool) != Some(true) {
        return Err(malformed(
            "archive request must archive the object".to_owned(),
        ));
    }
    Ok(())
}

fn validate_request_identity(
    label: &str,
    request: &Value,
    expected: &str,
) -> Result<(), CompatError> {
    let actual = request.get("entityId").and_then(Value::as_str);
    if actual == Some(expected) {
        Ok(())
    } else {
        Err(malformed(format!(
            "{label} entityId is {actual:?}, expected {expected:?}"
        )))
    }
}

fn malformed(message: String) -> CompatError {
    CompatError::Malformed {
        name: GraphDeliveryPayload::declaration().name,
        message,
    }
}

impl DurableRecord for GraphDeliveryPayload {
    fn declaration() -> &'static RecordDeclaration {
        &GRAPH_DELIVERY_PAYLOAD_DECLARATION
    }
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_delivery(self.wire())?;
        let bytes = serde_json::to_vec(self).map_err(|error| malformed(error.to_string()))?;
        if bytes.len() > MAX_GRAPH_DELIVERY_PAYLOAD_BYTES {
            return Err(malformed(format!(
                "payload is {} bytes; maximum is {MAX_GRAPH_DELIVERY_PAYLOAD_BYTES}",
                bytes.len()
            )));
        }
        Ok(bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        if bytes.len() > MAX_GRAPH_DELIVERY_PAYLOAD_BYTES {
            return Err(malformed(format!(
                "payload is {} bytes; maximum is {MAX_GRAPH_DELIVERY_PAYLOAD_BYTES}",
                bytes.len()
            )));
        }
        let raw: Value =
            serde_json::from_slice(bytes).map_err(|error| malformed(error.to_string()))?;
        reject_unknown_fields(Self::declaration().name, "", &raw, &["version", "data"])?;
        if raw.get("version").and_then(Value::as_str) != Some("v1") {
            return Err(CompatError::UnsupportedVersion {
                name: Self::declaration().name,
                version: raw
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>")
                    .to_owned(),
            });
        }
        let data = raw
            .get("data")
            .ok_or_else(|| malformed("data is required".to_owned()))?;
        reject_unknown_fields(
            Self::declaration().name,
            "data",
            data,
            &["encoding_version", "graph_identity", "request"],
        )?;
        let request = data
            .get("request")
            .ok_or_else(|| malformed("data.request is required".to_owned()))?;
        reject_unknown_fields(
            Self::declaration().name,
            "data.request",
            request,
            &["kind", "data"],
        )?;
        let request_data = request
            .get("data")
            .ok_or_else(|| malformed("data.request.data is required".to_owned()))?;
        match request.get("kind").and_then(Value::as_str) {
            Some("upsert") => reject_unknown_fields(
                Self::declaration().name,
                "data.request.data",
                request_data,
                &["create", "patch", "archive"],
            )?,
            Some("archive") => reject_unknown_fields(
                Self::declaration().name,
                "data.request.data",
                request_data,
                &["archive"],
            )?,
            _ => return Err(malformed("request kind is unsupported".to_owned())),
        }
        let value: Self =
            serde_json::from_value(raw).map_err(|error| malformed(error.to_string()))?;
        validate_delivery(value.wire())?;
        Ok(value)
    }
}

impl VersionedRecord for GraphDeliveryPayload {
    type Current = GraphDeliveryPayloadV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        self.into_current()
    }
}

impl PureUpcastRecord for GraphDeliveryPayload {}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use error_stack::Report;
    use serde_json::json;

    use super::*;
    use crate::blob::{BlobRef, BlobRefV1};
    use crate::error::GraphError;
    use crate::graph::effects::{BlobSliceRefV1, GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE};
    use crate::graph::{BatchOk, BulkResult, GraphClient};

    fn provenance() -> Provenance {
        Provenance {
            loaded_at: "2026-07-22T10:00:00Z".to_owned(),
            location_name: "fixture".to_owned(),
            ..Provenance::default()
        }
    }

    fn entity() -> EntityOp {
        EntityOp {
            namespace: "connector".to_owned(),
            entity_type: "https://example.com/types/entity-type/item/v/1".to_owned(),
            entity_id: json!("A-1"),
            properties: vec![(
                "https://example.com/types/property-type/name/v/1".to_owned(),
                json!("Widget"),
            )],
            property_provenance: BTreeMap::new(),
            provenance: provenance(),
            web_id: "00000000-0000-4000-8000-000000000001".to_owned(),
        }
    }

    fn link() -> LinkOp {
        LinkOp {
            op_id: super::super::link_pipeline::link_op_id(
                "connector",
                "00000000-0000-4000-8000-000000000001",
                "https://example.com/types/entity-type/related/v/1",
                "A-1",
                "B-1",
            ),
            namespace: "connector".to_owned(),
            web_id: "00000000-0000-4000-8000-000000000001".to_owned(),
            source_entity_type: "https://example.com/types/entity-type/item/v/1".to_owned(),
            source_entity_id: "A-1".to_owned(),
            link_type: "https://example.com/types/entity-type/related/v/1".to_owned(),
            target_entity_type: "https://example.com/types/entity-type/item/v/1".to_owned(),
            target_id: "B-1".to_owned(),
            properties: None,
            provenance: provenance(),
        }
    }

    fn decode_input(input: &DesiredObjectInputV1) -> GraphDeliveryPayloadV1 {
        let bytes = input.disposition.payload();
        GraphDeliveryPayload::decode(bytes)
            .expect("delivery payload")
            .into_current()
            .expect("current payload")
    }

    #[derive(Default)]
    struct PanicClient {
        calls: AtomicUsize,
    }

    impl PanicClient {
        fn called(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }

        fn unexpected(&self) -> ! {
            self.calls.fetch_add(1, Ordering::SeqCst);
            panic!("planner attempted a Graph call")
        }
    }

    #[async_trait::async_trait]
    impl GraphClient for PanicClient {
        fn identity(&self) -> String {
            "panic:graph".to_owned()
        }

        async fn has_entity(&self, _full_entity_id: &str) -> Result<bool, Report<GraphError>> {
            self.unexpected()
        }

        async fn archive_entity(&self, _op: &ArchiveOp) -> Result<(), Report<GraphError>> {
            self.unexpected()
        }

        async fn bulk_upsert_entities(
            &self,
            _ops: Vec<EntityOp>,
            _on_batch_ok: BatchOk,
        ) -> BulkResult {
            self.unexpected()
        }

        async fn bulk_upsert_links(&self, _ops: Vec<LinkOp>, _on_batch_ok: BatchOk) -> BulkResult {
            self.unexpected()
        }
    }

    #[test]
    fn planning_is_graph_client_free_and_preserves_delivery_request_bytes() {
        let client = Arc::new(PanicClient::default());
        let entity = entity();
        let link = link();
        let planned_entity = plan_entity_upsert(&entity).expect("entity plan");
        let planned_link = plan_link_upsert(&link).expect("link plan");

        let entity_payload = decode_input(&planned_entity.desired);
        let GraphDeliveryRequestV1::Upsert {
            create,
            patch,
            archive,
        } = entity_payload.request
        else {
            panic!("entity upsert")
        };
        assert_eq!(create, entity_create_params(&entity));
        assert_eq!(patch, entity_patch_params(&entity));
        let entity_archive = ArchiveOp {
            namespace: entity.namespace.clone(),
            entity_type: entity.entity_type.clone(),
            entity_id: js_string(&entity.entity_id),
            provenance: entity.provenance.clone(),
            web_id: entity.web_id.clone(),
        };
        assert_eq!(archive, archive_params(&entity_archive));

        let link_payload = decode_input(&planned_link.desired);
        let GraphDeliveryRequestV1::Upsert {
            create,
            patch,
            archive,
        } = link_payload.request
        else {
            panic!("link upsert")
        };
        assert_eq!(create, link_create_params(&link));
        assert_eq!(patch, link_patch_params(&link));
        assert_eq!(
            archive.get("entityId"),
            Some(&Value::String(link_entity_ids(&link).full_link_id))
        );
        assert_eq!(client.called(), 0);
    }

    fn published(plan: &GraphPlanV1) -> PublishedDesiredProjectionV1 {
        let objects = plan
            .desired
            .iter()
            .enumerate()
            .map(|(index, input)| {
                let payload = BlobSliceRefV1 {
                    artifact: BlobRef::V1(BlobRefV1 {
                        key: "payloads/pack.bin".to_owned(),
                        sha256: "a".repeat(64),
                        size: 4096,
                        media_type: GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE.to_owned(),
                        e_tag: None,
                        provider_version: None,
                    }),
                    offset: (index * 128) as u64,
                    length: 128,
                };
                let disposition = match &input.disposition {
                    DesiredObjectInputDispositionV1::Live(_) => DesiredDispositionV1::Live {
                        payload_digest: "b".repeat(64),
                        payload,
                    },
                    DesiredObjectInputDispositionV1::Archived(_) => {
                        DesiredDispositionV1::Archived {
                            payload_digest: "c".repeat(64),
                            payload,
                        }
                    }
                };
                super::super::artifacts::DesiredGraphObjectV1 {
                    kind: input.kind,
                    graph_identity: input.graph_identity.clone(),
                    disposition,
                }
            })
            .collect();
        PublishedDesiredProjectionV1 {
            reference: crate::orchestrator::work::DesiredProjectionRef {
                artifact: BlobRef::V1(BlobRefV1 {
                    key: "desired/index.json".to_owned(),
                    sha256: "d".repeat(64),
                    size: 1024,
                    media_type: super::super::artifacts::DESIRED_PROJECTION_INDEX_MEDIA_TYPE
                        .to_owned(),
                    e_tag: None,
                    provider_version: None,
                }),
            },
            objects,
        }
    }

    fn resolved(input: &DesiredObjectInputV1, marker: char) -> ResolvedDesiredObjectV1 {
        let payload = input.disposition.payload().to_vec();
        let payload_digest = hex::encode(Sha256::digest(&payload));
        let payload_ref = BlobSliceRefV1 {
            artifact: BlobRef::V1(BlobRefV1 {
                key: format!("payloads/{marker}.bin"),
                sha256: marker.to_string().repeat(64),
                size: payload.len() as u64,
                media_type: GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE.to_owned(),
                e_tag: None,
                provider_version: None,
            }),
            offset: 0,
            length: payload.len() as u64,
        };
        let disposition = match input.disposition {
            DesiredObjectInputDispositionV1::Live(_) => DesiredDispositionV1::Live {
                payload_digest,
                payload: payload_ref,
            },
            DesiredObjectInputDispositionV1::Archived(_) => DesiredDispositionV1::Archived {
                payload_digest,
                payload: payload_ref,
            },
        };
        ResolvedDesiredObjectV1 {
            object: super::super::artifacts::DesiredGraphObjectV1 {
                kind: input.kind,
                graph_identity: input.graph_identity.clone(),
                disposition,
            },
            payload,
        }
    }

    #[test]
    fn plan_finishes_in_dependency_order_and_binds_the_same_effect_set() {
        let entity = entity();
        let link = link();
        let mut plan = GraphPlanV1::default();
        plan.add(plan_link_upsert(&link).expect("link"), true);
        plan.add(plan_entity_upsert(&entity).expect("entity"), true);
        let archive = ArchiveOp {
            namespace: "connector".to_owned(),
            entity_type: entity.entity_type.clone(),
            entity_id: "Z-1".to_owned(),
            provenance: provenance(),
            web_id: entity.web_id.clone(),
        };
        plan.add(plan_entity_archive(&archive).expect("archive"), true);
        let plan = plan.finish().expect("finish");
        let published = published(&plan);
        let effects =
            bind_apply_effects(&"1".repeat(64), &published, &plan.effects).expect("bind effects");
        assert_eq!(effects.len(), 3);
        assert_eq!(effects[0].operation, GraphOperationV1::UpsertEntity);
        assert_eq!(effects[1].operation, GraphOperationV1::UpsertLink);
        assert_eq!(effects[2].operation, GraphOperationV1::ArchiveEntity);
        assert!(effects[0].payload.is_some());
        assert!(effects[1].payload.is_some());
        assert!(effects[2].payload.is_none());
        assert!(effects
            .windows(2)
            .all(|pair| pair[0].effect_id != pair[1].effect_id));
    }

    #[test]
    fn restore_force_applies_a_and_archives_only_g_identities_in_dependency_order() {
        let entity = entity();
        let link = link();
        let a_live = plan_entity_upsert(&entity).expect("A entity");
        let g_archived_same = plan_entity_archive(&ArchiveOp {
            namespace: entity.namespace.clone(),
            entity_type: entity.entity_type.clone(),
            entity_id: js_string(&entity.entity_id),
            provenance: entity.provenance.clone(),
            web_id: entity.web_id.clone(),
        })
        .expect("G archive");
        let g_only_link = plan_link_upsert(&link).expect("G-only link");
        let a = vec![resolved(&a_live.desired, 'a')];
        let g = vec![
            resolved(&g_archived_same.desired, 'b'),
            resolved(&g_only_link.desired, 'c'),
        ];

        let effects = plan_restore_effects(&"1".repeat(64), &a, &g).expect("Restore plan");
        assert_eq!(effects.len(), 2);
        assert_eq!(effects[0].operation, GraphOperationV1::UpsertEntity);
        assert_eq!(effects[0].graph_identity, a_live.desired.graph_identity);
        assert_eq!(
            effects[0].payload.as_ref(),
            Some(a[0].object.disposition.payload())
        );
        assert_eq!(effects[1].operation, GraphOperationV1::ArchiveLink);
        assert_eq!(
            effects[1].graph_identity,
            g_only_link.desired.graph_identity
        );
        assert!(effects[1].payload.is_none());
        assert!(effects
            .iter()
            .all(|effect| effect.target_state_digest == "1".repeat(64)));
    }

    #[test]
    fn restore_to_initial_empty_archives_every_contaminated_identity() {
        let g_entity = plan_entity_upsert(&entity()).expect("G entity");
        let g_link = plan_link_upsert(&link()).expect("G link");
        let effects = plan_restore_effects(
            "",
            &[],
            &[
                resolved(&g_entity.desired, 'd'),
                resolved(&g_link.desired, 'e'),
            ],
        )
        .expect("empty-state Restore plan");
        assert_eq!(
            effects
                .iter()
                .map(|effect| effect.operation)
                .collect::<Vec<_>>(),
            vec![
                GraphOperationV1::ArchiveLink,
                GraphOperationV1::ArchiveEntity,
            ]
        );
        assert!(effects
            .iter()
            .all(|effect| effect.target_state_digest.is_empty()
                && effect.payload.is_none()
                && effect.payload_digest.is_none()));
    }

    #[test]
    fn reconcile_force_applies_every_live_and_archived_object_in_dependency_order() {
        let live_entity = plan_entity_upsert(&entity()).expect("live entity");
        let archived_link = plan_link_archive(&ArchiveOp {
            namespace: "connector".to_owned(),
            entity_type: link().link_type,
            entity_id: "item::A::item::B".to_owned(),
            provenance: provenance(),
            web_id: "web".to_owned(),
        })
        .expect("archived link");
        let desired = vec![
            resolved(&archived_link.desired, 'a'),
            resolved(&live_entity.desired, 'b'),
        ];

        let effects = plan_reconcile_effects(&"2".repeat(64), &desired).expect("Reconcile plan");
        assert_eq!(effects.len(), 2);
        assert_eq!(effects[0].operation, GraphOperationV1::UpsertEntity);
        assert_eq!(effects[1].operation, GraphOperationV1::ArchiveLink);
        assert_eq!(
            effects[0].payload.as_ref(),
            Some(desired[1].object.disposition.payload())
        );
        assert!(effects[1].payload.is_none());
        assert!(effects
            .iter()
            .all(|effect| effect.target_state_digest == "2".repeat(64)));
    }

    #[test]
    fn changes_only_reuses_applied_bytes_and_retains_archive_tombstones() {
        let old_live = plan_entity_upsert(&entity()).expect("old live").desired;
        let old_archive = plan_entity_archive(&ArchiveOp {
            namespace: "connector".to_owned(),
            entity_type: "https://example.com/types/entity-type/item/v/1".to_owned(),
            entity_id: "retired".to_owned(),
            provenance: provenance(),
            web_id: "web".to_owned(),
        })
        .expect("old archive")
        .desired;
        let applied = vec![resolved(&old_live, 'a'), resolved(&old_archive, 'b')];

        let mut regenerated = entity();
        regenerated.provenance.loaded_at = "2099-01-01T00:00:00Z".to_owned();
        let mut generated = GraphPlanV1::default();
        generated.add(
            plan_entity_upsert(&regenerated).expect("regenerated"),
            false,
        );
        let finalized = finalize_projection_plan(
            &applied,
            generated,
            EffectSelectionV1::ChangesOnly,
            ProjectionCoverageV1::Complete,
        )
        .expect("finalize");

        assert!(finalized.effects.is_empty());
        assert_eq!(finalized.desired.len(), 2);
        let retained_live = finalized
            .desired
            .iter()
            .find(|desired| desired.graph_identity == old_live.graph_identity)
            .expect("retained live");
        assert_eq!(
            retained_live.disposition.payload(),
            old_live.disposition.payload()
        );
        assert!(finalized.desired.iter().any(|desired| {
            desired.graph_identity == old_archive.graph_identity
                && !disposition_is_live(&desired.disposition)
                && desired.disposition.payload() == old_archive.disposition.payload()
        }));
    }

    #[test]
    fn exact_adoption_suppresses_stale_hint_but_real_change_is_emitted() {
        let old = plan_entity_upsert(&entity()).expect("old");
        let applied = vec![resolved(&old.desired, 'a')];
        let mut same = GraphPlanV1::default();
        same.add(old.clone(), true);
        let adopted = finalize_projection_plan(
            &applied,
            same,
            EffectSelectionV1::ChangesOnly,
            ProjectionCoverageV1::Complete,
        )
        .expect("adopt");
        assert!(adopted.effects.is_empty());

        let mut changed_entity = entity();
        changed_entity.properties[0].1 = json!("changed");
        let mut changed = GraphPlanV1::default();
        changed.add(plan_entity_upsert(&changed_entity).expect("changed"), true);
        let changed = finalize_projection_plan(
            &applied,
            changed,
            EffectSelectionV1::ChangesOnly,
            ProjectionCoverageV1::Complete,
        )
        .expect("changed plan");
        assert_eq!(changed.effects.len(), 1);
        assert_eq!(changed.effects[0].operation, GraphOperationV1::UpsertEntity);
    }

    #[test]
    fn initialization_is_the_only_mode_that_adopts_an_object_missing_from_a() {
        let mut generated = GraphPlanV1::default();
        generated.add(plan_entity_upsert(&entity()).expect("entity"), false);
        let apply = finalize_projection_plan(
            &[],
            generated.clone(),
            EffectSelectionV1::ChangesOnly,
            ProjectionCoverageV1::Complete,
        )
        .expect("ordinary apply");
        assert_eq!(apply.effects.len(), 1);

        let initialization = finalize_projection_plan(
            &[],
            generated,
            EffectSelectionV1::InitializeFromExistingState,
            ProjectionCoverageV1::Complete,
        )
        .expect("initialization");
        assert!(initialization.effects.is_empty());
    }

    #[test]
    fn complete_plan_archives_missing_live_objects_while_partial_plan_carries_them() {
        let old = plan_entity_upsert(&entity()).expect("old");
        let applied = vec![resolved(&old.desired, 'a')];

        let complete = finalize_projection_plan(
            &applied,
            GraphPlanV1::default(),
            EffectSelectionV1::ChangesOnly,
            ProjectionCoverageV1::Complete,
        )
        .expect("complete");
        assert_eq!(complete.effects.len(), 1);
        assert_eq!(
            complete.effects[0].operation,
            GraphOperationV1::ArchiveEntity
        );
        assert!(!disposition_is_live(&complete.desired[0].disposition));
        assert_eq!(
            complete.desired[0].disposition.payload(),
            old.desired.disposition.payload()
        );

        let partial = finalize_projection_plan(
            &applied,
            GraphPlanV1::default(),
            EffectSelectionV1::ChangesOnly,
            ProjectionCoverageV1::Partial,
        )
        .expect("partial");
        assert!(partial.effects.is_empty());
        assert!(disposition_is_live(&partial.desired[0].disposition));
    }

    #[test]
    fn merged_force_plan_has_one_dependency_order_for_entities_and_links() {
        let mut entities = GraphPlanV1::default();
        entities.add(plan_entity_upsert(&entity()).expect("entity"), false);
        entities.add(
            plan_entity_archive(&ArchiveOp {
                namespace: "connector".to_owned(),
                entity_type: "https://example.com/types/entity-type/item/v/1".to_owned(),
                entity_id: "retired".to_owned(),
                provenance: provenance(),
                web_id: "web".to_owned(),
            })
            .expect("entity archive"),
            false,
        );
        let mut links = GraphPlanV1::default();
        links.add(plan_link_upsert(&link()).expect("link"), false);
        links.add(
            plan_link_archive(&ArchiveOp {
                namespace: "connector".to_owned(),
                entity_type: "https://example.com/types/entity-type/related/v/1".to_owned(),
                entity_id: "item::A::item::B".to_owned(),
                provenance: provenance(),
                web_id: "web".to_owned(),
            })
            .expect("link archive"),
            false,
        );
        entities.merge(links);

        let forced = finalize_projection_plan(
            &[],
            entities,
            EffectSelectionV1::ForceAll,
            ProjectionCoverageV1::Complete,
        )
        .expect("force");
        assert_eq!(
            forced
                .effects
                .iter()
                .map(|effect| effect.operation)
                .collect::<Vec<_>>(),
            vec![
                GraphOperationV1::UpsertEntity,
                GraphOperationV1::UpsertLink,
                GraphOperationV1::ArchiveLink,
                GraphOperationV1::ArchiveEntity,
            ]
        );
    }

    #[test]
    fn codec_rejects_forged_identity_and_nested_wrapper_drift() {
        let planned = plan_entity_upsert(&entity()).expect("plan");
        let bytes = planned.desired.disposition.payload();
        let mut raw: Value = serde_json::from_slice(bytes).expect("payload JSON");
        raw["data"]["graph_identity"] = Value::String("wrong".to_owned());
        assert!(
            GraphDeliveryPayload::decode(&serde_json::to_vec(&raw).expect("forged bytes")).is_err()
        );

        let mut drift: Value = serde_json::from_slice(bytes).expect("payload JSON");
        drift["data"]["request"]["future"] = Value::Bool(true);
        assert!(matches!(
            GraphDeliveryPayload::decode(&serde_json::to_vec(&drift).expect("drift bytes")),
            Err(CompatError::ExtraField { path, .. }) if path == "data.request.future"
        ));
    }

    #[test]
    fn exact_entity_and_link_delivery_bytes_match_independent_golden() {
        let entity = plan_entity_upsert(&entity()).expect("entity");
        let link = plan_link_upsert(&link()).expect("link");
        let fixture: Value =
            serde_json::from_slice(include_bytes!("../../tests/golden/graph-delivery-v1.json"))
                .expect("delivery fixture");
        assert_eq!(
            entity.desired.disposition.payload(),
            serde_json::to_vec(&fixture["entity"])
                .expect("entity fixture bytes")
                .as_slice()
        );
        assert_eq!(
            link.desired.disposition.payload(),
            serde_json::to_vec(&fixture["link"])
                .expect("link fixture bytes")
                .as_slice()
        );
    }
}
