//! Process-safe ownership and accounting for disposable local runner state.
//!
//! Remote content references remain authoritative. Local locks prevent a
//! scavenger from deleting a workspace or staging directory still owned by a
//! process on this host; they are not distributed workflow leases.

use std::fmt;
use std::fs::File;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use error_stack::{Report, ResultExt as _};
use fs4::fs_std::FileExt as _;
use tokio::sync::Notify;

const OWNER_LOCK: &str = ".active.lock";
const RESERVATION: &str = ".disk-reservation";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalDiskLimits {
    pub max_workspace_bytes: u64,
    pub max_cache_bytes: u64,
    pub min_free_bytes: u64,
    pub max_staging_bytes: u64,
    pub max_staging_age: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalDiskError {
    Inspect,
    InvalidPath,
    AlreadyActive,
    Capacity,
    Claim,
    Scavenge,
}

impl fmt::Display for LocalDiskError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Inspect => "inspect local runner disk failed",
            Self::InvalidPath => "local runner path is outside its configured root",
            Self::AlreadyActive => "local runner workspace is already active",
            Self::Capacity => "local runner disk capacity is exhausted",
            Self::Claim => "claim local runner workspace failed",
            Self::Scavenge => "scavenge abandoned local runner state failed",
        })
    }
}

impl std::error::Error for LocalDiskError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiskUsage {
    pub workspace_bytes: u64,
    pub available_bytes: u64,
    pub reserved_bytes: u64,
}

pub struct OwnedDirectory {
    path: PathBuf,
    lock: File,
}

impl fmt::Debug for OwnedDirectory {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OwnedDirectory")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl OwnedDirectory {
    pub fn claim(path: &Path) -> Result<Self, Report<LocalDiskError>> {
        std::fs::create_dir_all(path)
            .change_context(LocalDiskError::Claim)
            .attach_printable(format!("create owned directory {}", path.display()))?;
        let lock_path = path.join(OWNER_LOCK);
        let lock = open_lock(&lock_path).change_context(LocalDiskError::Claim)?;
        if !lock
            .try_lock_exclusive()
            .change_context(LocalDiskError::Claim)
            .attach_printable(format!("lock owned directory {}", path.display()))?
        {
            return Err(Report::new(LocalDiskError::AlreadyActive)
                .attach_printable(format!("workspace {} is locked", path.display())));
        }
        Ok(Self {
            path: path.to_owned(),
            lock,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for OwnedDirectory {
    fn drop(&mut self) {
        let _ = fs4::fs_std::FileExt::unlock(&self.lock);
    }
}

pub struct WorkspaceGuard {
    owned: OwnedDirectory,
    reservation_path: PathBuf,
    budget: Arc<WorkspaceBudget>,
}

impl fmt::Debug for WorkspaceGuard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WorkspaceGuard")
            .field("path", &self.owned.path)
            .finish_non_exhaustive()
    }
}

impl WorkspaceGuard {
    /// Replaces restore headroom with the exact space needed for one local
    /// checkpoint copy. This keeps checkpointing possible without reserving
    /// the configured per-database maximum for every admitted run.
    pub fn materialized(&mut self) -> Result<(), Report<LocalDiskError>> {
        let checkpoint_bytes = tree_size_excluding(self.path(), &[OWNER_LOCK, RESERVATION])?;
        self.budget
            .replace_reservation(&self.reservation_path, checkpoint_bytes)?;
        self.budget.notify.notify_waiters();
        Ok(())
    }

    pub fn path(&self) -> &Path {
        self.owned.path()
    }

    /// Releases ownership, atomically removes the workspace from its live
    /// name, then deletes only that quarantined disposable directory.
    pub fn discard(self) -> Result<(), Report<LocalDiskError>> {
        let path = self.owned.path().to_owned();
        let _ = std::fs::remove_file(&self.reservation_path);
        if !path.exists() {
            self.budget.notify.notify_waiters();
            return Ok(());
        }
        let parent = path.parent().ok_or_else(|| {
            Report::new(LocalDiskError::InvalidPath)
                .attach_printable(format!("workspace has no parent: {}", path.display()))
        })?;
        let quarantine = parent.join(format!(".discard-{}", uuid::Uuid::new_v4()));
        std::fs::rename(&path, &quarantine)
            .change_context(LocalDiskError::Scavenge)
            .attach_printable(format!("quarantine completed workspace {}", path.display()))?;
        std::fs::remove_dir_all(&quarantine)
            .change_context(LocalDiskError::Scavenge)
            .attach_printable(format!(
                "remove completed workspace {}",
                quarantine.display()
            ))?;
        self.budget.notify.notify_waiters();
        Ok(())
    }
}

impl Drop for WorkspaceGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.reservation_path);
        self.budget.notify.notify_waiters();
    }
}

