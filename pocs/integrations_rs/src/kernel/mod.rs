//! Domain-agnostic durable kernel: the keyspace, the [`port::Domain`]
//! contract the fenced log machinery is generic over, and the hosted-domain
//! layer with its runtime. Design rationale lives in
//! `local/docs/durable-kernel-split.md` and `local/docs/domain-api.md`.

#[allow(
    dead_code,
    reason = "library surface with no binary consumer; exercised by its test suite"
)]
pub(crate) mod domain;
pub mod keyspace;
pub(crate) mod port;
#[allow(
    dead_code,
    reason = "library surface with no binary consumer; exercised by its test suite"
)]
pub(crate) mod runtime;
