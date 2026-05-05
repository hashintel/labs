use alloc::{borrow::Cow, boxed::Box, vec};

use turbine::entity::EntityId;

use crate::{
    path::JsonPath,
    select::{
        property::{
            contains::SatisfiesContains, ends_with::SatisfiesEndsWith, equals::SatisfiesEquals,
            greater_than::SatisfiesGreaterThan,
            greater_than_or_equals::SatisfiesGreaterThanOrEquals, less_than::SatisfiesLessThan,
            less_than_or_equals::SatisfiesLessThanOrEquals, not_equals::SatisfiesNotEquals,
            starts_with::SatisfiesStartsWith,
        },
        Clause, Statement,
    },
    value::Value,
    View,
};

macro_rules! satisfies {
    ($trait:ident:$op:ident; JsonPath<'a> => [$($({<$($gen:ident),+>})? $rhs:ty $([? where $($bounds:tt)*])?),*]) => {
        $(
            impl<'a $($(,$gen)*)?> $trait<'a, $rhs> for JsonPath<'a> $(where $($bounds)+)? {
                fn into_match(self, rhs: $rhs) -> PropertyMatch<'a> {
                    PropertyMatch {
                        lhs: PathOrValue::Path(self),
                        condition: Condition::$op,
                        rhs: PathOrValue::Value(rhs.into()),
                    }
                }
            }
        )*

        impl<'a> $trait<'a, JsonPath<'a>> for JsonPath<'a> {
            fn into_match(self, rhs: JsonPath<'a>) -> PropertyMatch<'a> {
                PropertyMatch {
                    lhs: PathOrValue::Path(self),
                    condition: Condition::$op,
                    rhs: PathOrValue::Path(rhs),
                }
            }
        }
    };
    ($trait:ident:$op:ident; $({<$($lgen:ident),+>})? $lhs:ty $([? where $($lbounds:tt)+])? => [$($({<$($gen:ident),+>})? $rhs:ty $([? where $($bounds:tt)*])?),*]) => {
        $(
            impl<'a $($(,$gen)+)?> $trait<'a, $rhs> for $lhs $(where $($bounds)+)? {
                fn into_match(self, rhs: $rhs) -> PropertyMatch<'a> {
                    PropertyMatch {
                        lhs: PathOrValue::Value(self.into()),
                        condition: Condition::$op,
                        rhs: PathOrValue::Value(rhs.into()),
                    }
                }
            }
        )*

        impl<'a $($(,$lgen)+)?> $trait<'a, JsonPath<'a>> for $lhs $(where $($lbounds)+)? {
            fn into_match(self, rhs: JsonPath<'a>) -> PropertyMatch<'a> {
                PropertyMatch {
                    lhs: PathOrValue::Value(self.into()),
                    condition: Condition::$op,
                    rhs: PathOrValue::Path(rhs),
                }
            }
        }
    };
}

mod equals {
    use super::{Condition, JsonPath, PathOrValue, PropertyMatch, Value};

    pub trait SatisfiesEquals<'a, Rhs> {
        fn into_match(self, rhs: Rhs) -> PropertyMatch<'a>;
    }

    satisfies!(SatisfiesEquals:Equals; {<T>} T [? where T: Into<Value<'a>>] => [{<T, U>} U [? where T: Into<Value<'a>>, U: Into<Value<'a>>]]);
    satisfies!(SatisfiesEquals:Equals; JsonPath<'a> => [{<T>} T [? where T: Into<Value<'a>>]]);
}

mod not_equals {
    use super::{Condition, JsonPath, PathOrValue, PropertyMatch, Value};

    pub trait SatisfiesNotEquals<'a, Rhs> {
        fn into_match(self, rhs: Rhs) -> PropertyMatch<'a>;
    }

    satisfies!(SatisfiesNotEquals:NotEquals; {<T>} T [? where T: Into<Value<'a>>] => [{<T, U>} U [? where T: Into<Value<'a>>, U: Into<Value<'a>>]]);
    satisfies!(SatisfiesNotEquals:NotEquals; JsonPath<'a> => [{<T>} T [? where T: Into<Value<'a>>]]);
}