pub struct WorkspaceBudget {
    root: PathBuf,
    limits: LocalDiskLimits,
    lock: Mutex<()>,
    notify: Notify,
}

impl fmt::Debug for WorkspaceBudget {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WorkspaceBudget")
            .field("root", &self.root)
            .field("limits", &self.limits)
            .finish_non_exhaustive()
    }
}

impl WorkspaceBudget {
    pub fn new(
        root: impl Into<PathBuf>,
        limits: LocalDiskLimits,
    ) -> Result<Arc<Self>, Report<LocalDiskError>> {
        let root = root.into();
        std::fs::create_dir_all(&root)
            .change_context(LocalDiskError::Claim)
            .attach_printable(format!("create workspace root {}", root.display()))?;
        Ok(Arc::new(Self {
            root,
            limits,
            lock: Mutex::new(()),
            notify: Notify::new(),
        }))
    }

    /// Waits until the current aggregate usage plus the exact restore and
    /// checkpoint-copy headroom fits. It does not reserve every workspace's
    /// maximum size up front.
    pub async fn acquire(
        self: &Arc<Self>,
        workspace: &Path,
        restore_bytes: u64,
    ) -> Result<WorkspaceGuard, Report<LocalDiskError>> {
        self.validate_child(workspace)?;
        let required = restore_bytes.checked_mul(2).ok_or_else(|| {
            Report::new(LocalDiskError::Capacity)
                .attach_printable("restore plus checkpoint headroom overflowed u64")
        })?;
        let total = fs4::total_space(&self.root)
            .change_context(LocalDiskError::Inspect)
            .attach_printable("inspect workspace filesystem capacity")?;
        let impossible_free = self
            .limits
            .min_free_bytes
            .checked_add(required)
            .map_or(true, |needed| needed > total);
        if required > self.limits.max_workspace_bytes || impossible_free {
            return Err(Report::new(LocalDiskError::Capacity).attach_printable(format!(
                "run needs {required} bytes for restore plus checkpoint, but the workspace limit is {} bytes and the filesystem has {total} bytes with {} bytes reserved",
                self.limits.max_workspace_bytes, self.limits.min_free_bytes
            )));
        }
        let existing = tree_size_excluding(workspace, &[OWNER_LOCK, RESERVATION])?;
        if existing
            .checked_add(required)
            .map_or(true, |needed| needed > self.limits.max_workspace_bytes)
        {
            return Err(Report::new(LocalDiskError::Capacity).attach_printable(format!(
                "workspace already uses {existing} bytes and needs {required} restore/checkpoint bytes; RUNNER_MAX_WORKSPACE_BYTES is {} bytes",
                self.limits.max_workspace_bytes
            )));
        }
        loop {
            let notified = self.notify.notified();
            match self.try_acquire(workspace, required)? {
                Some(guard) => return Ok(guard),
                None => {
                    tokio::select! {
                        () = notified => {}
                        () = tokio::time::sleep(Duration::from_secs(1)) => {}
                    }
                }
            }
        }
    }

    fn try_acquire(
        self: &Arc<Self>,
        workspace: &Path,
        required: u64,
    ) -> Result<Option<WorkspaceGuard>, Report<LocalDiskError>> {
        let _lock = self.lock.lock().map_err(|_poisoned| {
            Report::new(LocalDiskError::Claim).attach_printable("workspace budget lock poisoned")
        })?;
        let budget_lock =
            open_lock(&self.root.join(".budget.lock")).change_context(LocalDiskError::Claim)?;
        budget_lock
            .lock_exclusive()
            .change_context(LocalDiskError::Claim)
            .attach_printable("lock cross-process workspace budget")?;

        let usage = self.usage()?;
        let required_total = usage
            .workspace_bytes
            .checked_add(usage.reserved_bytes)
            .and_then(|value| value.checked_add(required))
            .ok_or_else(|| {
                Report::new(LocalDiskError::Capacity)
                    .attach_printable("aggregate workspace accounting overflowed u64")
            })?;
        let required_free = self
            .limits
            .min_free_bytes
            .checked_add(required)
            .ok_or_else(|| {
                Report::new(LocalDiskError::Capacity)
                    .attach_printable("free-space reserve accounting overflowed u64")
            })?;
        if required_total > self.limits.max_workspace_bytes || usage.available_bytes < required_free
        {
            return Ok(None);
        }

        let owned = match OwnedDirectory::claim(workspace) {
            Ok(owned) => owned,
            Err(error) if error.current_context() == &LocalDiskError::AlreadyActive => {
                return Err(error)
            }
            Err(error) => return Err(error),
        };
        let reservation_path = workspace.join(RESERVATION);
        write_reservation(&reservation_path, required)?;
        Ok(Some(WorkspaceGuard {
            owned,
            reservation_path,
            budget: Arc::clone(self),
        }))
    }

