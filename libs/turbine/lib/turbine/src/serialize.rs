//! Polyfill for serde when serializing ZSTs and tuple types (which are just markers) into objects

#[macro_export]
macro_rules! serialize_compat {
    ($name:ident $(< $($lt:lifetime),* >)?) => {
        impl $(<$($lt),*>)? serde::Serialize for $name $(<$($lt),*>)? {
            fn serialize<S>(&self, serializer: S) -> core::result::Result<S::Ok, S::Error>
            where
                S: serde::Serializer,
            {
                let s = serializer.serialize_struct(core::stringify!($name), 0)?;

                serde::ser::SerializeStruct::end(s)
            }
        }
    };
}

#[cfg(test)]
mod tests {
    use core::marker::PhantomData;

    struct Zst;

    serialize_compat!(Zst);

    #[test]
    fn serialize_zst() {
        let export = serde_json::to_string(&Zst).unwrap();
        assert_eq!(export, "{}");
    }

    struct Tuple(u8);

    serialize_compat!(Tuple);

    #[test]
    fn serialize_tuple() {
        let export = serde_json::to_string(&Tuple(2)).unwrap();
        assert_eq!(export, "{}");
    }

    struct TupleRef<'a>(PhantomData<&'a ()>);

    serialize_compat!(TupleRef<'a>);

    #[test]
    fn serialize_tuple_ref() {
        let export = serde_json::to_string(&TupleRef(PhantomData)).unwrap();
        assert_eq!(export, "{}");
    }

    struct TupleMut<'a>(PhantomData<&'a mut ()>);

    serialize_compat!(TupleMut<'a>);

    #[test]
    fn serialize_tuple_mut() {
        let export = serde_json::to_string(&TupleMut(PhantomData)).unwrap();
        assert_eq!(export, "{}");
    }
}
