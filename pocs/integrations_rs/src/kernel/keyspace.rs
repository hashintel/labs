//! Kernel-owned S3 key derivation.
//!
//! Every durable key is derived here from one validated [`Namespace`]:
//! the control plane under `{namespace}/control/v1/...`, content-addressed
//! artifact prefixes under `{namespace}/artifacts/{kind}/sha256/...`, and
//! per-integration roots under `{namespace}/integrations/{digest}`. Call
//! sites must not format keys ad hoc — a writer and its validator drifting
//! apart on layout is exactly the bug this type exists to prevent.
//!
//! Protocol V1 instantiates the namespace as `tenants/{tenant}`; the layout
//! under it is frozen.

use std::fmt;

use crate::orchestrator::ids::{RequestId, RunId, TenantNamespace};
use crate::orchestrator::routing::{shard_path, IntegrationPath, Shard};

pub const MAX_NAMESPACE_BYTES: usize = 256;

/// Validated root prefix for one kernel instance. Segments obey the same
/// character rules as [`TenantNamespace`]; `/` separates segments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Namespace(String);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvalidNamespace {
    Empty,
    TooLong { actual_bytes: usize },
    UnsafeSegment,
}

impl fmt::Display for InvalidNamespace {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => formatter.write_str("namespace must not be empty"),
            Self::TooLong { actual_bytes } => write!(
                formatter,
                "namespace is {actual_bytes} bytes; maximum is {MAX_NAMESPACE_BYTES}"
            ),
            Self::UnsafeSegment => {
                formatter.write_str("namespace segments must be non-empty, not dot navigation, and use tenant-safe characters")
            }
        }
    }
}

impl std::error::Error for InvalidNamespace {}

fn valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && !matches!(segment, "." | "..")
        && segment.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'@' | b':')
        })
}

impl Namespace {
    pub fn parse(value: impl Into<String>) -> Result<Self, InvalidNamespace> {
        let value = value.into();
        if value.is_empty() {
            return Err(InvalidNamespace::Empty);
        }
        if value.len() > MAX_NAMESPACE_BYTES {
            return Err(InvalidNamespace::TooLong {
                actual_bytes: value.len(),
            });
        }
        if !value.split('/').all(valid_segment) {
            return Err(InvalidNamespace::UnsafeSegment);
        }
        Ok(Self(value))
    }

