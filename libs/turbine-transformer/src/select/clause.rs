use alloc::{boxed::Box, vec, vec::Vec};

use turbine::entity::EntityId;

use crate::{
    select::{dynamic::DynamicMatch, property::PropertyMatch, type_::TypeMatch, Statement},
    View,
};

pub enum Clause<'a> {
    /// If empty, always true.
    All(Vec<Clause<'a>>),
    /// If empty, always false.
    Any(Vec<Clause<'a>>),
    Not(Box<Clause<'a>>),

    Type(TypeMatch<'a>),
    Dynamic(DynamicMatch),
    Property(PropertyMatch<'a>),
}

impl Clause<'_> {
    pub(crate) fn matches(&self, view: &View, id: EntityId) -> bool {
        match self {
            Self::All(clauses) => clauses.iter().all(|c| c.matches(view, id)),
            Self::Any(clauses) => clauses.iter().any(|c| c.matches(view, id)),
            Self::Not(clause) => !clause.matches(view, id),

            Self::Type(matches) => matches.matches(view, id),
            Self::Dynamic(matches) => matches.matches(view, id),
            Self::Property(matches) => matches.matches(view, id),
        }
    }

    #[must_use]
    pub fn or(self, other: impl Into<Self>) -> Self {
        let other = other.into();

        if let Self::Any(mut clauses) = self {
            clauses.push(other);
            return Self::Any(clauses);
        }

        Self::Any(vec![self, other])
    }

    #[must_use]
    pub fn and(self, other: impl Into<Self>) -> Self {
        let other = other.into();

        if let Self::All(mut clauses) = self {
            clauses.push(other);
            return Self::All(clauses);
        }

        Self::All(vec![self, other])
    }

    #[must_use]
    pub fn not(self) -> Self {
        Self::Not(Box::new(self))
    }
}

impl<'a> Clause<'a> {
    combinator!(with_links, into_statement);
}
