//! Side-effect-free batch planning inside a disposable candidate workspace.
//!
//! Every live source reaches this module only through a journal-bound bronze
//! capture. The planner mutates DuckDB candidate tables and emits exact Graph
//! requests, but owns no Graph client and performs no external delivery.
use std::collections::BTreeMap;
use std::path::Path;

use error_stack::{Report, ResultExt as _};

use crate::config::Env;
use crate::definition::{Integration, LinkEntry, Pipeline, SourceKind, Step, StepKind};
use crate::engine::batch_sync::{collect_sinks, compose_provenance};
use crate::error::SourceError;
use crate::graph::link_pipeline::{self, LinkPlanningContext};
use crate::graph::planner::{EffectSelectionV1, GraphPlanV1, ProjectionCoverageV1};
use crate::graph::sink::{self, EntityPlanningContext};
use crate::orchestrator::work::{StatePhase, StatePhaseV1};
use crate::orchestrator::InvocationV1;
use crate::steps::{self, NamedInput, Transforms};
use crate::store::{lit, qi, Store};

pub(crate) struct CapturedSourceInput<'a> {
    pub(crate) path: &'a Path,
    pub(crate) loaded_at: &'a str,
}

#[derive(Debug)]
pub(crate) struct CandidatePlanV1 {
    pub(crate) graph: GraphPlanV1,
    pub(crate) coverage: ProjectionCoverageV1,
    pub(crate) phase: StatePhase,
}

enum PlannedStep {
    Graph(sink::EntitySinkPlanV1),
    Checkpoint,
}

pub(crate) async fn plan_candidate(
    store: &Store,
    integration: &Integration,
    captures: &BTreeMap<String, CapturedSourceInput<'_>>,
    invocation: &InvocationV1,
    transforms: &Transforms,
    env: &Env,
    submitted_at: &str,
) -> Result<CandidatePlanV1, Report<SourceError>> {
    let ordered = crate::engine::topology::sort_pipelines(&integration.pipelines)
        .map_err(|message| Report::new(SourceError).attach_printable(message))?;
    let mut graph = GraphPlanV1::default();
    let mut coverage = if invocation.links_only {
        ProjectionCoverageV1::Partial
    } else {
        ProjectionCoverageV1::Complete
    };

    if !invocation.links_only {
        for pipeline in ordered {
            let source = integration.sources.get(&pipeline.source).ok_or_else(|| {
                Report::new(SourceError)
                    .attach_printable(format!("source {} is not declared", pipeline.source))
            })?;
            if source.partial {
                coverage = ProjectionCoverageV1::Partial;
            }
            let source_table = format!("{}/{}", integration.connector_id, pipeline.source);
            hydrate_captured_source(
                store,
                &source_table,
                &pipeline.source,
                &source.kind,
                captures,
            )
            .await?;
            let row_count = store
                .query(&format!(
                    "SELECT COUNT(*)::BIGINT FROM {}",
                    qi(&source_table)
                ))
                .await
                .change_context(SourceError)?
                .single_i64();
            if let Some(asserts) = &source.asserts {
                crate::engine::asserts::run(
                    store,
                    &source_table,
                    &pipeline.source,
                    asserts,
                    row_count,
                )
                .await?;
            }
            let loaded_at = captures
                .get(&pipeline.source)
                .map_or(submitted_at, |capture| capture.loaded_at);
            if row_count == 0 {
                materialize_empty_pipeline(store, pipeline, &source_table, transforms).await?;
                if !source.partial
                    && !source.archive_on_empty
                    && source_has_prior_sink_state(store, integration, pipeline).await?
                {
                    coverage = ProjectionCoverageV1::Partial;
                } else {
                    graph.merge(
                        plan_empty_source(store, integration, pipeline, source, loaded_at, env)
                            .await?,
                    );
                }
            } else {
                graph.merge(
                    plan_source_pipeline(
                        store,
                        integration,
                        pipeline,
                        source,
                        &source_table,
                        loaded_at,
                        transforms,
                        env,
                    )
                    .await?,
                );
            }
            cleanup_pipeline_tables(store, pipeline, &source_table).await;
        }
    }

    for link in &integration.link_pipelines {
        let data_table = materialize_link_input(store, link).await?;
        let provenance = compose_provenance(
            integration,
            link.provenance.as_ref(),
            &format!("links:{}", link.id),
            submitted_at,
        );
        let planned = link_pipeline::plan_link_table(
            store,
            link,
            &data_table,
            &LinkPlanningContext {
                connector_id: &integration.connector_id,
                provenance: &provenance,
                unit_maps: &integration.unit_maps,
                effect_selection: EffectSelectionV1::ChangesOnly,
            },
        )
        .await?;
        graph.merge(planned.graph);
    }

    let phase = if integration.link_pipelines.is_empty() && !invocation.links_only {
        StatePhase::V1(StatePhaseV1::SourcesCommitted)
    } else {
        StatePhase::V1(StatePhaseV1::LinksCommitted)
    };
    Ok(CandidatePlanV1 {
        graph: graph.finish().change_context(SourceError)?,
        coverage,
        phase,
    })
}

