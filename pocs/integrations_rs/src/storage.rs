//! Sandboxed local inputs supplied by the operator. Durable bronze, named
//! checkpoints, and DuckDB state live in the blob repositories instead; this
//! type remains only for explicitly local `external` source keys.

use std::path::{Path, PathBuf};

use error_stack::{Report, ResultExt as _};

use crate::error::StoreError;

#[derive(Debug, Clone)]
pub struct Storage {
    root: PathBuf,
}

impl Storage {
    pub fn local(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn prepare(&self) -> Result<(), Report<StoreError>> {
        std::fs::create_dir_all(&self.root)
            .change_context(StoreError)
            .attach_printable("prepare local storage")
    }

    fn validate_key(key: &str) -> Result<(), Report<StoreError>> {
        if Path::new(key).is_absolute() || key.contains("..") {
            return Err(Report::new(StoreError)
                .attach_printable(format!("storage key must be relative without '..': {key}")));
        }
        Ok(())
    }

    /// Local filesystem path for a key: what DuckDB reads and what provenance
    /// renders.
    pub fn uri_for(&self, key: &str) -> Result<String, Report<StoreError>> {
        Self::validate_key(key)?;
        Ok(self.root.join(key).display().to_string())
    }

    /// The store's allowed-directories entry for this storage root.
    pub fn root(&self) -> &Path {
        &self.root
    }
}
