use proc_macro2::TokenStream;
use quote::{quote, ToTokens};
use type_system::{url::VersionedUrl, DataType};

use crate::name::NameResolver;

pub(crate) struct Builtin {
    url: &'static str,
    use_: &'static str,
}

impl ToTokens for Builtin {
    fn to_tokens(&self, tokens: &mut TokenStream) {
        let stream =
            syn::parse_str::<TokenStream>(self.use_).expect("`use_` should be valid Rust!");

        tokens.extend(stream);
    }
}

const ALLOW_LIST: &[Builtin] = &[
    Builtin {
        url: "https://blockprotocol.org/@blockprotocol/types/data-type/null/",
        use_: "use turbine::types::data::Null",
    },
    Builtin {
        url: "https://blockprotocol.org/@blockprotocol/types/data-type/text/",
        use_: "use turbine::types::data::Text",
    },
    Builtin {
        url: "https://blockprotocol.org/@blockprotocol/types/data-type/number/",
        use_: "use turbine::types::data::Number",
    },
    Builtin {
        url: "https://blockprotocol.org/@blockprotocol/types/data-type/object/",
        use_: "use turbine::types::data::Object",
    },
    Builtin {
        url: "https://blockprotocol.org/@blockprotocol/types/data-type/boolean/",
        use_: "use turbine::types::data::Boolean",
    },
    Builtin {
        url: "https://blockprotocol.org/@blockprotocol/types/data-type/emptyList/",
        use_: "use turbine::types::data::EmptyList",
    },
];

pub(crate) fn find_builtin(url: &VersionedUrl) -> Option<&'static Builtin> {
    ALLOW_LIST
        .iter()
        .find(|Builtin { url: builtin, .. }| *builtin == url.base_url.as_str())
}

fn is_allowed(data: &DataType) -> bool {
    find_builtin(data.id()).is_some()
}

// TODO: when generating and we encounter a custom data-type simply import, they will get a
//  compile_error either way!
pub(crate) fn generate(data: &DataType, _: &NameResolver) -> Option<TokenStream> {
    // do not issue errors for built-in types
    if is_allowed(data) {
        return None;
    }

    Some(
        quote!(compile_error!("custom data types are not yet supported, see [#355](https://github.com/blockprotocol/blockprotocol/pull/355) for the official RFC");),
    )
}
