//! Domain-agnostic durable kernel.
//!
//! Extraction target described in `local/docs/durable-kernel-split.md`. The
//! integrations orchestrator is being split so the log/lease/projection
//! machinery can serve other domains; modules land here step by step.

pub(crate) mod domain;
pub mod keyspace;
