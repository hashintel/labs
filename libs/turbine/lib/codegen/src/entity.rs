use std::{
    collections::{BTreeMap, HashMap},
    ops::Deref,
};

use proc_macro2::{Ident, Span, TokenStream};
use quote::{format_ident, quote};
use syn::{Token, Visibility};
use type_system::{
    url::{BaseUrl, VersionedUrl},
    EntityType,
};

use crate::{
    name::{Location, NameResolver, PropertyName},
    shared,
    shared::{
        determine_import_path, generate_mod, generate_properties_is_valid_value, generate_property,
        generate_property_object_conversion_body, imports, ConversionFunction, Import, Property,
        Variant,
    },
};

const RESERVED: &[&str] = &[
    "Type",
    "TypeRef",
    "EntityType",
    "EntityTypeRef",
    "EntityProperties",
    "EntityLink",
    "OptionalEntityLink",
    "VersionedUrlRef",
    "GenericEntityError",
    "Entity",
    "LinkData",
    "Serialize",
    "Properties",
    "PropertiesRef",
    "PropertiesMut",
    "Report",
    "HashMap",
    "BaseUrl",
    "String",
];

struct State {
    is_link: bool,
    import: Import,
}

fn properties<'a>(
    entity: &'a EntityType,
    resolver: &NameResolver,
    property_names: &HashMap<&VersionedUrl, PropertyName>,
    locations: &HashMap<&VersionedUrl, Location>,
) -> BTreeMap<&'a BaseUrl, Property> {
    shared::properties(
        entity.id(),
        entity.properties(),
        entity.required(),
        resolver,
        property_names,
        locations,
    )
}

fn generate_use(
    references: &[&VersionedUrl],
    locations: &HashMap<&VersionedUrl, Location>,
    state: &State,
) -> TokenStream {
    let mut imports: Vec<_> = imports(references, locations).collect();

    if state.is_link {
        imports.push(quote!(
            use turbine::entity::LinkData;
        ));
    }

    if state.import.box_ {
        imports.push(quote!(
            use alloc::boxed::Box;
        ));
    }

    if state.import.vec {
        imports.push(quote!(
            use alloc::vec::Vec;
        ));
    }

    if state.import.phantom_data {
        imports.push(quote!(
            use core::marker::PhantomData;
        ));
    }

    quote! {
        use serde::Serialize;
        use turbine::{TypeUrl, Type, TypeRef, TypeMut};
        use turbine::{EntityType, EntityTypeRef, EntityTypeMut, EntityProperties, EntityLink, OptionalEntityLink};
        use turbine::{PropertyType as _, PropertyTypeRef as _, PropertyTypeMut as _};
        use turbine::{VersionedUrlRef, GenericEntityError};
        use turbine::entity::Entity;
        use turbine::{BaseUrl, url};
        use error_stack::{Result, Report, ResultExt as _};
        use hashbrown::HashMap;
        use alloc::string::String;

        #(#imports)*
    }
}

fn generate_properties_try_from_value(
    variant: Variant,
    properties: &BTreeMap<&BaseUrl, Property>,
) -> TokenStream {
    shared::generate_properties_try_from_value(
        variant,
        properties,
        &Ident::new("GenericEntityError", Span::call_site()),
        &quote!(Self),
    )
}

fn generate_properties_is_valid_properties(
    variant: Variant,
    properties: &BTreeMap<&BaseUrl, Property>,
) -> TokenStream {
    if variant != Variant::Owned {
        return quote!();
    }

    if properties.is_empty() {
        quote! {
            fn is_valid_value(_: &HashMap<String, serde_json::value::Value>) -> bool {
                true
            }
        }
    } else {
        let body = generate_properties_is_valid_value(properties);

        quote! {
            fn is_valid_value(properties: &HashMap<String, serde_json::value::Value>) -> bool {
                #body
            }
        }
    }
}

