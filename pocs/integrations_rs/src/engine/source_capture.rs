//! Captures live source data before planning. Each capture is immutable and
//! bound to the run journal by source identity. A restarted attempt reuses the
//! capture.
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use error_stack::{Report, ResultExt as _};

use super::candidate::CapturedSourceInput;
use crate::blob::ArtifactStore;
use crate::config::Env;
use crate::definition::{Integration, SourceKind};
use crate::orchestrator::managed::{SecretRef, SecretStore as _};
use crate::orchestrator::run_artifacts::{CapturedSource, RunArtifactBindings};
use crate::orchestrator::shard_log::RunView;
use crate::orchestrator::InvocationV1;
use crate::snapshot;
use crate::storage::Storage;
use crate::store::{lit, qi, Store};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SourceCaptureError {
    UnsupportedReplay,
    MissingSource,
    Hydrate,
    Stage,
    Publish,
}

impl fmt::Display for SourceCaptureError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::UnsupportedReplay => {
                "timestamp-prefix bronze replay is not supported by protocol V1"
            }
            Self::MissingSource => "pipeline references an undeclared source",
            Self::Hydrate => "hydrate source for durable bronze capture failed",
            Self::Stage => "stage durable bronze capture failed",
            Self::Publish => "publish durable bronze capture failed",
        })
    }
}

impl std::error::Error for SourceCaptureError {}

pub(crate) struct DurableSourceCaptures {
    captures: BTreeMap<String, CapturedSource>,
    loaded_at: String,
}

impl DurableSourceCaptures {
    pub(crate) fn planner_inputs(&self) -> BTreeMap<String, CapturedSourceInput<'_>> {
        self.captures
            .iter()
            .map(|(source, capture)| {
                (
                    source.clone(),
                    CapturedSourceInput {
                        path: capture.materialized.path(),
                        loaded_at: &self.loaded_at,
                    },
                )
            })
            .collect()
    }

    pub(crate) fn artifact_references(&self) -> Vec<crate::blob::BlobRef> {
        self.captures
            .values()
            .map(|capture| capture.reference.clone())
            .collect()
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn capture_sources(
    candidate_store: &Store,
    artifact_store: &ArtifactStore,
    bindings: &RunArtifactBindings,
    storage: &Storage,
    integration: &Integration,
    invocation: &InvocationV1,
    run: &RunView,
    web_id: &str,
    actor_id: &str,
    env: &Env,
) -> Result<DurableSourceCaptures, Report<SourceCaptureError>> {
    if !invocation.replay.is_empty() {
        return Err(
            Report::new(SourceCaptureError::UnsupportedReplay).attach_printable(
                "a future replay request must carry an explicit prior run or artifact identity",
            ),
        );
    }
    let attempt_id = run
        .attempt_id
        .as_ref()
        .ok_or_else(|| Report::new(SourceCaptureError::Hydrate))?;
    let mut captures = BTreeMap::new();
    let mut seen = BTreeSet::new();
    let ordered = crate::engine::topology::sort_pipelines(&integration.pipelines)
        .map_err(|message| Report::new(SourceCaptureError::Hydrate).attach_printable(message))?;
    if !invocation.links_only {
        for pipeline in ordered {
            if !seen.insert(pipeline.source.clone()) {
                continue;
            }
            let source = integration.sources.get(&pipeline.source).ok_or_else(|| {
                Report::new(SourceCaptureError::MissingSource)
                    .attach_printable(format!("source: {}", pipeline.source))
            })?;
            if matches!(&source.kind, SourceKind::Checkpoint { .. }) {
                continue;
            }
            if let Some(captured) = bindings
                .recover_bronze_capture(
                    &run.integration_id,
                    &run.run_id,
                    attempt_id,
                    &pipeline.source,
                )
                .await
                .change_context(SourceCaptureError::Publish)?
            {
                captures.insert(pipeline.source.clone(), captured);
                continue;
            }
            let table = format!("_capture/{}", pipeline.source);
            hydrate_live_source(
                candidate_store,
                storage,
                &pipeline.source,
                &table,
                &source.kind,
                SourceAccess {
                    web_id,
                    actor_id,
                    env,
                    artifacts: artifact_store,
                },
            )
            .await?;
            let staged = artifact_store
                .stage(".parquet")
                .change_context(SourceCaptureError::Stage)?;
            candidate_store
                .exec(&format!(
                    "COPY (SELECT * FROM {}) TO {} (FORMAT PARQUET)",
                    qi(&table),
                    lit(&staged.display().to_string())
                ))
                .await
                .change_context(SourceCaptureError::Stage)?;
            let published_capture = bindings
                .publish_bronze_capture(
                    &run.integration_id,
                    &run.run_id,
                    attempt_id,
                    &pipeline.source,
                    &staged,
                )
                .await
                .change_context(SourceCaptureError::Publish)?;
            let _ = tokio::fs::remove_file(staged).await;
            let _ = candidate_store
                .exec(&format!("DROP TABLE IF EXISTS {}", qi(&table)))
                .await;
            tracing::debug!(
                source = %pipeline.source,
                disposition = ?published_capture.disposition,
                "bronze source capture is durable"
            );
            captures.insert(pipeline.source.clone(), published_capture);
        }
    }
    Ok(DurableSourceCaptures {
        captures,
        loaded_at: run.submitted_at.clone(),
    })
}

#[derive(Clone, Copy)]
struct SourceAccess<'a> {
    web_id: &'a str,
    actor_id: &'a str,
    env: &'a Env,
    artifacts: &'a ArtifactStore,
}

