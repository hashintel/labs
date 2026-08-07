//! Stable routing for durable-protocol version 1.

use std::fmt;

use sha2::{Digest, Sha256};

use super::ids::CanonicalIntegrationId;

pub const ROUTING_VERSION: u32 = 1;

// Shard identity is kernel-owned; this module owns the placement of
// integrations onto shards.
pub use durable_kernel::routing::{shard_path, InvalidShard, Shard, SHARD_COUNT};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct IntegrationPath([u8; 32]);

impl IntegrationPath {
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

impl fmt::Display for IntegrationPath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.to_hex())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    pub routing_value: u64,
    pub shard: Shard,
    pub integration_path: IntegrationPath,
}

pub fn route(id: &CanonicalIntegrationId) -> Route {
    let digest: [u8; 32] = Sha256::digest(id.as_str().as_bytes()).into();
    let routing_value = u64::from_be_bytes(
        digest[..8]
            .try_into()
            .expect("a SHA-256 digest always contains eight prefix bytes"),
    );
    let shard = Shard::from_u8((routing_value % u64::from(SHARD_COUNT)) as u8);
    Route {
        routing_value,
        shard,
        integration_path: IntegrationPath(digest),
    }
}

pub fn shard(id: &CanonicalIntegrationId) -> Shard {
    route(id).shard
}

pub fn integration_path(id: &CanonicalIntegrationId) -> IntegrationPath {
    route(id).integration_path
}

// Key derivation lives in the kernel keyspace; re-exported for the
// orchestrator's `routing::` import paths.
pub use crate::kernel::keyspace::Keyspace;

/// V1's identifier-typed key derivations on top of the kernel [`Keyspace`]:
/// the `tenants/{tenant}` namespace and every control or artifact key that
/// embeds a V1 identifier. The layout is frozen; the kernel keyspace owns
/// the shard, lease, and log roots these compose with.
pub trait TenantKeyspace: Sized {
    fn for_tenant(tenant: &super::ids::TenantNamespace) -> Self;
    fn ready_receipt(&self, shard: Shard, run_id: &super::ids::RunId) -> String;
    fn admission(&self, integration: &IntegrationPath) -> String;
    fn run_locator(&self, run_id: &super::ids::RunId) -> String;
    fn request(&self, shard: Shard, request_id: &super::ids::RequestId) -> String;
    fn request_result(&self, shard: Shard, request_id: &super::ids::RequestId) -> String;
    fn integration_root(&self, integration: &IntegrationPath) -> String;
    fn run_inputs(&self) -> String;
    fn run_inputs_digest_prefix(&self) -> String;
    fn run_policies(&self) -> String;
    fn run_policies_digest_prefix(&self) -> String;
}

impl TenantKeyspace for Keyspace {
    fn for_tenant(tenant: &super::ids::TenantNamespace) -> Self {
        let namespace = crate::kernel::keyspace::Namespace::parse(format!("tenants/{tenant}"))
            .expect("a validated tenant namespace is a valid keyspace namespace");
        Self::new(namespace)
    }

    fn ready_receipt(&self, shard: Shard, run_id: &super::ids::RunId) -> String {
        format!("{}/{}.json", self.ready_shard(shard), run_id)
    }

    fn admission(&self, integration: &IntegrationPath) -> String {
        format!("{}/admissions/{integration}.json", self.control_root())
    }

    fn run_locator(&self, run_id: &super::ids::RunId) -> String {
        format!("{}/run-locators/{run_id}.json", self.control_root())
    }

    fn request(&self, shard: Shard, request_id: &super::ids::RequestId) -> String {
        format!("{}/{}.json", self.requests(shard), request_id)
    }

    fn request_result(&self, shard: Shard, request_id: &super::ids::RequestId) -> String {
        format!("{}/{}.json", self.request_results(shard), request_id)
    }

    fn integration_root(&self, integration: &IntegrationPath) -> String {
        format!("{}/integrations/{integration}", self.namespace())
    }

    fn run_inputs(&self) -> String {
        format!("{}/artifacts/run-inputs", self.namespace())
    }

    fn run_inputs_digest_prefix(&self) -> String {
        format!("{}/sha256/", self.run_inputs())
    }

    fn run_policies(&self) -> String {
        format!("{}/artifacts/run-policies", self.namespace())
    }

    fn run_policies_digest_prefix(&self) -> String {
        format!("{}/sha256/", self.run_policies())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_range_is_closed_and_path_is_fixed_width() {
        assert_eq!(Shard::try_from(0).expect("minimum shard").get(), 0);
        assert_eq!(Shard::try_from(255).expect("maximum shard").get(), 255);
        assert_eq!(Shard::try_from(256), Err(InvalidShard { value: 256 }));
        assert_eq!(
            shard_path(Shard::try_from(0).expect("minimum shard")),
            "000"
        );
        assert_eq!(
            shard_path(Shard::try_from(255).expect("maximum shard")),
            "0ff"
        );
    }

    #[test]
    fn both_route_outputs_share_one_digest() {
        let id = CanonicalIntegrationId::parse("alice:supply-chain")
            .expect("fixture integration ID is valid");
        let routed = route(&id);
        assert_eq!(shard(&id), routed.shard);
        assert_eq!(integration_path(&id), routed.integration_path);
        assert_eq!(routed.integration_path.to_hex().len(), 64);
    }
}
