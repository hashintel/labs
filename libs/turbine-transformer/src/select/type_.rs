use alloc::{boxed::Box, collections::BTreeSet, vec};

use turbine::{entity::EntityId, TypeUrl, VersionedUrlRef};

use crate::{
    select::{Clause, Statement},
    View,
};

pub struct TypeMatch<'a> {
    ids: BTreeSet<EntityId>,
    types: BTreeSet<VersionedUrlRef<'static>>,

    inherits_from: BTreeSet<VersionedUrlRef<'a>>,
}

impl TypeMatch<'_> {
    pub(crate) fn matches(&self, view: &View, id: EntityId) -> bool {
        if self.ids.contains(&id) {
            return true;
        }

        let Some(type_) = view.entity_type(id) else {
            return false;
        };

        if self.types.contains(&type_) {
            return true;
        }

        let inherits_from = (view.lookup_inherits_from)(type_);

        let common = self.inherits_from.intersection(&inherits_from).count();
        if common > 0 {
            return true;
        }

        false
    }

    #[must_use]
    pub const fn new() -> Self {
        Self {
            ids: BTreeSet::new(),
            types: BTreeSet::new(),
            inherits_from: BTreeSet::new(),
        }
    }

    #[must_use]
    pub fn or_id(mut self, id: EntityId) -> Self {
        self.ids.insert(id);
        self
    }

    #[must_use]
    pub fn or_type<T: TypeUrl>(mut self) -> Self {
        self.types.insert(T::ID);
        self
    }

    #[must_use]
    pub fn or_inherits_from<T: TypeUrl>(mut self) -> Self {
        self.inherits_from.insert(T::ID);
        self
    }
}

impl<'a> TypeMatch<'a> {
    combinator!(or, and, not, with_links, into_statement);
}

impl<'a> From<TypeMatch<'a>> for Clause<'a> {
    fn from(value: TypeMatch<'a>) -> Self {
        Self::Type(value)
    }
}

impl<'a> From<TypeMatch<'a>> for Statement<'a> {
    fn from(value: TypeMatch<'a>) -> Self {
        Self::from(Clause::from(value))
    }
}
