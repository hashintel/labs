use alloc::{
    borrow::{Cow, ToOwned},
    collections::BTreeMap,
    string::String,
    vec::Vec,
};

use funty::Fundamental;
use hashbrown::HashMap;
use ordered_float::OrderedFloat;
use serde_json::Number;
use turbine::entity::EntityProperties;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Array<'a> {
    pub values: Vec<Value<'a>>,
}

impl<'a> Array<'a> {
    fn contains(&self, value: &Value) -> bool {
        self.values.contains(value)
    }

    fn starts_with(&self, value: &Self) -> bool {
        self.values.starts_with(&value.values)
    }

    fn ends_with(&self, value: &Self) -> bool {
        self.values.ends_with(&value.values)
    }
}

impl<'a> FromIterator<Value<'a>> for Array<'a> {
    fn from_iter<T>(iter: T) -> Self
    where
        T: IntoIterator<Item = Value<'a>>,
    {
        Self {
            values: iter.into_iter().collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Object<'a> {
    pub properties: Vec<(Value<'a>, Value<'a>)>,
}

impl<'a> Object<'a> {
    fn contains(&self, key: &Value) -> bool {
        self.properties.iter().any(|(k, _)| k == key)
    }
}

// TODO: is lossy conversion okay?
impl<'a> From<Object<'a>> for EntityProperties {
    fn from(value: Object<'a>) -> Self {
        let properties: HashMap<_, serde_json::Value> = value
            .properties
            .into_iter()
            .filter_map(|(k, v)| k.as_str().map(|k| (k.to_owned(), v.into())))
            .collect();

        Self::from(properties)
    }
}

impl<'a, K, V> FromIterator<(K, V)> for Object<'a>
where
    K: Into<Value<'a>>,
    V: Into<Value<'a>>,
{
    fn from_iter<T: IntoIterator<Item = (K, V)>>(iter: T) -> Self {
        let properties = iter
            .into_iter()
            .map(|(k, v)| (k.into(), v.into()))
            .collect();

        Self { properties }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Value<'a> {
    Null,
    Bool(bool),
    Integer(i128),
    Float(OrderedFloat<f64>),
    String(Cow<'a, str>),
    Array(Array<'a>),
    Object(Object<'a>),
}

impl<'a> Value<'a> {
    fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(s) => Some(s.as_ref()),
            _ => None,
        }
    }

    pub(crate) fn contains(&self, value: &'a Value) -> bool {
        match (self, value) {
            (Self::String(a), Self::String(b)) => a.contains(b.as_ref()),
            (Self::Array(a), b) => a.contains(b),
            (Self::Object(a), b) => a.contains(b),
            _ => false,
        }
    }

    pub(crate) fn starts_with(&self, value: &'a Value) -> bool {
        match (self, value) {
            (Self::String(a), Self::String(b)) => a.starts_with(b.as_ref()),
            (Self::Array(a), Self::Array(b)) => a.starts_with(b),
            _ => false,
        }
    }

    pub(crate) fn ends_with(&self, value: &'a Value) -> bool {
        match (self, value) {
            (Self::String(a), Self::String(b)) => a.ends_with(b.as_ref()),
            (Self::Array(a), Self::Array(b)) => a.ends_with(b),
            _ => false,
        }
    }
}

macro_rules! impl_from {
    (Int => $($ty:ty),*) => {
        $(
            impl<'a> From<$ty> for Value<'a> {
                fn from(value: $ty) -> Self {
                    Self::Integer(value as i128)
                }
            }
        )*
    };

    (Float => $($ty:ty),*) => {
        $(
            impl<'a> From<$ty> for Value<'a> {
                fn from(value: $ty) -> Self {
                    Self::Float(OrderedFloat(value as f64))
                }
            }
        )*
    };
}

impl From<()> for Value<'_> {
    fn from(_: ()) -> Self {
        Self::Null
    }
}

impl_from!(Int => i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize);
impl_from!(Float => f32, f64);

impl From<bool> for Value<'_> {
    fn from(value: bool) -> Self {
        Self::Bool(value)
    }
}

impl<'a> From<&'a str> for Value<'a> {
    fn from(value: &'a str) -> Self {
        Self::String(Cow::Borrowed(value))
    }
}

