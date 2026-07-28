#![allow(clippy::print_stdout, clippy::print_stderr)]

//! Release tooling: generates the activation attestation from actual
//! contract-suite evidence.
//!
//! The attestation is evidence for one binary version against one provider
//! configuration, never hand-written for production. This tool refuses to
//! emit anything unless:
//!
//! - the captured output of the credentialed S3 provider suite shows the
//!   contract passed (`--s3-suite-log`),
//! - the captured output of the isolated Graph delivery suite shows the
//!   contract passed (`--graph-suite-log`), and
//! - the `SlateDB` writer-fencing probe passes live against the configured
//!   blob URL, right now, in this process.
//!
//! Usage:
//!   `release_attestation` --output <path> --valid-hours <hours> \
//!       --s3-suite-log <path> --graph-suite-log <path>
//!
//! Environment: `INTEGRATIONS_BLOB_URL`, `HASH_GRAPH_URL`, and
//! `INTEGRATIONS_BLOB_CACHE` exactly as the worker will run.

use std::collections::HashMap;
use std::process::ExitCode;

use serde::Deserialize;
use sha2::{Digest as _, Sha256};

const MAX_SUITE_LOG_BYTES: u64 = 16 * 1024 * 1024;
const EVIDENCE_PREFIX: &str = "INTEGRATIONS_CONTRACT_EVIDENCE ";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContractEvidence {
    evidence_version: u32,
    suite: String,
    binary_version: String,
    blob_store_url_sha256: String,
    graph_url_sha256: Option<String>,
}

#[derive(Clone, Copy)]
struct ExpectedEvidence<'a> {
    suite: &'a str,
    blob_store_url_sha256: &'a str,
    graph_url_sha256: Option<&'a str>,
}

struct Arguments {
    output: String,
    valid_hours: i64,
    s3_suite_log: String,
    graph_suite_log: String,
}

fn parse_arguments() -> Result<Arguments, String> {
    let mut values = HashMap::new();
    let mut arguments = std::env::args().skip(1);
    while let Some(flag) = arguments.next() {
        let value = arguments
            .next()
            .ok_or_else(|| format!("{flag} requires a value"))?;
        values.insert(flag, value);
    }
    let take = |name: &str, values: &mut HashMap<String, String>| {
        values
            .remove(name)
            .ok_or_else(|| format!("{name} is required"))
    };
    let parsed = Arguments {
        output: take("--output", &mut values)?,
        valid_hours: take("--valid-hours", &mut values)?
            .parse::<i64>()
            .map_err(|error| format!("--valid-hours must be a positive integer: {error}"))?,
        s3_suite_log: take("--s3-suite-log", &mut values)?,
        graph_suite_log: take("--graph-suite-log", &mut values)?,
    };
    if parsed.valid_hours <= 0 {
        return Err("--valid-hours must be positive".to_owned());
    }
    if let Some(unknown) = values.keys().next() {
        return Err(format!("unknown argument {unknown}"));
    }
    Ok(parsed)
}

