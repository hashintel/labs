//! Kernel-owned S3 key derivation.
//!
//! Every durable key is derived here from one validated [`Namespace`]:
//! the control layer under `{namespace}/control/v1/...` and content-addressed
//! artifact prefixes under `{namespace}/artifacts/{kind}/sha256/...`. Call
//! sites must not format keys ad hoc. This type exists to prevent a writer
//! and its validator from disagreeing on layout.
//!
//! The layout under a namespace is frozen. A consuming domain derives its
//! own record-typed keys on top of these methods and does not define
//! parallel layouts.

use std::fmt;

use crate::routing::{shard_path, Shard};

pub const MAX_NAMESPACE_BYTES: usize = 256;

/// Validated root prefix for one kernel instance. Segments use tenant-safe
/// characters; `/` separates segments.
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

    pub fn namespace(&self) -> &Namespace {
        &self.namespace
    }

    // Control layer. The kernel owns everything under this root; domains
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

    pub fn requests(&self, shard: Shard) -> String {
        format!("{}/requests/{}", self.control_root(), shard_path(shard))
    }

    pub fn request_results(&self, shard: Shard) -> String {
        format!(
            "{}/request-results/{}",
            self.control_root(),
            shard_path(shard)
        )
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

    // Content-addressed artifacts. Publishers append
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keyspace() -> Keyspace {
        Keyspace::new(Namespace::parse("tenants/alice").expect("namespace should be valid"))
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
        assert!(
            Namespace::parse("x".repeat(MAX_NAMESPACE_BYTES)).is_ok(),
            "a namespace of exactly {MAX_NAMESPACE_BYTES} bytes should parse"
        );
        assert!(matches!(
            Namespace::parse("x".repeat(MAX_NAMESPACE_BYTES + 1)),
            Err(InvalidNamespace::TooLong { .. })
        ));
    }

    #[test]
    fn control_keys_match_the_frozen_layout() {
        let keyspace = keyspace();
        let shard = Shard::try_from(15).expect("shard should be valid");
        assert_eq!(keyspace.control_root(), "tenants/alice/control/v1");
        assert_eq!(
            keyspace.baseline(),
            "tenants/alice/control/v1/baseline.json"
        );
        assert_eq!(
            keyspace.known_shard(shard),
            "tenants/alice/control/v1/known-shards/00f.json"
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
        assert_eq!(keyspace.ready(), "tenants/alice/control/v1/ready");
        assert_eq!(
            keyspace.ready_shard(shard),
            "tenants/alice/control/v1/ready/00f"
        );
        assert_eq!(
            keyspace.requests(shard),
            "tenants/alice/control/v1/requests/00f"
        );
        assert_eq!(
            keyspace.request_results(shard),
            "tenants/alice/control/v1/request-results/00f"
        );
    }

    #[test]
    fn artifact_keys_match_the_frozen_layout() {
        let keyspace = keyspace();
        assert_eq!(
            keyspace
                .artifact_prefix("run-inputs")
                .expect("kind should be valid"),
            "tenants/alice/artifacts/run-inputs"
        );
        assert_eq!(
            keyspace
                .artifact_digest_prefix("run-inputs")
                .expect("kind should be valid"),
            "tenants/alice/artifacts/run-inputs/sha256/"
        );
        assert!(keyspace.artifact_prefix("no/slash").is_err());
    }
}
