//! Read-only operator queries and immutable control-inbox publication.
//!
//! This module is deliberately not a worker. It never opens a shard writer,
//! acquires a lease, advances an epoch, or resolves its own control request.

use std::fmt;

use error_stack::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use super::baseline::{compatible_control_baseline_exists, verify_control_baseline};
use super::control::{CancelRunV1, ControlCommandV1, ControlRequestV1};
use super::events::FailureSummary;
use super::events::{InputRef, PolicyRef};
use super::ids::{
    AttemptId, CanonicalIntegrationId, EventId, RequestId, RunId, TenantNamespace, WorkId,
};
use super::inbox::publish_control_request;
use super::internal_metadata::{
    RunInputRecord, RunLocatorRecord, RunPolicyRecord, MAX_RUN_LOCATOR_RECORD_BYTES,
};
use super::metadata::{CurrentTaskMetadata, CurrentTaskPayload, PreparedTask};
use super::projection::RunStatus as ProjectedRunStatus;
use super::record_io::read_strict as read_record;
use super::registry::{require_registered, DurableRecord};
use super::routing::Keyspace;
use super::shard_log::{read_projection, ShardLogLocation};
use super::submission::{active_admission_revision, submit_durable_for_run};
use crate::blob::{ArtifactStore, BlobRef};
use crate::config::{self, Env};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandRunState {
    AdmissionPending,
    Accepted,
    Running,
    Completed,
    Terminated,
}

impl fmt::Display for CommandRunState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AdmissionPending => "admission_pending",
            Self::Accepted => "accepted",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Terminated => "terminated",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandRunStatus {
    pub run_id: RunId,
    pub integration_id: CanonicalIntegrationId,
    pub state: CommandRunState,
    pub attempt: u64,
    pub attempt_id: Option<AttemptId>,
    pub active_work_id: Option<WorkId>,
    pub effect_count: Option<u64>,
    pub completed_effect_count: Option<u64>,
    pub revision: EventId,
    pub result: Option<BlobRef>,
    pub failure: Option<FailureSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublishedCancellation {
    pub run_id: RunId,
    pub request_id: RequestId,
    pub request_key: String,
    pub expected_revision: EventId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandSubmission {
    pub run_id: RunId,
    pub initial_revision: EventId,
    pub created: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandSurfaceError {
    Configuration,
    Storage,
    Baseline,
    Inventory,
    Projection,
    InvalidRunId,
    InvalidSubmission,
    PublishSubmissionArtifacts,
    SubmitRun,
    RunNotFound,
    InvalidControlRequest,
    PublishControlRequest,
}

impl fmt::Display for CommandSurfaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Configuration => "command-surface configuration is invalid",
            Self::Storage => "open command-surface object store failed",
            Self::Baseline => "validate tenant control baseline failed",
            Self::Inventory => "inspect known shard inventory failed",
            Self::Projection => "read authoritative shard projection failed",
            Self::InvalidRunId => "run ID is invalid",
            Self::InvalidSubmission => "prepared submission is invalid",
            Self::PublishSubmissionArtifacts => "publish immutable submission artifacts failed",
            Self::SubmitRun => "submit run through the V1 admission protocol failed",
            Self::RunNotFound => "run was not found in the tenant control plane",
            Self::InvalidControlRequest => "construct cancellation request failed",
            Self::PublishControlRequest => "publish cancellation request failed",
        })
    }
}

impl std::error::Error for CommandSurfaceError {}

#[derive(Clone)]
pub struct CommandSurface {
    env: Env,
    store: ArtifactStore,
    tenant: TenantNamespace,
    actor: Option<String>,
}

impl CommandSurface {
    pub fn open(env: &Env) -> Result<Self, Report<CommandSurfaceError>> {
        let web_id = env.get("HASH_WEB_ID").ok_or_else(|| {
            Report::new(CommandSurfaceError::Configuration)
                .attach_printable("HASH_WEB_ID is required")
        })?;
        Self::open_for(env, web_id, env.get("HASH_ACTOR_ID"))
    }

