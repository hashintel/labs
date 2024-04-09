//! Adapted copy of: <https://github.com/hashintel/hash/blob/715b69a7ae583036f989f5073acd6dc7022a1625/apps/hash-graph/lib/graph/src/shared/identifier/time.rs>

use serde::{Deserialize, Serialize};
use time::{serde::iso8601, OffsetDateTime};

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "limit")]
pub enum OpenTemporalBound {
    Exclusive(Timestamp),
    Unbounded,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "limit")]
pub enum ClosedTemporalBound {
    Inclusive(Timestamp),
}

/// Opaque structure to represent a single point in time.
///
/// The type parameter `A` is the time axis to distinguish between different time axes at compile
/// time.
// A generic parameter is used here to avoid implementing the same struct multiple times or using
// macros. It's reused in other time-related structs as well. This implies that trait bounds are
// not required for trait implementations.
#[derive(Debug, Copy, Clone, Ord, PartialOrd, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Timestamp {
    #[serde(with = "iso8601")]
    pub time: OffsetDateTime,
}

#[derive(Debug, Copy, Clone, Ord, PartialOrd, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct Interval<S, E> {
    pub start: S,
    pub end: E,
}

// TODO: we auto derive here, which is not correct. Problem: it is a lot more complicated to adapt
//  the code as we removed some generics and complexity

/// A temporal interval, where the lower bound is inclusive and the upper bound is either exclusive
/// or unbounded.
pub type LeftClosedTemporalInterval = Interval<ClosedTemporalBound, OpenTemporalBound>;