fn generate_properties_convert(
    variant: Variant,
    properties: &BTreeMap<&BaseUrl, Property>,
) -> TokenStream {
    if properties.is_empty() {
        match variant {
            Variant::Owned => {
                // inner type is guaranteed to be `PhantomData`, so we can just create the type
                // directly
                quote! {
                    fn as_mut(&mut self) -> PropertiesMut<'_> {
                        PropertiesMut(PhantomData)
                    }

                    fn as_ref(&self) -> PropertiesRef<'_> {
                        PropertiesRef(PhantomData)
                    }
                }
            }
            _ => {
                // guaranteed to be a ZST, just create it
                quote! {
                    fn into_owned(self) -> Properties {
                        Properties
                    }
                }
            }
        }
    } else {
        let name: Vec<_> = properties
            .values()
            .map(|Property { name, .. }| name)
            .collect();

        if variant == Variant::Owned {
            let as_mut = generate_property_object_conversion_body(
                &quote!(PropertiesMut),
                ConversionFunction::AsMut,
                properties,
            );

            let as_ref = generate_property_object_conversion_body(
                &quote!(PropertiesRef),
                ConversionFunction::AsRef,
                properties,
            );

            quote! {
                fn as_mut(&mut self) -> PropertiesMut<'_> {
                    let Self { #(#name),* } = self;

                    #as_mut
                }

                fn as_ref(&self) -> PropertiesRef<'_> {
                    let Self { #(#name),* } = self;

                    #as_ref
                }
            }
        } else {
            let into_owned = generate_property_object_conversion_body(
                &quote!(Properties),
                ConversionFunction::IntoOwned { variant },
                properties,
            );

            quote! {
                fn into_owned(self) -> Properties {
                    let Self { #(#name),* } = self;

                    #into_owned
                }
            }
        }
    }
}