    /// Open a request-scoped surface without changing process-global
    /// configuration. HTTP authentication remains outside this boundary; the
    /// already-authenticated tenant and actor are explicit inputs.
    pub fn open_for(
        env: &Env,
        web_id: &str,
        actor: Option<&str>,
    ) -> Result<Self, Report<CommandSurfaceError>> {
        let tenant = TenantNamespace::parse(web_id.to_owned())
            .change_context(CommandSurfaceError::Configuration)?;
        let store =
            ArtifactStore::from_url(&config::blob_store_url(env), config::blob_cache_dir(env))
                .change_context(CommandSurfaceError::Storage)?;
        Ok(Self {
            env: env.clone(),
            store,
            tenant,
            actor: actor.map(str::to_owned),
        })
    }

    pub async fn status(
        &self,
        run_id: &str,
    ) -> Result<CommandRunStatus, Report<CommandSurfaceError>> {
        let run_id =
            RunId::parse(run_id.to_owned()).change_context(CommandSurfaceError::InvalidRunId)?;
        self.status_for_run(&run_id)
            .await?
            .ok_or_else(|| Report::new(CommandSurfaceError::RunNotFound))
    }

    pub async fn submit(
        &self,
        prepared: PreparedTask,
    ) -> Result<CommandSubmission, Report<CommandSurfaceError>> {
        let payload = CurrentTaskPayload::from(prepared.payload);
        let metadata = CurrentTaskMetadata::from(prepared.metadata);
        let integration_id = CanonicalIntegrationId::parse(metadata.canonical_integration_id)
            .change_context(CommandSurfaceError::InvalidSubmission)?;
        if metadata.web_id != self.tenant.as_str() {
            return Err(
                Report::new(CommandSurfaceError::InvalidSubmission).attach_printable(
                    "prepared submission web identity disagrees with request tenant",
                ),
            );
        }
        let mut variables = std::collections::BTreeMap::new();
        variables.insert(
            "integrations.invocation.links_only".to_owned(),
            payload.invocation.links_only.to_string(),
        );
        variables.insert(
            "integrations.invocation.replay.v1".to_owned(),
            serde_json::to_string(&payload.invocation.replay)
                .change_context(CommandSurfaceError::InvalidSubmission)?,
        );
        let definition = serde_json::to_string(&payload.definition)
            .change_context(CommandSurfaceError::InvalidSubmission)?;
        let owner_actor_id = self.actor.clone().ok_or_else(|| {
            Report::new(CommandSurfaceError::Configuration)
                .attach_printable("an authenticated actor is required to submit a run")
        })?;
        let input_record = RunInputRecord::current(
            definition,
            variables,
            owner_actor_id,
            metadata.resolved_definition_digest,
        );
        require_registered::<RunInputRecord>()
            .change_context(CommandSurfaceError::InvalidSubmission)?;
        let input_bytes = input_record
            .encode()
            .change_context(CommandSurfaceError::InvalidSubmission)?;
        let input_artifact = publish_bytes(
            &self.store,
            &input_bytes,
            ".json",
            &Keyspace::for_tenant(&self.tenant).run_inputs(),
            "application/json",
        )
        .await
        .change_context(CommandSurfaceError::PublishSubmissionArtifacts)?;

        // V1 retains the established five-attempt default as five durable
        // handler failures. Process interruption remains outside this budget.
        let policy_record = RunPolicyRecord::current(5);
        require_registered::<RunPolicyRecord>()
            .change_context(CommandSurfaceError::InvalidSubmission)?;
        let policy_bytes = policy_record
            .encode()
            .change_context(CommandSurfaceError::InvalidSubmission)?;
        let policy_artifact = publish_bytes(
            &self.store,
            &policy_bytes,
            ".json",
            &Keyspace::for_tenant(&self.tenant).run_policies(),
            "application/json",
        )
        .await
        .change_context(CommandSurfaceError::PublishSubmissionArtifacts)?;
        let run_id = RunId::generate();
        let outcome = submit_durable_for_run(
            &self.store,
            &self.tenant,
            integration_id,
            run_id,
            InputRef {
                artifact: input_artifact,
                definition_digest: metadata.definition_digest,
                definition_digest_encoding_version: 1,
                planner_version: 1,
            },
            PolicyRef {
                policy_digest: hex::encode(Sha256::digest(&policy_bytes)),
                artifact: policy_artifact,
            },
            metadata.submitted_at,
        )
        .await
        .change_context(CommandSurfaceError::SubmitRun)?;
        Ok(CommandSubmission {
            run_id: outcome.run_id,
            initial_revision: outcome.initial_revision,
            created: outcome.created,
        })
    }