macro_rules! satisfies_numeric {
    ($module:ident, $name:ident, $condition:ident) => {
        mod $module {
            use crate::path::JsonPath;
            use crate::value::{Float, Integer};
            use crate::select::{
                property::{Condition, PathOrValue, PropertyMatch},
            };

            pub trait $name<'a, Rhs> {
                fn into_match(self, rhs: Rhs) -> PropertyMatch<'a>;
            }

            satisfies!($name:$condition; f32 => [{<T>} T [? where T: Float<'a>]]);
            satisfies!($name:$condition; f64 => [{<T>} T [? where T: Float<'a>]]);
            satisfies!($name:$condition; {<T>} T [? where T: Integer<'a>] => [{<T, U>} U [? where T: Integer<'a>, U: Integer<'a>]]);
            satisfies!($name:$condition; JsonPath<'a> => [{<T>} T [? where T: Integer<'a>], f32, f64]);
        }
    };
}

satisfies_numeric!(less_than, SatisfiesLessThan, LessThan);
satisfies_numeric!(
    less_than_or_equals,
    SatisfiesLessThanOrEquals,
    LessThanOrEquals
);
satisfies_numeric!(greater_than, SatisfiesGreaterThan, GreaterThan);
satisfies_numeric!(
    greater_than_or_equals,
    SatisfiesGreaterThanOrEquals,
    GreaterThanOrEquals
);

mod contains {
    use alloc::string::String;

    use crate::{
        path::JsonPath,
        select::property::{Condition, PathOrValue, PropertyMatch},
        value::{Array, Object, Value},
    };

    pub trait SatisfiesContains<'a, Rhs> {
        fn into_match(self, rhs: Rhs) -> PropertyMatch<'a>;
    }

    satisfies!(SatisfiesContains:Contains; String => [String, &'a str]);
    satisfies!(SatisfiesContains:Contains; &'a str => [String, &'a str]);
    satisfies!(SatisfiesContains:Contains; Array<'a> => [{<T>} T [? where T: Into<Value<'a>>]]);
    satisfies!(SatisfiesContains:Contains; Object<'a> => [{<T>} T [? where T: Into<Value<'a>>]]);
    satisfies!(SatisfiesContains:Contains; JsonPath<'a> => [String, &'a str, Array<'a>, Object<'a>]);
}

mod starts_with {
    use alloc::string::String;

    use crate::{
        select::property::{Condition, JsonPath, PathOrValue, PropertyMatch},
        value::Array,
    };

    pub trait SatisfiesStartsWith<'a, T> {
        fn into_match(self, rhs: T) -> PropertyMatch<'a>;
    }

    satisfies!(SatisfiesStartsWith:StartsWith; String => [String, &'a str]);
    satisfies!(SatisfiesStartsWith:StartsWith; &'a str => [String, &'a str]);
    satisfies!(SatisfiesStartsWith:StartsWith; Array<'a> => [Array<'a>]);
    satisfies!(SatisfiesStartsWith:StartsWith; JsonPath<'a> => [String, &'a str, Array<'a>]);
}

mod ends_with {
    use alloc::string::String;

    use crate::{
        select::property::{Condition, JsonPath, PathOrValue, PropertyMatch},
        value::Array,
    };

    pub trait SatisfiesEndsWith<'a, T> {
        fn into_match(self, rhs: T) -> PropertyMatch<'a>;
    }

    satisfies!(SatisfiesEndsWith:EndsWith; String => [String, &'a str]);
    satisfies!(SatisfiesEndsWith:EndsWith; &'a str => [String, &'a str]);
    satisfies!(SatisfiesEndsWith:EndsWith; Array<'a> => [Array<'a>]);
    satisfies!(SatisfiesEndsWith:EndsWith; JsonPath<'a> => [String, &'a str, Array<'a>]);
}

