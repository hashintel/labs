//! Protocol V1's shard-log surface over the kernel machinery.
//!
//! The append handle, retry/ambiguity discipline, and recovery live in
//! `durable_kernel::shard_log`; this module pins that machinery to
//! [`IntegrationsDomain`], derives production storage locations from the
//! environment, and folds V1 projections for read-only inspection.

use std::time::Duration;

use error_stack::{Report, ResultExt as _};

use super::DurableError;

mod command_loop;

pub(crate) use command_loop::{
    ControlRequestSnapshot, IntegrationsCommandExt, IntegrationsDomain,
    IntegrationsSnapshotContext, RunView, WorkRecoveryIntent,
};

// Kernel machinery, re-exported under this module's import paths.
pub(crate) use durable_kernel::shard_log::{
    LogStorageOptions, OpenedShard, ShardCommandConfig, ShardCommandError, ShardCommandErrorKind,
    ShardCommandOutcome, ShardLogLocation,
};

// The kernel's generic types, pinned to V1's domain under short names.
pub(crate) type ShardCommandHandle =
    durable_kernel::shard_log::ShardCommandHandle<IntegrationsDomain>;
pub(crate) type StartedShard = durable_kernel::shard_log::StartedShard<IntegrationsDomain>;
pub(crate) type RecoveredShard = durable_kernel::shard_log::RecoveredShard<IntegrationsDomain>;
pub(crate) type StartupRecovery = durable_kernel::shard_log::StartupRecovery<WorkRecoveryIntent>;
pub(crate) type StateChangeFeed =
    durable_kernel::shard_log::StateChangeFeed<super::ids::CanonicalIntegrationId>;

const DURABILITY_TIMEOUT: Duration = Duration::from_secs(60);

/// Production V1 location: storage and timeouts from the environment, the
/// log path from the tenant keyspace.
pub(crate) fn production_location(
    env: &crate::config::Env,
    shard: super::routing::Shard,
    tenant: &super::ids::TenantNamespace,
) -> Result<ShardLogLocation, Report<DurableError>> {
    use super::routing::TenantKeyspace as _;

    let storage = storage_for_control_path(
        env,
        &super::routing::Keyspace::for_tenant(tenant).shard_log(shard),
    )?;
    Ok(ShardLogLocation::new(
        shard,
        storage,
        Duration::from_millis(crate::config::control_read_timeout_ms(env)).max(DURABILITY_TIMEOUT),
        Duration::from_millis(crate::config::durability_timeout_ms(env)),
    ))
}

fn storage_for_control_path(
    env: &crate::config::Env,
    control_path: &str,
) -> Result<opendata_common::StorageConfig, Report<DurableError>> {
    durable_kernel::shard_log::storage_for_path(
        &LogStorageOptions {
            blob_url: crate::config::blob_store_url(env),
            aws_region: env
                .get("AWS_REGION")
                .or_else(|| env.get("AWS_DEFAULT_REGION"))
                .map(str::to_owned),
            shard_capacity: crate::config::configured_shard_capacity(env).max(1),
            block_cache_bytes: crate::config::slatedb_block_cache_bytes(env)
                .map_err(|message| Report::new(DurableError).attach_printable(message))?,
            meta_cache_bytes: crate::config::slatedb_meta_cache_bytes(env)
                .map_err(|message| Report::new(DurableError).attach_printable(message))?,
        },
        control_path,
    )
}

/// Disposable local V1 location under the tenant's frozen log layout.
#[cfg(test)]
pub(crate) fn disposable_local(
    shard: super::routing::Shard,
    tenant: &super::ids::TenantNamespace,
    object_store_root: &std::path::Path,
) -> ShardLogLocation {
    use super::routing::TenantKeyspace as _;

    ShardLogLocation::disposable_local(
        shard,
        &super::routing::Keyspace::for_tenant(tenant).shard_log(shard),
        object_store_root,
    )
}

/// Unleased V1 shard constructor for lifecycle and conformance test rigs.
#[cfg(test)]
pub(crate) async fn start_recovered(
    location: ShardLogLocation,
    config: ShardCommandConfig,
) -> Result<StartedShard, ShardCommandError> {
    durable_kernel::shard_log::start_recovered::<IntegrationsDomain>(location, config).await
}

/// Reconstructs a point-in-time V1 projection through a read-only LogDb
/// handle. Operator queries must never open a writer, advance a SlateDB
/// epoch, acquire a lease, or mutate the shard they inspect.
pub(crate) async fn read_projection(
    location: &ShardLogLocation,
) -> Result<super::projection::Projection, Report<DurableError>> {
    let records =
        durable_kernel::shard_log::read_journal::<super::events::JournalRecord>(location).await?;
    let mut projection = super::projection::Projection::default();
    for (sequence, record) in records {
        let input = super::events::SequencedJournalRecord::try_new(sequence, record)
            .change_context(DurableError)
            .attach_printable(format!(
                "validate shard projection record at sequence {sequence}"
            ))?;
        if super::routing::shard(&input.record().integration_id) != location.shard() {
            return Err(Report::new(DurableError).attach_printable(format!(
                "record at sequence {sequence} routes outside shard {}",
                super::routing::shard_path(location.shard())
            )));
        }
        super::projection::apply(&mut projection, input)
            .change_context(DurableError)
            .attach_printable(format!(
                "fold shard projection record at sequence {sequence}"
            ))?;
    }
    Ok(projection)
}
