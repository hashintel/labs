//! The checkable-property catalog.
//!
//! Each property is a stable, named claim about the kernel. Safety
//! properties must hold at every evaluation point; coverage properties
//! name the failure windows a test campaign must actually produce for the
//! safety checks to have been tested.
//!
//! The deterministic-simulation harness evaluates the catalog two ways:
//! property-based tests (proptest-generated schedules, shrinking a failure
//! to a minimal action sequence) check every safety property, and the
//! seeded campaign additionally accounts for coverage. See
//! `local/docs/property-catalog.md`.
//!
//! IDs are frozen: docs, TLA+ cross-references, and triage notes key on
//! them. Retire a property instead of renaming it.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PropertyClass {
    /// Must hold at every evaluation point.
    Safety,
    /// Must occur at least once per campaign.
    Coverage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Property {
    pub id: &'static str,
    pub class: PropertyClass,
    /// One sentence, present tense, checkable. For a `Safety` property
    /// this is the invariant; for a `Coverage` property, the situation a
    /// campaign must produce.
    pub statement: &'static str,
}

// Safety properties. KRN-A1 through KRN-A5 are the executable image of
// the `specs/LogCursor.tla` invariants (TLC-checked; see `specs/README.md`
// for the axiom-to-contract mapping); the statements here and the spec
// invariants must remain the same sentence in two languages.

/// See also `validate_recovered_prefix`, which enforces the same claim
/// inside the production loop; this property checks it from outside.
pub const ACK_IMPLIES_DURABLE: Property = Property {
    id: "KRN-A1-ACK-IMPLIES-DURABLE",
    class: PropertyClass::Safety,
    statement: "every event acknowledged Applied is in the durable prefix",
};

pub const DURABLE_END_MONOTONIC: Property = Property {
    id: "KRN-A2-DURABLE-END-MONOTONIC",
    class: PropertyClass::Safety,
    statement: "the durable end watermark never regresses",
};

pub const PROJECTION_IS_FOLD_OF_DURABLE_PREFIX: Property = Property {
    id: "KRN-A3-PROJECTION-REFOLD",
    class: PropertyClass::Safety,
    statement:
        "the served projection equals an independent fold of the durable prefix, deduplicated by \
         event identity",
};

pub const ACKED_EVENT_SURVIVES_RECOVERY: Property = Property {
    id: "KRN-A4-ACK-SURVIVES-RECOVERY",
    class: PropertyClass::Safety,
    statement: "recovery never loses or changes an acknowledged event",
};

pub const EVENT_ACKED_APPLIED_ONCE: Property = Property {
    id: "KRN-A5-APPLIED-ONCE",
    class: PropertyClass::Safety,
    statement: "one event identity is acknowledged Applied at most once",
};

pub const REJECTED_NEVER_DURABLE: Property = Property {
    id: "KRN-A6-REJECTED-NEVER-DURABLE",
    class: PropertyClass::Safety,
    statement: "an event the fold rejected never appears in the durable prefix",
};

// Effect-execution safety: the at-least-once contract of the hosted
// executor, checked against an external ledger that records every execution, repeats included.

pub const EFFECT_REPLAYS_ARE_IDENTICAL: Property = Property {
    id: "KRN-A7-EFFECT-REPLAY-IDENTICAL",
    class: PropertyClass::Safety,
    statement: "every execution of one effect identity carries a byte-identical payload",
};

pub const DURABLE_COMPLETION_IMPLIES_EXECUTED: Property = Property {
    id: "KRN-A8-COMPLETION-IMPLIES-EXECUTED",
    class: PropertyClass::Safety,
    statement:
        "every effect whose completion event is durable was executed against the external world \
         at least once",
};

pub const PLAN_REACHES_FIXPOINT: Property = Property {
    id: "KRN-A9-PLAN-FIXPOINT",
    class: PropertyClass::Safety,
    statement:
        "executing planned effects and folding their completions drains plan to empty in bounded \
         turns",
};

pub const DURABLE_EVENTS_HAVE_PROVENANCE: Property = Property {
    id: "KRN-A10-DURABLE-HAS-PROVENANCE",
    class: PropertyClass::Safety,
    statement:
        "every event in the durable prefix was proposed by a client of the loop — the journal \
         invents nothing",
};

// Coverage properties: the failure windows a schedule campaign must
// actually produce for the safety properties to have been tested.

pub const ADOPTED_AMBIGUOUS_DURABLE_APPEND: Property = Property {
    id: "KRN-S1-AMBIGUOUS-DURABLE-ADOPTED",
    class: PropertyClass::Coverage,
    statement:
        "an append that was durable but unacknowledged is adopted by recovery and acknowledged \
         AlreadyDurable",
};

