//! Conditional shard ownership leases.
//!
//! The lease decides which runner may attempt the SlateDB writer handshake. It
//! is not the journal fence: the storage writer epoch remains that boundary.

use std::fmt;
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use error_stack::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::record_io;
use super::registry::{
    reject_unknown_fields, CompatError, DurabilityClass, DurableRecord, MigrationPolicy,
    MutableCasRecord, RecordFamily, VersionedRecord,
};
use crate::blob::{ArtifactStore, CasVersion, CasWrite};

pub(crate) const MAX_SHARD_LEASE_BYTES: usize = 4 * 1024;
const MAX_OWNER_ID_BYTES: usize = 256;
const MAX_LEASE_TIMING: Duration = Duration::from_secs(24 * 60 * 60);

pub(crate) static SHARD_LEASE_FAMILY: RecordFamily = RecordFamily {
    name: "shard_lease",
    owning_module: "orchestrator::lease",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[],
    durability: DurabilityClass::MutableCas,
    migration: MigrationPolicy::MutableCas,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub(crate) enum ShardLease {
    V1(ShardLeaseV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ShardLeaseV1 {
    pub(crate) owner_id: String,
    pub(crate) lease_epoch: u64,
    pub(crate) acquired_at: String,
    pub(crate) expires_at: String,
}

impl ShardLease {
    pub(crate) fn current(&self) -> &ShardLeaseV1 {
        match self {
            Self::V1(value) => value,
        }
    }

    pub(crate) fn into_current(self) -> Result<ShardLeaseV1, InvalidLease> {
        validate_lease(self.current())?;
        let Self::V1(value) = self;
        Ok(value)
    }
}

impl super::registry::sealed::Sealed for ShardLease {}

impl DurableRecord for ShardLease {
    const FAMILY: &'static RecordFamily = &SHARD_LEASE_FAMILY;
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::MutableCas;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_lease(self.current()).map_err(compat_error)?;
        serde_json::to_vec(self).map_err(|error| CompatError::Malformed {
            family: Self::FAMILY.name,
            message: error.to_string(),
        })
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        if bytes.len() > MAX_SHARD_LEASE_BYTES {
            return Err(CompatError::Malformed {
                family: Self::FAMILY.name,
                message: format!(
                    "record is {} bytes; maximum is {MAX_SHARD_LEASE_BYTES}",
                    bytes.len()
                ),
            });
        }
        let value: Value =
            serde_json::from_slice(bytes).map_err(|error| CompatError::Malformed {
                family: Self::FAMILY.name,
                message: error.to_string(),
            })?;
        reject_unknown_fields(Self::FAMILY.name, "", &value, &["version", "data"])?;
        let version = value
            .get("version")
            .and_then(Value::as_str)
            .ok_or_else(|| CompatError::Malformed {
                family: Self::FAMILY.name,
                message: "version must be a string".to_owned(),
            })?;
        if version != "v1" {
            return Err(CompatError::UnsupportedVersion {
                family: Self::FAMILY.name,
                version: version.to_owned(),
            });
        }
        let data = value.get("data").ok_or_else(|| CompatError::Malformed {
            family: Self::FAMILY.name,
            message: "data is required".to_owned(),
        })?;
        reject_unknown_fields(
            Self::FAMILY.name,
            "data",
            data,
            &["owner_id", "lease_epoch", "acquired_at", "expires_at"],
        )?;
        let lease: Self =
            serde_json::from_value(value).map_err(|error| CompatError::Malformed {
                family: Self::FAMILY.name,
                message: error.to_string(),
            })?;
        validate_lease(lease.current()).map_err(compat_error)?;
        Ok(lease)
    }
}

impl VersionedRecord for ShardLease {
    type Current = ShardLeaseV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        self.into_current().map_err(compat_error)
    }
}

impl MutableCasRecord for ShardLease {
    fn from_current(current: Self::Current) -> Result<Self, CompatError> {
        validate_lease(&current).map_err(compat_error)?;
        Ok(Self::V1(current))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum InvalidLease {
    EmptyOwner,
    OwnerTooLarge { actual_bytes: usize },
    OwnerHasEdgeWhitespace,
    OwnerHasControlCharacter,
    ZeroEpoch,
    ZeroDuration,
    DurationOutOfRange,
    EpochOverflow,
    TimestampMalformed { field: &'static str },
    TimestampOrder,
    RenewalDoesNotExtend,
}

impl fmt::Display for InvalidLease {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyOwner => formatter.write_str("lease owner ID is empty"),
            Self::OwnerTooLarge { actual_bytes } => write!(
                formatter,
                "lease owner ID is {actual_bytes} bytes; maximum is {MAX_OWNER_ID_BYTES}"
            ),
            Self::OwnerHasEdgeWhitespace => {
                formatter.write_str("lease owner ID has leading or trailing whitespace")
            }
            Self::OwnerHasControlCharacter => {
                formatter.write_str("lease owner ID contains a control character")
            }
            Self::ZeroEpoch => formatter.write_str("lease epoch must be nonzero"),
            Self::ZeroDuration => formatter.write_str("lease duration must be nonzero"),
            Self::DurationOutOfRange => {
                formatter.write_str("lease duration cannot be represented safely")
            }
            Self::EpochOverflow => formatter.write_str("lease epoch overflowed"),
            Self::TimestampMalformed { field } => {
                write!(formatter, "lease {field} is not RFC 3339")
            }
            Self::TimestampOrder => {
                formatter.write_str("lease expiry must be later than acquisition")
            }
            Self::RenewalDoesNotExtend => {
                formatter.write_str("lease renewal must strictly extend the current expiry")
            }
        }
    }
}

impl std::error::Error for InvalidLease {}

fn validate_owner(owner_id: &str) -> Result<(), InvalidLease> {
    if owner_id.is_empty() {
        return Err(InvalidLease::EmptyOwner);
    }
    if owner_id.len() > MAX_OWNER_ID_BYTES {
        return Err(InvalidLease::OwnerTooLarge {
            actual_bytes: owner_id.len(),
        });
    }
    if owner_id.trim() != owner_id {
        return Err(InvalidLease::OwnerHasEdgeWhitespace);
    }
    if owner_id.chars().any(char::is_control) {
        return Err(InvalidLease::OwnerHasControlCharacter);
    }
    Ok(())
}

fn parse_timestamp(
    field: &'static str,
    value: &str,
) -> Result<DateTime<chrono::FixedOffset>, InvalidLease> {
    DateTime::parse_from_rfc3339(value).map_err(|_error| InvalidLease::TimestampMalformed { field })
}

fn validate_lease(lease: &ShardLeaseV1) -> Result<(), InvalidLease> {
    validate_owner(&lease.owner_id)?;
    if lease.lease_epoch == 0 {
        return Err(InvalidLease::ZeroEpoch);
    }
    let acquired_at = parse_timestamp("acquired_at", &lease.acquired_at)?;
    let expires_at = parse_timestamp("expires_at", &lease.expires_at)?;
    if expires_at <= acquired_at {
        return Err(InvalidLease::TimestampOrder);
    }
    Ok(())
}

fn compat_error(error: InvalidLease) -> CompatError {
    CompatError::Malformed {
        family: ShardLease::FAMILY.name,
        message: error.to_string(),
    }
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn new_lease(
    owner_id: &str,
    lease_epoch: u64,
    acquired_at: DateTime<Utc>,
    duration: Duration,
) -> Result<ShardLease, InvalidLease> {
    validate_owner(owner_id)?;
    if lease_epoch == 0 {
        return Err(InvalidLease::ZeroEpoch);
    }
    if duration.is_zero() {
        return Err(InvalidLease::ZeroDuration);
    }
    let duration =
        chrono::Duration::from_std(duration).map_err(|_error| InvalidLease::DurationOutOfRange)?;
    let expires_at = acquired_at
        .checked_add_signed(duration)
        .ok_or(InvalidLease::DurationOutOfRange)?;
    let lease = ShardLease::V1(ShardLeaseV1 {
        owner_id: owner_id.to_owned(),
        lease_epoch,
        acquired_at: timestamp(acquired_at),
        expires_at: timestamp(expires_at),
    });
    validate_lease(lease.current())?;
    Ok(lease)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum AcquirePlan {
    Create(ShardLease),
    Replace {
        observed_version: CasVersion,
        next: ShardLease,
    },
    Contended(ShardLeaseV1),
}

fn plan_acquisition(
    owner_id: &str,
    now: DateTime<Utc>,
    duration: Duration,
    takeover_grace: Duration,
    observed: Option<(ShardLease, CasVersion)>,
) -> Result<AcquirePlan, InvalidLease> {
    validate_owner(owner_id)?;
    let Some((observed, observed_version)) = observed else {
        return new_lease(owner_id, 1, now, duration).map(AcquirePlan::Create);
    };
    let current = observed.into_current()?;
    let expires_at = parse_timestamp("expires_at", &current.expires_at)?;
    let next_epoch = current
        .lease_epoch
        .checked_add(1)
        .ok_or(InvalidLease::EpochOverflow)?;
    // Contention applies only to a foreign owner. The lease's own holder
    // reacquires immediately after a self-inflicted stop (ambiguous append,
    // renewal wobble): the epoch still advances and the full handshake still
    // runs, fencing its own stale writer exactly like a foreign one. Runner
    // IDs are unique per process by deployment contract; duplicated IDs make
    // two runners fence each other's epochs, a loud misconfiguration, never
    // silent shared ownership. A foreign competitor additionally honors the
    // declared clock-skew envelope: the observed expiry was minted on the
    // owner clock, so replacement waits until the lease is expired even on a
    // clock running behind by the whole envelope. The grace is bounded by
    // MAX_LEASE_TIMING at configuration time, so the chrono conversion
    // cannot fail.
    let grace = chrono::Duration::from_std(takeover_grace)
        .unwrap_or_else(|_overflow| chrono::Duration::zero());
    if current.owner_id != owner_id && expires_at + grace > now {
        return Ok(AcquirePlan::Contended(current));
    }
    Ok(AcquirePlan::Replace {
        observed_version,
        next: new_lease(owner_id, next_epoch, now, duration)?,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AcquiredLease {
    pub(crate) lease: ShardLeaseV1,
    pub(crate) version: CasVersion,
}

impl AcquiredLease {
    pub(crate) fn expires_at(&self) -> Result<DateTime<Utc>, InvalidLease> {
        parse_timestamp("expires_at", &self.lease.expires_at).map(DateTime::from)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LeaseTiming {
    lease_duration: Duration,
    renew_interval: Duration,
    renewal_timeout: Duration,
    graph_chunk_deadline: Duration,
    cursor_commit_deadline: Duration,
    chunk_window: Duration,
    clock_skew: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InvalidLeaseTiming {
    Zero { field: &'static str },
    TooLarge { field: &'static str },
    Overflow { expression: &'static str },
    ChunkCannotFit,
    RenewalCannotFit,
}

impl fmt::Display for InvalidLeaseTiming {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Zero { field } => write!(formatter, "{field} must be nonzero"),
            Self::TooLarge { field } => {
                write!(formatter, "{field} exceeds the 24 hour configuration bound")
            }
            Self::Overflow { expression } => {
                write!(formatter, "duration arithmetic overflowed for {expression}")
            }
            Self::ChunkCannotFit => formatter.write_str(
                "lease_duration must be greater than graph_chunk_deadline + cursor_commit_deadline + safety_margin",
            ),
            Self::RenewalCannotFit => formatter.write_str(
                "renew_interval + renewal_timeout + safety_margin must be less than lease_duration",
            ),
        }
    }
}

impl std::error::Error for InvalidLeaseTiming {}

impl LeaseTiming {
    pub(crate) fn new(
        lease_duration: Duration,
        renew_interval: Duration,
        renewal_timeout: Duration,
        graph_chunk_deadline: Duration,
        cursor_commit_deadline: Duration,
        safety_margin: Duration,
        clock_skew: Duration,
    ) -> Result<Self, InvalidLeaseTiming> {
        // The declared inter-runner clock-skew envelope may be zero when an
        // operator asserts synchronized clocks; every other bound is
        // structural and must be positive.
        if clock_skew > MAX_LEASE_TIMING {
            return Err(InvalidLeaseTiming::TooLarge {
                field: "clock_skew",
            });
        }
        for (field, value) in [
            ("lease_duration", lease_duration),
            ("renew_interval", renew_interval),
            ("renewal_timeout", renewal_timeout),
            ("graph_chunk_deadline", graph_chunk_deadline),
            ("cursor_commit_deadline", cursor_commit_deadline),
            ("safety_margin", safety_margin),
        ] {
            if value.is_zero() {
                return Err(InvalidLeaseTiming::Zero { field });
            }
            if value > MAX_LEASE_TIMING {
                return Err(InvalidLeaseTiming::TooLarge { field });
            }
        }
        // The owner stops admitting one skew envelope before its own expiry
        // view, so a fast-clocked competitor cannot overlap an admitted chunk.
        let chunk_window = graph_chunk_deadline
            .checked_add(cursor_commit_deadline)
            .and_then(|value| value.checked_add(safety_margin))
            .and_then(|value| value.checked_add(clock_skew))
            .ok_or(InvalidLeaseTiming::Overflow {
                expression:
                    "graph_chunk_deadline + cursor_commit_deadline + safety_margin + clock_skew",
            })?;
        if lease_duration <= chunk_window {
            return Err(InvalidLeaseTiming::ChunkCannotFit);
        }
        let renewal_window = renew_interval
            .checked_add(renewal_timeout)
            .and_then(|value| value.checked_add(safety_margin))
            .ok_or(InvalidLeaseTiming::Overflow {
                expression: "renew_interval + renewal_timeout + safety_margin",
            })?;
        if renewal_window >= lease_duration {
            return Err(InvalidLeaseTiming::RenewalCannotFit);
        }
        Ok(Self {
            lease_duration,
            renew_interval,
            renewal_timeout,
            graph_chunk_deadline,
            cursor_commit_deadline,
            chunk_window,
            clock_skew,
        })
    }

    pub(crate) fn lease_duration(self) -> Duration {
        self.lease_duration
    }

    pub(crate) fn renew_interval(self) -> Duration {
        self.renew_interval
    }

    pub(crate) fn renewal_timeout(self) -> Duration {
        self.renewal_timeout
    }

    pub(crate) fn graph_chunk_deadline(self) -> Duration {
        self.graph_chunk_deadline
    }

    pub(crate) fn cursor_commit_deadline(self) -> Duration {
        self.cursor_commit_deadline
    }

    pub(crate) fn chunk_window(self) -> Duration {
        self.chunk_window
    }

    /// The declared bound on wall-clock disagreement between runners. A
    /// competitor waits this long past observed expiry before replacing a
    /// lease, and the owner stops admitting chunks this long early.
    pub(crate) fn clock_skew(self) -> Duration {
        self.clock_skew
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AcquireOutcome {
    Acquired(AcquiredLease),
    Contended(ShardLeaseV1),
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RenewOutcome {
    Renewed(AcquiredLease),
    Lost,
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LeaseError {
    Read,
    Invalid,
    Create,
    Replace,
    Revalidate,
    StorageContradiction,
    Renew,
}

impl fmt::Display for LeaseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Read => "shard lease read failed",
            Self::Invalid => "shard lease acquisition is invalid",
            Self::Create => "shard lease conditional create failed",
            Self::Replace => "shard lease conditional replacement failed",
            Self::Revalidate => "shard lease revalidation failed",
            Self::StorageContradiction => "shard lease storage returned an impossible outcome",
            Self::Renew => "shard lease renewal failed",
        })
    }
}

fn plan_renewal(
    acquired: &AcquiredLease,
    now: DateTime<Utc>,
    duration: Duration,
) -> Result<Option<ShardLease>, InvalidLease> {
    validate_lease(&acquired.lease)?;
    if duration.is_zero() {
        return Err(InvalidLease::ZeroDuration);
    }
    let current_expiry = parse_timestamp("expires_at", &acquired.lease.expires_at)?;
    if current_expiry <= now {
        return Ok(None);
    }
    let duration =
        chrono::Duration::from_std(duration).map_err(|_error| InvalidLease::DurationOutOfRange)?;
    let next_expiry = now
        .checked_add_signed(duration)
        .ok_or(InvalidLease::DurationOutOfRange)?;
    if next_expiry <= current_expiry {
        return Err(InvalidLease::RenewalDoesNotExtend);
    }
    let next = ShardLease::V1(ShardLeaseV1 {
        owner_id: acquired.lease.owner_id.clone(),
        lease_epoch: acquired.lease.lease_epoch,
        acquired_at: acquired.lease.acquired_at.clone(),
        expires_at: timestamp(next_expiry),
    });
    validate_lease(next.current())?;
    Ok(Some(next))
}

/// Renews only the exact acquired CAS version. Conflict and expiry are ordinary
/// ownership-loss outcomes; neither is retried against a newer lease.
pub(crate) async fn renew(
    store: &ArtifactStore,
    key: &str,
    acquired: &AcquiredLease,
    now: DateTime<Utc>,
    duration: Duration,
) -> Result<RenewOutcome, Report<LeaseError>> {
    let Some(next) = plan_renewal(acquired, now, duration).change_context(LeaseError::Renew)?
    else {
        return Ok(RenewOutcome::Expired);
    };
    match record_io::compare_and_swap(store, key, &acquired.version, &next)
        .await
        .change_context(LeaseError::Renew)?
    {
        CasWrite::Written(version) => Ok(RenewOutcome::Renewed(AcquiredLease {
            lease: next
                .into_current()
                .change_context(LeaseError::StorageContradiction)?,
            version,
        })),
        CasWrite::Conflict => Ok(RenewOutcome::Lost),
    }
}

impl std::error::Error for LeaseError {}

/// Revalidates the complete acquisition token. Owner and epoch equality alone
/// are insufficient because a later CAS update may carry the same values.
pub(crate) async fn is_current(
    store: &ArtifactStore,
    key: &str,
    acquired: &AcquiredLease,
    now: DateTime<Utc>,
) -> Result<bool, Report<LeaseError>> {
    let Some((observed, version)) =
        record_io::read_strict::<ShardLease>(store, key, MAX_SHARD_LEASE_BYTES)
            .await
            .change_context(LeaseError::Revalidate)?
    else {
        return Ok(false);
    };
    let observed = observed
        .into_current()
        .change_context(LeaseError::Revalidate)?;
    let expires_at = parse_timestamp("expires_at", &observed.expires_at)
        .change_context(LeaseError::Revalidate)?;
    Ok(version == acquired.version && observed == acquired.lease && expires_at > now)
}

/// Attempts one greedy acquisition. Contention is an ordinary outcome; callers
/// reread on their next scan rather than retrying one hot shard in a loop.
pub(crate) async fn try_acquire(
    store: &ArtifactStore,
    key: &str,
    owner_id: &str,
    now: DateTime<Utc>,
    duration: Duration,
    takeover_grace: Duration,
) -> Result<AcquireOutcome, Report<LeaseError>> {
    let observed = record_io::read_mutable::<ShardLease>(store, key, MAX_SHARD_LEASE_BYTES)
        .await
        .change_context(LeaseError::Read)?;
    let plan = plan_acquisition(owner_id, now, duration, takeover_grace, observed)
        .change_context(LeaseError::Invalid)?;
    match plan {
        AcquirePlan::Contended(current) => Ok(AcquireOutcome::Contended(current)),
        AcquirePlan::Create(next) => match record_io::create(store, key, &next)
            .await
            .change_context(LeaseError::Create)?
        {
            CasWrite::Written(version) => Ok(AcquireOutcome::Acquired(AcquiredLease {
                lease: next
                    .into_current()
                    .change_context(LeaseError::StorageContradiction)?,
                version,
            })),
            CasWrite::Conflict => Ok(AcquireOutcome::Conflict),
        },
        AcquirePlan::Replace {
            observed_version,
            next,
        } => match record_io::compare_and_swap(store, key, &observed_version, &next)
            .await
            .change_context(LeaseError::Replace)?
        {
            CasWrite::Written(version) => Ok(AcquireOutcome::Acquired(AcquiredLease {
                lease: next
                    .into_current()
                    .change_context(LeaseError::StorageContradiction)?,
                version,
            })),
            CasWrite::Conflict => Ok(AcquireOutcome::Conflict),
        },
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::orchestrator::registry::DurableRecord;
    use tempfile::tempdir;

    fn instant(seconds: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(seconds, 0).expect("fixture timestamp is representable")
    }

    fn acquired(outcome: AcquireOutcome) -> AcquiredLease {
        match outcome {
            AcquireOutcome::Acquired(lease) => lease,
            other => panic!("expected acquisition, got {other:?}"),
        }
    }

    #[test]
    fn wire_matches_independent_golden_and_rejects_drift() {
        let fixture = include_bytes!("../../tests/golden/shard-lease-v1.json");
        let fixture = fixture.strip_suffix(b"\n").unwrap_or(fixture);
        let decoded = ShardLease::decode(fixture).expect("decode independent fixture");
        assert_eq!(decoded.encode().expect("encode fixture"), fixture);

        for invalid in [
            br#"{"version":"v2","data":{}}"#.as_slice(),
            br#"{"version":"v1","data":{"owner_id":"runner-a","lease_epoch":1,"acquired_at":"2026-07-22T10:00:00Z","expires_at":"2026-07-22T10:01:00Z","extra":true}}"#.as_slice(),
            br#"{"version":"v1","data":{"owner_id":"runner-a","lease_epoch":0,"acquired_at":"2026-07-22T10:00:00Z","expires_at":"2026-07-22T10:01:00Z"}}"#.as_slice(),
            br#"{"version":"v1","data":{"owner_id":" runner-a","lease_epoch":1,"acquired_at":"2026-07-22T10:00:00Z","expires_at":"2026-07-22T10:01:00Z"}}"#.as_slice(),
            br#"{"version":"v1","data":{"owner_id":"runner-a","lease_epoch":1,"acquired_at":"2026-07-22T10:01:00Z","expires_at":"2026-07-22T10:00:00Z"}}"#.as_slice(),
        ] {
            assert!(ShardLease::decode(invalid).is_err());
        }
    }

    #[test]
    fn pure_decision_increments_every_expired_acquisition_and_rejects_overflow() {
        let version = CasVersion::V1(crate::blob::CasVersionV1 {
            e_tag: Some("one".to_owned()),
            provider_version: None,
        });
        let current = new_lease("runner-a", 7, instant(0), Duration::from_secs(10))
            .expect("valid current lease");
        let AcquirePlan::Replace { next, .. } = plan_acquisition(
            "runner-a",
            instant(10),
            Duration::from_secs(10),
            Duration::ZERO,
            Some((current, version.clone())),
        )
        .expect("same-owner reacquisition is valid") else {
            panic!("expired lease must be replaceable");
        };
        assert_eq!(next.current().lease_epoch, 8);

        let maximum = new_lease("runner-a", u64::MAX, instant(0), Duration::from_secs(1))
            .expect("maximum epoch is representable on the wire");
        assert_eq!(
            plan_acquisition(
                "runner-b",
                instant(1),
                Duration::from_secs(1),
                Duration::ZERO,
                Some((maximum, version)),
            ),
            Err(InvalidLease::EpochOverflow)
        );
    }

    #[test]
    fn the_owner_reacquires_its_own_unexpired_lease_at_the_next_epoch() {
        let version = CasVersion::V1(crate::blob::CasVersionV1 {
            e_tag: Some("one".to_owned()),
            provider_version: None,
        });
        let current = new_lease("runner-a", 3, instant(0), Duration::from_secs(60))
            .expect("valid current lease");
        let AcquirePlan::Replace { next, .. } = plan_acquisition(
            "runner-a",
            instant(5),
            Duration::from_secs(60),
            Duration::from_secs(5),
            Some((current.clone(), version.clone())),
        )
        .expect("same-owner reacquisition plans") else {
            panic!("the owner must not wait out its own lease")
        };
        assert_eq!(next.current().lease_epoch, 4);

        // A different owner still waits for expiry plus the skew envelope.
        assert!(matches!(
            plan_acquisition(
                "runner-b",
                instant(5),
                Duration::from_secs(60),
                Duration::from_secs(5),
                Some((current, version)),
            )
            .expect("foreign unexpired lease plans"),
            AcquirePlan::Contended(_)
        ));
    }

    #[test]
    fn takeover_honors_the_declared_clock_skew_envelope() {
        let version = CasVersion::V1(crate::blob::CasVersionV1 {
            e_tag: Some("one".to_owned()),
            provider_version: None,
        });
        let current = new_lease("runner-a", 1, instant(0), Duration::from_secs(10))
            .expect("valid current lease");
        // Expired on this clock, but within the skew envelope: the observed
        // expiry may have been minted on a clock running ahead by the whole
        // envelope, so replacement must wait.
        assert!(matches!(
            plan_acquisition(
                "runner-b",
                instant(14),
                Duration::from_secs(10),
                Duration::from_secs(5),
                Some((current.clone(), version.clone())),
            )
            .expect("grace-held lease plans"),
            AcquirePlan::Contended(_)
        ));
        assert!(matches!(
            plan_acquisition(
                "runner-b",
                instant(16),
                Duration::from_secs(10),
                Duration::from_secs(5),
                Some((current, version)),
            )
            .expect("post-envelope lease plans"),
            AcquirePlan::Replace { .. }
        ));
    }

    #[test]
    fn timing_feasibility_uses_strict_checked_boundaries() {
        let valid = LeaseTiming::new(
            Duration::from_secs(61),
            Duration::from_secs(20),
            Duration::from_secs(10),
            Duration::from_secs(40),
            Duration::from_secs(10),
            Duration::from_secs(10),
            Duration::ZERO,
        )
        .expect("both strict inequalities hold");
        assert_eq!(valid.chunk_window(), Duration::from_secs(60));

        assert_eq!(
            LeaseTiming::new(
                Duration::from_secs(60),
                Duration::from_secs(20),
                Duration::from_secs(10),
                Duration::from_secs(40),
                Duration::from_secs(10),
                Duration::from_secs(10),
                Duration::ZERO,
            ),
            Err(InvalidLeaseTiming::ChunkCannotFit)
        );
        assert_eq!(
            LeaseTiming::new(
                Duration::from_secs(61),
                Duration::from_secs(40),
                Duration::from_secs(11),
                Duration::from_secs(20),
                Duration::from_secs(10),
                Duration::from_secs(10),
                Duration::ZERO,
            ),
            Err(InvalidLeaseTiming::RenewalCannotFit)
        );
        assert_eq!(
            LeaseTiming::new(
                Duration::from_secs(61),
                Duration::ZERO,
                Duration::from_secs(10),
                Duration::from_secs(20),
                Duration::from_secs(10),
                Duration::from_secs(10),
                Duration::ZERO,
            ),
            Err(InvalidLeaseTiming::Zero {
                field: "renew_interval"
            })
        );
    }

    #[tokio::test]
    async fn renewal_preserves_epoch_and_requires_the_exact_cas_version() {
        let remote = tempdir().expect("create remote directory");
        let cache_a = tempdir().expect("create first cache");
        let cache_b = tempdir().expect("create second cache");
        let first_store =
            ArtifactStore::local(remote.path(), cache_a.path()).expect("open first store");
        let second_store =
            ArtifactStore::local(remote.path(), cache_b.path()).expect("open second store");
        let key = "tenants/alice/control/v1/leases/027.json";
        let first = acquired(
            try_acquire(
                &first_store,
                key,
                "runner-a",
                instant(0),
                Duration::from_secs(60),
                Duration::ZERO,
            )
            .await
            .expect("acquire lease"),
        );

        let renewed = match renew(
            &first_store,
            key,
            &first,
            instant(30),
            Duration::from_secs(60),
        )
        .await
        .expect("renew exact lease")
        {
            RenewOutcome::Renewed(value) => value,
            other => panic!("expected renewal, got {other:?}"),
        };
        assert_eq!(renewed.lease.lease_epoch, first.lease.lease_epoch);
        assert_eq!(renewed.lease.acquired_at, first.lease.acquired_at);
        assert_ne!(renewed.version, first.version);
        assert_eq!(
            renew(
                &second_store,
                key,
                &first,
                instant(31),
                Duration::from_secs(60),
            )
            .await
            .expect("stale renewal is ordinary loss"),
            RenewOutcome::Lost
        );
        assert!(is_current(&second_store, key, &renewed, instant(31))
            .await
            .expect("revalidate renewed lease"));
    }

    #[test]
    fn renewal_refuses_expiry_and_non_extending_clock_drift() {
        let acquired = AcquiredLease {
            lease: new_lease("runner-a", 1, instant(0), Duration::from_secs(60))
                .expect("lease")
                .into_current()
                .expect("current lease"),
            version: CasVersion::V1(crate::blob::CasVersionV1 {
                e_tag: Some("one".to_owned()),
                provider_version: None,
            }),
        };
        assert_eq!(
            plan_renewal(&acquired, instant(60), Duration::from_secs(60)),
            Ok(None)
        );
        assert_eq!(
            plan_renewal(&acquired, instant(1), Duration::from_secs(30)),
            Err(InvalidLease::RenewalDoesNotExtend)
        );
    }

    #[tokio::test]
    async fn absent_and_expired_leases_advance_one_monotonic_epoch_chain() {
        let remote = tempdir().expect("create remote directory");
        let cache_a = tempdir().expect("create first cache");
        let cache_b = tempdir().expect("create second cache");
        let first_store =
            ArtifactStore::local(remote.path(), cache_a.path()).expect("open first store");
        let second_store =
            ArtifactStore::local(remote.path(), cache_b.path()).expect("open second store");
        let key = "tenants/alice/control/v1/leases/027.json";

        let first = acquired(
            try_acquire(
                &first_store,
                key,
                "runner-a",
                instant(0),
                Duration::from_secs(10),
                Duration::ZERO,
            )
            .await
            .expect("acquire absent lease"),
        );
        assert_eq!(first.lease.lease_epoch, 1);

        let held = try_acquire(
            &second_store,
            key,
            "runner-b",
            instant(9),
            Duration::from_secs(10),
            Duration::ZERO,
        )
        .await
        .expect("observe unexpired lease");
        assert!(matches!(held, AcquireOutcome::Contended(ref lease) if lease.lease_epoch == 1));

        let second = acquired(
            try_acquire(
                &second_store,
                key,
                "runner-b",
                instant(10),
                Duration::from_secs(10),
                Duration::ZERO,
            )
            .await
            .expect("take over expired lease"),
        );
        assert_eq!(second.lease.lease_epoch, 2);

        let third = acquired(
            try_acquire(
                &second_store,
                key,
                "runner-b",
                instant(20),
                Duration::from_secs(10),
                Duration::ZERO,
            )
            .await
            .expect("same owner reacquires expired lease"),
        );
        assert_eq!(third.lease.lease_epoch, 3);
    }

    #[tokio::test]
    async fn concurrent_absent_acquirers_have_exactly_one_winner() {
        let remote = tempdir().expect("create remote directory");
        let cache_a = tempdir().expect("create first cache");
        let cache_b = tempdir().expect("create second cache");
        let first = ArtifactStore::local(remote.path(), cache_a.path()).expect("open first store");
        let second =
            ArtifactStore::local(remote.path(), cache_b.path()).expect("open second store");
        let key = "tenants/alice/control/v1/leases/027.json";

        let (left, right) = tokio::join!(
            try_acquire(
                &first,
                key,
                "runner-a",
                instant(0),
                Duration::from_secs(10),
                Duration::ZERO
            ),
            try_acquire(
                &second,
                key,
                "runner-b",
                instant(0),
                Duration::from_secs(10),
                Duration::ZERO,
            )
        );
        let outcomes = [
            left.expect("first acquisition"),
            right.expect("second acquisition"),
        ];
        assert_eq!(
            outcomes
                .iter()
                .filter(|outcome| matches!(outcome, AcquireOutcome::Acquired(_)))
                .count(),
            1
        );
        assert_eq!(
            outcomes
                .iter()
                .filter(|outcome| {
                    matches!(
                        outcome,
                        AcquireOutcome::Conflict | AcquireOutcome::Contended(_)
                    )
                })
                .count(),
            1
        );
    }
}
