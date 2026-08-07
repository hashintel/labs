//! Run-scoped immutable artifact bindings.
//!
//! A source capture becomes replayable only after its source-qualified
//! `ArtifactPublished` event is durable. Publication before that event is an
//! orphan-safe content upload. Recovery always adopts the journal binding
//! before consulting or recapturing a live source.
use crate::orchestrator::shard_log::IntegrationsCommandExt as _;
use std::fmt;
use std::path::Path;

use error_stack::{Report, ResultExt as _};

use super::events::{
    ArtifactPublishedV1, ArtifactRole, JournalEvent, JournalEventV1, JournalRecordV1,
};
use super::ids::{AttemptId, CanonicalIntegrationId, RunId, TenantNamespace};
use super::projection::RunStatus;
use super::routing;
use super::shard_log::{ShardCommandErrorKind, ShardCommandHandle};
use crate::blob::{ArtifactStore, BlobNamespace, BlobRef, MaterializedBlob};

const BRONZE_MEDIA_TYPE: &str = "application/vnd.apache.parquet";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunArtifactError {
    RunUnavailable,
    StaleAttempt,
    InvalidNamespace,
    Publish,
    JournalMutation,
    ArtifactConflict,
    ArtifactIntegrity,
}

impl fmt::Display for RunArtifactError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::RunUnavailable => "run is unavailable for artifact publication",
            Self::StaleAttempt => "run artifact publication attempt is no longer current",
            Self::InvalidNamespace => "run artifact namespace is invalid",
            Self::Publish => "publish immutable run artifact failed",
            Self::JournalMutation => "bind run artifact in the journal failed",
            Self::ArtifactConflict => "run artifact identity is already bound to different content",
            Self::ArtifactIntegrity => "bound run artifact failed integrity validation",
        })
    }
}

impl std::error::Error for RunArtifactError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunArtifactDisposition {
    Published,
    Recovered,
}

pub(crate) struct CapturedSource {
    pub(crate) reference: BlobRef,
    pub(crate) materialized: MaterializedBlob,
    pub(crate) disposition: RunArtifactDisposition,
}

#[derive(Debug, Clone)]
pub(crate) struct RunArtifactBindings {
    tenant: TenantNamespace,
    store: ArtifactStore,
    commands: ShardCommandHandle,
}

impl RunArtifactBindings {
    pub(crate) fn new(
        tenant: TenantNamespace,
        store: ArtifactStore,
        commands: ShardCommandHandle,
    ) -> Self {
        Self {
            tenant,
            store,
            commands,
        }
    }

    pub(crate) async fn publish_bronze_capture(
        &self,
        integration_id: &CanonicalIntegrationId,
        run_id: &RunId,
        attempt_id: &AttemptId,
        source: &str,
        candidate: &Path,
    ) -> Result<CapturedSource, Report<RunArtifactError>> {
        let role = ArtifactRole::BronzeCapture(source.to_owned());
        if let Some(reference) = self
            .bound_artifact(integration_id, run_id, attempt_id, &role)
            .await?
        {
            return self
                .materialize(reference, RunArtifactDisposition::Recovered)
                .await;
        }

        let prefix = BlobNamespace::v1(&self.tenant, &routing::integration_path(integration_id))
            .key("artifacts/bronze")
            .change_context(RunArtifactError::InvalidNamespace)?;
        let candidate_reference = self
            .store
            .publish(candidate, &prefix, BRONZE_MEDIA_TYPE)
            .await
            .change_context(RunArtifactError::Publish)?;

        if !self
            .commands
            .attempt_is_current(run_id.clone(), attempt_id.clone())
            .await
            .change_context(RunArtifactError::JournalMutation)?
        {
            return Err(Report::new(RunArtifactError::StaleAttempt));
        }
        let record = JournalRecordV1::new(
            integration_id.clone(),
            JournalEvent::V1(JournalEventV1::ArtifactPublished(ArtifactPublishedV1 {
                run_id: run_id.clone(),
                role: role.clone(),
                reference: candidate_reference.clone(),
            })),
        )
        .change_context(RunArtifactError::JournalMutation)?;
        match self.commands.propose(record).await {
            Ok(_) => {
                self.materialize(candidate_reference, RunArtifactDisposition::Published)
                    .await
            }
            Err(error) if error.kind == ShardCommandErrorKind::InvalidCandidate => {
                let Some(winner) = self
                    .bound_artifact(integration_id, run_id, attempt_id, &role)
                    .await?
                else {
                    return Err(
                        Report::new(error).change_context(RunArtifactError::JournalMutation)
                    );
                };
                self.materialize(winner, RunArtifactDisposition::Recovered)
                    .await
            }
            Err(error) => Err(Report::new(error).change_context(RunArtifactError::JournalMutation)),
        }
    }

    pub(crate) async fn recover_bronze_capture(
        &self,
        integration_id: &CanonicalIntegrationId,
        run_id: &RunId,
        attempt_id: &AttemptId,
        source: &str,
    ) -> Result<Option<CapturedSource>, Report<RunArtifactError>> {
        let role = ArtifactRole::BronzeCapture(source.to_owned());
        let Some(reference) = self
            .bound_artifact(integration_id, run_id, attempt_id, &role)
            .await?
        else {
            return Ok(None);
        };
        self.materialize(reference, RunArtifactDisposition::Recovered)
            .await
            .map(Some)
    }