#[allow(clippy::too_many_lines)]
fn generate_type(
    entity: &EntityType,
    variant: Variant,
    location: &Location,
    properties: &BTreeMap<&BaseUrl, Property>,
    state: &mut State,
) -> TokenStream {
    let lifetime = variant.into_lifetime().map(|lifetime| quote!(<#lifetime>));

    let mut derives = vec![format_ident!("Debug"), format_ident!("Serialize")];
    let mut property_derives = vec![format_ident!("Debug")];

    if variant == Variant::Owned || variant == Variant::Ref {
        for derive in [
            format_ident!("Clone"),
            format_ident!("PartialEq"),
            format_ident!("Eq"),
        ] {
            derives.push(derive.clone());
            property_derives.push(derive);
        }
    }

    if !properties.is_empty() {
        property_derives.push(format_ident!("Serialize"));
    }

    let derive = quote!(#[derive(#(#derives),*)]);
    let property_derive = quote!(#[derive(#(#property_derives),*)]);

    let name = match variant {
        Variant::Owned => &location.name,
        Variant::Ref => &location.name_ref,
        Variant::Mut => &location.name_mut,
    };

    let alias = name.alias.as_ref().map(|alias| {
        let alias = Ident::new(alias, Span::call_site());
        let name = Ident::new(&name.value, Span::call_site());

        quote!(pub type #alias #lifetime = #name #lifetime;)
    });

    let doc = generate_doc(entity);

    let name = Ident::new(&name.value, Span::call_site());

    let properties_name = match variant {
        Variant::Owned => Ident::new("Properties", Span::call_site()),
        Variant::Ref => Ident::new("PropertiesRef", Span::call_site()),
        Variant::Mut => Ident::new("PropertiesMut", Span::call_site()),
    };

    let reference = variant.into_reference();

    let mutability = match variant {
        Variant::Owned => Some(quote!(mut)),
        Variant::Ref | Variant::Mut => None,
    };

    let mut fields = vec![quote!(pub properties: #properties_name #lifetime)];

    if state.is_link {
        fields.push(quote!(pub link_data: #reference LinkData));
    }

    let (body, try_from_value) = if properties.is_empty() {
        if matches!(variant, Variant::Ref | Variant::Mut) {
            state.import.phantom_data = true;

            (
                quote!((pub PhantomData<&'a ()>);),
                quote!(Ok(Self(PhantomData))),
            )
        } else {
            (quote!(;), quote!(Ok(Self)))
        }
    } else {
        let try_from_value = generate_properties_try_from_value(variant, properties);

        let properties = properties.iter().map(|(base, property)| {
            generate_property(
                base,
                property,
                variant,
                Some(&Visibility::Public(Token![pub](Span::call_site()))),
                &mut state.import,
            )
        });

        (
            quote!({
                #(#properties),*
            }),
            try_from_value,
        )
    };

    let serialize_polyfill = properties
        .is_empty()
        .then(|| quote!(turbine::serialize_compat!(#properties_name #lifetime);));

    let conversion = generate_properties_convert(variant, properties);

    let is_valid_value = generate_properties_is_valid_properties(variant, properties);

    quote! {
        #property_derive
        pub struct #properties_name #lifetime #body

        #serialize_polyfill

        impl #lifetime #properties_name #lifetime {
            fn try_from_value(#mutability properties: #reference HashMap<String, serde_json::Value>) -> Result<Self, GenericEntityError> {
                #try_from_value
            }

            #conversion

            #is_valid_value
        }

        #doc
        #derive
        #[serde(rename_all = "camelCase")]
        pub struct #name #lifetime {
            #(#fields),*
        }

        #alias
    }
}

fn generate_doc(entity: &EntityType) -> TokenStream {
    let title = entity.title();
    // mimic `#(...)?`
    let description = entity.description().into_iter();

    quote!(
        #[doc = #title]
        #(
            #[doc = ""]
            #[doc = #description]
        )*
    )
}

// we don't need pretty imports for these types, they are just tuples and are not meant to be
// accessed directly
fn generate_absolute_import(location: &Location) -> TokenStream {
    let path = determine_import_path(location);
    let name = Ident::new(&location.name.value, Span::call_site());

    quote!(crate #(:: #path)* :: #name)
}

fn generate_type_url_inherits_from(entity: &EntityType, resolver: &NameResolver) -> TokenStream {
    let all_of = entity
        .inherits_from()
        .all_of()
        .iter()
        .filter_map(|reference| {
            let url = reference.url();

            if resolver.facts().should_skip(url) {
                return None;
            }

            let location = resolver.location(url);
            Some(generate_absolute_import(&location))
        });

    quote!(type InheritsFrom = (#(#all_of, <#all_of as TypeUrl>::InheritsFrom,)*);)
}

fn generate_owned(
    entity: &EntityType,
    location: &Location,
    properties: &BTreeMap<&BaseUrl, Property>,
    state: &mut State,
    resolver: &NameResolver,
) -> TokenStream {
    let name = Ident::new(&location.name.value, Span::call_site());
    let name_ref = Ident::new(&location.name_ref.value, Span::call_site());
    let name_mut = Ident::new(&location.name_mut.value, Span::call_site());

    let base_url = entity.id().base_url.as_str();
    let version = entity.id().version;

    let def = generate_type(entity, Variant::Owned, location, properties, state);

    // we emulate `#(...)?` which doesn't exist, see https://github.com/dtolnay/quote/issues/213
    let link_data: Vec<_> = state
        .is_link
        .then(|| Ident::new("link_data", Span::call_site()))
        .into_iter()
        .collect();

    let entity_link = if state.is_link {
        quote! {
            impl EntityLink for #name {
                fn link_data(&self) -> &LinkData {
                    &self.link_data
                }
            }
        }
    } else {
        quote! {
            impl OptionalEntityLink for #name {
                fn link_data_opt(&self) -> Option<&turbine::entity::LinkData> {
                    None
                }
            }
        }
    };

    let inherits_from = generate_type_url_inherits_from(entity, resolver);

    quote! {
        #def

        impl TypeUrl for #name {
            #inherits_from

            const ID: VersionedUrlRef<'static>  = url!(#base_url / v / #version);
        }

        impl Type for #name {
            type Mut<'a> = #name_mut<'a> where Self: 'a;
            type Ref<'a> = #name_ref<'a> where Self: 'a;

            fn as_mut(&mut self) -> Self::Mut<'_> {
                #name_mut {
                    properties: self.properties.as_mut(),
                    #(#link_data: &mut self.link_data)*
                }
            }

            fn as_ref(&self) -> Self::Ref<'_> {
                #name_ref {
                    properties: self.properties.as_ref(),
                    #(#link_data: &self.link_data)*
                }
            }
        }

        impl EntityType for #name {
            type Error = GenericEntityError;

            fn try_from_entity(value: Entity) -> Option<Result<Self, Self::Error>> {
                if Self::ID != value.metadata.entity_type_id {
                    return None;
                }

                let properties = Properties::try_from_value(value.properties.0);
                #(let #link_data = value.link_data
                    .ok_or_else(|| Report::new(GenericEntityError::ExpectedLinkData));
                )*

                match turbine::fold_tuple_reports((properties, #(#link_data)*)) {
                    Err(error) => Some(Err(error)),
                    Ok((properties, #(#link_data,)*)) => Some(
                        Ok(
                            Self {
                                properties,
                                #(#link_data,)*
                            }
                        )
                    )
                }
            }

            fn is_valid_entity(value: &Entity) -> bool {
                Self::ID == value.metadata.entity_type_id &&
                    #(value.#link_data.is_some() &&)*
                    Properties::is_valid_value(&value.properties.0)
            }
        }

        impl EntityProperties for #name {
            type Properties = Properties;

            fn properties(&self) -> &Self::Properties {
                &self.properties
            }
        }

        #entity_link
    }
}

fn generate_ref(
    entity: &EntityType,
    location: &Location,
    properties: &BTreeMap<&BaseUrl, Property>,
    state: &mut State,
    resolver: &NameResolver,
) -> TokenStream {
    let name = Ident::new(&location.name.value, Span::call_site());
    let name_ref = Ident::new(&location.name_ref.value, Span::call_site());

    let def = generate_type(entity, Variant::Ref, location, properties, state);

    let base_url = entity.id().base_url.as_str();
    let version = entity.id().version;

    // we emulate `#(...)?` which doesn't exist, see https://github.com/dtolnay/quote/issues/213
    let link_data: Vec<_> = state
        .is_link
        .then(|| Ident::new("link_data", Span::call_site()))
        .into_iter()
        .collect();

    let entity_link = if state.is_link {
        quote! {
            impl EntityLink for #name_ref<'_> {
                fn link_data(&self) -> &LinkData {
                    self.link_data
                }
            }
        }
    } else {
        quote! {
            impl OptionalEntityLink for #name_ref<'_> {
                fn link_data_opt(&self) -> Option<&turbine::entity::LinkData> {
                    None
                }
            }
        }
    };

    let inherits_from = generate_type_url_inherits_from(entity, resolver);

    quote! {
        #def

        impl TypeUrl for #name_ref<'_> {
            #inherits_from

            const ID: VersionedUrlRef<'static>  = url!(#base_url / v / #version);
        }

        impl TypeRef for #name_ref<'_> {
            type Owned = #name;

            fn into_owned(self) -> Self::Owned {
                #name {
                    properties: self.properties.into_owned(),
                    #(#link_data: self.link_data.clone())*
                }
            }
        }

        impl<'a> EntityTypeRef<'a> for #name_ref<'a> {
            type Error = GenericEntityError;

            fn try_from_entity(value: &'a Entity) -> Option<Result<Self, Self::Error>> {
                if Self::Owned::ID != value.metadata.entity_type_id {
                    return None;
                }

                let properties = PropertiesRef::try_from_value(&value.properties.0);
                #(let #link_data = value.link_data
                    .as_ref()
                    .ok_or_else(|| Report::new(GenericEntityError::ExpectedLinkData));
                )*

                match turbine::fold_tuple_reports((properties, #(#link_data)*)) {
                    Err(error) => Some(Err(error)),
                    Ok((properties, #(#link_data,)*)) => Some(
                        Ok(
                            Self {
                                properties,
                                #(#link_data,)*
                            }
                        )
                    )
                }
            }
        }

        impl<'a> EntityProperties for #name_ref<'a> {
            type Properties = PropertiesRef<'a>;

            fn properties(&self) -> &Self::Properties {
                &self.properties
            }
        }

        #entity_link
    }
}

