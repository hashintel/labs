//! The durable execution kernel is an event-sourced, S3-backed control layer with
//! content-addressed identities, snapshot-bounded replay, and epoch-fenced
//! shard logs.
//!
//! A domain implements the user-facing traits in [`domain`]. Domains that need
//! full control implement the internal port in [`port`]. Both run through [`runtime`].
//! Storage layout is derived in [`keyspace`]. Record codecs register through
//! [`registry`]. Append and recovery are implemented in [`shard_log`].

// The workspace cargo config injects the HASH-repo lint list. Correctness
// and suspicious lints stay hot. The allows below are doc-shape and
// numeric-cast pedantry that adds noise without adding safety here. String indexing
// operates on validated ASCII, while casts represent counts and durations.
#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::must_use_candidate,
    clippy::return_self_not_must_use,
    clippy::too_long_first_doc_paragraph,
    clippy::doc_markdown,
    clippy::indexing_slicing,
    clippy::string_slice,
    clippy::option_if_let_else,
    clippy::missing_const_for_fn,
    clippy::map_unwrap_or,
    clippy::cast_possible_wrap,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_truncation,
    clippy::single_match_else,
    clippy::items_after_statements,
    // Cheap handle clones for Store and Arc callbacks read better as calls to
    // clone. Reports render through their debug representation. This crate
    // also uses mod.rs for its module layout.
    clippy::clone_on_ref_ptr,
    clippy::needless_pass_by_value,
    clippy::significant_drop_tightening,
    clippy::implicit_hasher,
    clippy::use_debug,
    clippy::too_many_lines,
    clippy::mod_module_files,
    clippy::self_named_module_files,
    clippy::large_enum_variant,
    clippy::match_same_arms,
    clippy::if_same_then_else,
    clippy::result_large_err,
    clippy::used_underscore_binding,
    clippy::ref_option,
    clippy::unused_async,
    clippy::format_collect,
    clippy::format_push_string,
    clippy::or_fun_call,
    clippy::assigning_clones,
    clippy::needless_collect,
    clippy::unnecessary_map_or,
    clippy::default_trait_access,
    clippy::redundant_clone,
    clippy::unwrap_in_result
)]

use std::fmt;

pub mod domain;
pub mod ids;
pub mod keyspace;
pub mod port;
pub mod properties;
pub mod registry;
pub mod routing;
pub mod runtime;
pub mod shard_log;
#[cfg(any(test, feature = "test-util"))]
pub mod sim;

/// Context for storage, envelope, or durable-worker failures.
#[derive(Debug)]
pub struct DurableError;

impl fmt::Display for DurableError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("durable kernel operation failed")
    }
}

impl std::error::Error for DurableError {}
