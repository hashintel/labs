//! One batch sync of a built integration: coherence check, then sources
//! strictly sequentially in topo order (per-source isolation), then the link
//! phase. Empty sources with prior state skip archival unless partial or
//! archiveOnEmpty (transient-empty protection). Every sql/external/rest
//! hydrate persists a bronze Parquet snapshot before asserts (newest 3 kept);
//! replay re-runs from a snapshot instead of the live source.

use std::collections::HashMap;

use error_stack::{Report, ResultExt as _};
use serde_json::{Map, Value};

use crate::config::Env;
use crate::definition::{Integration, Pipeline, SinkConfig, SourceDef, SourceKind, Step, StepKind};
use crate::dlq;
use crate::durable_artifacts::ArtifactRepository;
use crate::error::{CoherenceError, SourceError};
use crate::graph::coherence::CheckError;
use crate::graph::link_pipeline::{self, LinkContext};
use crate::graph::sink::{self, SinkContext, SyncError, SyncResult};
use crate::graph::{Provenance, SharedClient};
use crate::run_manifest::{AdmittedInputV1, RunManifestRepository};
use crate::snapshot;
use crate::steps::{self, NamedInput, Transforms};
use crate::storage::Storage;
use crate::store::{lit, qi, Store};

pub struct SyncOptions<'a> {
    pub filter: Option<&'a [String]>,
    pub defer_links: bool,
    pub run_id: &'a str,
    pub replay: &'a HashMap<String, Option<String>>,
    pub transforms: &'a Transforms,
    pub fetcher: Option<crate::connectors::rest_api::Fetcher>,
    pub env: &'a Env,
    pub run_manifest: Option<&'a RunManifestRepository>,
}

struct HydratedSource {
    row_count: i64,
    loaded_at: String,
}

pub struct CollectedSink<'a> {
    pub sink_id: String,
    pub config: &'a SinkConfig,
}

pub fn collect_sinks(pipelines: &[Pipeline]) -> Vec<CollectedSink<'_>> {
    fn walk<'a>(steps: &'a [Step], out: &mut Vec<CollectedSink<'a>>) {
        for step in steps {
            match &step.kind {
                StepKind::GraphSink { config } => out.push(CollectedSink {
                    sink_id: step.id.clone(),
                    config,
                }),
                StepKind::Branch { branches } => {
                    for branch in branches {
                        walk(branch, out);
                    }
                }
                _ => {}
            }
        }
    }

    let mut out = vec![];
    for pipeline in pipelines {
        walk(&pipeline.steps, &mut out);
    }
    out
}

fn flatten_steps(steps: &[Step]) -> Vec<&Step> {
    let mut out = vec![];
    for step in steps {
        out.push(step);
        if let StepKind::Branch { branches } = &step.kind {
            for branch in branches {
                out.extend(flatten_steps(branch));
            }
        }
    }
    out
}

pub async fn run(
    store: &Store,
    integration: &Integration,
    storage: &Storage,
    artifacts: &ArtifactRepository,
    client: &SharedClient,
    options: &SyncOptions<'_>,
) -> Result<SyncResult, CheckError> {
    let loaded_at = now_iso();

    let ordered = crate::engine::topology::sort_pipelines(&integration.pipelines)
        .map_err(|message| Report::new(CoherenceError).attach_printable(message))?;
    let targets: Vec<&Pipeline> = match options.filter {
        Some(filter) => ordered
            .into_iter()
            .filter(|pipeline| filter.contains(&pipeline.source))
            .collect(),
        None => ordered,
    };

    crate::graph::coherence::check(store, client, integration, options.env).await?;

    let mut result = SyncResult::default();
    for pipeline in targets {
        result = result.merge(
            sync_one_source(
                store,
                integration,
                storage,
                artifacts,
                client,
                pipeline,
                &loaded_at,
                options,
            )
            .await,
        );
    }

    if !options.defer_links {
        result = result
            .merge(flush_links(store, integration, artifacts, client, &loaded_at, options).await);
    }

    Ok(result)
}