    pub async fn baseline_active(&self) -> Result<bool, Report<CommandSurfaceError>> {
        compatible_control_baseline_exists(&self.store, &self.tenant)
            .await
            .change_context(CommandSurfaceError::Baseline)
    }

    pub async fn cancel(
        &self,
        run_id: &str,
    ) -> Result<PublishedCancellation, Report<CommandSurfaceError>> {
        let status = self.status(run_id).await?;
        let actor = self.actor.as_deref().ok_or_else(|| {
            Report::new(CommandSurfaceError::Configuration)
                .attach_printable("an authenticated actor is required to publish a control request")
        })?;
        let request = ControlRequestV1::new(
            self.tenant.clone(),
            status.integration_id,
            actor.to_owned(),
            ControlCommandV1::CancelRun(CancelRunV1 {
                run_id: status.run_id.clone(),
                expected_run_revision: status.revision.clone(),
                expected_failed_work: status.active_work_id,
            }),
        )
        .change_context(CommandSurfaceError::InvalidControlRequest)?;
        let request_key = publish_control_request(&self.store, &request)
            .await
            .change_context(CommandSurfaceError::PublishControlRequest)?;
        Ok(PublishedCancellation {
            run_id: status.run_id,
            request_id: request.request_id,
            request_key,
            expected_revision: status.revision,
        })
    }

    async fn status_for_run(
        &self,
        run_id: &RunId,
    ) -> Result<Option<CommandRunStatus>, Report<CommandSurfaceError>> {
        verify_control_baseline(&self.store, &self.tenant)
            .await
            .change_context(CommandSurfaceError::Baseline)?;
        if let Some(integration_id) = self.run_locator(run_id).await? {
            let shard = super::routing::shard(&integration_id);
            if let Some(status) = self
                .projected_status(run_id, &integration_id, shard)
                .await?
            {
                return Ok(Some(status));
            }
            if let Some(revision) =
                active_admission_revision(&self.store, &self.tenant, &integration_id, run_id)
                    .await
                    .change_context(CommandSurfaceError::Inventory)?
            {
                return Ok(Some(pending_status(
                    run_id.clone(),
                    integration_id,
                    revision,
                )));
            }
            return Ok(None);
        }
        Ok(None)
    }

    async fn run_locator(
        &self,
        run_id: &RunId,
    ) -> Result<Option<CanonicalIntegrationId>, Report<CommandSurfaceError>> {
        let key = Keyspace::for_tenant(&self.tenant).run_locator(run_id);
        read_record::<RunLocatorRecord>(&self.store, &key, MAX_RUN_LOCATOR_RECORD_BYTES)
            .await
            .change_context(CommandSurfaceError::Inventory)
            .map(|record| record.map(|(record, _version)| record.into_current()))
    }

