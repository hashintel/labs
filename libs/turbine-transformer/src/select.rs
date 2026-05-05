use alloc::{collections::BTreeSet, vec::Vec};

use petgraph::{graph::NodeIndex, visit::IntoNodeReferences};
use turbine::entity::EntityId;

use crate::View;

macro_rules! combinator {
    ($($v:lifetime ,)? or) => {
    #[must_use]
    pub fn or$(<$v>)?(self, other: impl Into<Clause<'a>>) -> Clause<'a> {
        let this = self.into();
        let other = other.into();

        if let Clause::Any(mut clauses) = other {
            clauses.insert(0, this);
            Clause::Any(clauses)
        } else {
            Clause::Any(vec![this, other])
        }
    }
    };

    ($($v:lifetime ,)? and) => {
    #[must_use]
    pub fn and$(<$v>)?(self, other: impl Into<Clause<'a>>) -> Clause<'a> {
        let this = self.into();
        let other = other.into();

        if let Clause::All(mut clauses) = other {
            clauses.insert(0, this);
            Clause::All(clauses)
        } else {
            Clause::All(vec![this, other])
        }
    }
    };

    ($($v:lifetime ,)? not) => {
    #[must_use]
    pub fn not$(<$v>)?(self) -> Clause<'a> {
        Clause::Not(Box::new(self.into()))
    }
    };

    ($($v:lifetime ,)? with_links) => {
    #[must_use]
    pub fn with_links$(<$v>)?(self) -> Statement<'a> {
        Statement::from(self)
    }
    };

    ($($v:lifetime ,)? into_statement) => {
    #[must_use]
    pub fn into_statement$(<$v>)?(self) -> Statement<'a> {
        Statement::from(self)
    }
    };

    ($($tt:ident $(<$v:lifetime>)?),+) => {
        $(combinator!($($v,)? $tt);)*
    };
}

mod clause;
mod dynamic;
mod property;
mod type_;

pub use clause::Clause;
pub use dynamic::DynamicMatch;
pub use property::{PathOrValue, PropertyMatch};
pub use type_::TypeMatch;

pub use crate::{
    path::{JsonPath, Segment},
    value::Value,
};

pub struct Statement<'a> {
    if_: Clause<'a>,

    left: Option<Clause<'a>>,
    right: Option<Clause<'a>>,
}

impl<'a> Statement<'a> {
    #[must_use]
    pub fn new(clause: impl Into<Clause<'a>>) -> Self {
        Self {
            if_: clause.into(),
            left: None,
            right: None,
        }
    }

    pub fn type_() -> TypeMatch<'a> {
        TypeMatch::new()
    }

    #[must_use]
    pub fn with_left(mut self, left: impl Into<Clause<'a>>) -> Self {
        self.left = Some(left.into());
        self
    }

    #[must_use]
    pub fn with_right(mut self, right: impl Into<Clause<'a>>) -> Self {
        self.right = Some(right.into());
        self
    }

    #[must_use]
    pub fn or_if(mut self, if_: impl Into<Clause<'a>>) -> Self {
        self.if_ = self.if_.or(if_);
        self
    }

    #[must_use]
    pub fn or_left(mut self, left: impl Into<Clause<'a>>) -> Self {
        let left = left.into();

        if let Some(this_left) = self.left {
            self.left = Some(this_left.or(left));
        } else {
            self.left = Some(left);
        }
        self
    }

    #[must_use]
    pub fn or_right(mut self, right: impl Into<Clause<'a>>) -> Self {
        let right = right.into();

        if let Some(this_right) = self.right {
            self.right = Some(this_right.or(right));
        } else {
            self.right = Some(right);
        }
        self
    }
}

impl<'a> From<Clause<'a>> for Statement<'a> {
    fn from(value: Clause<'a>) -> Self {
        Self {
            if_: value,
            left: None,
            right: None,
        }
    }
}

struct Select<'a> {
    statements: Vec<Statement<'a>>,
}

impl Select<'_> {
    fn eval_link(view: &View, link: Option<EntityId>, if_: Option<&Clause>) -> bool {
        let Some(if_) = if_ else {
            // completely skip checks for links if we have no if_ statement
            // important(!) we do not check if link is None here, as we want to allow both
            // to ensure that links are not allowed at all, `if_` must be set to an empty set
            return true;
        };

        let Some(link) = link else {
            // if we have an if_ statement, but no link, we fail
            // contrast to above, as we're in a very different context here, we need to know
            // if there are any links and only want to allow those
            return false;
        };

        let Some(node) = view.lookup.get(&link) else {
            // unable to find entity, not in graph, so skip
            return false;
        };

        let Some(&weight) = view.graph.node_weight(*node) else {
            // in theory infallible, but we're not going to panic here
            return false;
        };

        // We do not check if the link is ignored, because even if such a link exists, the node
        // connected is still valid.
        if_.matches(view, weight)
    }

    fn eval_statement(view: &View, id: EntityId, statement: &Statement) -> bool {
        if !statement.if_.matches(view, id) {
            return false;
        }

        if !Self::eval_link(
            view,
            view.entity_link(id).map(|link| link.left_entity_id),
            statement.left.as_ref(),
        ) {
            return false;
        }

        if !Self::eval_link(
            view,
            view.entity_link(id).map(|link| link.right_entity_id),
            statement.right.as_ref(),
        ) {
            return false;
        }

        true
    }

    fn eval(&self, view: &View, id: EntityId) -> bool {
        for statement in &self.statements {
            if Self::eval_statement(view, id, statement) {
                return true;
            }
        }

        false
    }

    fn run(self, view: &View) -> BTreeSet<NodeIndex> {
        let ignore = &view.exclude;

        let mut selected = BTreeSet::new();

        for (index, weight) in view.graph.node_references() {
            if ignore.contains(&index) {
                continue;
            }

            if self.eval(view, *weight) {
                selected.insert(index);
            }
        }

        selected
    }
}

impl View<'_> {
    pub fn select(&mut self, statements: Vec<Statement>) {
        let nodes = Select { statements }.run(self);

        self.exclude_complement(&nodes);
    }

    pub fn select_complement(&mut self, statements: Vec<Statement>) {
        let nodes = Select { statements }.run(self);

        self.exclude(&nodes);
    }
}
