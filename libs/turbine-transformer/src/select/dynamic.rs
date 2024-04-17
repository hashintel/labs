use alloc::{boxed::Box, vec};

use turbine::entity::EntityId;

use crate::{
    select::{Clause, Statement},
    View,
};

type DynamicMatchFn<'a> = dyn Fn(&View, EntityId) -> bool + 'a;
type BoxedDynamicMatchFn = Box<DynamicMatchFn<'static>>;

pub struct DynamicMatch {
    dynamic: BoxedDynamicMatchFn,
}

impl DynamicMatch {
    combinator!(or<'a>, and<'a>, not<'a>);

    #[must_use]
    pub fn new(dynamic: impl Fn(&View, EntityId) -> bool + 'static) -> Self {
        Self {
            dynamic: Box::new(dynamic),
        }
    }

    pub(crate) fn matches(&self, view: &View, node: EntityId) -> bool {
        (self.dynamic)(view, node)
    }
}

impl<'a> From<DynamicMatch> for Clause<'a> {
    fn from(dynamic: DynamicMatch) -> Self {
        Clause::Dynamic(dynamic)
    }
}

impl<'a> From<DynamicMatch> for Statement<'a> {
    fn from(dynamic: DynamicMatch) -> Self {
        Self {
            if_: dynamic.into(),
            left: None,
            right: None,
        }
    }
}