    pub fn usage(&self) -> Result<DiskUsage, Report<LocalDiskError>> {
        let workspace_bytes = tree_size_excluding(&self.root, &[OWNER_LOCK, RESERVATION])?;
        let reserved_bytes = sum_reservations(&self.root)?;
        let available_bytes = fs4::available_space(&self.root)
            .change_context(LocalDiskError::Inspect)
            .attach_printable("inspect available workspace filesystem bytes")?;
        Ok(DiskUsage {
            workspace_bytes,
            available_bytes,
            reserved_bytes,
        })
    }

    pub fn enforce_aggregate(&self) -> Result<(), Report<LocalDiskError>> {
        let usage = self.usage()?;
        if usage.workspace_bytes > self.limits.max_workspace_bytes {
            return Err(
                Report::new(LocalDiskError::Capacity).attach_printable(format!(
                    "active workspaces use {} bytes; maximum is {} bytes",
                    usage.workspace_bytes, self.limits.max_workspace_bytes
                )),
            );
        }
        if usage.available_bytes < self.limits.min_free_bytes {
            return Err(
                Report::new(LocalDiskError::Capacity).attach_printable(format!(
                    "filesystem has {} bytes available; reserve is {} bytes",
                    usage.available_bytes, self.limits.min_free_bytes
                )),
            );
        }
        Ok(())
    }

    fn replace_reservation(
        &self,
        reservation_path: &Path,
        checkpoint_bytes: u64,
    ) -> Result<(), Report<LocalDiskError>> {
        let _lock = self.lock.lock().map_err(|_poisoned| {
            Report::new(LocalDiskError::Claim).attach_printable("workspace budget lock poisoned")
        })?;
        refresh_checkpoint_reservation(
            &self.root,
            reservation_path,
            checkpoint_bytes,
            self.limits.max_workspace_bytes,
            self.limits.min_free_bytes,
        )
    }

    pub fn scavenge_abandoned(&self) -> Result<Vec<PathBuf>, Report<LocalDiskError>> {
        let _lock = self.lock.lock().map_err(|_poisoned| {
            Report::new(LocalDiskError::Scavenge).attach_printable("scavenger lock poisoned")
        })?;
        let mut removed = Vec::new();
        for directory in child_directories_recursive(&self.root)? {
            if directory == self.root {
                continue;
            }
            let lock_path = directory.join(OWNER_LOCK);
            if !lock_path.exists() && !directory.join(".state-generation").is_file() {
                continue;
            }
            let lock = open_lock(&lock_path).change_context(LocalDiskError::Scavenge)?;
            if !lock
                .try_lock_exclusive()
                .change_context(LocalDiskError::Scavenge)?
            {
                continue;
            }
            remove_claimed_directory(&directory, lock)?;
            removed.push(directory);
        }
        if !removed.is_empty() {
            self.notify.notify_waiters();
        }
        Ok(removed)
    }

    fn validate_child(&self, path: &Path) -> Result<(), Report<LocalDiskError>> {
        if path == self.root || !path.starts_with(&self.root) {
            return Err(
                Report::new(LocalDiskError::InvalidPath).attach_printable(format!(
                    "workspace {} is not a strict child of {}",
                    path.display(),
                    self.root.display()
                )),
            );
        }
        Ok(())
    }
}