    /// The protocol-V1 namespace: `tenants/{tenant}`.
    pub fn for_tenant(tenant: &TenantNamespace) -> Self {
        Self(format!("tenants/{tenant}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Namespace {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Derives every durable key under one namespace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Keyspace {
    namespace: Namespace,
}

impl Keyspace {
    pub fn new(namespace: Namespace) -> Self {
        Self { namespace }
    }

    pub fn for_tenant(tenant: &TenantNamespace) -> Self {
        Self::new(Namespace::for_tenant(tenant))
    }

    pub fn namespace(&self) -> &Namespace {
        &self.namespace
    }

    // Control plane. The kernel owns everything under this root; domains
    // must not mint keys here.

    pub fn control_root(&self) -> String {
        format!("{}/control/v1", self.namespace)
    }

    pub fn baseline(&self) -> String {
        format!("{}/baseline.json", self.control_root())
    }

    pub fn known_shards(&self) -> String {
        format!("{}/known-shards", self.control_root())
    }

    pub fn known_shard(&self, shard: Shard) -> String {
        format!("{}/{}.json", self.known_shards(), shard_path(shard))
    }

    pub fn ready(&self) -> String {
        format!("{}/ready", self.control_root())
    }

    pub fn ready_shard(&self, shard: Shard) -> String {
        format!("{}/{}", self.ready(), shard_path(shard))
    }

    pub fn ready_receipt(&self, shard: Shard, run_id: &RunId) -> String {
        format!("{}/{}.json", self.ready_shard(shard), run_id)
    }

    pub fn admission(&self, integration: &IntegrationPath) -> String {
        format!("{}/admissions/{integration}.json", self.control_root())
    }

    pub fn run_locator(&self, run_id: &RunId) -> String {
        format!("{}/run-locators/{run_id}.json", self.control_root())
    }

    pub fn requests(&self, shard: Shard) -> String {
        format!("{}/requests/{}", self.control_root(), shard_path(shard))
    }

    pub fn request(&self, shard: Shard, request_id: &RequestId) -> String {
        format!("{}/{}.json", self.requests(shard), request_id)
    }

    pub fn request_results(&self, shard: Shard) -> String {
        format!(
            "{}/request-results/{}",
            self.control_root(),
            shard_path(shard)
        )
    }

    pub fn request_result(&self, shard: Shard, request_id: &RequestId) -> String {
        format!("{}/{}.json", self.request_results(shard), request_id)
    }

    pub fn lease(&self, shard: Shard) -> String {
        format!("{}/leases/{}.json", self.control_root(), shard_path(shard))
    }

    pub fn shard_root(&self, shard: Shard) -> String {
        format!("{}/shards/{}", self.control_root(), shard_path(shard))
    }

    pub fn shard_log(&self, shard: Shard) -> String {
        format!("{}/log", self.shard_root(shard))
    }

    pub fn shard_projection(&self, shard: Shard) -> String {
        format!("{}/projection", self.shard_root(shard))
    }

    // Content-addressed artifacts. `publish_record` appends
    // `/sha256/{digest[..2]}/{digest}{ext}` under these prefixes;
    // `artifact_digest_prefix` is the matching validation boundary.

    pub fn artifact_prefix(&self, kind: &str) -> Result<String, InvalidNamespace> {
        if !valid_segment(kind) {
            return Err(InvalidNamespace::UnsafeSegment);
        }
        Ok(format!("{}/artifacts/{kind}", self.namespace))
    }

    pub fn artifact_digest_prefix(&self, kind: &str) -> Result<String, InvalidNamespace> {
        Ok(format!("{}/sha256/", self.artifact_prefix(kind)?))
    }

    pub fn run_inputs(&self) -> String {
        format!("{}/artifacts/run-inputs", self.namespace)
    }

    pub fn run_inputs_digest_prefix(&self) -> String {
        format!("{}/sha256/", self.run_inputs())
    }

    pub fn run_policies(&self) -> String {
        format!("{}/artifacts/run-policies", self.namespace)
    }

    pub fn run_policies_digest_prefix(&self) -> String {
        format!("{}/sha256/", self.run_policies())
    }

    // Per-integration namespace root (state versions, run manifests,
    // desired/effect artifacts, engine data live under it).

    pub fn integration_root(&self, integration: &IntegrationPath) -> String {
        format!("{}/integrations/{integration}", self.namespace)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestrator::ids::CanonicalIntegrationId;
    use crate::orchestrator::routing::integration_path;

    fn keyspace() -> Keyspace {
        Keyspace::for_tenant(&TenantNamespace::parse("alice").expect("valid tenant"))
    }

    #[test]
    fn namespace_segments_are_validated() {
        assert!(Namespace::parse("tenants/alice").is_ok());
        assert!(Namespace::parse("flat-domain").is_ok());
        assert_eq!(Namespace::parse(""), Err(InvalidNamespace::Empty));
        for invalid in [
            "tenants//alice",
            "a/../b",
            "a/",
            "/a",
            "sp ace",
            "back\\slash",
        ] {
            assert_eq!(
                Namespace::parse(invalid),
                Err(InvalidNamespace::UnsafeSegment),
                "{invalid:?}"
            );
        }
        assert!(matches!(
            Namespace::parse("x".repeat(MAX_NAMESPACE_BYTES + 1)),
            Err(InvalidNamespace::TooLong { .. })
        ));
    }

    #[test]
    fn control_keys_match_the_frozen_v1_layout() {
        let keyspace = keyspace();
        let shard = Shard::try_from(15).expect("valid shard");
        assert_eq!(keyspace.control_root(), "tenants/alice/control/v1");
        assert_eq!(
            keyspace.baseline(),
            "tenants/alice/control/v1/baseline.json"
        );
        assert_eq!(
            keyspace.known_shard(shard),
            "tenants/alice/control/v1/known-shards/00f.json"
        );
        let run_id = RunId::parse("00000000-0000-4000-8000-000000000001").expect("valid run ID");
        assert_eq!(
            keyspace.ready_receipt(shard, &run_id),
            format!("tenants/alice/control/v1/ready/00f/{run_id}.json")
        );
        assert_eq!(
            keyspace.run_locator(&run_id),
            format!("tenants/alice/control/v1/run-locators/{run_id}.json")
        );
        let request_id = RequestId::parse("a".repeat(64)).expect("valid request ID");
        assert_eq!(
            keyspace.request(shard, &request_id),
            format!("tenants/alice/control/v1/requests/00f/{request_id}.json")
        );
        assert_eq!(
            keyspace.request_result(shard, &request_id),
            format!("tenants/alice/control/v1/request-results/00f/{request_id}.json")
        );
        assert_eq!(
            keyspace.lease(shard),
            "tenants/alice/control/v1/leases/00f.json"
        );
        assert_eq!(
            keyspace.shard_log(shard),
            "tenants/alice/control/v1/shards/00f/log"
        );
        assert_eq!(
            keyspace.shard_projection(shard),
            "tenants/alice/control/v1/shards/00f/projection"
        );
    }

    #[test]
    fn artifact_and_integration_keys_match_the_frozen_v1_layout() {
        let keyspace = keyspace();
        assert_eq!(keyspace.run_inputs(), "tenants/alice/artifacts/run-inputs");
        assert_eq!(
            keyspace.run_inputs_digest_prefix(),
            "tenants/alice/artifacts/run-inputs/sha256/"
        );
        assert_eq!(
            keyspace.run_policies(),
            "tenants/alice/artifacts/run-policies"
        );
        assert_eq!(
            keyspace.artifact_prefix("run-inputs").expect("valid kind"),
            keyspace.run_inputs()
        );
        assert!(keyspace.artifact_prefix("no/slash").is_err());
        let id = CanonicalIntegrationId::parse("alice:sap").expect("valid integration ID");
        let integration = integration_path(&id);
        assert_eq!(
            keyspace.integration_root(&integration),
            format!("tenants/alice/integrations/{integration}")
        );
    }
}