    async fn bound_artifact(
        &self,
        integration_id: &CanonicalIntegrationId,
        run_id: &RunId,
        attempt_id: &AttemptId,
        role: &ArtifactRole,
    ) -> Result<Option<BlobRef>, Report<RunArtifactError>> {
        let run = self
            .commands
            .inspect_run(run_id.clone())
            .await
            .change_context(RunArtifactError::JournalMutation)?
            .ok_or_else(|| Report::new(RunArtifactError::RunUnavailable))?;
        if run.integration_id != *integration_id
            || run.status != RunStatus::Running
            || run.attempt_id.as_ref() != Some(attempt_id)
        {
            return Err(Report::new(RunArtifactError::StaleAttempt));
        }
        let Some(reference) = run.artifacts.get(role).cloned() else {
            return Ok(None);
        };
        self.validate_reference(integration_id, &reference)?;
        Ok(Some(reference))
    }

    fn validate_reference(
        &self,
        integration_id: &CanonicalIntegrationId,
        reference: &BlobRef,
    ) -> Result<(), Report<RunArtifactError>> {
        let expected_prefix = format!(
            "{}/artifacts/bronze/sha256/",
            BlobNamespace::v1(&self.tenant, &routing::integration_path(integration_id)).root()
        );
        let current = reference.current();
        if current.media_type != BRONZE_MEDIA_TYPE || !current.key.starts_with(&expected_prefix) {
            return Err(Report::new(RunArtifactError::ArtifactConflict)
                .attach_printable(format!("artifact key: {}", current.key))
                .attach_printable(format!("artifact media type: {}", current.media_type)));
        }
        Ok(())
    }

    async fn materialize(
        &self,
        reference: BlobRef,
        disposition: RunArtifactDisposition,
    ) -> Result<CapturedSource, Report<RunArtifactError>> {
        let materialized = self
            .store
            .materialize_guarded(&reference)
            .await
            .change_context(RunArtifactError::ArtifactIntegrity)?;
        Ok(CapturedSource {
            reference,
            materialized,
            disposition,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob::BlobRefV1;
    use crate::orchestrator::events::{AttemptStartedV1, InputRef, PolicyRef, RunAcceptedV1};
    use crate::orchestrator::ids::derive_attempt_id;
    use crate::orchestrator::routing;
    use crate::orchestrator::shard_log::{start_recovered, ShardCommandConfig};

    fn placeholder(key: &str, digest: char) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: key.to_owned(),
            sha256: digest.to_string().repeat(64),
            size: 1,
            media_type: "application/json".to_owned(),
            e_tag: None,
            provider_version: None,
        })
    }

    #[tokio::test]
    async fn source_identity_is_durable_and_recovery_never_recaptures_it() {
        let remote = tempfile::tempdir().expect("remote directory");
        let cache = tempfile::tempdir().expect("cache directory");
        let tenant = TenantNamespace::parse("alice").expect("tenant");
        let integration = CanonicalIntegrationId::parse("alice:supply-chain").expect("integration");
        let run_id = RunId::parse("00000000-0000-4000-8000-000000000001").expect("run ID");
        let attempt_id = derive_attempt_id(&run_id, 1);
        let location = crate::orchestrator::shard_log::disposable_local(
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
                        immutable_input: InputRef {
                            artifact: placeholder("inputs/run.json", 'a'),
                            definition_digest: "b".repeat(64),
                            definition_digest_encoding_version: 1,
                            planner_version: 1,
                        },
                        policy: PolicyRef {
                            artifact: placeholder("policies/run.json", 'c'),
                            policy_digest: "d".repeat(64),
                        },
                        submitted_at: "2026-07-23T00:00:00Z".to_owned(),
                    })),
                )
                .expect("accepted record"),
            )
            .await
            .expect("accept run");
        commands
            .propose(
                JournalRecordV1::new(
                    integration.clone(),
                    JournalEvent::V1(JournalEventV1::AttemptStarted(AttemptStartedV1 {
                        run_id: run_id.clone(),
                        attempt_id: attempt_id.clone(),
                        attempt: 1,
                    })),
                )
                .expect("attempt record"),
            )
            .await
            .expect("start attempt");

        let store = ArtifactStore::local(remote.path(), cache.path()).expect("artifact store");
        let bindings = RunArtifactBindings::new(tenant, store.clone(), commands.clone());
        let first_path = store.stage(".parquet").expect("first stage");
        tokio::fs::write(&first_path, b"first source bytes")
            .await
            .expect("write first stage");
        let first = bindings
            .publish_bronze_capture(&integration, &run_id, &attempt_id, "orders", &first_path)
            .await
            .expect("publish first capture");
        assert_eq!(first.disposition, RunArtifactDisposition::Published);
        let first_reference = first.reference.clone();
        drop(first);

        let changed_path = store.stage(".parquet").expect("changed stage");
        tokio::fs::write(&changed_path, b"changed live source")
            .await
            .expect("write changed stage");
        let recovered = bindings
            .publish_bronze_capture(&integration, &run_id, &attempt_id, "orders", &changed_path)
            .await
            .expect("recover durable source binding");
        assert_eq!(recovered.disposition, RunArtifactDisposition::Recovered);
        assert_eq!(recovered.reference, first_reference);
        assert_eq!(
            tokio::fs::read(recovered.materialized.path())
                .await
                .expect("read recovered bytes"),
            b"first source bytes"
        );

        let second_path = store.stage(".parquet").expect("second stage");
        tokio::fs::write(&second_path, b"second source bytes")
            .await
            .expect("write second stage");
        bindings
            .publish_bronze_capture(
                &integration,
                &run_id,
                &attempt_id,
                "materials",
                &second_path,
            )
            .await
            .expect("publish second source");
        let run = commands
            .inspect_run(run_id)
            .await
            .expect("inspect run")
            .expect("run exists");
        assert_eq!(run.artifacts.len(), 2);
        assert!(run
            .artifacts
            .contains_key(&ArtifactRole::BronzeCapture("orders".to_owned())));
        assert!(run
            .artifacts
            .contains_key(&ArtifactRole::BronzeCapture("materials".to_owned())));

        started.task.abort();
    }
}
