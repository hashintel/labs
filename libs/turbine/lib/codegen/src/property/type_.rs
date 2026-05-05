use std::collections::HashMap;

use itertools::Itertools;
use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote, ToTokens};
use type_system::{url::VersionedUrl, PropertyValues};

use crate::{
    name::{Location, NameResolver},
    property::{
        property_value::{
            ConversionBody, PropertyValue, PropertyValueGenerator, SelfType, SelfVariants,
        },
        PathSegment, State,
    },
    shared::Variant,
};

pub(super) struct Type {
    pub(super) def: TokenStream,
    pub(super) lifetime: Option<TokenStream>,

    pub(super) impl_ty: TokenStream,
    pub(super) impl_try_from_value: TokenStream,
    pub(super) impl_is_valid_value: TokenStream,
    pub(super) impl_conversion: TokenStream,
}

pub(super) struct TypeGenerator<'a> {
    pub(super) id: &'a VersionedUrl,
    pub(super) name: &'a Ident,
    pub(super) variant: Variant,
    pub(super) self_variants: SelfVariants,

    pub(super) values: &'a [PropertyValues],
    pub(super) resolver: &'a NameResolver<'a>,
    pub(super) locations: &'a HashMap<&'a VersionedUrl, Location<'a>>,

    pub(super) state: &'a mut State,
}

impl<'a> TypeGenerator<'a> {
    fn hoist(
        &mut self,
        value: &PropertyValues,
        derive: &TokenStream,
        lifetime: Option<TokenStream>,
    ) -> Type {
        let name = self.name;

        let semicolon = match value {
            PropertyValues::PropertyTypeObject(_) => false,
            PropertyValues::ArrayOfPropertyValues(_) | PropertyValues::DataTypeReference(_) => true,
        };

        self.state.stack.push(PathSegment::OneOf { index: 0 });
        let PropertyValue {
            body,
            try_from,
            is_valid_value,
            conversion,
        } = PropertyValueGenerator {
            id: self.id,
            variant: self.variant,
            self_type: SelfType::struct_(),
            self_variants: &self.self_variants,
            resolver: self.resolver,
            locations: self.locations,
            value,
            state: self.state,
        }
        .finish();
        self.state.stack.pop();

        let semicolon = semicolon.then_some(quote!(;));

        let def = quote! {
            #derive
            pub struct #name #lifetime #body #semicolon
        };

        let SelfVariants { owned, ref_, mut_ } = &self.self_variants;
        let ConversionBody {
            into_owned,
            as_ref,
            as_mut,
        } = conversion;

        let impl_conversion = match self.variant {
            Variant::Owned => {
                quote! {
                    fn as_mut(&mut self) -> #mut_<'_> {
                        #as_mut
                    }

                    fn as_ref(&self) -> #ref_<'_> {
                        #as_ref
                    }
                }
            }
            Variant::Ref | Variant::Mut => {
                quote! {
                    fn into_owned(self) -> #owned {
                        #into_owned
                    }
                }
            }
        };

        let impl_is_valid_value = quote! {
            fn is_valid_value(value: &serde_json::Value) -> bool #is_valid_value
        };
        let impl_ty = quote!(#name #lifetime);

        Type {
            def,
            lifetime,
            impl_ty,
            impl_try_from_value: try_from,
            impl_is_valid_value,
            impl_conversion,
        }
    }

    fn impl_conversion(&self, conversion: &[ConversionBody]) -> TokenStream {
        let SelfVariants { owned, ref_, mut_ } = &self.self_variants;

        let into_owned = conversion
            .iter()
            .flat_map(|ConversionBody { into_owned, .. }| into_owned);
        let as_ref = conversion
            .iter()
            .flat_map(|ConversionBody { as_ref, .. }| as_ref);
        let as_mut = conversion
            .iter()
            .flat_map(|ConversionBody { as_mut, .. }| as_mut);

        // TODO: we might need something else for the return type here!
        match self.variant {
            Variant::Owned => {
                quote! {
                    fn as_mut(&mut self) -> #mut_<'_> {
                        match self {
                            #(#as_mut),*
                        }
                    }

                    fn as_ref(&self) -> #ref_<'_> {
                        match self {
                            #(#as_ref),*
                        }
                    }
                }
            }
            Variant::Ref | Variant::Mut => {
                quote! {
                    fn into_owned(self) -> #owned {
                        match self {
                            #(#into_owned),*
                        }
                    }
                }
            }
        }
    }

    pub(super) fn finish(mut self) -> Type {
        let derive = match self.variant {
            Variant::Owned | Variant::Ref => {
                quote!(#[derive(Debug, PartialEq, Eq, Clone, Serialize)])
            }
            Variant::Mut => quote!(#[derive(Debug, Serialize)]),
        };

        let lifetime = match self.variant {
            Variant::Ref | Variant::Mut => Some(quote!(<'a>)),
            Variant::Owned => None,
        };

        if let [value] = self.values {
            return self.hoist(value, &derive, lifetime);
        }

        // we cannot hoist and therefore need to create an enum

        // N.B.:
        // in the enum we could in theory name the variant by the name of the struct, problem here
        // is ofc that we would still need to name the other variants and then we have
        // potential name conflicts... Do we need to box on Ref and Mut self-referential?
        let (body, try_from_variants, is_valid_value, conversion): (
            Vec<_>,
            Vec<_>,
            Vec<_>,
            Vec<_>,
        ) = self
            .values
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let name = format_ident!("Variant{index}");

                self.state.stack.push(PathSegment::OneOf { index });
                let PropertyValue {
                    body,
                    try_from,
                    is_valid_value,
                    conversion,
                } = PropertyValueGenerator {
                    id: self.id,
                    variant: self.variant,
                    self_type: SelfType::enum_(&name.to_token_stream()),
                    self_variants: &self.self_variants,
                    resolver: self.resolver,
                    locations: self.locations,
                    value,
                    state: self.state,
                }
                .finish();
                self.state.stack.pop();

                (
                    quote! {
                        #name #body
                    },
                    try_from,
                    is_valid_value,
                    conversion,
                )
            })
            .multiunzip();

        let deref = match self.variant {
            Variant::Owned => quote!(&),
            Variant::Ref => quote!(),
            Variant::Mut => quote!(&*),
        };

        let try_from_tries =
            is_valid_value
                .iter()
                .zip(try_from_variants)
                .map(|(is_valid_value, try_from)| {
                    quote! {
                        // LLVM is smart enough to optimize away the immediate function invocation
                        // we use this to be able to use `return` in the generated code.
                        let is_valid = (|value: &serde_json::value::Value| #is_valid_value)(#deref value);

                        if is_valid {
                            return #try_from;
                        }
                    }
                });

        let try_from = quote! {
            #(
                #try_from_tries
            )*

            Err(Report::new(GenericPropertyError::InvalidValue))
        };

        let is_valid_value = quote! {
            fn is_valid_value(value: &serde_json::Value) -> bool {
                true #(|| #is_valid_value)*
            }
        };

        let name = self.name;
        let def = quote! {
            #derive
            #[serde(untagged)]
            pub enum #name #lifetime {
                #(#body),*
            }
        };

        let impl_ty = quote!(#name #lifetime);

        Type {
            def,
            lifetime,
            impl_ty,
            impl_try_from_value: try_from,
            impl_is_valid_value: is_valid_value,
            impl_conversion: self.impl_conversion(&conversion),
        }
    }
}
