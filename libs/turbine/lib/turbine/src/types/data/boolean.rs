use core::ops::{Deref, DerefMut};

use error_stack::{Report, Result};
use onlyerror::Error;
use serde::Serialize;
use serde_json::Value;

use crate::{
    types::data::DataTypePath, url, DataType, DataTypeMut, DataTypeRef, Type, TypeMut, TypeRef,
    TypeTraverse, TypeUrl, VersionedUrlRef,
};

#[derive(Debug, Clone, Error)]
pub enum BooleanError {
    #[error("`{0:?}` is not a bool")]
    NotABoolean(Value),
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct Boolean(bool);

impl Boolean {
    #[must_use]
    pub const fn new(value: bool) -> Self {
        Self(value)
    }
}

impl<T> From<T> for Boolean
where
    T: Into<bool>,
{
    fn from(value: T) -> Self {
        Self(value.into())
    }
}

impl Deref for Boolean {
    type Target = bool;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for Boolean {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl TypeUrl for Boolean {
    type InheritsFrom = ();

    const ID: VersionedUrlRef<'static> =
        url!("https://blockprotocol.org/@blockprotocol/types/data-type/boolean/" / v / 1);
}

impl TypeTraverse for Boolean {
    type Path = DataTypePath;
}

impl Type for Boolean {
    type Mut<'a> = BooleanMut<'a> where Self: 'a;
    type Ref<'a> = Self where Self: 'a;

    fn as_mut(&mut self) -> Self::Mut<'_> {
        BooleanMut(&mut self.0)
    }

    fn as_ref(&self) -> Self::Ref<'_> {
        *self
    }
}

impl DataType for Boolean {
    type Error = BooleanError;

    fn try_from_value(value: Value) -> Result<Self, Self::Error> {
        if let Value::Bool(value) = value {
            Ok(Self(value))
        } else {
            Err(Report::new(BooleanError::NotABoolean(value)))
        }
    }

    fn is_valid_value(value: &Value) -> bool {
        value.is_boolean()
    }
}

impl TypeRef for Boolean {
    type Owned = Self;

    fn into_owned(self) -> Self::Owned {
        self
    }
}

impl<'a> DataTypeRef<'a> for Boolean {
    type Error = BooleanError;

    fn try_from_value(value: &'a Value) -> Result<Self, Self::Error> {
        value.as_bool().map_or_else(
            || Err(Report::new(BooleanError::NotABoolean(value.clone()))),
            |value| Ok(Self(value)),
        )
    }
}

#[derive(Debug, Serialize)]
pub struct BooleanMut<'a>(&'a mut bool);

impl Deref for BooleanMut<'_> {
    type Target = bool;

    fn deref(&self) -> &Self::Target {
        &*self.0
    }
}

impl DerefMut for BooleanMut<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.0
    }
}

impl TypeUrl for BooleanMut<'_> {
    type InheritsFrom = ();

    const ID: VersionedUrlRef<'static> =
        url!("https://blockprotocol.org/@blockprotocol/types/data-type/boolean/" / v / 1);
}

impl TypeTraverse for BooleanMut<'_> {
    type Path = DataTypePath;
}

impl TypeMut for BooleanMut<'_> {
    type Owned = Boolean;

    fn into_owned(self) -> Self::Owned {
        Boolean(*self.0)
    }
}

impl<'a> DataTypeMut<'a> for BooleanMut<'a> {
    type Error = BooleanError;

    fn try_from_value(value: &'a mut Value) -> Result<Self, Self::Error> {
        if let Value::Bool(value) = value {
            Ok(Self(value))
        } else {
            Err(Report::new(BooleanError::NotABoolean(value.clone())))
        }
    }
}
