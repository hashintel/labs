//! Validated identities used by the clean durable protocol.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest as _, Sha256};
use uuid::Uuid;

pub const MAX_CANONICAL_INTEGRATION_ID_BYTES: usize = 1024;
pub const MAX_TENANT_NAMESPACE_BYTES: usize = 128;

const SHA256_HEX_BYTES: usize = 64;

macro_rules! uuid_id {
    ($name:ident, $label:literal) => {
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(String);

        impl $name {
            pub fn generate() -> Self {
                Self(Uuid::new_v4().to_string())
            }

            pub fn parse(value: impl Into<String>) -> Result<Self, InvalidId> {
                let value = value.into();
                let parsed = Uuid::parse_str(&value)
                    .map_err(|_| InvalidId::new($label, "must be a UUID"))?;
                let canonical = parsed.hyphenated().to_string();
                if value != canonical {
                    return Err(InvalidId::new(
                        $label,
                        "must use canonical lowercase hyphenated UUID encoding",
                    ));
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }

        impl Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_str(self.as_str())
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                Self::parse(value).map_err(serde::de::Error::custom)
            }
        }
    };
}

macro_rules! digest_id {
    ($name:ident, $label:literal) => {
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(String);

        impl $name {
            pub fn parse(value: impl Into<String>) -> Result<Self, InvalidId> {
                let value = value.into();
                if value.len() != SHA256_HEX_BYTES
                    || !value
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                {
                    return Err(InvalidId::new(
                        $label,
                        "must be exactly 64 lowercase hexadecimal SHA-256 characters",
                    ));
                }
                Ok(Self(value))
            }

            #[allow(
                dead_code,
                reason = "some identity families are introduced before their owning record PR"
            )]
            pub(crate) fn from_digest(digest: String) -> Self {
                debug_assert_eq!(digest.len(), SHA256_HEX_BYTES);
                Self(digest)
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }

        impl Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_str(self.as_str())
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                Self::parse(value).map_err(serde::de::Error::custom)
            }
        }
    };
}

uuid_id!(RunId, "run ID");
digest_id!(AttemptId, "attempt ID");
digest_id!(StateVersionId, "state-version ID");
digest_id!(WorkId, "work ID");
digest_id!(EventId, "event ID");
digest_id!(RequestId, "request ID");
digest_id!(RequestDigest, "request digest");
digest_id!(DlqEntryId, "DLQ-entry ID");
digest_id!(EffectId, "effect ID");
digest_id!(JournalRecordDigest, "journal-record digest");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidId {
    kind: &'static str,
    reason: &'static str,
}

impl InvalidId {
    const fn new(kind: &'static str, reason: &'static str) -> Self {
        Self { kind, reason }
    }
}

impl fmt::Display for InvalidId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} {}", self.kind, self.reason)
    }
}

impl std::error::Error for InvalidId {}

pub(crate) fn canonical_digest<T: Serialize>(
    domain: &str,
    projection: &T,
) -> Result<String, serde_json::Error> {
    let mut digest = Sha256::new();
    digest.update(domain.as_bytes());
    digest.update([0]);
    digest.update(serde_json::to_vec(projection)?);
    Ok(hex::encode(digest.finalize()))
}

pub fn derive_attempt_id(run_id: &RunId, attempt: u64) -> AttemptId {
    #[derive(Serialize)]
    struct AttemptIdentity<'a> {
        run_id: &'a RunId,
        attempt: u64,
    }

    let digest = canonical_digest("attempt:v1", &AttemptIdentity { run_id, attempt })
        .expect("serializing a typed attempt identity cannot fail");
    AttemptId::from_digest(digest)
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TenantNamespace(String);