pub async fn flush_links(
    store: &Store,
    integration: &Integration,
    artifacts: &ArtifactRepository,
    client: &SharedClient,
    loaded_at: &str,
    options: &SyncOptions<'_>,
) -> SyncResult {
    let mut result = SyncResult::default();

    for entry in &integration.link_pipelines {
        let provenance = compose_provenance(
            integration,
            entry.provenance.as_ref(),
            &format!("links:{}", entry.id),
            loaded_at,
        );

        let ctx = LinkContext {
            connector_id: &integration.connector_id,
            artifacts,
            provenance: &provenance,
            unit_maps: &integration.unit_maps,
            run_id: options.run_id,
            env: options.env,
            run_manifest: options.run_manifest,
        };

        let staged = match link_pipeline::process(store, entry, &ctx).await {
            Ok(staged) => staged,
            Err(err) => {
                tracing::error!("link pipeline \"{}\" failed: {err:?}", entry.id);
                SyncResult {
                    errors: vec![SyncError {
                        kind: "link-pipeline".to_owned(),
                        entity_id: entry.id.clone(),
                        message: format!("{err:?}"),
                    }],
                    ..SyncResult::default()
                }
            }
        };

        let flushed =
            match link_pipeline::flush(store, &integration.connector_id, client, Some(&entry.id))
                .await
            {
                Ok(flushed) => flushed,
                Err(err) => SyncResult {
                    errors: vec![SyncError {
                        kind: "link-flush".to_owned(),
                        entity_id: entry.id.clone(),
                        message: format!("{err:?}"),
                    }],
                    ..SyncResult::default()
                },
            };

        result = result.merge(staged).merge(flushed);
    }

    result
}

