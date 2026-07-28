//! Registry-gated I/O for versioned records stored at stable CAS keys.
//!
//! Content-addressed immutable artifacts use [`ArtifactStore::publish_record`].
//! Every typed record stored at a stable key goes through this module so the
//! V1 registry check cannot be omitted by an individual caller.

use std::fmt;

use error_stack::{Report, ResultExt as _};

use super::registry::{require_registered, CompatError, DurableRecord, MutableCasRecord};
use crate::blob::{ArtifactStore, BoundedCasDocument, CasVersion, CasWrite};

const MAX_MUTABLE_MIGRATION_ATTEMPTS: usize = 8;

#[derive(Debug)]
pub(crate) enum RecordIoError {
    Registration,
    Encode,
    Read,
    Decode,
    TooLarge {
        actual_bytes: u64,
        maximum_bytes: usize,
    },
    Create,
    Update,
    MigrationConflictLimit,
}

impl fmt::Display for RecordIoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Registration => formatter.write_str("durable record is not registered"),
            Self::Encode => formatter.write_str("durable record encoding failed"),
            Self::Read => formatter.write_str("durable record read failed"),
            Self::Decode => formatter.write_str("durable record decoding failed"),
            Self::TooLarge {
                actual_bytes,
                maximum_bytes,
            } => write!(
                formatter,
                "durable record is {actual_bytes} bytes; maximum is {maximum_bytes}"
            ),
            Self::Create => formatter.write_str("durable record conditional create failed"),
            Self::Update => formatter.write_str("durable record conditional update failed"),
            Self::MigrationConflictLimit => {
                formatter.write_str("durable record remained unstable during migration")
            }
        }
    }
}

impl std::error::Error for RecordIoError {}

pub(crate) enum InspectedRecord<T> {
    Missing,
    Present(T, CasVersion),
    Malformed(CompatError, CasVersion),
    TooLarge {
        actual_bytes: u64,
        maximum_bytes: usize,
    },
}

fn ensure_registered<T: DurableRecord>() -> Result<(), Report<RecordIoError>> {
    require_registered::<T>()
        .change_context(RecordIoError::Registration)
        .attach_printable(T::FAMILY.name)
}

fn encode_registered<T: DurableRecord>(record: &T) -> Result<Vec<u8>, Report<RecordIoError>> {
    ensure_registered::<T>()?;
    record
        .encode()
        .change_context(RecordIoError::Encode)
        .attach_printable(T::FAMILY.name)
}

/// Reads a registered record while preserving malformed bytes as an
/// observation. This is for startup diagnostics and derived-cache repair;
/// authoritative callers should use [`read_strict`].
pub(crate) async fn inspect<T: DurableRecord>(
    store: &ArtifactStore,
    key: &str,
    maximum_bytes: usize,
) -> Result<InspectedRecord<T>, Report<RecordIoError>> {
    ensure_registered::<T>()?;
    let observed = store
        .get_cas_document_bounded(key, maximum_bytes)
        .await
        .change_context(RecordIoError::Read)
        .attach_printable(T::FAMILY.name)
        .attach_printable(key.to_owned())?;
    Ok(match observed {
        BoundedCasDocument::Missing => InspectedRecord::Missing,
        BoundedCasDocument::Present(bytes, version) => match T::decode(&bytes) {
            Ok(record) => InspectedRecord::Present(record, version),
            Err(error) => InspectedRecord::Malformed(error, version),
        },
        BoundedCasDocument::TooLarge {
            actual_bytes,
            max_bytes,
        } => InspectedRecord::TooLarge {
            actual_bytes,
            maximum_bytes: max_bytes,
        },
    })
}

pub(crate) async fn read_strict<T: DurableRecord>(
    store: &ArtifactStore,
    key: &str,
    maximum_bytes: usize,
) -> Result<Option<(T, CasVersion)>, Report<RecordIoError>> {
    match inspect::<T>(store, key, maximum_bytes).await? {
        InspectedRecord::Missing => Ok(None),
        InspectedRecord::Present(record, version) => Ok(Some((record, version))),
        InspectedRecord::Malformed(error, _version) => {
            Err(Report::new(error).change_context(RecordIoError::Decode))
        }
        InspectedRecord::TooLarge {
            actual_bytes,
            maximum_bytes,
        } => Err(Report::new(RecordIoError::TooLarge {
            actual_bytes,
            maximum_bytes,
        })),
    }
}