pub const RETRIED_AMBIGUOUS_LOST_APPEND: Property = Property {
    id: "KRN-S2-AMBIGUOUS-LOST-RETRIED",
    class: PropertyClass::Coverage,
    statement:
        "an append that was lost with an unknown commit is proven absent and retried to Applied",
};

pub const WRITER_FENCED: Property = Property {
    id: "KRN-S3-WRITER-FENCED",
    class: PropertyClass::Coverage,
    statement: "a writer is fenced by a newer epoch and the loop stops instead of resolving",
};

pub const CRASH_WITH_UNACKNOWLEDGED_DURABLE_EVENT: Property = Property {
    id: "KRN-S4-CRASH-UNACKED-DURABLE",
    class: PropertyClass::Coverage,
    statement: "a crash happens while the durable prefix holds an event no caller saw acknowledged",
};

pub const DUPLICATE_SUBMISSION_ABSORBED: Property = Property {
    id: "KRN-S5-DUPLICATE-ABSORBED",
    class: PropertyClass::Coverage,
    statement: "a byte-identical resubmission is acknowledged AlreadyDurable without a new append",
};

pub const RECOVERY_REPLAYED_NONEMPTY_PREFIX: Property = Property {
    id: "KRN-S6-RECOVERY-NONEMPTY",
    class: PropertyClass::Coverage,
    statement: "recovery replays a non-empty durable prefix into a projection",
};

pub const RECOVERY_BOUNDED_BY_SNAPSHOT: Property = Property {
    id: "KRN-S7-SNAPSHOT-BOUNDED-RECOVERY",
    class: PropertyClass::Coverage,
    statement: "recovery restores from a committed snapshot and replays only the suffix",
};

pub const CORRUPT_SNAPSHOT_FELL_BACK: Property = Property {
    id: "KRN-S8-SNAPSHOT-CORRUPTION-FALLBACK",
    class: PropertyClass::Coverage,
    statement:
        "recovery meets a corrupted snapshot and completes correctly from an older snapshot or \
         full replay",
};

pub const EFFECT_EXECUTED_MORE_THAN_ONCE: Property = Property {
    id: "KRN-S9-EFFECT-REEXECUTED",
    class: PropertyClass::Coverage,
    statement: "one effect identity executes more than once because its completion was lost",
};

/// Every catalogued property, for exhaustive coverage accounting.
pub const CATALOG: &[Property] = &[
    ACK_IMPLIES_DURABLE,
    DURABLE_END_MONOTONIC,
    PROJECTION_IS_FOLD_OF_DURABLE_PREFIX,
    ACKED_EVENT_SURVIVES_RECOVERY,
    EVENT_ACKED_APPLIED_ONCE,
    REJECTED_NEVER_DURABLE,
    EFFECT_REPLAYS_ARE_IDENTICAL,
    DURABLE_COMPLETION_IMPLIES_EXECUTED,
    PLAN_REACHES_FIXPOINT,
    DURABLE_EVENTS_HAVE_PROVENANCE,
    ADOPTED_AMBIGUOUS_DURABLE_APPEND,
    RETRIED_AMBIGUOUS_LOST_APPEND,
    WRITER_FENCED,
    CRASH_WITH_UNACKNOWLEDGED_DURABLE_EVENT,
    DUPLICATE_SUBMISSION_ABSORBED,
    RECOVERY_REPLAYED_NONEMPTY_PREFIX,
    RECOVERY_BOUNDED_BY_SNAPSHOT,
    CORRUPT_SNAPSHOT_FELL_BACK,
    EFFECT_EXECUTED_MORE_THAN_ONCE,
];

/// Sink for coverage observations. The harness owns one per campaign and
/// checks it against [`CATALOG`] when the campaign ends.
pub trait CoverageSink {
    fn observe(&mut self, property: &Property);
}

/// Asserts a safety property at one evaluation point. A violation panics
/// with the property ID, statement, and caller-supplied detail; the
/// harness attaches whatever replays the run (a shrunk schedule or a
/// seed plus action trace).
#[track_caller]
pub fn check(property: &Property, condition: bool, detail: impl fmt::Display) {
    debug_assert_eq!(property.class, PropertyClass::Safety);
    assert!(
        condition,
        "property {} violated: {} — {detail}",
        property.id, property.statement
    );
}

/// Records that a coverage property occurred here. Never fails a single
/// run; the campaign fails if the property never occurs.
pub fn covered(sink: &mut dyn CoverageSink, property: &Property, condition: bool) {
    debug_assert_eq!(property.class, PropertyClass::Coverage);
    if condition {
        sink.observe(property);
    }
}
