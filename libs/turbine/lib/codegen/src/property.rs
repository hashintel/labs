mod inner;
mod property_value;
mod type_;

use std::{collections::HashMap, ops::Deref};

use proc_macro2::{Ident, Span, TokenStream};
use quote::quote;
use type_system::{url::VersionedUrl, DataTypeReference, PropertyType, PropertyTypeReference};

use crate::{
    name::{Location, NameResolver},
    property::{
        inner::InnerTypes,
        type_::{Type, TypeGenerator},
    },
    shared::{generate_mod, imports, Import, Variant},
};

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
enum PathSegment {
    Inner { index: usize },
    OneOf { index: usize },
    Array,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
struct Stack(Vec<PathSegment>);

impl Stack {
    #[must_use]
    const fn new() -> Self {
        Self(Vec::new())
    }

    fn push(&mut self, segment: PathSegment) {
        self.0.push(segment);
    }

    fn pop(&mut self) {
        self.0.pop();
    }
}

impl Deref for Stack {
    type Target = [PathSegment];

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

struct State {
    /// extra streams that are to be created in the main function body
    extra: Vec<TokenStream>,
    stack: Stack,
    inner: InnerTypes,
    import: Import,
}

const RESERVED: &[&str] = &[
    "Type",
    "TypeRef",
    "PropertyType",
    "PropertyTypeRef",
    "PropertyTypeMut",
    "DataType",
    "DataTypeRef",
    "DataTypeMut",
    "VersionedUrlRef",
    "GenericPropertyError",
    "Serialize",
    "Report",
];

struct PropertyTypeGenerator<'a> {
    property: &'a PropertyType,
    resolver: &'a NameResolver<'a>,

    location: Location<'a>,

    locations: HashMap<&'a VersionedUrl, Location<'a>>,
    references: Vec<&'a VersionedUrl>,

    state: State,
}

impl<'a> PropertyTypeGenerator<'a> {
    fn new(property: &'a PropertyType, resolver: &'a NameResolver<'a>) -> Self {
        let location = resolver.location(property.id());

        let mut references: Vec<_> = property
            .property_type_references()
            .into_iter()
            .map(PropertyTypeReference::url)
            .chain(
                property
                    .data_type_references()
                    .into_iter()
                    .map(DataTypeReference::url),
            )
            .collect();
        // need to sort, as otherwise results might vary between invocations
        references.sort();

        let mut reserved = RESERVED.to_vec();
        reserved.push(&location.name.value);
        reserved.push(&location.name_ref.value);
        reserved.push(&location.name_mut.value);

        if let Some(name) = &location.name.alias {
            reserved.push(name);
        }
        if let Some(name) = &location.name_ref.alias {
            reserved.push(name);
        }
        if let Some(name) = &location.name_mut.alias {
            reserved.push(name);
        }

        // we need to clone here, otherwise we're in ownership kerfuffle
        let locations = resolver.locations(references.clone(), &reserved);

        let state = State {
            extra: vec![],
            inner: InnerTypes::new(&locations),
            stack: Stack::new(),
            import: Import {
                vec: false,
                box_: false,
                phantom_data: false,
            },
        };

        Self {
            property,
            resolver,
            location,
            locations,
            references,
            state,
        }
    }

    fn use_(&self) -> TokenStream {
        let mut imports: Vec<_> = imports(&self.references, &self.locations).collect();

        if self.state.import.box_ {
            imports.push(quote!(
                use alloc::boxed::Box;
            ));
        }

        if self.state.import.vec {
            imports.push(quote!(
                use alloc::vec::Vec;
            ));
        }

        quote! {
            use serde::Serialize;
            use turbine::{TypeUrl, Type, TypeRef, TypeMut};
            use turbine::{PropertyType, PropertyTypeRef, PropertyTypeMut};
            use turbine::{DataType, DataTypeRef, DataTypeMut};
            use turbine::url;
            use turbine::{VersionedUrlRef, GenericPropertyError};
            use error_stack::{Result, Report, ResultExt as _};

            #(#imports)*
        }
    }

    fn mod_(&self) -> Option<TokenStream> {
        generate_mod(&self.location.kind, self.resolver)
    }

    fn doc(&self) -> TokenStream {
        let property = self.property;
        let title = property.title();
        // mimic `#(...)?`
        let description = property.description().into_iter();

        quote!(
            #[doc = #title]
            #(
                #[doc = ""]
                #[doc = #description]
            )*
        )
    }

    fn type_(&mut self, name: &Ident, variant: Variant) -> Type {
        TypeGenerator {
            id: self.property.id(),
            name,
            variant,
            values: self.property.one_of(),
            self_variants: (&self.location).into(),
            resolver: self.resolver,
            locations: &self.locations,
            state: &mut self.state,
        }
        .finish()
    }