impl TenantNamespace {
    pub fn parse(value: impl Into<String>) -> Result<Self, InvalidTenantNamespace> {
        let value = value.into();
        if value.is_empty() {
            return Err(InvalidTenantNamespace::Empty);
        }
        if value.len() > MAX_TENANT_NAMESPACE_BYTES {
            return Err(InvalidTenantNamespace::TooLong {
                actual_bytes: value.len(),
                max_bytes: MAX_TENANT_NAMESPACE_BYTES,
            });
        }
        if matches!(value.as_str(), "." | "..")
            || !value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'@' | b':')
            })
        {
            return Err(InvalidTenantNamespace::UnsafeCharacter);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for TenantNamespace {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl Serialize for TenantNamespace {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for TenantNamespace {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvalidTenantNamespace {
    Empty,
    UnsafeCharacter,
    TooLong {
        actual_bytes: usize,
        max_bytes: usize,
    },
}

impl fmt::Display for InvalidTenantNamespace {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => formatter.write_str("tenant namespace must not be empty"),
            Self::UnsafeCharacter => {
                formatter.write_str("tenant namespace must be one safe ASCII object-path component")
            }
            Self::TooLong {
                actual_bytes,
                max_bytes,
            } => write!(
                formatter,
                "tenant namespace is {actual_bytes} bytes; maximum is {max_bytes}"
            ),
        }
    }
}

impl std::error::Error for InvalidTenantNamespace {}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CanonicalIntegrationId(String);

impl CanonicalIntegrationId {
    pub fn parse(value: impl Into<String>) -> Result<Self, InvalidCanonicalIntegrationId> {
        let value = value.into();
        if value.is_empty() {
            return Err(InvalidCanonicalIntegrationId::Empty);
        }
        if value.len() > MAX_CANONICAL_INTEGRATION_ID_BYTES {
            return Err(InvalidCanonicalIntegrationId::TooLong {
                actual_bytes: value.len(),
                max_bytes: MAX_CANONICAL_INTEGRATION_ID_BYTES,
            });
        }
        if value.chars().any(char::is_whitespace) {
            return Err(InvalidCanonicalIntegrationId::ContainsWhitespace);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl AsRef<str> for CanonicalIntegrationId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for CanonicalIntegrationId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl Serialize for CanonicalIntegrationId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for CanonicalIntegrationId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(value).map_err(serde::de::Error::custom)
    }
}

impl TryFrom<String> for CanonicalIntegrationId {
    type Error = InvalidCanonicalIntegrationId;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(value)
    }
}

impl TryFrom<&str> for CanonicalIntegrationId {
    type Error = InvalidCanonicalIntegrationId;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::parse(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvalidCanonicalIntegrationId {
    Empty,
    ContainsWhitespace,
    TooLong {
        actual_bytes: usize,
        max_bytes: usize,
    },
}

impl fmt::Display for InvalidCanonicalIntegrationId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => formatter.write_str("canonical integration ID must not be empty"),
            Self::ContainsWhitespace => {
                formatter.write_str("canonical integration ID must not contain whitespace")
            }
            Self::TooLong {
                actual_bytes,
                max_bytes,
            } => write!(
                formatter,
                "canonical integration ID is {actual_bytes} bytes; maximum is {max_bytes}"
            ),
        }
    }
}

impl std::error::Error for InvalidCanonicalIntegrationId {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_bytes_without_normalizing_unicode() {
        let composed =
            CanonicalIntegrationId::parse("web:caf\u{e9}").expect("composed ID is valid");
        let decomposed =
            CanonicalIntegrationId::parse("web:cafe\u{301}").expect("decomposed ID is valid");
        assert_ne!(composed, decomposed);

        assert_eq!(
            CanonicalIntegrationId::parse(""),
            Err(InvalidCanonicalIntegrationId::Empty)
        );
        for value in [" web:id", "web:id ", "web:\tid", "web:\nid", "web:\u{a0}id"] {
            assert_eq!(
                CanonicalIntegrationId::parse(value),
                Err(InvalidCanonicalIntegrationId::ContainsWhitespace),
                "value {value:?}"
            );
        }
    }

    #[test]
    fn maximum_is_measured_in_utf8_bytes() {
        assert!(CanonicalIntegrationId::parse("x".repeat(1024)).is_ok());
        assert!(matches!(
            CanonicalIntegrationId::parse("\u{e9}".repeat(513)),
            Err(InvalidCanonicalIntegrationId::TooLong {
                actual_bytes: 1026,
                max_bytes: 1024,
            })
        ));
    }

    #[test]
    fn tenant_namespace_is_one_bounded_ascii_component() {
        for valid in ["alice", "web-123", "org@example:prod"] {
            assert!(TenantNamespace::parse(valid).is_ok(), "value {valid:?}");
        }
        for invalid in ["", ".", "..", "../alice", "alice/web", "white space", "wéb"] {
            assert!(
                TenantNamespace::parse(invalid).is_err(),
                "value {invalid:?}"
            );
        }
        assert!(TenantNamespace::parse("x".repeat(MAX_TENANT_NAMESPACE_BYTES)).is_ok());
        assert!(matches!(
            TenantNamespace::parse("x".repeat(MAX_TENANT_NAMESPACE_BYTES + 1)),
            Err(InvalidTenantNamespace::TooLong { .. })
        ));
    }

    #[test]
    fn protocol_ids_reject_noncanonical_wire_values() {
        assert!(RunId::parse("550E8400-E29B-41D4-A716-446655440000").is_err());
        assert!(StateVersionId::parse("A".repeat(64)).is_err());
        assert!(StateVersionId::parse("a".repeat(63)).is_err());
        assert!(serde_json::from_str::<EventId>(r#""not-a-digest""#).is_err());
    }

    #[test]
    fn attempt_identity_is_stable_and_attempt_sensitive() {
        let run =
            RunId::parse("00000000-0000-4000-8000-000000000001").expect("valid canonical UUID");
        assert_eq!(derive_attempt_id(&run, 1), derive_attempt_id(&run, 1));
        assert_ne!(derive_attempt_id(&run, 1), derive_attempt_id(&run, 2));
    }
}
