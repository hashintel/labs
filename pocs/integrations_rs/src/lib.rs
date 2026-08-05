// The ex-lab cargo config injects the HASH-repo lint list; correctness and
// suspicious lints stay hot. The allows below are doc-shape and numeric-cast
// pedantry that adds noise, not safety, here: string indexing operates on
// regex-validated ASCII, casts are row counts and durations.
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
    // Deliberate: cheap handle clones (Store, Arc callbacks) read better as
    // .clone(); Reports render via {:?} on purpose; faithful ports keep the
    // reference implementation's function shapes; mod.rs is this crate's
    // module layout.
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

pub mod application;
pub mod blob;
pub mod build;
pub mod coerce;
pub mod config;
pub mod dlq;
pub mod durable_artifacts;
pub mod error;
pub mod identity;
pub mod kernel;
pub mod local_disk;
pub mod orchestrator;
pub mod production;
pub mod progress;
pub mod run_manifest;
pub mod run_slots;
pub mod runtime_settings;
pub mod secret;
pub mod snapshot;
pub mod steps;
pub mod storage;
pub mod store;
pub mod throttle;
pub mod value;
pub mod web_api;
pub mod yaml;

pub mod connectors;
pub mod graph;

pub mod engine {
    pub mod asserts;
    pub mod batch_sync;
    pub(crate) mod candidate;
    pub mod event_store;
    pub mod event_table;
    pub(crate) mod source_capture;
    pub mod topology;
}

pub mod http {
    pub mod egress;
    pub mod pacer;
    pub mod retry;
}
