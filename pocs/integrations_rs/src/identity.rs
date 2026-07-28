//! Integration identity and state layout, matching the TS/Elixir runners:
//! state lives at `{base_dir}/state/{web_id}/{connector_id}/` with
//! `store.duckdb` and a `staging/` directory beside it.

use std::io::Write as _;
use std::path::{Component, Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntegrationId {
    pub web_id: String,
    pub connector_id: String,
    pub canonical: String,
    pub config_hash: String,
}

pub fn integration_id(yaml: &Value, web_id: &str) -> IntegrationId {
    let connector_id = yaml
        .get("connector")
        .and_then(|connector| connector.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_owned();

    let digest = Sha256::digest(serde_json::to_string(yaml).unwrap_or_default());

    IntegrationId {
        canonical: format!("{web_id}:{connector_id}"),
        config_hash: hex::encode(digest)[..12].to_owned(),
        web_id: web_id.to_owned(),
        connector_id,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatePaths {
    pub duckdb: PathBuf,
    pub staging: PathBuf,
    /// Stable for the lifetime of this local/shared state directory. Durable
    /// checkpoints use it to avoid reusing results on a worker that does not
    /// have the DuckDB and staging data that produced them.
    pub generation: String,
}

impl StatePaths {
    pub fn root(&self) -> &Path {
        self.duckdb
            .parent()
            .expect("state_paths always constructs a database below its root")
    }
}

pub(crate) fn is_safe_state_component(value: &str) -> bool {
    if value.contains(['/', '\\']) {
        return false;
    }
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

pub fn state_paths(base_dir: &str, id: &IntegrationId) -> std::io::Result<StatePaths> {
    for (label, value) in [("web id", &id.web_id), ("connector id", &id.connector_id)] {
        if !is_safe_state_component(value) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("{label} must be one safe path component: {value:?}"),
            ));
        }
    }

    let root = PathBuf::from(base_dir)
        .join("state")
        .join(&id.web_id)
        .join(&id.connector_id);
    let staging = root.join("staging");
    std::fs::create_dir_all(&staging)?;
    let generation = state_generation(&root)?;

    Ok(StatePaths {
        duckdb: root.join("store.duckdb"),
        staging,
        generation,
    })
}

fn state_generation(root: &Path) -> std::io::Result<String> {
    let marker = root.join(".state-generation");
    match read_generation(&marker) {
        Ok(generation) => return Ok(generation),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    // Write and fsync a unique temporary file, then publish it with a hard
    // link. The link is atomic and never overwrites a concurrently-created
    // generation marker.
    let candidate = uuid::Uuid::new_v4().to_string();
    let temporary = root.join(format!(".state-generation.{candidate}.tmp"));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(candidate.as_bytes())?;
    file.sync_all()?;
    drop(file);

    let publish = std::fs::hard_link(&temporary, &marker);
    let _ = std::fs::remove_file(&temporary);
    match publish {
        Ok(()) => read_generation(&marker),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => read_generation(&marker),
        Err(error) => Err(error),
    }
}

fn read_generation(path: &Path) -> std::io::Result<String> {
    let value = std::fs::read_to_string(path)?;
    let value = value.trim();
    uuid::Uuid::parse_str(value).map_err(|error| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "invalid state generation marker {}: {error}",
                path.display()
            ),
        )
    })?;
    Ok(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{is_safe_state_component, state_paths, IntegrationId};

    #[test]
    fn state_ids_cannot_escape_the_runner_root() {
        for unsafe_id in ["", ".", "..", "../outside", "nested/id", "/tmp/outside"] {
            assert!(!is_safe_state_component(unsafe_id), "{unsafe_id:?}");
        }
        assert!(is_safe_state_component("tenant:connector-1"));

        let id = IntegrationId {
            web_id: "web".to_owned(),
            connector_id: "../outside".to_owned(),
            canonical: "web:../outside".to_owned(),
            config_hash: String::new(),
        };
        assert_eq!(
            state_paths("/tmp/runner", &id)
                .expect_err("unsafe connector id")
                .kind(),
            std::io::ErrorKind::InvalidInput
        );
    }

    #[test]
    fn state_generation_is_stable_per_directory_and_unique_across_directories() {
        let root = tempfile::tempdir().expect("temporary root");
        let id = IntegrationId {
            web_id: "web".to_owned(),
            connector_id: "connector".to_owned(),
            canonical: "web:connector".to_owned(),
            config_hash: String::new(),
        };
        let first =
            state_paths(root.path().to_str().expect("UTF-8 path"), &id).expect("first state path");
        let second =
            state_paths(root.path().to_str().expect("UTF-8 path"), &id).expect("second state path");
        assert_eq!(first.generation, second.generation);

        let other_root = tempfile::tempdir().expect("other temporary root");
        let other = state_paths(other_root.path().to_str().expect("UTF-8 path"), &id)
            .expect("other state path");
        assert_ne!(first.generation, other.generation);
    }
}
