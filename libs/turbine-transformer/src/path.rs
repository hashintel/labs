use alloc::{
    borrow::{Cow, ToOwned},
    vec::Vec,
};

use turbine::{entity::Entity, BaseUrl, BaseUrlRef, TypeUrl};

use crate::value::{Object, Value};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Segment<'a> {
    Field(Cow<'a, str>),
    Index(usize),
}

impl<'a> From<BaseUrlRef<'a>> for Segment<'a> {
    fn from(value: BaseUrlRef<'a>) -> Self {
        Self::Field(Cow::Borrowed(value.as_str()))
    }
}

impl<'a> From<BaseUrl> for Segment<'a> {
    fn from(value: BaseUrl) -> Self {
        Self::Field(Cow::Owned(value.as_str().to_owned()))
    }
}

impl<'a> From<usize> for Segment<'a> {
    fn from(value: usize) -> Self {
        Self::Index(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct JsonPath<'a>(Cow<'a, [Segment<'a>]>);

impl<'a> JsonPath<'a> {
    #[must_use]
    pub const fn new() -> Self {
        Self(Cow::Owned(Vec::new()))
    }

    #[must_use]
    pub const fn from_slice(segments: &'a [Segment<'a>]) -> Self {
        Self(Cow::Borrowed(segments))
    }

    #[must_use]
    pub fn then<T: TypeUrl>(mut self) -> Self {
        self.0.to_mut().push(T::ID.base().into());
        self
    }

    #[must_use]
    pub fn then_field(mut self, field: impl Into<Cow<'a, str>>) -> Self {
        self.0.to_mut().push(Segment::Field(field.into()));
        self
    }

    #[must_use]
    pub fn then_index(mut self, index: usize) -> Self {
        self.0.to_mut().push(Segment::Index(index));
        self
    }

    pub(crate) fn segments(&self) -> &[Segment] {
        &self.0
    }

    pub(crate) fn traverse_entity<'b>(&self, entity: &'b Entity) -> Option<Value<'b>> {
        let value = entity.properties.properties();

        if self.0.is_empty() {
            return Some(
                value
                    .iter()
                    .map(|(key, value)| (Value::from(key.as_str()), Value::from(value)))
                    .collect::<Object>()
                    .into(),
            );
        }

        let (first, rest) = self.0.split_first()?;

        let value = match first {
            Segment::Field(field) => value.get(field.as_ref())?,
            Segment::Index(_) => {
                return None;
            }
        };

        JsonPath(Cow::Borrowed(rest)).traverse(value)
    }

    fn traverse<'b>(&self, value: &'b serde_json::Value) -> Option<Value<'b>> {
        let mut value = value;

        for segment in self.0.iter() {
            match segment {
                Segment::Field(field) => {
                    value = value.get(field.as_ref())?;
                }
                Segment::Index(index) => {
                    value = value.get(index)?;
                }
            }
        }

        Some(value.into())
    }

    pub(crate) fn set(&self, target: &mut serde_json::Value, value: Value<'a>) {
        if self.0.is_empty() {
            *target = value.into();
            return;
        }

        let (first, rest) = self.0.split_first().expect("infallible");

        let target = match first {
            Segment::Field(field) => {
                if let serde_json::Value::Object(object) = target {
                    object.get_mut(field.as_ref())
                } else {
                    return;
                }
            }
            Segment::Index(index) => {
                if let serde_json::Value::Array(array) = target {
                    array.get_mut(*index)
                } else {
                    return;
                }
            }
        };

        let Some(target) = target else {
            return;
        };

        JsonPath(Cow::Borrowed(rest)).set(target, value);
    }

    pub(crate) fn set_entity(&self, entity: &mut Entity, value: Value<'a>) {
        if self.0.is_empty() {
            if let Value::Object(object) = value {
                entity.properties = object.into();
            }

            return;
        }

        let (first, rest) = self.0.split_first().expect("infallible");

        let target = match first {
            Segment::Field(field) => entity.properties.properties_mut().get_mut(field.as_ref()),
            Segment::Index(_) => {
                return;
            }
        };

        let Some(target) = target else {
            return;
        };

        JsonPath(Cow::Borrowed(rest)).set(target, value);
    }
}
