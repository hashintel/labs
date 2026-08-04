//! Accepted-run to immutable Apply-candidate composition.
//!
//! Slow source, DuckDB, and object-store work stays outside the shard command
//! loop. The loop is used only for the next `AttemptStarted` and the
//! source-qualified artifact bindings that make replay exact.
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

use error_stack::{Report, ResultExt as _};

use super::events::{AttemptStartedV1, JournalEvent, JournalEventV1, JournalRecordV1};
use super::ids::{derive_attempt_id, TenantNamespace};
use super::run_artifacts::RunArtifactBindings;
use super::run_input::{load_run_input, DEFINITION_DIGEST_ENCODING_VERSION, PLANNER_VERSION};
use super::shard_log::{RunView, ShardCommandHandle};
use super::state::StateAuthority;
use crate::blob::{ArtifactStore, BlobNamespace, StateSnapshot, StateSnapshotV1};
use crate::config::{self, Env};
use crate::engine::candidate::plan_candidate;
use crate::engine::source_capture::capture_sources;
use crate::graph::apply::ApplyCandidateV1;
use crate::graph::artifacts::DESIRED_PROJECTION_SCHEMA_VERSION;
use crate::graph::planner::EffectSelectionV1;
use crate::local_disk::WorkspaceBudget;
use crate::orchestrator::routing;
use crate::steps::Transforms;
use crate::storage::Storage;
use crate::store::{Store, StoreOptions};

const STATE_SCHEMA_VERSION: u32 = 1;
const DUCKDB_MEDIA_TYPE: &str = "application/vnd.duckdb";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunPlanningError {
    StaleRun,
    StartAttempt,
    Input,
    State,
    Disk,
    Workspace,
    Sources,
    Candidate,
    Snapshot,
    Cleanup,
}

impl fmt::Display for RunPlanningError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::StaleRun => "accepted run is no longer eligible for planning",
            Self::StartAttempt => "durably start planning attempt failed",
            Self::Input => "load immutable run input failed",
            Self::State => "restore journal-selected state failed",
            Self::Disk => "admit candidate workspace failed",
            Self::Workspace => "open candidate DuckDB workspace failed",
            Self::Sources => "capture durable source inputs failed",
            Self::Candidate => "build side-effect-free Apply candidate failed",
            Self::Snapshot => "publish candidate DuckDB snapshot failed",
            Self::Cleanup => "reclaim completed candidate workspace failed",
        })
    }
}

impl std::error::Error for RunPlanningError {}

pub(crate) struct RunPlanner {
    env: Env,
    tenant: TenantNamespace,
    artifacts: ArtifactStore,
    state: Arc<dyn StateAuthority>,
    commands: ShardCommandHandle,
    workspaces: Arc<WorkspaceBudget>,
    storage: Storage,
    transforms: Transforms,
}

#[derive(Debug, Clone)]
pub(crate) struct PlanningAttempt {
    pub(crate) run: RunView,
    pub(crate) attempt_id: super::ids::AttemptId,
    pub(crate) attempt: u64,
}

impl RunPlanner {
    pub(crate) fn new(
        env: Env,
        tenant: TenantNamespace,
        artifacts: ArtifactStore,
        state: Arc<dyn StateAuthority>,
        commands: ShardCommandHandle,
    ) -> Result<Self, Report<RunPlanningError>> {
        let workspace_root = PathBuf::from(config::runner_base_dir(&env)).join("workspaces");
        let workspaces = WorkspaceBudget::new(
            &workspace_root,
            config::local_disk_limits(&env)
                .map_err(|message| Report::new(RunPlanningError::Disk).attach_printable(message))?,
        )
        .change_context(RunPlanningError::Disk)?;
        let configured_source_root = PathBuf::from(env.get("SOURCE_FOLDER").unwrap_or("."));
        let source_root = if configured_source_root.is_absolute() {
            configured_source_root
        } else {
            std::env::current_dir()
                .change_context(RunPlanningError::Workspace)?
                .join(configured_source_root)
        };
        let storage = Storage::local(source_root);
        storage
            .prepare()
            .change_context(RunPlanningError::Workspace)?;
        Ok(Self {
            env,
            tenant,
            artifacts,
            state,
            commands,
            workspaces,
            storage,
            transforms: Transforms::new(),
        })
    }