/// Atomically refreshes one active workspace's exact checkpoint-copy
/// reservation. Store threads call this after every serialized DuckDB
/// boundary, so growing databases cannot silently consume their headroom.
pub fn refresh_checkpoint_reservation(
    root: &Path,
    reservation_path: &Path,
    checkpoint_bytes: u64,
    max_workspace_bytes: u64,
    min_free_bytes: u64,
) -> Result<(), Report<LocalDiskError>> {
    let budget_lock =
        open_lock(&root.join(".budget.lock")).change_context(LocalDiskError::Claim)?;
    budget_lock
        .lock_exclusive()
        .change_context(LocalDiskError::Claim)?;
    let previous = read_reservation(reservation_path)?.unwrap_or(0);
    let workspace_bytes = tree_size_excluding(root, &[OWNER_LOCK, RESERVATION])?;
    let reserved_bytes = sum_reservations(root)?;
    let available_bytes = fs4::available_space(root)
        .change_context(LocalDiskError::Inspect)
        .attach_printable("inspect available workspace filesystem bytes")?;
    let projected = workspace_bytes
        .checked_add(reserved_bytes.saturating_sub(previous))
        .and_then(|value| value.checked_add(checkpoint_bytes))
        .ok_or_else(|| {
            Report::new(LocalDiskError::Capacity)
                .attach_printable("checkpoint reservation accounting overflowed u64")
        })?;
    let required_free = min_free_bytes
        .checked_add(checkpoint_bytes)
        .ok_or_else(|| {
            Report::new(LocalDiskError::Capacity)
                .attach_printable("checkpoint free-space accounting overflowed u64")
        })?;
    if projected > max_workspace_bytes || available_bytes < required_free {
        return Err(Report::new(LocalDiskError::Capacity).attach_printable(format!(
            "run needs {checkpoint_bytes} bytes of checkpoint headroom; projected aggregate is {projected}/{max_workspace_bytes} RUNNER_MAX_WORKSPACE_BYTES and free space is {available_bytes}/{required_free} required RUNNER_MIN_FREE_BYTES"
        )));
    }
    write_reservation(reservation_path, checkpoint_bytes)
}

pub fn scavenge_staging(
    root: &Path,
    max_age: Duration,
    max_bytes: u64,
) -> Result<Vec<PathBuf>, Report<LocalDiskError>> {
    std::fs::create_dir_all(root)
        .change_context(LocalDiskError::Scavenge)
        .attach_printable("create staging root")?;
    let now = SystemTime::now();
    let mut abandoned = Vec::new();
    for entry in std::fs::read_dir(root)
        .change_context(LocalDiskError::Scavenge)
        .attach_printable("read staging root")?
    {
        let entry = entry.change_context(LocalDiskError::Scavenge)?;
        if !entry
            .file_type()
            .change_context(LocalDiskError::Scavenge)?
            .is_dir()
        {
            continue;
        }
        let path = entry.path();
        let lock = open_lock(&path.join(OWNER_LOCK)).change_context(LocalDiskError::Scavenge)?;
        if !lock
            .try_lock_exclusive()
            .change_context(LocalDiskError::Scavenge)?
        {
            continue;
        }
        let modified = entry
            .metadata()
            .change_context(LocalDiskError::Scavenge)?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH);
        abandoned.push((path, modified));
    }
    abandoned.sort_by_key(|(_path, modified)| *modified);
    let mut total = tree_size_excluding(root, &[OWNER_LOCK])?;
    let mut removed = Vec::new();
    for (path, modified) in abandoned {
        let expired = now.duration_since(modified).unwrap_or_default() >= max_age;
        if !expired && total <= max_bytes {
            continue;
        }
        let size = tree_size_excluding(&path, &[OWNER_LOCK])?;
        let lock = open_lock(&path.join(OWNER_LOCK)).change_context(LocalDiskError::Scavenge)?;
        if !lock
            .try_lock_exclusive()
            .change_context(LocalDiskError::Scavenge)?
        {
            continue;
        }
        remove_claimed_directory(&path, lock)?;
        total = total.saturating_sub(size);
        removed.push(path);
    }
    Ok(removed)
}

pub fn tree_size(path: &Path) -> Result<u64, Report<LocalDiskError>> {
    tree_size_excluding(path, &[])
}

fn tree_size_excluding(
    path: &Path,
    excluded_names: &[&str],
) -> Result<u64, Report<LocalDiskError>> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(Report::new(error).change_context(LocalDiskError::Inspect)),
    };
    if !metadata.file_type().is_dir() {
        return Ok(metadata.len());
    }
    let mut total = 0_u64;
    for entry in std::fs::read_dir(path).change_context(LocalDiskError::Inspect)? {
        let entry = entry.change_context(LocalDiskError::Inspect)?;
        let name = entry.file_name();
        if excluded_names
            .iter()
            .any(|excluded| name == std::ffi::OsStr::new(excluded))
        {
            continue;
        }
        total = total
            .checked_add(tree_size_excluding(&entry.path(), excluded_names)?)
            .ok_or_else(|| {
                Report::new(LocalDiskError::Inspect)
                    .attach_printable("local disk byte accounting overflowed u64")
            })?;
    }
    Ok(total)
}