#[allow(clippy::too_many_arguments)]
async fn sync_one_source(
    store: &Store,
    integration: &Integration,
    storage: &Storage,
    artifacts: &ArtifactRepository,
    client: &SharedClient,
    pipeline: &Pipeline,
    loaded_at: &str,
    options: &SyncOptions<'_>,
) -> SyncResult {
    let source_table = format!("{}/{}", integration.connector_id, pipeline.source);
    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&source_table)))
        .await;

    let outcome = sync_source_inner(
        store,
        integration,
        storage,
        artifacts,
        client,
        pipeline,
        &source_table,
        loaded_at,
        options,
    )
    .await;

    // Cleanup regardless of outcome (the Elixir `after` block).
    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&source_table)))
        .await;
    for step in flatten_steps(&pipeline.steps) {
        let _ = store
            .exec(&format!(
                "DROP TABLE IF EXISTS {}",
                qi(&format!("_step/{}", step.id))
            ))
            .await;
    }
    for (alias, _) in &pipeline.inputs {
        let _ = store
            .exec(&format!(
                "DROP TABLE IF EXISTS {}",
                qi(&format!("_ent_src/{}/{alias}", pipeline.source))
            ))
            .await;
    }

    match outcome {
        Ok(result) => {
            if let Err(err) =
                log_quarantine_summary(store, &integration.connector_id, &pipeline.source).await
            {
                tracing::warn!("quarantine summary failed: {err:?}");
            }
            result
        }
        Err(err) => {
            tracing::error!(
                "source \"{}\" failed: {err:?} - continuing with remaining sources",
                pipeline.source
            );
            SyncResult {
                errors: vec![SyncError {
                    kind: "table".to_owned(),
                    entity_id: pipeline.source.clone(),
                    message: format!("{err:?}"),
                }],
                ..SyncResult::default()
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn sync_source_inner(
    store: &Store,
    integration: &Integration,
    storage: &Storage,
    artifacts: &ArtifactRepository,
    client: &SharedClient,
    pipeline: &Pipeline,
    source_table: &str,
    loaded_at: &str,
    options: &SyncOptions<'_>,
) -> Result<SyncResult, Report<SourceError>> {
    let source_def = integration.sources.get(&pipeline.source).ok_or_else(|| {
        Report::new(SourceError)
            .attach_printable(format!("source {} not declared", pipeline.source))
    })?;

    let hydrated = hydrate(
        store,
        storage,
        artifacts,
        &pipeline.source,
        source_table,
        source_def,
        loaded_at,
        options,
    )
    .await?;

    if let Some(asserts) = &source_def.asserts {
        crate::engine::asserts::run(
            store,
            source_table,
            &pipeline.source,
            asserts,
            hydrated.row_count,
        )
        .await?;
    }

    if hydrated.row_count == 0 {
        handle_empty_source(
            store,
            integration,
            client,
            pipeline,
            source_def,
            &hydrated.loaded_at,
            options,
        )
        .await
    } else {
        run_source_pipeline(
            store,
            integration,
            artifacts,
            client,
            pipeline,
            source_def,
            source_table,
            &hydrated.loaded_at,
            options,
        )
        .await
    }
}

#[allow(clippy::too_many_arguments)]
async fn hydrate(
    store: &Store,
    storage: &Storage,
    artifacts: &ArtifactRepository,
    source: &str,
    source_table: &str,
    source_def: &SourceDef,
    loaded_at: &str,
    options: &SyncOptions<'_>,
) -> Result<HydratedSource, Report<SourceError>> {
    if let Some(manifest) = options.run_manifest {
        if let Some(admitted) = manifest
            .admitted_input(source)
            .await
            .change_context(SourceError)?
        {
            let path = artifacts.materialize(&admitted.object).await?;
            load_parquet(store, source_table, &path).await?;
            tracing::info!(
                source,
                loaded_at = admitted.loaded_at,
                "replaying exact run input"
            );
            return Ok(HydratedSource {
                row_count: admitted.row_count,
                loaded_at: admitted.loaded_at,
            });
        }
    }

    let replay = options.replay.get(source);

    let hydrated = match (&source_def.kind, replay) {
        (
            SourceKind::Sql { .. }
            | SourceKind::External { .. }
            | SourceKind::Rest { .. }
            | SourceKind::Postgres(_),
            Some(prefix),
        ) => {
            let (hydrated, object) =
                replay_bronze(store, artifacts, source, source_table, prefix.as_deref()).await?;
            admit_input(options, source, &hydrated, object).await?;
            Ok(hydrated)
        }

        (
            SourceKind::Sql {
                sql, primary_key, ..
            },
            None,
        ) => {
            let materialized =
                snapshot::materialize(store, source, source_table, sql, primary_key).await?;
            let object = write_bronze(store, artifacts, source, source_table, loaded_at).await?;
            let hydrated = HydratedSource {
                row_count: materialized.row_count,
                loaded_at: loaded_at.to_owned(),
            };
            admit_input(options, source, &hydrated, object).await?;
            Ok(hydrated)
        }

        (SourceKind::Checkpoint { name }, _) => {
            let Some(path) = load_run_checkpoint(artifacts, options.run_manifest, name).await?
            else {
                return Err(Report::new(SourceError)
                    .attach_printable(format!("durable checkpoint {name} not found")));
            };
            let uri = path.display().to_string();
            store
                .exec(&format!(
                    "CREATE OR REPLACE TABLE {} AS SELECT * FROM read_parquet({})",
                    qi(source_table),
                    lit(&uri)
                ))
                .await
                .change_context(SourceError)?;

            let row_count = store
                .query(&format!(
                    "SELECT COUNT(*)::BIGINT FROM {}",
                    qi(source_table)
                ))
                .await
                .change_context(SourceError)?
                .single_i64();
            let object = write_bronze(store, artifacts, source, source_table, loaded_at).await?;
            let hydrated = HydratedSource {
                row_count,
                loaded_at: loaded_at.to_owned(),
            };
            admit_input(options, source, &hydrated, object).await?;
            Ok(hydrated)
        }

        (SourceKind::External { key, primary_key }, None) => {
            let key = key.clone().unwrap_or_default();
            let uri = storage.uri_for(&key).change_context(SourceError)?;
            let materialized = snapshot::materialize(
                store,
                source,
                source_table,
                &format!("SELECT * FROM read_parquet({})", lit(&uri)),
                primary_key,
            )
            .await?;
            let object = write_bronze(store, artifacts, source, source_table, loaded_at).await?;
            let hydrated = HydratedSource {
                row_count: materialized.row_count,
                loaded_at: loaded_at.to_owned(),
            };
            admit_input(options, source, &hydrated, object).await?;
            Ok(hydrated)
        }

        (
            SourceKind::Rest {
                endpoint,
                primary_key,
            },
            None,
        ) => {
            let row_count = crate::connectors::rest_api::hydrate(
                store,
                source,
                source_table,
                endpoint.expose(),
                primary_key,
                options.fetcher.clone(),
                options.env,
            )
            .await?;
            let object = write_bronze(store, artifacts, source, source_table, loaded_at).await?;
            let hydrated = HydratedSource {
                row_count,
                loaded_at: loaded_at.to_owned(),
            };
            admit_input(options, source, &hydrated, object).await?;
            Ok(hydrated)
        }

        (SourceKind::Postgres(_), None) => Err(Report::new(SourceError)
            .attach_printable("PostgreSQL sources require durable source capture")),

        (SourceKind::Table { .. }, _) => Err(Report::new(SourceError).attach_printable(format!(
            "source {source} is a stream table; batch cannot hydrate it"
        ))),
    }?;
    Ok(hydrated)
}

async fn write_bronze(
    store: &Store,
    artifacts: &ArtifactRepository,
    source: &str,
    source_table: &str,
    loaded_at: &str,
) -> Result<crate::blob::BlobRef, Report<SourceError>> {
    artifacts
        .write_bronze(store, source, source_table, loaded_at)
        .await
}

async fn replay_bronze(
    store: &Store,
    artifacts: &ArtifactRepository,
    source: &str,
    source_table: &str,
    prefix: Option<&str>,
) -> Result<(HydratedSource, crate::blob::BlobRef), Report<SourceError>> {
    let Some((loaded_at, object, path)) = artifacts.resolve_bronze(source, prefix).await? else {
        return Err(Report::new(SourceError).attach_printable(format!(
            "no durable bronze snapshot for source \"{source}\" matching {prefix:?}"
        )));
    };
    let uri = path.display().to_string();
    tracing::info!("replaying source \"{source}\" from bronze {loaded_at}");

    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {} AS SELECT * FROM read_parquet({})",
            qi(source_table),
            lit(&uri)
        ))
        .await
        .change_context(SourceError)?;

    let row_count = store
        .query(&format!(
            "SELECT COUNT(*)::BIGINT FROM {}",
            qi(source_table)
        ))
        .await
        .change_context(SourceError)?
        .single_i64();
    Ok((
        HydratedSource {
            row_count,
            loaded_at,
        },
        object,
    ))
}

async fn admit_input(
    options: &SyncOptions<'_>,
    source: &str,
    hydrated: &HydratedSource,
    object: crate::blob::BlobRef,
) -> Result<(), Report<SourceError>> {
    if let Some(manifest) = options.run_manifest {
        manifest
            .admit_input(
                source,
                AdmittedInputV1 {
                    loaded_at: hydrated.loaded_at.clone(),
                    row_count: hydrated.row_count,
                    object,
                },
            )
            .await
            .change_context(SourceError)?;
    }
    Ok(())
}

async fn load_parquet(
    store: &Store,
    table: &str,
    path: &std::path::Path,
) -> Result<(), Report<SourceError>> {
    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {} AS SELECT * FROM read_parquet({})",
            qi(table),
            lit(&path.display().to_string())
        ))
        .await
        .change_context(SourceError)
}