    async fn projected_status(
        &self,
        run_id: &RunId,
        expected_integration: &CanonicalIntegrationId,
        shard: super::routing::Shard,
    ) -> Result<Option<CommandRunStatus>, Report<CommandSurfaceError>> {
        let paths = Keyspace::for_tenant(&self.tenant);
        if self
            .store
            .list(&paths.shard_log(shard))
            .await
            .change_context(CommandSurfaceError::Inventory)?
            .is_empty()
        {
            return Ok(None);
        }
        let location = ShardLogLocation::production(&self.env, shard, &self.tenant)
            .change_context(CommandSurfaceError::Projection)?;
        let projection = read_projection(&location)
            .await
            .change_context(CommandSurfaceError::Projection)?;
        let Some(run) = projection.runs.get(run_id) else {
            return Ok(None);
        };
        if expected_integration != &run.integration_id {
            return Err(Report::new(CommandSurfaceError::Projection)
                .attach_printable("run locator disagrees with the projected integration"));
        }
        let integration = projection
            .integrations
            .get(&run.integration_id)
            .ok_or_else(|| {
                Report::new(CommandSurfaceError::Projection)
                    .attach_printable(format!("run {run_id} has no integration projection"))
            })?;
        let active_work = integration
            .foreground_work
            .as_ref()
            .and_then(|work_id| projection.work.get(work_id));
        Ok(Some(CommandRunStatus {
            run_id: run_id.clone(),
            integration_id: run.integration_id.clone(),
            state: projected_state(run.status),
            attempt: run.attempt,
            attempt_id: run.attempt_id.clone(),
            active_work_id: integration.foreground_work.clone(),
            effect_count: active_work.map(|work| work.effect_count),
            completed_effect_count: active_work.map(|work| work.completed_effect_count),
            revision: run.revision.clone(),
            result: run.result.clone(),
            failure: run.failure.clone(),
        }))
    }
}

fn pending_status(
    run_id: RunId,
    integration_id: CanonicalIntegrationId,
    revision: EventId,
) -> CommandRunStatus {
    CommandRunStatus {
        run_id,
        integration_id,
        state: CommandRunState::AdmissionPending,
        attempt: 0,
        attempt_id: None,
        active_work_id: None,
        effect_count: None,
        completed_effect_count: None,
        revision,
        result: None,
        failure: None,
    }
}

async fn publish_bytes(
    store: &ArtifactStore,
    bytes: &[u8],
    suffix: &str,
    logical_prefix: &str,
    media_type: &str,
) -> Result<BlobRef, Report<crate::error::BlobError>> {
    let staged = store.stage(suffix)?;
    tokio::fs::write(&staged, bytes)
        .await
        .change_context(crate::error::BlobError)
        .attach_printable("write staged command-surface artifact")?;
    let result = store.publish(&staged, logical_prefix, media_type).await;
    if let Err(error) = tokio::fs::remove_file(&staged).await {
        tracing::warn!(
            path = %staged.display(),
            %error,
            "failed to remove published command-surface staging file"
        );
    }
    result
}

