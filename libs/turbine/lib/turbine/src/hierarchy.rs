use core::iter::{empty, once};

use crate::{TypeUrl, VersionedUrlRef};

#[rustfmt::skip]
macro_rules! all_the_tuples {
    ($name:ident) => {
        $name!(T1);
        $name!(T1, T2);
        $name!(T1, T2, T3);
        $name!(T1, T2, T3, T4);
        $name!(T1, T2, T3, T4, T5);
        $name!(T1, T2, T3, T4, T5, T6);
        $name!(T1, T2, T3, T4, T5, T6, T7);
        $name!(T1, T2, T3, T4, T5, T6, T7, T8);
        $name!(T1, T2, T3, T4, T5, T6, T7, T8, T9);
        $name!(T1, T2, T3, T4, T5, T6, T7, T8, T9, T10);
        $name!(T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11);
        $name!(T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12);
        $name!(T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13);
        $name!(T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14);
        $name!(T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15);
        $name!(T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15, T16);
    };
}

pub trait TypeHierarchyResolution {
    type Iterator: Iterator<Item = VersionedUrlRef<'static>>;

    fn resolve() -> Self::Iterator;
}

impl<T> TypeHierarchyResolution for T
where
    T: TypeUrl,
{
    type Iterator = impl Iterator<Item = VersionedUrlRef<'static>>;

    fn resolve() -> Self::Iterator {
        once(T::ID)
    }
}

impl TypeHierarchyResolution for () {
    type Iterator = impl Iterator<Item = VersionedUrlRef<'static>>;

    fn resolve() -> Self::Iterator {
        empty()
    }
}

macro_rules! impl_inherits_from {
    ($($name:ident),*) => {
        impl<$($name),*> TypeHierarchyResolution for ($($name,)*)
        where
            $($name: TypeHierarchyResolution,)*
        {
            type Iterator = impl Iterator<Item = VersionedUrlRef<'static>>;

            fn resolve() -> Self::Iterator {
                let iter = empty();
                $(let iter = iter.chain($name::resolve());)*
                iter
            }
        }
    };
}

all_the_tuples!(impl_inherits_from);