    fn owned(&mut self) -> TokenStream {
        let name = Ident::new(self.location.name.value.as_str(), Span::call_site());
        let name_ref = Ident::new(self.location.name_ref.value.as_str(), Span::call_site());
        let name_mut = Ident::new(self.location.name_mut.value.as_str(), Span::call_site());

        let base_url = self.property.id().base_url.as_str();
        let version = self.property.id().version;

        let alias = self.location.name.alias.as_ref().map(|alias| {
            let alias = Ident::new(alias, Span::call_site());

            quote!(pub type #alias = #name;)
        });

        let doc = self.doc();

        let Type {
            def,
            impl_try_from_value,
            impl_conversion,
            impl_is_valid_value,
            ..
        } = self.type_(&name, Variant::Owned);

        quote! {
            #doc
            #def

            impl TypeUrl for #name {
                // The RFC for `allOf` on property types is still in draft
                type InheritsFrom = ();

                const ID: VersionedUrlRef<'static>  = url!(#base_url / v / #version);
            }

            impl Type for #name {
                type Mut<'a> = #name_mut<'a> where Self: 'a;
                type Ref<'a> = #name_ref<'a> where Self: 'a;

                #impl_conversion
            }

            impl PropertyType for #name {
                type Error = GenericPropertyError;

                fn try_from_value(value: serde_json::Value) -> Result<Self, Self::Error> {
                    #impl_try_from_value
                }

                #impl_is_valid_value
            }

            #alias
        }
    }

    fn ref_(&mut self) -> TokenStream {
        let name = Ident::new(self.location.name.value.as_str(), Span::call_site());
        let name_ref = Ident::new(self.location.name_ref.value.as_str(), Span::call_site());

        let base_url = self.property.id().base_url.as_str();
        let version = self.property.id().version;

        let alias = self.location.name_ref.alias.as_ref().map(|alias| {
            let alias = Ident::new(alias, Span::call_site());

            quote!(pub type #alias<'a> = #name_ref<'a>;)
        });

        let doc = self.doc();

        let Type {
            def,
            impl_try_from_value,
            impl_conversion,
            ..
        } = self.type_(&name_ref, Variant::Ref);

        quote! {
            #doc
            #def

            impl TypeUrl for #name_ref<'_> {
                // The RFC for `allOf` on property types is still in draft
                type InheritsFrom = ();

                const ID: VersionedUrlRef<'static>  = url!(#base_url / v / #version);
            }

            impl TypeRef for #name_ref<'_> {
                type Owned = #name;

                #impl_conversion
            }

            impl<'a> PropertyTypeRef<'a> for #name_ref<'a> {
                type Error = GenericPropertyError;

                fn try_from_value(value: &'a serde_json::Value) -> Result<Self, Self::Error> {
                    #impl_try_from_value
                }
            }

            #alias
        }
    }

    fn mut_(&mut self) -> TokenStream {
        let name = Ident::new(self.location.name.value.as_str(), Span::call_site());
        let name_mut = Ident::new(self.location.name_mut.value.as_str(), Span::call_site());

        let base_url = self.property.id().base_url.as_str();
        let version = self.property.id().version;

        let alias = self.location.name_mut.alias.as_ref().map(|alias| {
            let alias = Ident::new(alias, Span::call_site());

            quote!(pub type #alias<'a> = #name_mut<'a>;)
        });

        let doc = self.doc();

        let Type {
            def,
            impl_try_from_value,
            impl_conversion,
            ..
        } = self.type_(&name_mut, Variant::Mut);

        quote! {
            #doc
            #def

            impl TypeUrl for #name_mut<'_> {
                // The RFC for `allOf` on property types is still in draft
                type InheritsFrom = ();

                const ID: VersionedUrlRef<'static>  = url!(#base_url / v / #version);
            }

            impl TypeMut for #name_mut<'_> {
                type Owned = #name;

                #impl_conversion
            }

            impl<'a> PropertyTypeMut<'a> for #name_mut<'a> {
                type Error = GenericPropertyError;

                fn try_from_value(value: &'a mut serde_json::Value) -> Result<Self, Self::Error> {
                    #impl_try_from_value
                }
            }

            #alias
        }
    }

    fn finish(mut self) -> TokenStream {
        let owned = self.owned();
        let ref_ = self.ref_();
        let mut_ = self.mut_();

        let use_ = self.use_();
        let mod_ = self.mod_();

        let extra = self.state.extra;

        quote! {
            #use_

            #(#extra)*

            #owned
            #ref_
            #mut_

            #mod_
        }
    }
}

// Generate the code for all oneOf, depending (with the () vs. {}) and extra types required,
// then if oneOf is one use a struct instead, inner types (`Inner`) should be
// generated via a mutable vec
pub(crate) fn generate(property: &PropertyType, resolver: &NameResolver) -> TokenStream {
    let generator = PropertyTypeGenerator::new(property, resolver);

    generator.finish()
}