impl<'a> From<String> for Value<'a> {
    fn from(value: String) -> Self {
        Self::String(Cow::Owned(value))
    }
}

impl<'a> From<Array<'a>> for Value<'a> {
    fn from(value: Array<'a>) -> Self {
        Self::Array(value)
    }
}

impl<'a> From<Vec<Value<'a>>> for Value<'a> {
    fn from(value: Vec<Value<'a>>) -> Self {
        Self::Array(Array { values: value })
    }
}

impl<'a> From<Object<'a>> for Value<'a> {
    fn from(value: Object<'a>) -> Self {
        Self::Object(value)
    }
}

impl<'a> From<BTreeMap<String, Value<'a>>> for Value<'a> {
    fn from(value: BTreeMap<String, Value<'a>>) -> Self {
        let object = value.into_iter().collect();

        Self::Object(object)
    }
}

impl From<&Number> for Value<'_> {
    fn from(value: &Number) -> Self {
        #[allow(clippy::option_if_let_else)]
        if let Some(value) = value.as_i64() {
            Self::Integer(i128::from(value))
        } else if let Some(value) = value.as_f64() {
            Self::Float(OrderedFloat(value))
        } else {
            unreachable!()
        }
    }
}

impl<'a> From<serde_json::Value> for Value<'a> {
    fn from(value: serde_json::Value) -> Self {
        match value {
            serde_json::Value::Null => Self::Null,
            serde_json::Value::Bool(value) => Self::Bool(value),
            serde_json::Value::Number(value) => (&value).into(),
            serde_json::Value::String(value) => Self::String(Cow::Owned(value)),
            serde_json::Value::Array(array) => Self::Array(Array {
                values: array.into_iter().map(Value::from).collect(),
            }),
            serde_json::Value::Object(object) => Self::Object(Object {
                properties: object
                    .into_iter()
                    .map(|(k, v)| (Value::from(k), Value::from(v)))
                    .collect(),
            }),
        }
    }
}

impl<'a> From<&'a serde_json::Value> for Value<'a> {
    fn from(value: &'a serde_json::Value) -> Self {
        match value {
            serde_json::Value::Null => Self::Null,
            serde_json::Value::Bool(value) => Self::Bool(*value),
            serde_json::Value::Number(value) => value.into(),
            serde_json::Value::String(value) => Self::String(Cow::Borrowed(value)),
            serde_json::Value::Array(array) => Self::Array(Array {
                values: array.iter().map(Value::from).collect(),
            }),
            serde_json::Value::Object(object) => Self::Object(Object {
                properties: object
                    .iter()
                    .map(|(k, v)| (Value::from(k.as_str()), Value::from(v)))
                    .collect(),
            }),
        }
    }
}

// TODO: conversion is potentially lossy
impl<'a> From<Value<'a>> for serde_json::Value {
    fn from(value: Value<'a>) -> Self {
        match value {
            Value::Null => Self::Null,
            Value::Bool(value) => Self::Bool(value),
            // Reason: There's no other way, we're already lossy.
            #[allow(clippy::cast_possible_truncation)]
            Value::Integer(value) => Self::Number((value as i64).into()),
            Value::Float(value) => Self::Number(
                Number::from_f64(value.as_f64())
                    .expect("float can never be NaN, as OrderedFloat is not NaN"),
            ),
            Value::String(value) => Self::String(value.into_owned()),
            Value::Array(value) => Self::Array(value.values.into_iter().map(Self::from).collect()),
            Value::Object(value) => Self::Object(
                value
                    .properties
                    .into_iter()
                    .filter_map(|(k, v)| k.as_str().map(|k| (k.to_owned(), v.into())))
                    .collect(),
            ),
        }
    }
}

pub trait Integer<'a>: Into<Value<'a>> {}

macro_rules! impl_integer {
    ($($ty:ty),*) => {
        $(
            impl Integer<'_> for $ty {}
        )*
    };
}

impl_integer!(
    i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize
);

pub trait Float<'a>: Into<Value<'a>> {}

macro_rules! impl_float {
    ($($ty:ty),*) => {
        $(
            impl Float<'_> for $ty {}
        )*
    };
}

impl_float!(f32, f64);