fn sum_reservations(root: &Path) -> Result<u64, Report<LocalDiskError>> {
    let mut total = 0_u64;
    for directory in child_directories_recursive(root)? {
        let path = directory.join(RESERVATION);
        let value = match std::fs::read_to_string(&path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(Report::new(error)
                    .change_context(LocalDiskError::Inspect)
                    .attach_printable(format!("read disk reservation {}", path.display())))
            }
        };
        let bytes = value.trim().parse::<u64>().map_err(|error| {
            Report::new(error)
                .change_context(LocalDiskError::Inspect)
                .attach_printable(format!("decode disk reservation {}", path.display()))
        })?;
        total = total.checked_add(bytes).ok_or_else(|| {
            Report::new(LocalDiskError::Inspect)
                .attach_printable("workspace reservations overflowed u64")
        })?;
    }
    Ok(total)
}

fn read_reservation(path: &Path) -> Result<Option<u64>, Report<LocalDiskError>> {
    let value = match std::fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(Report::new(error)
                .change_context(LocalDiskError::Inspect)
                .attach_printable(format!("read disk reservation {}", path.display())))
        }
    };
    value.trim().parse::<u64>().map(Some).map_err(|error| {
        Report::new(error)
            .change_context(LocalDiskError::Inspect)
            .attach_printable(format!("decode disk reservation {}", path.display()))
    })
}

fn child_directories_recursive(root: &Path) -> Result<Vec<PathBuf>, Report<LocalDiskError>> {
    let mut pending = vec![root.to_owned()];
    let mut result = Vec::new();
    while let Some(path) = pending.pop() {
        result.push(path.clone());
        for entry in std::fs::read_dir(&path).change_context(LocalDiskError::Inspect)? {
            let entry = entry.change_context(LocalDiskError::Inspect)?;
            if entry
                .file_type()
                .change_context(LocalDiskError::Inspect)?
                .is_dir()
            {
                pending.push(entry.path());
            }
        }
    }
    Ok(result)
}

fn open_lock(path: &Path) -> Result<File, std::io::Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
}

fn write_reservation(path: &Path, bytes: u64) -> Result<(), Report<LocalDiskError>> {
    let mut reservation = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .change_context(LocalDiskError::Claim)
        .attach_printable("create workspace disk reservation")?;
    writeln!(reservation, "{bytes}")
        .change_context(LocalDiskError::Claim)
        .attach_printable("write workspace disk reservation")?;
    reservation
        .sync_all()
        .change_context(LocalDiskError::Claim)
        .attach_printable("fsync workspace disk reservation")
}