const fn projected_state(status: ProjectedRunStatus) -> CommandRunState {
    match status {
        ProjectedRunStatus::Accepted => CommandRunState::Accepted,
        ProjectedRunStatus::Running => CommandRunState::Running,
        ProjectedRunStatus::Completed => CommandRunState::Completed,
        ProjectedRunStatus::Terminated => CommandRunState::Terminated,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::blob::{BlobRef, BlobRefV1};
    use crate::orchestrator::events::{
        AttemptStartedV1, InputRef, JournalEvent, JournalEventV1, JournalRecordV1, PolicyRef,
    };
    use crate::orchestrator::ids::derive_attempt_id;
    use crate::orchestrator::shard_log::{start_recovered, ShardCommandConfig};
    use crate::orchestrator::submission::{
        admitted_run_record, delete_ready_receipt, discover_ready_receipts, submit_durable_for_run,
    };

    fn env(remote: &tempfile::TempDir, cache: &tempfile::TempDir) -> Env {
        Env::from_map(HashMap::from([
            (
                "INTEGRATIONS_BLOB_URL".to_owned(),
                format!("file://{}", remote.path().display()),
            ),
            (
                "INTEGRATIONS_BLOB_CACHE".to_owned(),
                cache.path().display().to_string(),
            ),
            ("HASH_WEB_ID".to_owned(), "alice".to_owned()),
            ("HASH_ACTOR_ID".to_owned(), "actor:alice".to_owned()),
        ]))
    }

    fn blob(key: &str, digest: char) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: key.to_owned(),
            sha256: digest.to_string().repeat(64),
            size: 1,
            media_type: "application/json".to_owned(),
            e_tag: None,
            provider_version: None,
        })
    }

    fn input() -> InputRef {
        InputRef {
            artifact: blob("inputs/one.json", 'a'),
            definition_digest: "b".repeat(64),
            definition_digest_encoding_version: 1,
            planner_version: 1,
        }
    }

    fn policy() -> PolicyRef {
        PolicyRef {
            artifact: blob("policies/one.json", 'c'),
            policy_digest: "d".repeat(64),
        }
    }

    #[tokio::test]
    async fn pending_status_and_cancel_use_only_v1_receipts_and_control_inbox() {
        let remote = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let env = env(&remote, &cache);
        let store =
            ArtifactStore::from_url(&config::blob_store_url(&env), config::blob_cache_dir(&env))
                .unwrap();
        let tenant = TenantNamespace::parse("alice").unwrap();
        let integration = CanonicalIntegrationId::parse("alice:supply-chain").unwrap();
        let run_id = RunId::parse("00000000-0000-4000-8000-000000000001").unwrap();
        let submitted = submit_durable_for_run(
            &store,
            &tenant,
            integration.clone(),
            run_id.clone(),
            input(),
            policy(),
            "2026-07-23T00:00:00Z".to_owned(),
        )
        .await
        .unwrap();
        let surface = CommandSurface::open(&env).unwrap();
        delete_ready_receipt(
            &store,
            &tenant,
            super::super::routing::shard(&integration),
            &run_id,
        )
        .await
        .unwrap();

        // The immutable locator plus active admission bridge the interval
        // after receipt deletion but before a separate read-only journal
        // reader observes RunAccepted.
        let status = surface.status(run_id.as_str()).await.unwrap();
        assert_eq!(status.state, CommandRunState::AdmissionPending);
        assert_eq!(status.revision, submitted.initial_revision);
        let first = surface.cancel(run_id.as_str()).await.unwrap();
        let retry = surface.cancel(run_id.as_str()).await.unwrap();
        assert_eq!(first, retry);
        assert_eq!(
            first.request_key,
            Keyspace::for_tenant(&tenant).request(
                super::super::routing::shard(&integration),
                &first.request_id
            )
        );
    }

    #[tokio::test]
    async fn projected_status_is_read_only_and_does_not_fence_the_live_writer() {
        let remote = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let env = env(&remote, &cache);
        let store =
            ArtifactStore::from_url(&config::blob_store_url(&env), config::blob_cache_dir(&env))
                .unwrap();
        let tenant = TenantNamespace::parse("alice").unwrap();
        let integration = CanonicalIntegrationId::parse("alice:supply-chain").unwrap();
        let run_id = RunId::parse("00000000-0000-4000-8000-000000000001").unwrap();
        submit_durable_for_run(
            &store,
            &tenant,
            integration.clone(),
            run_id.clone(),
            input(),
            policy(),
            "2026-07-23T00:00:00Z".to_owned(),
        )
        .await
        .unwrap();
        let receipt = discover_ready_receipts(&store, &tenant)
            .await
            .unwrap()
            .pop()
            .unwrap();
        let accepted = admitted_run_record(&store, &tenant, &receipt)
            .await
            .unwrap()
            .unwrap();
        let location =
            ShardLogLocation::production(&env, super::super::routing::shard(&integration), &tenant)
                .unwrap();
        let started = start_recovered(location, ShardCommandConfig::default())
            .await
            .unwrap();
        started.handle.propose(accepted).await.unwrap();
        delete_ready_receipt(&store, &tenant, receipt.shard, &run_id)
            .await
            .unwrap();

        let surface = CommandSurface::open(&env).unwrap();
        let status = surface.status(run_id.as_str()).await.unwrap();
        assert_eq!(status.state, CommandRunState::Accepted);
        let attempt_id = derive_attempt_id(&run_id, 1);
        started
            .handle
            .propose(
                JournalRecordV1::new(
                    integration,
                    JournalEvent::V1(JournalEventV1::AttemptStarted(AttemptStartedV1 {
                        run_id,
                        attempt: 1,
                        attempt_id,
                    })),
                )
                .unwrap(),
            )
            .await
            .expect("read-only status must not fence the writer");
        started.handle.shutdown().await.unwrap();
        started.task.await.unwrap().unwrap();
    }
}
