//! User-fault and engine error contexts (error-stack style: plain context
//! types carried by `Report`, `change_context` at module boundaries,
//! `attach_printable` for detail).

use core::error::Error;
use core::fmt;

/// A user fault in integration configuration: YAML shape, missing fields,
/// broken references, unresolved env vars. Carries every issue found so an
/// author fixes the config in one pass instead of raise-by-raise.
/// Deterministic by definition: orchestrators cancel on it, never retry.
#[derive(Debug, Clone, PartialEq, Eq)]
#[must_use]
pub struct ConfigError {
    pub issues: Vec<Issue>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    pub path: Option<String>,
    pub message: String,
}

impl Issue {
    pub fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            path: Some(path.into()),
            message: message.into(),
        }
    }

    pub fn bare(message: impl Into<String>) -> Self {
        Self {
            path: None,
            message: message.into(),
        }
    }
}

impl ConfigError {
    pub fn new(issues: Vec<Issue>) -> Self {
        Self { issues }
    }

    pub fn bare(message: impl Into<String>) -> Self {
        Self {
            issues: vec![Issue::bare(message)],
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.issues.as_slice() {
            [Issue {
                path: None,
                message,
            }] => fmt.write_str(message),
            issues => {
                fmt.write_str("invalid integration config:")?;
                for issue in issues {
                    match &issue.path {
                        Some(path) => write!(fmt, "\n  - {path}: {}", issue.message)?,
                        None => write!(fmt, "\n  - {}", issue.message)?,
                    }
                }
                Ok(())
            }
        }
    }
}

impl Error for ConfigError {}

/// A store (DuckDB) operation failed.
#[derive(Debug)]
#[must_use]
pub struct StoreError;

impl fmt::Display for StoreError {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt.write_str("store operation failed")
    }
}

impl Error for StoreError {}

/// A durable blob operation failed. The concrete provider error is attached
/// to the report without exposing credentials or signed request URLs.
#[derive(Debug)]
#[must_use]
pub struct BlobError;

impl fmt::Display for BlobError {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt.write_str("blob storage operation failed")
    }
}

impl Error for BlobError {}

/// Restoring or committing the durable integration state failed.
#[derive(Debug)]
#[must_use]
pub struct StateError;

impl fmt::Display for StateError {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt.write_str("durable state operation failed")
    }
}

impl Error for StateError {}

/// A production preflight or durable-store integrity check failed.
#[derive(Debug)]
#[must_use]
pub struct DiagnosticsError;

impl fmt::Display for DiagnosticsError {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt.write_str("production diagnostics failed")
    }
}

impl Error for DiagnosticsError {}

/// A graph API request failed after retries and fallbacks.
#[derive(Debug)]
#[must_use]
pub struct GraphError;

impl fmt::Display for GraphError {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt.write_str("graph API operation failed")
    }
}

impl Error for GraphError {}

/// State/graph coherence failed: the state dir does not belong to the target
/// graph. Non-retryable by definition.
#[derive(Debug)]
#[must_use]
pub struct CoherenceError;

impl fmt::Display for CoherenceError {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt.write_str("state/graph coherence check failed")
    }
}

impl Error for CoherenceError {}

/// A source failed to hydrate or sync (per-source isolation boundary).
#[derive(Debug)]
#[must_use]
pub struct SourceError;

impl fmt::Display for SourceError {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt.write_str("source sync failed")
    }
}

impl Error for SourceError {}

/// A run-level failure (workflow, admission, lifecycle).
#[derive(Debug)]
#[must_use]
pub struct RunError;

impl fmt::Display for RunError {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt.write_str("integration run failed")
    }
}

impl Error for RunError {}