/// Renaming while holding the ownership lock prevents a new claimant from
/// racing deletion. A claimant may recreate the original path only after the
/// abandoned directory has moved aside, so it cannot be removed by this pass.
fn remove_claimed_directory(path: &Path, lock: File) -> Result<(), Report<LocalDiskError>> {
    let parent = path.parent().ok_or_else(|| {
        Report::new(LocalDiskError::Scavenge)
            .attach_printable(format!("scavenge path {} has no parent", path.display()))
    })?;
    let quarantine = parent.join(format!(".scavenge-{}", uuid::Uuid::new_v4()));
    std::fs::rename(path, &quarantine)
        .change_context(LocalDiskError::Scavenge)
        .attach_printable(format!("quarantine abandoned directory {}", path.display()))?;
    drop(lock);
    std::fs::remove_dir_all(&quarantine)
        .change_context(LocalDiskError::Scavenge)
        .attach_printable(format!(
            "remove quarantined directory {}",
            quarantine.display()
        ))
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;

    fn limits(max_workspace_bytes: u64) -> LocalDiskLimits {
        LocalDiskLimits {
            max_workspace_bytes,
            max_cache_bytes: 1024,
            min_free_bytes: 0,
            max_staging_bytes: 1024,
            max_staging_age: Duration::from_secs(60),
        }
    }

    #[tokio::test]
    async fn admission_queues_until_exact_restore_headroom_is_released() {
        let root = tempfile::tempdir().unwrap();
        let budget = WorkspaceBudget::new(root.path(), limits(20)).unwrap();
        let first = budget
            .acquire(&root.path().join("first"), 10)
            .await
            .unwrap();
        let waiting = {
            let budget = Arc::clone(&budget);
            let path = root.path().join("second");
            tokio::spawn(async move { budget.acquire(&path, 1).await.unwrap() })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!waiting.is_finished());
        drop(first);
        let second = waiting.await.unwrap();
        assert_eq!(second.path(), root.path().join("second"));
    }

    #[tokio::test]
    async fn impossible_restore_fails_instead_of_queueing_forever() {
        let root = tempfile::tempdir().unwrap();
        let budget = WorkspaceBudget::new(root.path(), limits(20)).unwrap();
        let error = budget
            .acquire(&root.path().join("too-large"), 11)
            .await
            .expect_err("restore and checkpoint cannot fit");
        assert_eq!(error.current_context(), &LocalDiskError::Capacity);
    }

    #[tokio::test]
    async fn materialization_retains_one_exact_checkpoint_copy_not_the_database_cap() {
        let root = tempfile::tempdir().unwrap();
        let budget = WorkspaceBudget::new(root.path(), limits(40)).unwrap();
        let mut guard = budget.acquire(&root.path().join("run"), 10).await.unwrap();
        std::fs::write(guard.path().join("store.duckdb"), [0_u8; 10]).unwrap();
        guard.materialized().unwrap();
        let usage = budget.usage().unwrap();
        assert_eq!(usage.workspace_bytes, 10);
        assert_eq!(usage.reserved_bytes, 10);
    }

    #[tokio::test]
    async fn database_growth_refreshes_headroom_and_fails_at_the_hard_boundary() {
        let root = tempfile::tempdir().unwrap();
        let budget = WorkspaceBudget::new(root.path(), limits(30)).unwrap();
        let workspace = root.path().join("run");
        let mut guard = budget.acquire(&workspace, 0).await.unwrap();
        let database = workspace.join("store.duckdb");
        std::fs::write(&database, [0_u8; 10]).unwrap();
        guard.materialized().unwrap();
        std::fs::write(&database, [0_u8; 16]).unwrap();
        let error =
            refresh_checkpoint_reservation(root.path(), &workspace.join(RESERVATION), 16, 30, 0)
                .expect_err("database and its next checkpoint cannot exceed the aggregate cap");
        assert_eq!(error.current_context(), &LocalDiskError::Capacity);
    }

    #[test]
    fn scavenger_removes_abandoned_but_never_locked_directories() {
        let root = tempfile::tempdir().unwrap();
        let budget = WorkspaceBudget::new(root.path(), limits(1024)).unwrap();
        let active = OwnedDirectory::claim(&root.path().join("active")).unwrap();
        let abandoned_path = root.path().join("abandoned");
        let abandoned = OwnedDirectory::claim(&abandoned_path).unwrap();
        drop(abandoned);
        let removed = budget.scavenge_abandoned().unwrap();
        assert_eq!(removed, vec![abandoned_path]);
        assert!(active.path().exists());
    }

    #[test]
    fn scavenger_removes_a_crash_between_workspace_creation_and_locking() {
        let root = tempfile::tempdir().unwrap();
        let budget = WorkspaceBudget::new(root.path(), limits(1024)).unwrap();
        let orphan = root.path().join("tenant/integration");
        std::fs::create_dir_all(&orphan).unwrap();
        std::fs::write(orphan.join(".state-generation"), "not-yet-claimed").unwrap();
        assert_eq!(budget.scavenge_abandoned().unwrap(), vec![orphan.clone()]);
        assert!(!orphan.exists());
    }

    #[test]
    fn staging_scavenger_respects_active_lock_even_when_over_budget() {
        let root = tempfile::tempdir().unwrap();
        let active = OwnedDirectory::claim(&root.path().join("active")).unwrap();
        std::fs::write(active.path().join("large.stage"), vec![0; 32]).unwrap();
        let abandoned_path = root.path().join("abandoned");
        let abandoned = OwnedDirectory::claim(&abandoned_path).unwrap();
        std::fs::write(abandoned.path().join("old.stage"), vec![0; 32]).unwrap();
        drop(abandoned);
        let removed = scavenge_staging(root.path(), Duration::MAX, 32).unwrap();
        assert_eq!(removed, vec![abandoned_path]);
        assert!(active.path().exists());
    }
}