async fn log_quarantine_summary(
    store: &Store,
    connector_id: &str,
    source: &str,
) -> Result<(), Report<crate::error::StoreError>> {
    for row in dlq::summary(store, connector_id, Some(source)).await? {
        if row.count > 0 {
            tracing::warn!(
                "quarantine {}/{}: {} {} ({})",
                row.kind,
                row.sink_id,
                row.property_url,
                row.count,
                row.coercion
            );
        }
    }
    Ok(())
}

async fn handle_empty_source(
    store: &Store,
    integration: &Integration,
    client: &SharedClient,
    pipeline: &Pipeline,
    source_def: &SourceDef,
    loaded_at: &str,
    options: &SyncOptions<'_>,
) -> Result<SyncResult, Report<SourceError>> {
    let mut result = SyncResult::default();

    for step in flatten_steps(&pipeline.steps) {
        let StepKind::GraphSink { config } = &step.kind else {
            continue;
        };

        let state_exists = store
            .schema_of(&format!(
                "_state/sync/{}/{}",
                integration.connector_id, step.id
            ))
            .await
            .change_context(SourceError)?
            .is_some();

        if !source_def.partial && !source_def.archive_on_empty && state_exists {
            tracing::warn!(
                "\"{}\": zero rows but prior state exists for sink \"{}\"; skipping archival. Set archiveOnEmpty: true on the source config to opt into drain-on-empty.",
                pipeline.source,
                step.id
            );
            continue;
        }

        let provenance = compose_provenance(
            integration,
            source_def.provenance.as_ref(),
            &pipeline.source,
            loaded_at,
        );
        let ctx = SinkContext {
            connector_id: &integration.connector_id,
            client,
            provenance: &provenance,
            unit_maps: &integration.unit_maps,
            run_id: options.run_id,
            source: Some(&pipeline.source),
            partial: source_def.partial,
            env: options.env,
        };

        result = result.merge(sink::diff_and_sync(store, &step.id, config, None, &ctx).await?);
    }

    Ok(result)
}