async fn hydrate_live_source(
    store: &Store,
    storage: &Storage,
    source: &str,
    table: &str,
    kind: &SourceKind,
    access: SourceAccess<'_>,
) -> Result<(), Report<SourceCaptureError>> {
    match kind {
        SourceKind::Sql {
            sql, primary_key, ..
        } => {
            snapshot::materialize(store, source, table, sql, primary_key)
                .await
                .change_context(SourceCaptureError::Hydrate)?;
            Ok(())
        }
        SourceKind::External { key, primary_key } => {
            let key = key.as_deref().unwrap_or_default();
            let uri = storage
                .uri_for(key)
                .change_context(SourceCaptureError::Hydrate)?;
            snapshot::materialize(
                store,
                source,
                table,
                &format!("SELECT * FROM read_parquet({})", lit(&uri)),
                primary_key,
            )
            .await
            .change_context(SourceCaptureError::Hydrate)?;
            Ok(())
        }
        SourceKind::Rest {
            endpoint,
            primary_key,
        } => {
            crate::connectors::rest_api::hydrate(
                store,
                source,
                table,
                endpoint.expose(),
                primary_key,
                None,
                access.env,
            )
            .await
            .change_context(SourceCaptureError::Hydrate)?;
            Ok(())
        }
        SourceKind::Postgres(source_config) => {
            let secret_store =
                crate::orchestrator::hash_graph_vault::HashGraphVaultSecretStore::from_env(
                    access.env,
                )
                .map_err(|message| {
                    Report::new(SourceCaptureError::Hydrate).attach_printable(message)
                })?
                .ok_or_else(|| {
                    Report::new(SourceCaptureError::Hydrate)
                        .attach_printable("HASH Graph Vault secret store is not configured")
                })?
                .for_actor(access.actor_id);
            let credentials = secret_store
                .read(
                    access.web_id,
                    &SecretRef {
                        entity_uuid: source_config.credentials.secret_entity_uuid,
                    },
                )
                .await
                .map_err(|_error| {
                    Report::new(SourceCaptureError::Hydrate).attach_printable(format!(
                        "PostgreSQL User Secret {} could not be resolved",
                        source_config.credentials.secret_entity_uuid
                    ))
                })?;
            let captured = access
                .artifacts
                .stage(".parquet")
                .change_context(SourceCaptureError::Stage)?;
            let capture_result = crate::connectors::postgres::capture(
                source_config,
                &credentials,
                &captured,
                crate::config::duckdb_limits(access.env),
            )
            .await
            .change_context(SourceCaptureError::Hydrate);
            if capture_result.is_err() {
                let _ = tokio::fs::remove_file(&captured).await;
            }
            capture_result?;
            let result = snapshot::materialize(
                store,
                source,
                table,
                &format!(
                    "SELECT * FROM read_parquet({})",
                    lit(&captured.display().to_string())
                ),
                &source_config.primary_key,
            )
            .await
            .change_context(SourceCaptureError::Hydrate);
            let _ = tokio::fs::remove_file(captured).await;
            result?;
            Ok(())
        }
        SourceKind::Checkpoint { .. } => Ok(()),
        SourceKind::Table { .. } => Err(Report::new(SourceCaptureError::Hydrate)
            .attach_printable("stream table sources are invalid in protocol V1")),
    }
}
