//! Stable routing for durable-protocol version 1.

use std::fmt;

use sha2::{Digest, Sha256};

use super::ids::CanonicalIntegrationId;

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

// Key derivation lives in the kernel keyspace; re-exported for the
// orchestrator's `routing::` import paths.
pub use crate::kernel::keyspace::Keyspace;

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
