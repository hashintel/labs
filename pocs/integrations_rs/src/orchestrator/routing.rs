//! Stable routing for durable-protocol version 1.

use std::fmt;

use sha2::{Digest, Sha256};

use super::ids::{CanonicalIntegrationId, RequestId, RunId, TenantNamespace};

pub const ROUTING_VERSION: u32 = 1;
pub const SHARD_COUNT: u16 = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Shard(u8);

impl Shard {
    pub fn get(self) -> u8 {
        self.0
    }
}

impl TryFrom<u16> for Shard {
    type Error = InvalidShard;

    fn try_from(value: u16) -> Result<Self, Self::Error> {
        match u8::try_from(value) {
            Ok(value) => Ok(Self(value)),
            Err(_out_of_range) => Err(InvalidShard { value }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidShard {
    pub value: u16,
}

impl fmt::Display for InvalidShard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "shard {} is outside routing-v1 range 0..{}",
            self.value, SHARD_COUNT
        )
    }
}

impl std::error::Error for InvalidShard {}

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
    let shard = Shard((routing_value % u64::from(SHARD_COUNT)) as u8);
    Route {
        routing_value,
        shard,
        integration_path: IntegrationPath(digest),
    }
}

pub fn shard(id: &CanonicalIntegrationId) -> Shard {
    route(id).shard
}

pub fn shard_path(shard: Shard) -> String {
    format!("{:03x}", shard.get())
}

pub fn integration_path(id: &CanonicalIntegrationId) -> IntegrationPath {
    route(id).integration_path
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlPaths {
    tenant: TenantNamespace,
}

impl ControlPaths {
    pub fn new(tenant: TenantNamespace) -> Self {
        Self { tenant }
    }

    pub fn root(&self) -> String {
        format!("tenants/{}/control/v1", self.tenant)
    }

    pub fn baseline(&self) -> String {
        format!("{}/baseline.json", self.root())
    }

    pub fn known_shards(&self) -> String {
        format!("{}/known-shards", self.root())
    }

    pub fn known_shard(&self, shard: Shard) -> String {
        format!("{}/{}.json", self.known_shards(), shard_path(shard))
    }

    pub fn ready(&self) -> String {
        format!("{}/ready", self.root())
    }

    pub fn ready_shard(&self, shard: Shard) -> String {
        format!("{}/{}", self.ready(), shard_path(shard))
    }

    pub fn ready_receipt(&self, shard: Shard, run_id: &RunId) -> String {
        format!("{}/{}.json", self.ready_shard(shard), run_id)
    }

    pub fn admission(&self, integration: &IntegrationPath) -> String {
        format!("{}/admissions/{integration}.json", self.root())
    }

    pub fn run_locator(&self, run_id: &RunId) -> String {
        format!("{}/run-locators/{run_id}.json", self.root())
    }

    pub fn requests(&self, shard: Shard) -> String {
        format!("{}/requests/{}", self.root(), shard_path(shard))
    }

    pub fn request(&self, shard: Shard, request_id: &RequestId) -> String {
        format!("{}/{}.json", self.requests(shard), request_id)
    }

    pub fn request_results(&self, shard: Shard) -> String {
        format!("{}/request-results/{}", self.root(), shard_path(shard))
    }

    pub fn request_result(&self, shard: Shard, request_id: &RequestId) -> String {
        format!("{}/{}.json", self.request_results(shard), request_id)
    }

    pub fn lease(&self, shard: Shard) -> String {
        format!("{}/leases/{}.json", self.root(), shard_path(shard))
    }

    pub fn shard_root(&self, shard: Shard) -> String {
        format!("{}/shards/{}", self.root(), shard_path(shard))
    }

    pub fn shard_log(&self, shard: Shard) -> String {
        format!("{}/log", self.shard_root(shard))
    }

    pub fn shard_projection(&self, shard: Shard) -> String {
        format!("{}/projection", self.shard_root(shard))
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

    #[test]
    fn control_paths_are_tenant_first_and_shard_canonical() {
        let tenant = TenantNamespace::parse("alice").expect("valid tenant");
        let paths = ControlPaths::new(tenant);
        let shard = Shard::try_from(15).expect("valid shard");
        let id = CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration ID");
        let integration = integration_path(&id);

        assert_eq!(paths.baseline(), "tenants/alice/control/v1/baseline.json");
        assert_eq!(
            paths.known_shard(shard),
            "tenants/alice/control/v1/known-shards/00f.json"
        );
        assert_eq!(
            paths.admission(&integration),
            format!("tenants/alice/control/v1/admissions/{integration}.json")
        );
        let run_id = RunId::parse("00000000-0000-4000-8000-000000000001").expect("valid run ID");
        assert_eq!(
            paths.run_locator(&run_id),
            format!("tenants/alice/control/v1/run-locators/{run_id}.json")
        );
        assert_eq!(
            paths.shard_log(shard),
            "tenants/alice/control/v1/shards/00f/log"
        );
    }
}