pub enum Condition {
    Equals,
    NotEquals,
    LessThan,
    LessThanOrEquals,
    GreaterThan,
    GreaterThanOrEquals,
    Contains,
    StartsWith,
    EndsWith,
}

// TODO: in future version, PathOrValue should be typed over the Path, this requires major changes
//  in the codegen.
pub enum PathOrValue<'a> {
    Path(JsonPath<'a>),
    Value(Value<'a>),
}

pub struct PropertyMatch<'a> {
    lhs: PathOrValue<'a>,
    condition: Condition,
    rhs: PathOrValue<'a>,
}

impl<'a> PropertyMatch<'a> {
    pub fn equals<T, U>(lhs: T, rhs: U)
    where
        T: SatisfiesEquals<'a, U>,
    {
        lhs.into_match(rhs);
    }

    pub fn not_equals<T, U>(lhs: T, rhs: U)
    where
        T: SatisfiesNotEquals<'a, U>,
    {
        lhs.into_match(rhs);
    }

    pub fn less_than<T, U>(lhs: T, rhs: U)
    where
        T: SatisfiesLessThan<'a, U>,
    {
        lhs.into_match(rhs);
    }

    pub fn less_than_or_equals<T, U>(lhs: T, rhs: U)
    where
        T: SatisfiesLessThanOrEquals<'a, U>,
    {
        lhs.into_match(rhs);
    }

    pub fn greater_than<T, U>(lhs: T, rhs: U)
    where
        T: SatisfiesGreaterThan<'a, U>,
    {
        lhs.into_match(rhs);
    }

    pub fn greater_than_or_equals<T, U>(lhs: T, rhs: U)
    where
        T: SatisfiesGreaterThanOrEquals<'a, U>,
    {
        lhs.into_match(rhs);
    }

    pub fn contains<T, U>(lhs: T, rhs: U)
    where
        T: SatisfiesContains<'a, U>,
    {
        lhs.into_match(rhs);
    }

    pub fn starts_with<T, U>(lhs: T, rhs: U)
    where
        T: SatisfiesStartsWith<'a, U>,
    {
        lhs.into_match(rhs);
    }

    pub fn ends_with<T, U>(lhs: T, rhs: U)
    where
        T: SatisfiesEndsWith<'a, U>,
    {
        lhs.into_match(rhs);
    }
}

impl PropertyMatch<'_> {
    pub(crate) fn matches(&self, view: &View, id: EntityId) -> bool {
        let Some(entity) = view.entity(id) else {
            return false;
        };

        let lhs = match &self.lhs {
            PathOrValue::Path(path) => path.traverse_entity(entity).map(Cow::Owned),
            PathOrValue::Value(value) => Some(Cow::Borrowed(value)),
        };

        let rhs = match &self.rhs {
            PathOrValue::Path(path) => path.traverse_entity(entity).map(Cow::Owned),
            PathOrValue::Value(value) => Some(Cow::Borrowed(value)),
        };

        let Some(lhs) = lhs else {
            return false;
        };

        let Some(rhs) = rhs else {
            return false;
        };

        match self.condition {
            Condition::Equals => lhs == rhs,
            Condition::NotEquals => lhs != rhs,
            Condition::LessThan => lhs < rhs,
            Condition::LessThanOrEquals => lhs <= rhs,
            Condition::GreaterThan => lhs > rhs,
            Condition::GreaterThanOrEquals => lhs >= rhs,
            Condition::Contains => lhs.contains(rhs.as_ref()),
            Condition::StartsWith => lhs.starts_with(rhs.as_ref()),
            Condition::EndsWith => lhs.ends_with(rhs.as_ref()),
        }
    }
}

impl<'a> PropertyMatch<'a> {
    combinator!(or, and, not, with_links, into_statement);
}

impl<'a> From<PropertyMatch<'a>> for Clause<'a> {
    fn from(value: PropertyMatch<'a>) -> Self {
        Clause::Property(value)
    }
}

impl<'a> From<PropertyMatch<'a>> for Statement<'a> {
    fn from(value: PropertyMatch<'a>) -> Self {
        Self::from(Clause::from(value))
    }
}