/// A suite log counts as evidence only when the named contract test ran,
/// emitted one machine-readable statement bound to this binary and the exact
/// provider URLs, and the harness reported an overall pass with zero failures.
fn verify_suite_log(
    path: &str,
    contract_test: &str,
    expected: ExpectedEvidence<'_>,
) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|error| format!("read suite log {path}: {error}"))?;
    if metadata.len() > MAX_SUITE_LOG_BYTES {
        return Err(format!(
            "suite log {path} exceeds {MAX_SUITE_LOG_BYTES} bytes"
        ));
    }
    let log =
        std::fs::read_to_string(path).map_err(|error| format!("read suite log {path}: {error}"))?;
    let test_prefix = format!("test {contract_test} ... ");
    let contract_passed = log.lines().any(|line| {
        line.starts_with(&test_prefix)
            && (line.ends_with("... ok") || line.contains(EVIDENCE_PREFIX))
    });
    if !contract_passed {
        return Err(format!(
            "suite log {path} does not show a completed run of {contract_test}"
        ));
    }
    if log.contains("FAILED") || log.contains("panicked") {
        return Err(format!("suite log {path} contains failures"));
    }
    if !log.contains("test result: ok.") {
        return Err(format!("suite log {path} has no passing harness summary"));
    }
    let evidence = log
        .lines()
        // libtest may print captured stdout after `test <name> ... ` on the
        // same line, so the marker is anchored but not necessarily at column
        // zero. The JSON still occupies the remainder of that line.
        .filter_map(|line| line.split_once(EVIDENCE_PREFIX).map(|(_prefix, json)| json))
        .map(|json| {
            serde_json::from_str::<ContractEvidence>(json).map_err(|error| {
                format!("suite log {path} has malformed contract evidence: {error}")
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let [evidence] = evidence.as_slice() else {
        return Err(format!(
            "suite log {path} must contain exactly one {EVIDENCE_PREFIX:?} record"
        ));
    };
    if evidence.evidence_version != 1
        || evidence.suite != expected.suite
        || evidence.binary_version != env!("CARGO_PKG_VERSION")
        || evidence.blob_store_url_sha256 != expected.blob_store_url_sha256
        || evidence.graph_url_sha256.as_deref() != expected.graph_url_sha256
    {
        return Err(format!(
            "suite log {path} evidence does not match the current binary and provider configuration"
        ));
    }
    Ok(())
}

fn required_env(env: &integrations_rs::config::Env, name: &str) -> Result<String, String> {
    env.get(name)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| format!("{name} is required"))
}

fn digest(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(output) => {
            println!("release attestation written to {output}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("release attestation refused: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<String, String> {
    let arguments = parse_arguments()?;
    let env = integrations_rs::config::Env::process();
    let blob_url = required_env(&env, "INTEGRATIONS_BLOB_URL")?;
    let graph_url = required_env(&env, "HASH_GRAPH_URL")?;
    required_env(&env, "INTEGRATIONS_BLOB_CACHE")?;
    let blob_url_sha256 = digest(blob_url.trim_end_matches('/'));
    let graph_url_sha256 = digest(graph_url.trim_end_matches('/'));

    verify_suite_log(
        &arguments.s3_suite_log,
        "real_s3_provider_contract",
        ExpectedEvidence {
            suite: "s3-provider-v1",
            blob_store_url_sha256: &blob_url_sha256,
            graph_url_sha256: None,
        },
    )?;
    verify_suite_log(
        &arguments.graph_suite_log,
        "real_graph_delivery_contract",
        ExpectedEvidence {
            suite: "graph-delivery-v1",
            blob_store_url_sha256: &blob_url_sha256,
            graph_url_sha256: Some(&graph_url_sha256),
        },
    )?;
    integrations_rs::production::slatedb_fencing_contract(&env)
        .await
        .map_err(|error| format!("live SlateDB fencing probe failed: {error:?}"))?;

    let valid_until = chrono::Utc::now() + chrono::Duration::hours(arguments.valid_hours);
    let attestation = serde_json::json!({
        "version": 1,
        "protocolVersion": 1,
        "binaryVersion": env!("CARGO_PKG_VERSION"),
        "validUntil": valid_until.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "blobStoreUrlSha256": blob_url_sha256,
        "graphUrlSha256": graph_url_sha256,
        "objectStoreContractPassed": true,
        "slateDbContractPassed": true,
        "graphDeliveryContractPassed": true
    });
    let bytes = serde_json::to_vec_pretty(&attestation)
        .map_err(|error| format!("encode attestation: {error}"))?;
    std::fs::write(&arguments.output, bytes)
        .map_err(|error| format!("write attestation {}: {error}", arguments.output))?;
    Ok(arguments.output)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLOB_DIGEST: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const GRAPH_DIGEST: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn log_file(content: &str) -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().expect("log directory");
        let path = dir.path().join("suite.log");
        std::fs::write(&path, content).expect("write suite log");
        let path = path.display().to_string();
        (dir, path)
    }

    #[test]
    fn a_passing_suite_log_is_accepted() {
        let evidence = serde_json::json!({
            "evidenceVersion": 1,
            "suite": "s3-provider-v1",
            "binaryVersion": env!("CARGO_PKG_VERSION"),
            "blobStoreUrlSha256": BLOB_DIGEST,
            "graphUrlSha256": null
        });
        let (_dir, path) = log_file(&format!(
            "running 1 test\ntest real_s3_provider_contract ... {EVIDENCE_PREFIX}{evidence}\nok\n\ntest result: ok. 1 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out\n"
        ));
        verify_suite_log(
            &path,
            "real_s3_provider_contract",
            ExpectedEvidence {
                suite: "s3-provider-v1",
                blob_store_url_sha256: BLOB_DIGEST,
                graph_url_sha256: None,
            },
        )
        .expect("passing bound log is evidence");
    }

    #[test]
    fn missing_failed_or_ignored_contract_runs_are_refused() {
        let (_dir, absent) = log_file("running 0 tests\n\ntest result: ok. 0 passed; 0 failed\n");
        let expected = || ExpectedEvidence {
            suite: "s3-provider-v1",
            blob_store_url_sha256: BLOB_DIGEST,
            graph_url_sha256: None,
        };
        verify_suite_log(&absent, "real_s3_provider_contract", expected())
            .expect_err("a log without the contract test is not evidence");

        let (_dir, ignored) = log_file(
            "running 1 test\ntest real_s3_provider_contract ... ignored\n\ntest result: ok. 0 passed; 0 failed; 1 ignored\n",
        );
        verify_suite_log(&ignored, "real_s3_provider_contract", expected())
            .expect_err("an ignored contract test is not evidence");

        let (_dir, failed) = log_file(
            "running 1 test\ntest real_s3_provider_contract ... ok\ntest other ... FAILED\n\ntest result: FAILED. 1 passed; 1 failed\n",
        );
        verify_suite_log(&failed, "real_s3_provider_contract", expected())
            .expect_err("a failing suite is not evidence");
    }

    #[test]
    fn passing_text_with_wrong_or_missing_provider_evidence_is_refused() {
        let harness =
            "test real_graph_delivery_contract ... ok\n\ntest result: ok. 1 passed; 0 failed\n";
        let (_dir, missing) = log_file(harness);
        let expected = || ExpectedEvidence {
            suite: "graph-delivery-v1",
            blob_store_url_sha256: BLOB_DIGEST,
            graph_url_sha256: Some(GRAPH_DIGEST),
        };
        verify_suite_log(&missing, "real_graph_delivery_contract", expected())
            .expect_err("plain passing text is not provider-bound evidence");

        let evidence = serde_json::json!({
            "evidenceVersion": 1,
            "suite": "graph-delivery-v1",
            "binaryVersion": env!("CARGO_PKG_VERSION"),
            "blobStoreUrlSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            "graphUrlSha256": GRAPH_DIGEST
        });
        let (_dir, wrong) = log_file(&format!("{EVIDENCE_PREFIX}{evidence}\n{harness}"));
        verify_suite_log(&wrong, "real_graph_delivery_contract", expected())
            .expect_err("evidence from a different blob provider is not reusable");
    }
}
