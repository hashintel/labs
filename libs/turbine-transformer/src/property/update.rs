use alloc::{boxed::Box, collections::BTreeSet, vec::Vec};

use turbine::{
    entity::{Entity, EntityId},
    TypeUrl,
};

use crate::{
    select::{Clause, JsonPath, Value},
    View,
};

pub struct StaticUpdate<'a> {
    path: JsonPath<'a>,
    value: Value<'a>,
}

impl<'a> StaticUpdate<'a> {
    #[must_use]
    pub fn new<T: TypeUrl>(value: impl Into<Value<'a>>) -> Self {
        Self {
            path: JsonPath::new().then::<T>(),
            value: value.into(),
        }
    }

    #[must_use]
    pub fn new_with_path(path: impl Into<JsonPath<'a>>, value: impl Into<Value<'a>>) -> Self {
        Self {
            path: path.into(),
            value: value.into(),
        }
    }

    fn apply(&self, entity: &mut Entity) {
        self.path.set_entity(entity, self.value.clone());
    }
}

type DynamicUpdateFn<'b> = dyn Fn(&mut Entity) + 'b;
type BoxedDynamicUpdateFn = Box<DynamicUpdateFn<'static>>;

pub struct DynamicUpdate {
    value: BoxedDynamicUpdateFn,
}

impl DynamicUpdate {
    pub fn new(value: impl Fn(&mut Entity) + 'static) -> Self {
        Self {
            value: Box::new(value),
        }
    }

    fn apply(&self, entity: &mut Entity) {
        (self.value)(entity);
    }
}

pub enum UpdateStatement<'a> {
    Static(StaticUpdate<'a>),
    Dynamic(DynamicUpdate),
}

impl<'a> From<StaticUpdate<'a>> for UpdateStatement<'a> {
    fn from(update: StaticUpdate<'a>) -> Self {
        Self::Static(update)
    }
}

impl<'a> From<DynamicUpdate> for UpdateStatement<'a> {
    fn from(update: DynamicUpdate) -> Self {
        Self::Dynamic(update)
    }
}

pub struct Update<'a> {
    if_: Clause<'a>,

    actions: Vec<UpdateStatement<'a>>,
}

impl<'a> Update<'a> {
    pub fn new(if_: impl Into<Clause<'a>>) -> Self {
        Self {
            if_: if_.into(),
            actions: Vec::new(),
        }
    }

    pub fn do_(mut self, action: impl Into<UpdateStatement<'a>>) -> Self {
        self.actions.push(action.into());
        self
    }

    fn matches(&self, view: &View, id: EntityId) -> bool {
        self.if_.matches(view, id)
    }

    fn apply(&self, entity: &mut Entity) {
        for action in &self.actions {
            match action {
                UpdateStatement::Static(action) => action.apply(entity),
                UpdateStatement::Dynamic(action) => action.apply(entity),
            }
        }
    }
}

pub struct PropertyUpdate<'a> {
    statements: Vec<Update<'a>>,
}

impl<'a> PropertyUpdate<'a> {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            statements: Vec::new(),
        }
    }

    #[must_use]
    pub fn and(mut self, clause: impl Into<Update<'a>>) -> Self {
        self.statements.push(clause.into());
        self
    }

    fn eval(update: &Update, view: &mut View) {
        // We need to precompute the matches because we can't borrow the view immutably while we're
        // mutating it.
        let matches: BTreeSet<_> = view
            .entities
            .iter()
            .enumerate()
            .filter(|(_, entity)| update.matches(view, entity.metadata.record_id.entity_id))
            .map(|(index, _)| index)
            .collect();

        let entities = view
            .entities
            .iter_mut()
            .enumerate()
            .filter(|(index, _)| matches.contains(index))
            .map(|(_, entity)| entity);

        for entity in entities {
            update.apply(entity);
        }
    }

    fn run(self, view: &mut View) {
        for statement in &self.statements {
            Self::eval(statement, view)
        }
    }
}

impl<'a> View<'a> {
    pub fn update_properties(&mut self, statements: Vec<Update>) {
        PropertyUpdate { statements }.run(self);
    }
}
