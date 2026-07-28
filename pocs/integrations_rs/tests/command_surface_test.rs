use std::process::Command;

use integrations_rs::orchestrator::{
    CommandRunState, CommandRunStatus, CommandSubmission, PublishedCancellation,
};

fn command(remote: &tempfile::TempDir, cache: &tempfile::TempDir) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_integrations_rs"));
    command
        .env(
            "INTEGRATIONS_BLOB_URL",
            format!("file://{}", remote.path().display()),
        )
        .env("INTEGRATIONS_BLOB_CACHE", cache.path())
        .env("HASH_WEB_ID", "alice")
        .env("HASH_ACTOR_ID", "actor:alice");
    command
}

#[tokio::test]
async fn baseline_cli_status_cancel_and_verify_use_the_v1_surface() {
    let remote = tempfile::tempdir().expect("remote");
    let cache = tempfile::tempdir().expect("cache");
    let definition = format!("{}/examples/aviation.yaml", env!("CARGO_MANIFEST_DIR"));
    let submit = command(&remote, &cache)
        .args(["submit", &definition, "--json"])
        .output()
        .expect("submit command");
    assert!(submit.status.success(), "{submit:?}");
    let submitted: CommandSubmission =
        serde_json::from_slice(&submit.stdout).expect("submission JSON");

    let status = command(&remote, &cache)
        .args(["status", submitted.run_id.as_str(), "--json"])
        .output()
        .expect("status command");
    assert!(status.status.success(), "{status:?}");
    let status: CommandRunStatus = serde_json::from_slice(&status.stdout).expect("status JSON");
    assert_eq!(status.state, CommandRunState::AdmissionPending);

    let cancel = command(&remote, &cache)
        .args(["cancel", submitted.run_id.as_str(), "--json"])
        .output()
        .expect("cancel command");
    assert!(cancel.status.success(), "{cancel:?}");
    let cancellation: PublishedCancellation =
        serde_json::from_slice(&cancel.stdout).expect("cancel JSON");
    assert_eq!(cancellation.run_id, submitted.run_id);

    let verify = command(&remote, &cache)
        .args(["verify-store", "--full"])
        .output()
        .expect("verify-store command");
    assert!(verify.status.success(), "{verify:?}");
    let verification: serde_json::Value =
        serde_json::from_slice(&verify.stdout).expect("verification JSON");
    assert_eq!(verification["baselineCompatible"], true);
    assert_eq!(verification["tenantNamespace"], "alice");
    assert_eq!(verification["runLocators"], 1);
}