async fn hydrate_captured_source(
    store: &Store,
    table: &str,
    source: &str,
    kind: &SourceKind,
    captures: &BTreeMap<String, CapturedSourceInput<'_>>,
) -> Result<(), Report<SourceError>> {
    match kind {
        SourceKind::Checkpoint { name } => {
            let checkpoint = checkpoint_table(name);
            if store
                .schema_of(&checkpoint)
                .await
                .change_context(SourceError)?
                .is_none()
            {
                return Err(Report::new(SourceError)
                    .attach_printable(format!("checkpoint {name:?} is unavailable")));
            }
            store
                .exec(&format!(
                    "CREATE OR REPLACE TABLE {} AS SELECT * FROM {}",
                    qi(table),
                    qi(&checkpoint)
                ))
                .await
                .change_context(SourceError)
        }
        SourceKind::Table { .. } => Err(Report::new(SourceError).attach_printable(format!(
            "stream table source {source:?} is invalid in protocol V1"
        ))),
        SourceKind::Sql { .. }
        | SourceKind::External { .. }
        | SourceKind::Rest { .. }
        | SourceKind::Postgres(_) => {
            let capture = captures.get(source).ok_or_else(|| {
                Report::new(SourceError)
                    .attach_printable(format!("source {source:?} has no durable bronze capture"))
            })?;
            store
                .exec(&format!(
                    "CREATE OR REPLACE TABLE {} AS SELECT * FROM read_parquet({})",
                    qi(table),
                    lit(&capture.path.display().to_string())
                ))
                .await
                .change_context(SourceError)
        }
    }
}