pub(crate) async fn create<T: DurableRecord + Sync>(
    store: &ArtifactStore,
    key: &str,
    record: &T,
) -> Result<CasWrite, Report<RecordIoError>> {
    let bytes = encode_registered(record)?;
    store
        .create_cas_document(key, bytes)
        .await
        .change_context(RecordIoError::Create)
        .attach_printable(T::FAMILY.name)
        .attach_printable(key.to_owned())
}

pub(crate) async fn compare_and_swap<T: DurableRecord + Sync>(
    store: &ArtifactStore,
    key: &str,
    expected: &CasVersion,
    record: &T,
) -> Result<CasWrite, Report<RecordIoError>> {
    let bytes = encode_registered(record)?;
    store
        .compare_and_swap_cas_document(key, expected, bytes)
        .await
        .change_context(RecordIoError::Update)
        .attach_printable(T::FAMILY.name)
        .attach_printable(key.to_owned())
}

/// Reads a mutable record through its declared normalization boundary. Older
/// supported bytes are rewritten to the current canonical encoding against
/// exactly the version that was observed.
pub(crate) async fn read_mutable<T: MutableCasRecord>(
    store: &ArtifactStore,
    key: &str,
    maximum_bytes: usize,
) -> Result<Option<(T, CasVersion)>, Report<RecordIoError>> {
    ensure_registered::<T>()?;
    for _attempt in 0..MAX_MUTABLE_MIGRATION_ATTEMPTS {
        let (bytes, observed_version) = match store
            .get_cas_document_bounded(key, maximum_bytes)
            .await
            .change_context(RecordIoError::Read)
            .attach_printable(T::FAMILY.name)
            .attach_printable(key.to_owned())?
        {
            BoundedCasDocument::Missing => return Ok(None),
            BoundedCasDocument::Present(bytes, version) => (bytes, version),
            BoundedCasDocument::TooLarge {
                actual_bytes,
                max_bytes,
            } => {
                return Err(Report::new(RecordIoError::TooLarge {
                    actual_bytes,
                    maximum_bytes: max_bytes,
                }));
            }
        };
        let current = T::decode(&bytes)
            .and_then(MutableCasRecord::into_emitted)
            .change_context(RecordIoError::Decode)?;
        let canonical = current
            .encode()
            .change_context(RecordIoError::Encode)
            .attach_printable(T::FAMILY.name)?;
        if canonical.as_slice() == bytes.as_ref() {
            return Ok(Some((current, observed_version)));
        }
        match store
            .compare_and_swap_cas_document(key, &observed_version, canonical)
            .await
            .change_context(RecordIoError::Update)
            .attach_printable(T::FAMILY.name)
            .attach_printable(key.to_owned())?
        {
            CasWrite::Written(version) => return Ok(Some((current, version))),
            CasWrite::Conflict => {}
        }
    }
    Err(Report::new(RecordIoError::MigrationConflictLimit)
        .attach_printable(T::FAMILY.name)
        .attach_printable(key.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestrator::registry::{DurabilityClass, MigrationPolicy, RecordFamily};
    use tempfile::tempdir;

    static UNREGISTERED_FAMILY: RecordFamily = RecordFamily {
        name: "record_io_unregistered_fixture",
        owning_module: "orchestrator::record_io::tests",
        emitted_version: 1,
        supported_versions: &[1],
        algorithm_versions: &[],
        durability: DurabilityClass::ImmutableArtifact,
        migration: MigrationPolicy::PureUpcast,
    };

    struct UnregisteredRecord;

    impl super::super::registry::sealed::Sealed for UnregisteredRecord {}

    impl DurableRecord for UnregisteredRecord {
        const FAMILY: &'static RecordFamily = &UNREGISTERED_FAMILY;
        const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

        fn encode(&self) -> Result<Vec<u8>, CompatError> {
            Ok(b"{}".to_vec())
        }

        fn decode(_bytes: &[u8]) -> Result<Self, CompatError> {
            Ok(Self)
        }
    }

    #[tokio::test]
    async fn unregistered_record_is_rejected_before_storage_is_touched() {
        let remote = tempdir().expect("create remote fixture directory");
        let cache = tempdir().expect("create cache fixture directory");
        let store = ArtifactStore::local(remote.path(), cache.path()).expect("open local store");

        let error = create(&store, "control/fixture.json", &UnregisteredRecord)
            .await
            .expect_err("unregistered family must fail");
        assert!(matches!(
            error.current_context(),
            RecordIoError::Registration
        ));
        assert!(matches!(
            store
                .get_cas_document_bounded("control/fixture.json", 16)
                .await
                .expect("inspect fixture key"),
            BoundedCasDocument::Missing
        ));
    }
}