#[allow(clippy::too_many_arguments)]
async fn run_source_pipeline(
    store: &Store,
    integration: &Integration,
    artifacts: &ArtifactRepository,
    client: &SharedClient,
    pipeline: &Pipeline,
    source_def: &SourceDef,
    source_table: &str,
    loaded_at: &str,
    options: &SyncOptions<'_>,
) -> Result<SyncResult, Report<SourceError>> {
    let mut named_inputs = vec![];
    for (alias, checkpoint) in &pipeline.inputs {
        let table = format!("_ent_src/{}/{alias}", pipeline.source);
        let Some(path) = load_run_checkpoint(artifacts, options.run_manifest, checkpoint).await?
        else {
            return Err(Report::new(SourceError)
                .attach_printable(format!("durable checkpoint {checkpoint} not found")));
        };
        let uri = path.display().to_string();
        store
            .exec(&format!(
                "CREATE OR REPLACE TABLE {} AS SELECT * FROM read_parquet({})",
                qi(&table),
                lit(&uri)
            ))
            .await
            .change_context(SourceError)?;
        named_inputs.push(NamedInput {
            alias: alias.clone(),
            table,
        });
    }

    let mut on_side_effect = |step: &Step, current_table: &str| {
        let store = store.clone();
        let client = client.clone();
        let artifacts = artifacts.clone();
        let current_table = current_table.to_owned();
        let step = step.clone();
        let provenance = compose_provenance(
            integration,
            source_def.provenance.as_ref(),
            &pipeline.source,
            loaded_at,
        );
        let connector_id = integration.connector_id.clone();
        let unit_maps = integration.unit_maps.clone();
        let run_id = options.run_id.to_owned();
        let source = pipeline.source.clone();
        let partial = source_def.partial;
        let env = options.env.clone();
        let run_manifest = options.run_manifest.cloned();

        Box::pin(async move {
            match &step.kind {
                StepKind::GraphSink { config } => {
                    let ctx = SinkContext {
                        connector_id: &connector_id,
                        client: &client,
                        provenance: &provenance,
                        unit_maps: &unit_maps,
                        run_id: &run_id,
                        source: Some(&source),
                        partial,
                        env: &env,
                    };
                    sink::diff_and_sync(&store, &step.id, config, Some(&current_table), &ctx).await
                }
                StepKind::Checkpoint { name } => {
                    let object = artifacts
                        .write_checkpoint(&store, name, &current_table)
                        .await?;
                    if let Some(manifest) = &run_manifest {
                        manifest
                            .record_checkpoint(name, object)
                            .await
                            .change_context(SourceError)?;
                    }
                    Ok(SyncResult::default())
                }
                _ => Ok(SyncResult::default()),
            }
        })
            as std::pin::Pin<
                Box<
                    dyn std::future::Future<Output = Result<SyncResult, Report<SourceError>>>
                        + Send,
                >,
            >
    };

    let outcome = steps::run_pipeline(
        store,
        source_table,
        &pipeline.steps,
        &named_inputs,
        options.transforms,
        &mut on_side_effect,
    )
    .await?;

    Ok(outcome
        .effects
        .into_iter()
        .fold(SyncResult::default(), SyncResult::merge))
}