fn generate_mut(
    entity: &EntityType,
    location: &Location,
    properties: &BTreeMap<&BaseUrl, Property>,
    state: &mut State,
    resolver: &NameResolver,
) -> TokenStream {
    let name = Ident::new(&location.name.value, Span::call_site());
    let name_mut = Ident::new(&location.name_mut.value, Span::call_site());

    let def = generate_type(entity, Variant::Mut, location, properties, state);

    let base_url = entity.id().base_url.as_str();
    let version = entity.id().version;

    // we emulate `#(...)?` which doesn't exist, see https://github.com/dtolnay/quote/issues/213
    let link_data: Vec<_> = state
        .is_link
        .then(|| Ident::new("link_data", Span::call_site()))
        .into_iter()
        .collect();

    let entity_link = if state.is_link {
        quote! {
            impl EntityLink for #name_mut<'_> {
                fn link_data(&self) -> &LinkData {
                    &*self.link_data
                }
            }
        }
    } else {
        quote! {
            impl OptionalEntityLink for #name_mut<'_> {
                fn link_data_opt(&self) -> Option<&turbine::entity::LinkData> {
                    None
                }
            }
        }
    };

    let inherits_from = generate_type_url_inherits_from(entity, resolver);

    quote! {
        #def

        impl TypeUrl for #name_mut<'_> {
            #inherits_from

            const ID: VersionedUrlRef<'static>  = url!(#base_url / v / #version);
        }

        impl TypeMut for #name_mut<'_> {
            type Owned = #name;

            fn into_owned(self) -> Self::Owned {
                #name {
                    properties: self.properties.into_owned(),
                    #(#link_data: self.link_data.clone())*
                }
            }
        }

        impl<'a> EntityTypeMut<'a> for #name_mut<'a> {
            type Error = GenericEntityError;

            fn try_from_entity(value: &'a mut Entity) -> Option<Result<Self, Self::Error>> {
                if Self::Owned::ID != value.metadata.entity_type_id {
                    return None;
                }

                let properties = PropertiesMut::try_from_value(&mut value.properties.0);
                #(let #link_data = value.link_data
                    .as_mut()
                    .ok_or_else(|| Report::new(GenericEntityError::ExpectedLinkData));
                )*

                match turbine::fold_tuple_reports((properties, #(#link_data)*)) {
                    Err(error) => Some(Err(error)),
                    Ok((properties, #(#link_data,)*)) => Some(
                        Ok(
                            Self {
                                properties,
                                #(#link_data,)*
                            }
                        )
                    )
                }
            }
        }

        impl<'a> EntityProperties for #name_mut<'a> {
            type Properties = PropertiesMut<'a>;

            fn properties(&self) -> &Self::Properties {
                &self.properties
            }
        }

        #entity_link
    }
}

pub(crate) fn generate(entity: &EntityType, resolver: &NameResolver) -> TokenStream {
    let url = entity.id();

    let location = resolver.location(url);

    let property_type_references = entity.property_type_references();

    let mut references: Vec<_> = property_type_references
        .iter()
        .map(|reference| reference.url())
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

    let property_names = resolver.property_names(references.iter().map(Deref::deref));
    let locations = resolver.locations(references.iter().map(Deref::deref), &reserved);

    let properties = properties(entity, resolver, &property_names, &locations);

    let is_link = resolver.facts().links().contains(url);

    let mut state = State {
        is_link,
        import: Import {
            vec: false,
            box_: false,
            phantom_data: false,
        },
    };

    let owned = generate_owned(entity, &location, &properties, &mut state, resolver);
    let ref_ = generate_ref(entity, &location, &properties, &mut state, resolver);
    let mut_ = generate_mut(entity, &location, &properties, &mut state, resolver);

    let mod_ = generate_mod(&location.kind, resolver);
    let use_ = generate_use(&references, &locations, &state);

    quote! {
        #use_

        #owned
        #ref_
        #mut_

        #mod_
    }
}