    /// One-shot convenience for tests. Production dispatch always splits
    /// `start_attempt` from `build_candidate` so a candidate failure can be
    /// recorded against the exact durable attempt.
    #[cfg(test)]
    pub(crate) async fn plan(
        &self,
        observed: RunView,
    ) -> Result<ApplyCandidateV1, Report<RunPlanningError>> {
        let attempt = self.start_attempt(observed).await?;
        self.build_candidate(attempt).await
    }

    pub(crate) async fn start_attempt(
        &self,
        observed: RunView,
    ) -> Result<PlanningAttempt, Report<RunPlanningError>> {
        if observed.active_work_id.is_some() {
            return Err(Report::new(RunPlanningError::StaleRun)
                .attach_printable("run already owns durable foreground work"));
        }
        let attempt = observed
            .attempt
            .checked_add(1)
            .ok_or_else(|| Report::new(RunPlanningError::StartAttempt))?;
        let attempt_id = derive_attempt_id(&observed.run_id, attempt);
        let start = JournalRecordV1::new(
            observed.integration_id.clone(),
            JournalEvent::V1(JournalEventV1::AttemptStarted(AttemptStartedV1 {
                run_id: observed.run_id.clone(),
                attempt_id: attempt_id.clone(),
                attempt,
            })),
        )
        .change_context(RunPlanningError::StartAttempt)?;
        self.commands
            .propose(start)
            .await
            .change_context(RunPlanningError::StartAttempt)?;
        let run = self
            .commands
            .inspect_run(observed.run_id.clone())
            .await
            .change_context(RunPlanningError::StartAttempt)?
            .ok_or_else(|| Report::new(RunPlanningError::StaleRun))?;
        if run.attempt != attempt || run.attempt_id.as_ref() != Some(&attempt_id) {
            return Err(Report::new(RunPlanningError::StaleRun));
        }
        Ok(PlanningAttempt {
            run,
            attempt_id,
            attempt,
        })
    }