/// Materialize a checkpoint through the run manifest. The integration-level
/// checkpoint head is only consulted on first observation; retries use the
/// immutable object recorded for this canonical run.
pub(crate) async fn load_run_checkpoint(
    artifacts: &ArtifactRepository,
    manifest: Option<&RunManifestRepository>,
    name: &str,
) -> Result<Option<std::path::PathBuf>, Report<SourceError>> {
    if let Some(manifest) = manifest {
        if let Some(object) = manifest
            .checkpoint(name)
            .await
            .change_context(SourceError)?
        {
            return artifacts.materialize(&object).await.map(Some);
        }
    }

    let Some((object, path)) = artifacts.resolve_checkpoint(name).await? else {
        return Ok(None);
    };
    if let Some(manifest) = manifest {
        manifest
            .pin_checkpoint(name, object)
            .await
            .change_context(SourceError)?;
    }
    Ok(Some(path))
}

/// Field-level precedence: source-level over connector-level, defaults last.
pub fn compose_provenance(
    integration: &Integration,
    source_level: Option<&Value>,
    source: &str,
    loaded_at: &str,
) -> Provenance {
    let connector_level = integration.connector_provenance.as_ref();
    let empty = Map::new();
    let source_map = source_level.and_then(Value::as_object).unwrap_or(&empty);
    let connector_map = connector_level.and_then(Value::as_object).unwrap_or(&empty);

    let pick = |key: &str| {
        source_map
            .get(key)
            .or_else(|| connector_map.get(key))
            .cloned()
    };

    let location_name = source_map
        .get("location")
        .and_then(|location| location.get("name"))
        .and_then(Value::as_str)
        .or_else(|| {
            connector_map
                .get("location")
                .and_then(|location| location.get("name"))
                .and_then(Value::as_str)
        })
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{}/{source}", integration.connector_id));

    Provenance {
        loaded_at: loaded_at.to_owned(),
        location_name,
        authors: pick("authors").and_then(|authors| {
            authors.as_array().map(|authors| {
                authors
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
        }),
        first_published: pick("firstPublished").and_then(|value| value.as_str().map(str::to_owned)),
        last_updated: pick("lastUpdated").and_then(|value| value.as_str().map(str::to_owned)),
    }
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::blob::{ArtifactStore, BlobNamespace};
    use crate::run_manifest::RunManifestRepository;
    use crate::store::StoreOptions;

    #[tokio::test]
    async fn retry_uses_admitted_bronze_instead_of_changed_live_source() {
        let remote = tempfile::tempdir().unwrap();
        let local = tempfile::tempdir().unwrap();
        let blobs = ArtifactStore::local(remote.path(), local.path().join("cache")).unwrap();
        let namespace = BlobNamespace::new("alice", "sap").unwrap();
        let artifacts = ArtifactRepository::new(blobs.clone(), namespace.clone());
        let manifest = RunManifestRepository::new(blobs, namespace, "run-1", "definition-1");
        manifest.open_or_create().await.unwrap();
        let store = Store::open(StoreOptions {
            path: Some(local.path().join("store.duckdb")),
            allowed_directories: Some(vec![
                artifacts.staging_root().to_owned(),
                artifacts.materialized_root(),
                local.path().to_owned(),
            ]),
            ..StoreOptions::default()
        })
        .unwrap();
        let storage = Storage::local(local.path());
        storage.prepare().unwrap();
        let replay = HashMap::new();
        let transforms = Transforms::new();
        let env = Env::default();
        let options = SyncOptions {
            filter: None,
            defer_links: true,
            run_id: "run-1",
            replay: &replay,
            transforms: &transforms,
            fetcher: None,
            env: &env,
            run_manifest: Some(&manifest),
        };
        let original = SourceDef {
            kind: SourceKind::Sql {
                sql: "SELECT 1 AS id, 'original' AS value".to_owned(),
                primary_key: vec!["id".to_owned()],
                extensions: vec![],
            },
            partial: false,
            archive_on_empty: false,
            provenance: None,
            asserts: None,
        };
        let first = hydrate(
            &store,
            &storage,
            &artifacts,
            "materials",
            "source",
            &original,
            "2026-07-15T10:00:00Z",
            &options,
        )
        .await
        .unwrap();
        assert_eq!(first.loaded_at, "2026-07-15T10:00:00Z");

        let changed = SourceDef {
            kind: SourceKind::Sql {
                sql: "SELECT 1 AS id, 'changed-after-crash' AS value".to_owned(),
                primary_key: vec!["id".to_owned()],
                extensions: vec![],
            },
            ..original
        };
        let recovered = hydrate(
            &store,
            &storage,
            &artifacts,
            "materials",
            "source",
            &changed,
            "2026-07-15T11:00:00Z",
            &options,
        )
        .await
        .unwrap();
        assert_eq!(recovered.loaded_at, "2026-07-15T10:00:00Z");
        let value = store.query("SELECT value FROM source").await.unwrap().rows[0][0]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(value, "original");
    }

    #[tokio::test]
    async fn retry_reads_the_run_pinned_checkpoint_not_the_moved_head() {
        let remote = tempfile::tempdir().unwrap();
        let local = tempfile::tempdir().unwrap();
        let blobs = ArtifactStore::local(remote.path(), local.path().join("cache")).unwrap();
        let namespace = BlobNamespace::new("alice", "sap").unwrap();
        let artifacts = ArtifactRepository::new(blobs.clone(), namespace.clone());
        let manifest = RunManifestRepository::new(blobs, namespace, "run-1", "definition-1");
        manifest.open_or_create().await.unwrap();
        let store = Store::open(StoreOptions {
            path: Some(local.path().join("store.duckdb")),
            allowed_directories: Some(vec![
                artifacts.staging_root().to_owned(),
                artifacts.materialized_root(),
                local.path().to_owned(),
            ]),
            ..StoreOptions::default()
        })
        .unwrap();

        store
            .exec("CREATE TABLE checkpoint_source(value VARCHAR); INSERT INTO checkpoint_source VALUES ('first')")
            .await
            .unwrap();
        artifacts
            .write_checkpoint(&store, "shared", "checkpoint_source")
            .await
            .unwrap();
        let first = load_run_checkpoint(&artifacts, Some(&manifest), "shared")
            .await
            .unwrap()
            .unwrap();

        store
            .exec("DELETE FROM checkpoint_source; INSERT INTO checkpoint_source VALUES ('second')")
            .await
            .unwrap();
        artifacts
            .write_checkpoint(&store, "shared", "checkpoint_source")
            .await
            .unwrap();
        let replay = load_run_checkpoint(&artifacts, Some(&manifest), "shared")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(first, replay);
        let value = store
            .query(&format!(
                "SELECT value FROM read_parquet({})",
                lit(&replay.display().to_string())
            ))
            .await
            .unwrap();
        assert_eq!(value.rows[0][0], Value::String("first".to_owned()));
    }
}