async fn source_has_prior_sink_state(
    store: &Store,
    integration: &Integration,
    pipeline: &Pipeline,
) -> Result<bool, Report<SourceError>> {
    for sink in collect_sinks(std::slice::from_ref(pipeline)) {
        if store
            .schema_of(&format!(
                "_state/sync/{}/{}",
                integration.connector_id, sink.sink_id
            ))
            .await
            .change_context(SourceError)?
            .is_some()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn plan_empty_source(
    store: &Store,
    integration: &Integration,
    pipeline: &Pipeline,
    source: &crate::definition::SourceDef,
    loaded_at: &str,
    env: &Env,
) -> Result<GraphPlanV1, Report<SourceError>> {
    let provenance = compose_provenance(
        integration,
        source.provenance.as_ref(),
        &pipeline.source,
        loaded_at,
    );
    let mut graph = GraphPlanV1::default();
    for sink in collect_sinks(std::slice::from_ref(pipeline)) {
        let planned = sink::plan_entity_sink(
            store,
            &sink.sink_id,
            sink.config,
            None,
            &EntityPlanningContext {
                connector_id: &integration.connector_id,
                provenance: &provenance,
                unit_maps: &integration.unit_maps,
                source: Some(&pipeline.source),
                partial: source.partial,
                effect_selection: EffectSelectionV1::ChangesOnly,
                env,
            },
        )
        .await?;
        reject_row_build_errors(&sink.sink_id, &planned.errors)?;
        graph.merge(planned.graph);
    }
    Ok(graph)
}

async fn materialize_empty_pipeline(
    store: &Store,
    pipeline: &Pipeline,
    source_table: &str,
    transforms: &Transforms,
) -> Result<(), Report<SourceError>> {
    let named_inputs = materialize_named_inputs(store, pipeline).await?;
    let mut on_side_effect = |step: &Step, current_table: &str| {
        let store = store.clone();
        let step = step.clone();
        let current_table = current_table.to_owned();
        Box::pin(async move {
            if let StepKind::Checkpoint { name } = &step.kind {
                store
                    .exec(&format!(
                        "CREATE OR REPLACE TABLE {} AS SELECT * FROM {}",
                        qi(&checkpoint_table(name)),
                        qi(&current_table)
                    ))
                    .await
                    .change_context(SourceError)?;
            }
            Ok(())
        })
            as std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<(), Report<SourceError>>> + Send>,
            >
    };
    steps::run_pipeline(
        store,
        source_table,
        &pipeline.steps,
        &named_inputs,
        transforms,
        &mut on_side_effect,
    )
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn plan_source_pipeline(
    store: &Store,
    integration: &Integration,
    pipeline: &Pipeline,
    source: &crate::definition::SourceDef,
    source_table: &str,
    loaded_at: &str,
    transforms: &Transforms,
    env: &Env,
) -> Result<GraphPlanV1, Report<SourceError>> {
    let named_inputs = materialize_named_inputs(store, pipeline).await?;
    let provenance = compose_provenance(
        integration,
        source.provenance.as_ref(),
        &pipeline.source,
        loaded_at,
    );
    let mut on_side_effect = |step: &Step, current_table: &str| {
        let store = store.clone();
        let step = step.clone();
        let current_table = current_table.to_owned();
        let connector_id = integration.connector_id.clone();
        let provenance = provenance.clone();
        let unit_maps = integration.unit_maps.clone();
        let source_name = pipeline.source.clone();
        let partial = source.partial;
        let env = env.clone();
        Box::pin(async move {
            match &step.kind {
                StepKind::GraphSink { config } => sink::plan_entity_sink(
                    &store,
                    &step.id,
                    config,
                    Some(&current_table),
                    &EntityPlanningContext {
                        connector_id: &connector_id,
                        provenance: &provenance,
                        unit_maps: &unit_maps,
                        source: Some(&source_name),
                        partial,
                        effect_selection: EffectSelectionV1::ChangesOnly,
                        env: &env,
                    },
                )
                .await
                .map(PlannedStep::Graph),
                StepKind::Checkpoint { name } => {
                    store
                        .exec(&format!(
                            "CREATE OR REPLACE TABLE {} AS SELECT * FROM {}",
                            qi(&checkpoint_table(name)),
                            qi(&current_table)
                        ))
                        .await
                        .change_context(SourceError)?;
                    Ok(PlannedStep::Checkpoint)
                }
                _ => unreachable!("step runner invokes only side-effect steps"),
            }
        })
            as std::pin::Pin<
                Box<
                    dyn std::future::Future<Output = Result<PlannedStep, Report<SourceError>>>
                        + Send,
                >,
            >
    };
    let outcome = steps::run_pipeline(
        store,
        source_table,
        &pipeline.steps,
        &named_inputs,
        transforms,
        &mut on_side_effect,
    )
    .await?;
    let mut graph = GraphPlanV1::default();
    for effect in outcome.effects {
        if let PlannedStep::Graph(planned) = effect {
            reject_row_build_errors("entity sink", &planned.errors)?;
            graph.merge(planned.graph);
        }
    }
    Ok(graph)
}

async fn materialize_named_inputs(
    store: &Store,
    pipeline: &Pipeline,
) -> Result<Vec<NamedInput>, Report<SourceError>> {
    let mut inputs = Vec::with_capacity(pipeline.inputs.len());
    for (alias, checkpoint) in &pipeline.inputs {
        let source = checkpoint_table(checkpoint);
        if store
            .schema_of(&source)
            .await
            .change_context(SourceError)?
            .is_none()
        {
            return Err(Report::new(SourceError)
                .attach_printable(format!("checkpoint {checkpoint:?} is unavailable")));
        }
        let table = format!("_ent_src/{}/{alias}", pipeline.source);
        store
            .exec(&format!(
                "CREATE OR REPLACE TABLE {} AS SELECT * FROM {}",
                qi(&table),
                qi(&source)
            ))
            .await
            .change_context(SourceError)?;
        inputs.push(NamedInput {
            alias: alias.clone(),
            table,
        });
    }
    Ok(inputs)
}

async fn materialize_link_input(
    store: &Store,
    link: &LinkEntry,
) -> Result<String, Report<SourceError>> {
    let inputs = if link.source.is_empty() {
        link.inputs.clone()
    } else {
        vec![("input".to_owned(), link.source.clone())]
    };
    if inputs.is_empty() {
        return Err(Report::new(SourceError)
            .attach_printable(format!("link pipeline {:?} has no input", link.id)));
    }
    let mut named = Vec::with_capacity(inputs.len());
    for (alias, checkpoint) in inputs {
        let source = checkpoint_table(&checkpoint);
        if store
            .schema_of(&source)
            .await
            .change_context(SourceError)?
            .is_none()
        {
            return Err(Report::new(SourceError)
                .attach_printable(format!("checkpoint {checkpoint:?} is unavailable")));
        }
        let table = format!("_link_src/{}/{alias}", link.id);
        store
            .exec(&format!(
                "CREATE OR REPLACE TABLE {} AS SELECT * FROM {}",
                qi(&table),
                qi(&source)
            ))
            .await
            .change_context(SourceError)?;
        named.push(NamedInput { alias, table });
    }
    if link.steps.is_empty() {
        return if named.len() == 1 {
            Ok(named.remove(0).table)
        } else {
            Err(Report::new(SourceError)
                .attach_printable("multiple link inputs require a SQL step"))
        };
    }
    let mut previous = None;
    for step in &link.steps {
        let StepKind::Sql { sql } = &step.kind else {
            continue;
        };
        let output = format!("_link_step/{}", step.id);
        steps::execute_sql_step(store, sql, previous.as_deref(), &output, &named).await?;
        previous = Some(output);
    }
    previous.ok_or_else(|| {
        Report::new(SourceError).attach_printable("link pipeline has no executable SQL step")
    })
}

fn reject_row_build_errors(
    sink_id: &str,
    errors: &[sink::SyncError],
) -> Result<(), Report<SourceError>> {
    if errors.is_empty() {
        return Ok(());
    }
    Err(Report::new(SourceError)
        .attach_printable(format!("sink {sink_id:?} rejected {} rows", errors.len()))
        .attach_printable(
            errors
                .iter()
                .take(5)
                .map(|error| format!("{}: {}", error.entity_id, error.message))
                .collect::<Vec<_>>()
                .join("; "),
        ))
}

async fn cleanup_pipeline_tables(store: &Store, pipeline: &Pipeline, source_table: &str) {
    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(source_table)))
        .await;
    for step in flatten_steps(&pipeline.steps) {
        let _ = store
            .exec(&format!(
                "DROP TABLE IF EXISTS {}",
                qi(&format!("_step/{}", step.id))
            ))
            .await;
    }
}

fn flatten_steps(steps: &[Step]) -> Vec<&Step> {
    let mut flattened = Vec::new();
    for step in steps {
        flattened.push(step);
        if let StepKind::Branch { branches } = &step.kind {
            for branch in branches {
                flattened.extend(flatten_steps(branch));
            }
        }
    }
    flattened
}

fn checkpoint_table(name: &str) -> String {
    format!("_checkpoint/{name}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::definition::{
        Accessor, Pipeline, ProvenanceFields, SinkConfig, SourceDef, Step, StepKind,
    };
    use crate::secret::Secret;
    use crate::store::StoreOptions;
    use serde_json::Map;
    use std::collections::HashMap;

    fn integration() -> Integration {
        Integration {
            connector_id: "candidate".to_owned(),
            connector_mode: "batch".to_owned(),
            connector_config: Secret::new(serde_json::json!({
                "id": "candidate",
                "mode": "batch"
            })),
            id_namespace: None,
            connector_provenance: None,
            sources: HashMap::from([(
                "orders".to_owned(),
                SourceDef {
                    kind: SourceKind::External {
                        key: None,
                        primary_key: vec!["id".to_owned()],
                    },
                    partial: false,
                    archive_on_empty: false,
                    provenance: None,
                    asserts: None,
                },
            )]),
            pipelines: vec![Pipeline {
                source: "orders".to_owned(),
                depends_on: vec![],
                inputs: vec![],
                steps: vec![Step {
                    id: "orders-sink".to_owned(),
                    kind: StepKind::GraphSink {
                        config: SinkConfig {
                            entity_type: "https://example.test/types/entity-type/order/v/1"
                                .to_owned(),
                            entity_id: "id".to_owned(),
                            web_id: "alice".to_owned(),
                            id_namespace: None,
                            properties: vec![(
                                "https://example.test/types/property-type/name/".to_owned(),
                                Accessor::Column("name".to_owned()),
                            )],
                            property_fields: vec![(
                                "https://example.test/types/property-type/name/".to_owned(),
                                "name".to_owned(),
                            )],
                            provenance: None,
                            provenance_fields: ProvenanceFields::default(),
                        },
                    },
                }],
            }],
            link_pipelines: vec![],
            unit_maps: Map::new(),
        }
    }

    #[tokio::test]
    async fn exact_capture_plans_without_graph_and_reuses_candidate_state() {
        let root = tempfile::tempdir().expect("workspace");
        let database = root.path().join("candidate.duckdb");
        let capture = root.path().join("orders.parquet");
        let store = Store::open(StoreOptions {
            path: Some(database),
            allowed_directories: Some(vec![root.path().to_owned()]),
            ..StoreOptions::default()
        })
        .expect("candidate store");
        store
            .exec(
                "CREATE TABLE seed AS SELECT 'one' AS _key, 'insert' AS _op, NULL::JSON AS _before, 'one' AS id, 'Order one' AS name",
            )
            .await
            .expect("seed source");
        store
            .exec(&format!(
                "COPY seed TO {} (FORMAT PARQUET)",
                lit(&capture.display().to_string())
            ))
            .await
            .expect("capture source");
        let captures = BTreeMap::from([(
            "orders".to_owned(),
            CapturedSourceInput {
                path: &capture,
                loaded_at: "2026-07-23T00:00:00Z",
            },
        )]);
        let invocation = InvocationV1::default();
        let transforms = Transforms::new();
        let env = Env::default();

        let first = plan_candidate(
            &store,
            &integration(),
            &captures,
            &invocation,
            &transforms,
            &env,
            "2026-07-23T00:00:00Z",
        )
        .await
        .expect("first candidate");
        assert_eq!(first.coverage, ProjectionCoverageV1::Complete);
        assert_eq!(first.graph.desired.len(), 1);
        assert_eq!(first.graph.effects.len(), 1);
        assert_eq!(
            store
                .query("SELECT COUNT(*)::BIGINT FROM \"_state/sync/candidate/orders-sink\"")
                .await
                .expect("state count")
                .single_i64(),
            1
        );

        let second = plan_candidate(
            &store,
            &integration(),
            &captures,
            &invocation,
            &transforms,
            &env,
            "2026-07-23T00:00:00Z",
        )
        .await
        .expect("second candidate");
        assert_eq!(second.graph.desired.len(), 1);
        assert!(second.graph.effects.is_empty());
        assert_eq!(second.phase, StatePhase::V1(StatePhaseV1::SourcesCommitted));
    }

    #[tokio::test]
    async fn empty_source_still_materializes_its_checkpoint() {
        let root = tempfile::tempdir().expect("workspace");
        let capture = root.path().join("empty.parquet");
        let store = Store::open(StoreOptions {
            allowed_directories: Some(vec![root.path().to_owned()]),
            ..StoreOptions::default()
        })
        .expect("candidate store");
        store
            .exec(
                "CREATE TABLE seed AS SELECT 'snapshot' AS _op, '{}' AS _key, \
                 NULL::JSON AS _before, 'one' AS id WHERE false",
            )
            .await
            .expect("seed empty source");
        store
            .exec(&format!(
                "COPY seed TO {} (FORMAT PARQUET)",
                lit(&capture.display().to_string())
            ))
            .await
            .expect("capture empty source");
        let mut integration = integration();
        integration.pipelines[0].steps = vec![Step {
            id: "orders-checkpoint".to_owned(),
            kind: StepKind::Checkpoint {
                name: "orders".to_owned(),
            },
        }];
        let captures = BTreeMap::from([(
            "orders".to_owned(),
            CapturedSourceInput {
                path: &capture,
                loaded_at: "2026-07-23T00:00:00Z",
            },
        )]);

        plan_candidate(
            &store,
            &integration,
            &captures,
            &InvocationV1::default(),
            &Transforms::new(),
            &Env::default(),
            "2026-07-23T00:00:00Z",
        )
        .await
        .expect("empty candidate");

        assert!(store
            .schema_of(&checkpoint_table("orders"))
            .await
            .expect("checkpoint schema")
            .is_some());
        assert_eq!(
            store
                .query("SELECT COUNT(*)::BIGINT FROM \"_checkpoint/orders\"")
                .await
                .expect("checkpoint rows")
                .single_i64(),
            0
        );
    }
}
