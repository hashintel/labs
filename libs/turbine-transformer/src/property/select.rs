use alloc::{borrow::Cow, boxed::Box, collections::BTreeSet, vec::Vec};

use turbine::{
    entity::{Entity, EntityId},
    TypeUrl,
};

use crate::{
    select::{Clause, JsonPath, Segment},
    View,
};

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub enum Action {
    Exclude,
    Include,
}

impl Action {
    const fn reverse(self) -> Self {
        match self {
            Self::Exclude => Self::Include,
            Self::Include => Self::Exclude,
        }
    }
}

type DynamicActionFn<'a> = dyn Fn(&Entity) -> Option<Action> + 'a;
type BoxedDynamicActionFn = Box<DynamicActionFn<'static>>;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
enum Then {
    Explicit(Action),
    // The reverse of the default action
    Implicit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaticAction<'a> {
    path: JsonPath<'a>,
    then: Then,
}

impl StaticAction<'static> {
    #[must_use]
    pub fn new<T: TypeUrl>() -> Self {
        Self {
            path: JsonPath::new().then::<T>(),
            then: Then::Implicit,
        }
    }
}

impl<'a> StaticAction<'a> {
    #[must_use]
    pub fn new_with_path(path: impl Into<JsonPath<'a>>) -> Self {
        Self {
            path: path.into(),
            then: Then::Implicit,
        }
    }

    #[must_use]
    pub const fn then(mut self, action: Action) -> Self {
        self.then = Then::Explicit(action);
        self
    }
}

pub struct DynamicAction<'a> {
    path: JsonPath<'a>,
    then: BoxedDynamicActionFn,
}

impl DynamicAction<'static> {
    #[must_use]
    pub fn new<T: TypeUrl>(then: impl Fn(&Entity) -> Option<Action> + 'static) -> Self {
        Self {
            path: JsonPath::new().then::<T>(),
            then: Box::new(then),
        }
    }
}

impl<'a> DynamicAction<'a> {
    #[must_use]
    pub fn new_with_path(
        path: impl Into<JsonPath<'a>>,
        then: impl Fn(&Entity) -> Option<Action> + 'static,
    ) -> Self {
        Self {
            path: path.into(),
            then: Box::new(then),
        }
    }
}

pub enum ActionStatement<'a> {
    Static(StaticAction<'a>),
    Dynamic(DynamicAction<'a>),
}

impl<'a> From<StaticAction<'a>> for ActionStatement<'a> {
    fn from(action: StaticAction<'a>) -> Self {
        Self::Static(action)
    }
}

impl<'a> From<DynamicAction<'a>> for ActionStatement<'a> {
    fn from(action: DynamicAction<'a>) -> Self {
        Self::Dynamic(action)
    }
}

pub struct Select<'a> {
    if_: Clause<'a>,

    actions: Vec<ActionStatement<'a>>,
    default: Action,
}

impl<'a> Select<'a> {
    pub fn new(if_: impl Into<Clause<'a>>, default: Action) -> Self {
        Self {
            if_: if_.into(),
            actions: Vec::new(),
            default,
        }
    }

    pub fn do_(mut self, action: impl Into<ActionStatement<'a>>) -> Self {
        self.actions.push(action.into());
        self
    }

    fn matches(&self, view: &View, id: EntityId) -> bool {
        self.if_.matches(view, id)
    }

    fn apply(&self, entity: &mut Entity) {
        // for every depth, find the matching properties that we need to include
        let mut included = BTreeSet::new();

        // depending on the default action, we either include all properties or exclude all
        // properties by default
        if self.default == Action::Include {
            for keys in entity.properties.properties().keys() {
                included.insert(Cow::Owned(keys.clone()));
            }
        }

        for action in &self.actions {
            match action {
                ActionStatement::Static(action) => {
                    assert!(
                        action.path.segments().len() <= 1,
                        "PropertySelect does not support nested paths (yet)"
                    );

                    let [key] = action.path.segments() else {
                        continue;
                    };

                    match key {
                        Segment::Index(_) => continue,
                        Segment::Field(field) => {
                            if let Some(action) = match action.then {
                                Then::Explicit(action) => Some(action),
                                Then::Implicit => Some(self.default.reverse()),
                            } {
                                if action == Action::Include {
                                    included.insert(Cow::Borrowed(field.as_ref()));
                                } else {
                                    included.remove(field.as_ref());
                                }
                            }
                        }
                    }
                }
                ActionStatement::Dynamic(action) => {
                    assert!(
                        action.path.segments().len() <= 1,
                        "PropertySelect does not support nested paths (yet)"
                    );

                    let [key] = action.path.segments() else {
                        continue;
                    };

                    match key {
                        Segment::Index(_) => continue,
                        Segment::Field(field) => {
                            if let Some(action) = (action.then)(entity) {
                                if action == Action::Include {
                                    included.insert(Cow::Borrowed(field.as_ref()));
                                } else {
                                    included.remove(field.as_ref());
                                }
                            }
                        }
                    }
                }
            }
        }

        entity
            .properties
            .properties_mut()
            .retain(|key, _| included.contains(key.as_str()));
    }
}

pub struct PropertySelect<'a> {
    statements: Vec<Select<'a>>,
}

impl<'a> PropertySelect<'a> {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            statements: Vec::new(),
        }
    }

    #[must_use]
    pub fn and(mut self, clause: impl Into<Select<'a>>) -> Self {
        self.statements.push(clause.into());
        self
    }

    fn eval(select: &Select, view: &mut View) {
        // We need to precompute the matches because we can't borrow the view immutably while we're
        // mutating it.
        let matches: BTreeSet<_> = view
            .entities
            .iter()
            .enumerate()
            .filter(|(_, entity)| select.matches(view, entity.metadata.record_id.entity_id))
            .map(|(index, _)| index)
            .collect();

        let entities = view
            .entities
            .iter_mut()
            .enumerate()
            .filter(|(index, _)| matches.contains(index))
            .map(|(_, entity)| entity);

        for entity in entities {
            select.apply(entity);
        }
    }

    fn run(self, view: &mut View) {
        for statement in &self.statements {
            Self::eval(statement, view);
        }
    }
}

impl<'a> View<'a> {
    pub fn select_properties(&mut self, statements: Vec<Select>) {
        PropertySelect { statements }.run(self);
    }
}