    pub(crate) async fn build_candidate(
        &self,
        planning: PlanningAttempt,
    ) -> Result<ApplyCandidateV1, Report<RunPlanningError>> {
        let PlanningAttempt {
            run,
            attempt_id,
            attempt,
        } = planning;
        let loaded = load_run_input(
            &self.artifacts,
            &self.tenant,
            &run.integration_id,
            &run.immutable_input,
            &self.env,
        )
        .await
        .change_context(RunPlanningError::Input)?;
        if loaded.definition_digest != run.immutable_input.definition_digest
            || run.immutable_input.definition_digest_encoding_version
                != DEFINITION_DIGEST_ENCODING_VERSION
            || run.immutable_input.planner_version != PLANNER_VERSION
        {
            return Err(Report::new(RunPlanningError::Input));
        }

        let cursor = self
            .state
            .current(&run.integration_id)
            .await
            .change_context(RunPlanningError::State)?
            .ok_or_else(|| Report::new(RunPlanningError::State))?;
        let (parent_snapshot, restore_bytes, generation) = match &cursor.state {
            Some(reference) => {
                let state = self
                    .state
                    .load(&run.integration_id, reference)
                    .await
                    .change_context(RunPlanningError::State)?;
                let snapshot = state
                    .try_current()
                    .change_context(RunPlanningError::State)?
                    .snapshot
                    .current()
                    .clone();
                let generation = snapshot
                    .generation
                    .checked_add(1)
                    .ok_or_else(|| Report::new(RunPlanningError::State))?;
                (
                    Some(snapshot.clone()),
                    snapshot.duckdb.current().size,
                    generation,
                )
            }
            None => (None, 0, 1),
        };
        let workspace = self.workspace_path(&run, attempt);
        let mut guard = self
            .workspaces
            .acquire(&workspace, restore_bytes)
            .await
            .change_context(RunPlanningError::Disk)?;
        let database = workspace.join("candidate.duckdb");
        let _restored_guard = if let Some(snapshot) = &parent_snapshot {
            let materialized = self
                .artifacts
                .materialize_guarded(&snapshot.duckdb)
                .await
                .change_context(RunPlanningError::State)?;
            tokio::fs::copy(materialized.path(), &database)
                .await
                .change_context(RunPlanningError::Workspace)?;
            // The copy preserves the cache blob's read-only seal; the
            // candidate is this attempt's mutable working database.
            let mut permissions = tokio::fs::metadata(&database)
                .await
                .change_context(RunPlanningError::Workspace)?
                .permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            tokio::fs::set_permissions(&database, permissions)
                .await
                .change_context(RunPlanningError::Workspace)?;
            Some(materialized)
        } else {
            None
        };
        guard
            .materialized()
            .change_context(RunPlanningError::Disk)?;
        let limits = config::duckdb_limits(&self.env);
        let aggregate_workspace_root =
            PathBuf::from(config::runner_base_dir(&self.env)).join("workspaces");
        let candidate_store = Store::open(StoreOptions {
            path: Some(database),
            allowed_directories: Some(vec![
                // DuckDB's external-access allowlist is process-global once
                // locked. Pin the stable disposable root, not one attempt
                // directory, so a recovered attempt can open its sibling.
                aggregate_workspace_root.clone(),
                self.storage.root().to_owned(),
                self.artifacts.materialized_root(),
                self.artifacts.staging_root().to_owned(),
            ]),
            extensions: loaded
                .integration
                .sources
                .values()
                .filter_map(|source| match &source.kind {
                    crate::build::SourceKind::Sql { extensions, .. } => Some(extensions.clone()),
                    _ => None,
                })
                .flatten()
                .collect(),
            memory_limit: limits.memory_limit,
            max_temp_directory_size: limits.max_temp_directory_size,
            max_database_size: Some(config::duckdb_max_database_size(&self.env)),
            aggregate_workspace_root: Some(aggregate_workspace_root),
            max_aggregate_workspace_size: Some(
                config::local_disk_limits(&self.env)
                    .map_err(|message| {
                        Report::new(RunPlanningError::Disk).attach_printable(message)
                    })?
                    .max_workspace_bytes
                    .to_string(),
            ),
            min_free_space: Some(
                config::local_disk_limits(&self.env)
                    .map_err(|message| {
                        Report::new(RunPlanningError::Disk).attach_printable(message)
                    })?
                    .min_free_bytes
                    .to_string(),
            ),
            threads: Some(limits.threads),
        })
        .change_context(RunPlanningError::Workspace)?;
        let bindings = RunArtifactBindings::new(
            self.tenant.clone(),
            self.artifacts.clone(),
            self.commands.clone(),
        );
        let captures = capture_sources(
            &candidate_store,
            &self.artifacts,
            &bindings,
            &self.storage,
            &loaded.integration,
            &loaded.invocation,
            &run,
            &self.env,
        )
        .await
        .change_context(RunPlanningError::Sources)?;
        let inputs = captures.planner_inputs();
        let planned = plan_candidate(
            &candidate_store,
            &loaded.integration,
            &inputs,
            &loaded.invocation,
            &self.transforms,
            &self.env,
            &run.submitted_at,
        )
        .await
        .change_context(RunPlanningError::Candidate)?;
        drop(inputs);
        let staged_snapshot = self
            .artifacts
            .stage(".duckdb")
            .change_context(RunPlanningError::Snapshot)?;
        candidate_store
            .snapshot(staged_snapshot.clone())
            .await
            .change_context(RunPlanningError::Snapshot)?;
        let prefix = BlobNamespace::v1(
            &self.tenant,
            &routing::integration_path(&run.integration_id),
        )
        .key("artifacts/state")
        .change_context(RunPlanningError::Snapshot)?;
        let duckdb = self
            .artifacts
            .publish(&staged_snapshot, &prefix, DUCKDB_MEDIA_TYPE)
            .await
            .change_context(RunPlanningError::Snapshot)?;
        let _ = tokio::fs::remove_file(staged_snapshot).await;
        candidate_store
            .close()
            .await
            .change_context(RunPlanningError::Workspace)?;
        let snapshot = StateSnapshot::V1(StateSnapshotV1 {
            generation,
            duckdb,
            accepted_batches: captures.artifact_references(),
            created_at: chrono::Utc::now().to_rfc3339(),
        });
        drop(captures);
        drop(_restored_guard);
        guard.discard().change_context(RunPlanningError::Cleanup)?;
        Ok(ApplyCandidateV1 {
            integration_id: run.integration_id,
            owner_actor_id: loaded.owner_actor_id,
            run_id: run.run_id,
            attempt_id,
            attempt,
            phase: planned.phase,
            snapshot,
            definition_digest: loaded.definition_digest,
            definition_digest_encoding_version: DEFINITION_DIGEST_ENCODING_VERSION,
            planner_version: PLANNER_VERSION,
            state_schema_version: STATE_SCHEMA_VERSION,
            desired_projection_schema_version: DESIRED_PROJECTION_SCHEMA_VERSION,
            graph: planned.graph,
            selection: EffectSelectionV1::ChangesOnly,
            coverage: planned.coverage,
            created_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    fn workspace_path(&self, run: &RunView, attempt: u64) -> PathBuf {
        PathBuf::from(config::runner_base_dir(&self.env))
            .join("workspaces")
            .join(routing::integration_path(&run.integration_id).to_hex())
            .join(run.run_id.as_str())
            .join(format!("attempt-{attempt:020}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob::{BlobRef, BlobRefV1};
    use crate::orchestrator::events::{InputRef, PolicyRef, RunAcceptedV1};
    use crate::orchestrator::internal_metadata::{RunInputRecord, MAX_RUN_INPUT_RECORD_BYTES};
    use crate::orchestrator::metadata;
    use crate::orchestrator::shard_log::{start_recovered, ShardCommandConfig, ShardLogLocation};
    use crate::orchestrator::state::JournalStateAuthority;
    use crate::store::StoreOptions;
    use std::collections::{BTreeMap, HashMap};

    fn policy() -> PolicyRef {
        PolicyRef {
            artifact: BlobRef::V1(BlobRefV1 {
                key: "tenants/alice/artifacts/run-policies/sha256/cc/policy.json".to_owned(),
                sha256: "c".repeat(64),
                size: 1,
                media_type: "application/json".to_owned(),
                e_tag: None,
                provider_version: None,
            }),
            policy_digest: "d".repeat(64),
        }
    }

    #[tokio::test]
    async fn accepted_input_becomes_a_remote_candidate_without_graph_access() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let local = tempfile::tempdir().expect("local");
        let source_root = local.path().join("inputs");
        std::fs::create_dir_all(&source_root).expect("source directory");
        let source_file = source_root.join("orders.parquet");
        let source_store = Store::open(StoreOptions {
            path: None,
            allowed_directories: Some(vec![source_root.clone()]),
            ..StoreOptions::default()
        })
        .expect("source writer");
        source_store
            .exec("CREATE TABLE source AS SELECT 'one' AS id, 'Order one' AS name")
            .await
            .expect("source rows");
        source_store
            .exec(&format!(
                "COPY source TO {} (FORMAT PARQUET)",
                crate::store::lit(&source_file.display().to_string())
            ))
            .await
            .expect("write source parquet");
        source_store.close().await.expect("close source writer");

        let env = Env::from_map(HashMap::from([
            ("HASH_WEB_ID".to_owned(), "alice".to_owned()),
            (
                "INTEGRATIONS_BLOB_URL".to_owned(),
                format!("file://{}", remote.path().display()),
            ),
            (
                "INTEGRATIONS_BLOB_CACHE".to_owned(),
                cache.path().display().to_string(),
            ),
            (
                "RUNNER_BASE_DIR".to_owned(),
                local.path().join("state").display().to_string(),
            ),
            (
                "SOURCE_FOLDER".to_owned(),
                source_root.display().to_string(),
            ),
            ("RUNNER_MAX_WORKSPACE_BYTES".to_owned(), "1GiB".to_owned()),
            (
                "INTEGRATIONS_BLOB_CACHE_MAX_BYTES".to_owned(),
                "1GiB".to_owned(),
            ),
            ("RUNNER_MIN_FREE_BYTES".to_owned(), "1MiB".to_owned()),
            ("RUNNER_MAX_STAGING_BYTES".to_owned(), "1GiB".to_owned()),
            ("DUCKDB_MAX_DATABASE_SIZE".to_owned(), "256MiB".to_owned()),
        ]));
        let tenant = TenantNamespace::parse("alice").expect("tenant");
        let integration = super::super::ids::CanonicalIntegrationId::parse("alice:supply-chain")
            .expect("integration");
        let run_id = super::super::ids::RunId::parse("00000000-0000-4000-8000-000000000001")
            .expect("run ID");
        let definition = serde_json::json!({
            "connector": {"id": "supply-chain", "mode": "batch"},
            "sources": {
                "orders": {
                    "kind": "external",
                    "key": "orders.parquet",
                    "primaryKey": "id"
                }
            },
            "pipelines": {
                "entities": [{
                    "source": "orders",
                    "steps": [{
                        "id": "orders-sink",
                        "kind": "graph-sink",
                        "config": {
                            "entityType": "https://example.test/types/entity-type/order/v/1",
                            "entityId": "id",
                            "webId": "alice",
                            "properties": {
                                "https://example.test/types/property-type/name/": "name"
                            }
                        }
                    }]
                }]
            }
        });
        let digest = metadata::definition_digest(&definition).expect("definition digest");
        let input = RunInputRecord::current(
            serde_json::to_string(&definition).expect("definition JSON"),
            BTreeMap::from([
                (
                    "integrations.invocation.links_only".to_owned(),
                    "false".to_owned(),
                ),
                (
                    "integrations.invocation.replay.v1".to_owned(),
                    "{}".to_owned(),
                ),
            ]),
            "actor:owner".to_owned(),
            digest.clone(),
        );
        let artifacts = ArtifactStore::local(remote.path(), cache.path()).expect("artifact store");
        let input_artifact = artifacts
            .publish_record(
                &input,
                MAX_RUN_INPUT_RECORD_BYTES,
                "tenants/alice/artifacts/run-inputs",
                "application/json",
            )
            .await
            .expect("publish input");
        let input_ref = InputRef {
            artifact: input_artifact,
            definition_digest: digest,
            definition_digest_encoding_version: DEFINITION_DIGEST_ENCODING_VERSION,
            planner_version: PLANNER_VERSION,
        };
        let location = ShardLogLocation::disposable_local(
            routing::shard(&integration),
            &tenant,
            remote.path(),
        );
        let started = start_recovered(location, ShardCommandConfig::default())
            .await
            .expect("start shard");
        let commands = started.handle.clone();
        commands
            .propose(
                JournalRecordV1::new(
                    integration.clone(),
                    JournalEvent::V1(JournalEventV1::RunAccepted(RunAcceptedV1 {
                        run_id: run_id.clone(),
                        immutable_input: input_ref,
                        policy: policy(),
                        submitted_at: "2026-07-23T00:00:00Z".to_owned(),
                    })),
                )
                .expect("accepted record"),
            )
            .await
            .expect("accept run");
        let state: Arc<dyn StateAuthority> = Arc::new(JournalStateAuthority::new(
            artifacts.clone(),
            tenant.clone(),
            commands.clone(),
        ));
        let planner = RunPlanner::new(env, tenant, artifacts.clone(), state, commands.clone())
            .expect("run planner");
        let observed = commands
            .inspect_run(run_id.clone())
            .await
            .expect("inspect run")
            .expect("accepted run");
        let expected_workspace = planner.workspace_path(&observed, 1);
        let candidate = planner.plan(observed).await.expect("plan candidate");

        assert_eq!(candidate.graph.desired.len(), 1);
        assert_eq!(candidate.graph.effects.len(), 1);
        assert_eq!(candidate.snapshot.current().accepted_batches.len(), 1);
        assert!(artifacts
            .materialize(&candidate.snapshot.current().duckdb)
            .await
            .expect("materialize remote snapshot")
            .is_file());
        let projected = commands
            .inspect_run(run_id)
            .await
            .expect("inspect planned run")
            .expect("run");
        assert_eq!(projected.artifacts.len(), 1);
        assert_eq!(projected.attempt, 1);
        assert!(!expected_workspace.exists());

        started.task.abort();
    }
}
