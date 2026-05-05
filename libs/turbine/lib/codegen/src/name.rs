use std::{
    borrow::Cow,
    collections::{BTreeMap, HashMap, HashSet},
    fmt::{Display, Formatter},
    iter::once,
    path::PathBuf,
};

use heck::{ToPascalCase, ToSnekCase};
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::Url;
use type_system::url::VersionedUrl;

use crate::{
    analysis::{facts::Facts, DependencyAnalyzer},
    AnyType,
};

#[derive(Debug, Copy, Clone)]
pub enum ModuleFlavor {
    ModRs,
    ModuleRs,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct Directory(String);

impl Directory {
    #[must_use]
    pub fn name(&self) -> &str {
        &self.0
    }

    #[must_use]
    #[allow(clippy::missing_const_for_fn)]
    pub fn into_name(self) -> String {
        self.0
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct File(String);

impl File {
    pub(crate) fn name(&self) -> &str {
        &self.0
    }

    #[must_use]
    #[allow(clippy::missing_const_for_fn)]
    pub fn into_name(self) -> String {
        self.0
    }

    pub(crate) fn fs_name(&self) -> String {
        format!("{}.rs", self.0)
    }

    #[must_use]
    pub fn is_mod(&self) -> bool {
        self.0 == "mod"
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct Path(Vec<Directory>, File);

impl Path {
    #[must_use]
    pub fn directories(&self) -> &[Directory] {
        &self.0
    }

    #[must_use]
    pub const fn file(&self) -> &File {
        &self.1
    }

    #[must_use]
    #[allow(clippy::missing_const_for_fn)]
    pub fn into_parts(self) -> (Vec<Directory>, File) {
        (self.0, self.1)
    }
}

impl From<Path> for PathBuf {
    fn from(value: Path) -> Self {
        let Path(directories, file) = value;

        let path: Vec<_> = directories
            .into_iter()
            .map(|directory| directory.name().to_owned())
            .chain(once(file.fs_name()))
            .collect();

        Self::from(path.join("/"))
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct Name {
    pub(crate) value: String,
    pub(crate) alias: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum LocationKind<'a> {
    /// Indicates that we are the latest version, if other is non-empty we need to create `use`
    /// statements and import those types.
    Latest { other: Vec<&'a VersionedUrl> },
    /// Specific older version, that is not current, implies that there is a latest version it is
    /// referenced in.
    Version,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct Alias {
    pub(crate) value: Option<String>,
    pub(crate) value_ref: Option<String>,
    pub(crate) value_mut: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct Location<'a> {
    pub(crate) path: Path,

    pub(crate) name: Name,
    pub(crate) name_ref: Name,
    pub(crate) name_mut: Name,

    pub(crate) alias: Alias,
    pub(crate) kind: LocationKind<'a>,
}

/// Pattern matching mode
///
/// We only match path and host/protocol, everything else is stripped
#[derive(Debug, Copy, Clone, serde::Deserialize)]
pub enum Mode {
    MatchPath,
    MatchAll,
}

impl Mode {
    /// Verification step that panics as this will lead to corruption either way
    ///
    /// Will verify that all named groups required by the [`NameResolver`] are present depending on
    /// the name.
    ///
    /// ## Panics
    ///
    /// If the regex pattern is incomplete or does not have the required capture groups
    fn verify_pattern(self, regex: &Regex) {
        match self {
            Self::MatchPath => {
                // we do not check for extra groups, as they might be used, this is mostly just to
                // encourage future checks
                let mut optional: HashSet<_> = once("namespace").collect();
                let mut required: HashSet<_> = ["kind", "id"].into_iter().collect();

                for name in regex.capture_names().flatten() {
                    required.remove(name);
                    optional.remove(name);
                }

                assert!(
                    required.is_empty(),
                    "match path pattern requires `kind` and `id` named groups"
                );
            }
            Self::MatchAll => {
                let mut optional: HashSet<_> = once("namespace").collect();
                let mut required: HashSet<_> = ["origin", "kind", "id"].into_iter().collect();

                for name in regex.capture_names().flatten() {
                    required.remove(name);
                    optional.remove(name);
                }

                assert!(
                    required.is_empty(),
                    "match all pattern requires `origin`, `kind` and `id` named groups"
                );
            }
        }
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct Flavor {
    pub name: Cow<'static, str>,
    mode: Mode,
    #[serde(with = "serde_regex")]
    pattern: Regex,
}

impl Flavor {
    /// ## Panics
    ///
    /// If the regex pattern is incomplete or does not have the required capture groups
    #[must_use]
    pub fn new(name: &'static str, mode: Mode, pattern: Regex) -> Self {
        mode.verify_pattern(&pattern);

        Self {
            name: Cow::Borrowed(name),
            mode,
            pattern,
        }
    }
}

static BLOCKPROTOCOL_FLAVOR: Lazy<Flavor> = Lazy::new(|| {
    let pattern = Regex::new(
        r"^/@(?P<namespace>[\w-]+)/types/(?P<kind>data|property|entity)-type/(?P<id>[\w\-_%~]+)/$",
    )
    .expect("valid pattern");

    Flavor::new("block-protocol", Mode::MatchPath, pattern)
});

static BUILTIN_FLAVORS: &[&Lazy<Flavor>] = &[&BLOCKPROTOCOL_FLAVOR];

const BUILTIN_OVERRIDES: &[Override] = &[Override::from_parts(
    Some(OverrideAction::new_static(
        "blockprotocol.org",
        "blockprotocol",
    )),
    None,
)];

#[derive(Debug, Copy, Clone)]
enum Kind {
    Data,
    Property,
    Entity,
}

impl Display for Kind {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Data => f.write_str("data"),
            Self::Property => f.write_str("property"),
            Self::Entity => f.write_str("entity"),
        }
    }
}

struct UrlParts<'a> {
    origin: String,
    namespace: Option<Cow<'a, str>>,
    kind: Kind,
    id: &'a str,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct OverrideAction {
    matches: Cow<'static, str>,
    replacement: Cow<'static, str>,
}

impl OverrideAction {
    pub fn new(matches: impl Into<String>, replacement: impl Into<String>) -> Self {
        Self {
            matches: Cow::Owned(matches.into()),
            replacement: Cow::Owned(replacement.into()),
        }
    }

    const fn new_static(matches: &'static str, replacement: &'static str) -> Self {
        Self {
            matches: Cow::Borrowed(matches),
            replacement: Cow::Borrowed(replacement),
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Override {
    origin: Option<OverrideAction>,
    namespace: Option<OverrideAction>,
}

impl Override {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            origin: None,
            namespace: None,
        }
    }

    const fn from_parts(origin: Option<OverrideAction>, namespace: Option<OverrideAction>) -> Self {
        Self { origin, namespace }
    }

    #[allow(clippy::missing_const_for_fn)]
    #[must_use]
    pub fn with_origin(mut self, origin: OverrideAction) -> Self {
        self.origin = Some(origin);

        self
    }

    #[allow(clippy::missing_const_for_fn)]
    #[must_use]
    pub fn with_namespace(mut self, namespace: OverrideAction) -> Self {
        self.namespace = Some(namespace);

        self
    }

    fn apply(&self, url: &mut UrlParts) {
        if let Some(origin) = &self.origin {
            if url.origin == origin.matches {
                url.origin = origin.replacement.clone().into_owned();
            }

            if let Some(namespace) = &self.namespace {
                if url.namespace.as_ref() == Some(&namespace.matches) {
                    url.namespace = Some(origin.replacement.clone());
                }
            }
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct PropertyName(pub(crate) String);

// TODO: caching?!
pub(crate) struct NameResolver<'a> {
    lookup: &'a HashMap<VersionedUrl, AnyType>,
    analyzer: &'a DependencyAnalyzer<'a>,
    facts: &'a Facts,

    overrides: Vec<Override>,
    module: ModuleFlavor,
    flavors: Vec<Flavor>,
}

impl<'a> NameResolver<'a> {
    pub(crate) const fn new(
        lookup: &'a HashMap<VersionedUrl, AnyType>,
        analyzer: &'a DependencyAnalyzer<'a>,
        facts: &'a Facts,
    ) -> Self {
        Self {
            lookup,
            analyzer,
            facts,

            overrides: Vec::new(),
            module: ModuleFlavor::ModRs,
            flavors: Vec::new(),
        }
    }

    pub(crate) fn with_override(&mut self, value: Override) {
        self.overrides.push(value);
    }

    pub(crate) fn with_module_flavor(&mut self, flavor: ModuleFlavor) {
        self.module = flavor;
    }

    pub(crate) fn with_flavor(&mut self, flavor: Flavor) {
        self.flavors.push(flavor);
    }

    fn url_into_parts<'b>(&self, url: &'b Url) -> Option<UrlParts<'b>> {
        let flavors = BUILTIN_FLAVORS
            .iter()
            .map(|flavor| &***flavor)
            .chain(self.flavors.iter());

        for flavor in flavors {
            let target = match flavor.mode {
                Mode::MatchPath => url.path(),
                Mode::MatchAll => url.as_str(),
            };

            let Some(captures) = flavor.pattern.captures(target) else {
                continue;
            };

            let origin = match flavor.mode {
                Mode::MatchPath => {
                    let origin = url.origin().ascii_serialization();

                    // origin already does not include the password or username field from before
                    // the path, this additionally removes the scheme, as it is unlikely that from
                    // the same origin two different protocols are used to serve the exact same id
                    // that is used in two different places.
                    // This overall creates some nicer urls, e.g. `blockprotocol_org` instead of
                    // `https_blockprotocol_org`
                    if let Some((_, origin)) = origin.split_once("://") {
                        origin.to_owned()
                    } else {
                        origin
                    }
                }
                Mode::MatchAll => captures
                    .name("origin")
                    .expect("infallible; checked by constructor")
                    .as_str()
                    .to_owned(),
            };

            let namespace = captures
                .name("namespace")
                .map(|m| m.as_str())
                .map(Cow::Borrowed);

            let kind = captures
                .name("kind")
                .map(|m| m.as_str())
                .expect("infallible; checked by constructor");

            let kind = match kind {
                "data" => Kind::Data,
                "property" => Kind::Property,
                "entity" => Kind::Entity,
                _ => unimplemented!(),
            };

            let id = captures
                .name("id")
                .map(|m| m.as_str())
                .expect("infallible; checked by constructor");

            let mut url = UrlParts {
                origin,
                namespace,
                kind,
                id,
            };

            for r#override in BUILTIN_OVERRIDES.iter().chain(self.overrides.iter()) {
                r#override.apply(&mut url);
            }

            return Some(url);
        }

        None
    }

    fn determine_name(
        &self,
        url: &VersionedUrl,
        parts: Option<&UrlParts>,
        versions: &BTreeMap<u32, &AnyType>,
    ) -> Name {
        let mut name = match parts {
            None => self.lookup[url].title().to_pascal_case(),
            Some(UrlParts { id, .. }) => id.to_pascal_case(),
        };

        // Default handling, if we're the newest version (very often the case), then we also export
        // a versioned identifier to the "default" one.
        let mut alias = Some(format!("{name}V{}", url.version));

        if let Some((&other_latest, _)) = versions.last_key_value() {
            if other_latest > url.version {
                // we also need to suffix the version number to the type name to stay consistent and
                // avoid ambiguity
                name = format!("{name}V{}", url.version);

                // the name is the actual alias, so we don't need to export it multiple times
                alias = None;
            }
        }

        Name { value: name, alias }
    }

    fn other_versions_of_url(&self, url: &VersionedUrl) -> BTreeMap<u32, &'a AnyType> {
        self.lookup
            .iter()
            .filter(|(key, _)| key.base_url == url.base_url)
            .filter(|(key, _)| **key != *url)
            .map(|(key, value)| (key.version, value))
            .collect()
    }

    /// Return the module location for the structure or enum for the specified URL
    ///
    /// We need to resolve the name and if there are multiple versions we need to make sure that
    /// those are in the correct file! (`mod.rs` vs `module.rs`)
    pub(crate) fn location(&self, url: &VersionedUrl) -> Location {
        let versions = self.other_versions_of_url(url);

        let base_url = url.base_url.to_url();

        let parts = self.url_into_parts(&base_url);

        let mut path = match &parts {
            // we don't know the URL, so the file is simply called the snake_case version of the
            // URL
            None => Path(Vec::new(), File(base_url.as_str().to_snek_case())),
            Some(UrlParts {
                origin,
                namespace,
                kind,
                id,
            }) => {
                let mut directories = vec![Directory(origin.to_snek_case())];

                if let Some(namespace) = namespace {
                    directories.push(Directory(namespace.to_snek_case()));
                }

                directories.push(Directory(kind.to_string()));

                Path(directories, File(id.to_snek_case()))
            }
        };

        let name = self.determine_name(url, parts.as_ref(), &versions);
        let mut kind = LocationKind::Latest { other: vec![] };

        // we need to handle multiple versions, the latest version is always in the `mod.rs`,
        // `module.rs`, while all other files are in `v<N>` files.
        // in the case that there are no other versions, we can just continue and use the name
        // provided earlier.
        if let Some((&other_latest, _)) = versions.last_key_value() {
            if other_latest > url.version {
                // we're an older version, therefore we need to be in a directory, with `v<N>` as
                // file
                let File(old) = path.1;
                path.0.push(Directory(old));
                path.1 = File(format!("v{}", url.version));

                kind = LocationKind::Version;
            } else {
                kind = LocationKind::Latest {
                    other: versions.into_values().map(AnyType::id).collect(),
                };

                // we're the newest version, hoist it up to the `module.rs` or `mod.rs` file,
                // depending on flavor.
                match self.module {
                    ModuleFlavor::ModRs => {
                        let File(old) = path.1;
                        path.0.push(Directory(old));
                        path.1 = File("mod".to_owned());
                    }
                    // no change necessary
                    ModuleFlavor::ModuleRs => {}
                }
            }
        }

        let name_ref = Name {
            value: format!("{}Ref", name.value),
            alias: name.alias.as_ref().map(|alias| format!("{alias}Ref")),
        };

        let name_mut = Name {
            value: format!("{}Mut", name.value),
            alias: name.alias.as_ref().map(|alias| format!("{alias}Mut")),
        };

        Location {
            path,
            name,
            name_ref,
            name_mut,
            alias: Alias {
                value: None,
                value_ref: None,
                value_mut: None,
            },
            kind,
        }
    }

    /// Same as [`Self::location`], but is aware of name clashes and will resolve those properly
    pub(crate) fn locations<'b>(
        &self,
        urls: impl IntoIterator<Item = &'b VersionedUrl>,
        reserved: &[&str],
    ) -> HashMap<&'b VersionedUrl, Location> {
        let mut locations_by_base: HashMap<String, Vec<_>> = HashMap::new();

        for url in urls {
            let location = self.location(url);

            let urls = locations_by_base
                .entry(location.name.value.clone())
                .or_default();

            urls.push((url, location));
        }

        let mut output = HashMap::new();

        for mut locations in locations_by_base.into_values() {
            let name = &locations[0].1.name.value;

            if locations.len() > 1 || reserved.contains(&&**name) {
                // suffix names with their position
                for (index, (_, location)) in locations.iter_mut().enumerate() {
                    location.alias = Alias {
                        value: Some(format!("{}{index}", location.name.value)),
                        value_ref: Some(format!("{}{index}", location.name_ref.value)),
                        value_mut: Some(format!("{}{index}", location.name_mut.value)),
                    };
                }
            }

            for (url, location) in locations {
                output.insert(url, location);
            }
        }

        output
    }

    /// Returns the name for the accessor or property for the specified URL
    pub(crate) fn property_name(&self, url: &VersionedUrl) -> PropertyName {
        let base_url = url.base_url.to_url();

        let parts = self.url_into_parts(&base_url);

        // here we don't differentiate between versions, as it is highly unlikely that we end up
        // with properties that are of different versions in the same property or entity type.
        let name = match parts {
            None => self.lookup[url].title().to_snek_case(),
            Some(UrlParts { id, .. }) => id.to_snek_case(),
        };

        PropertyName(name)
    }

    /// Same as [`Self::property_name`], but is aware of name clashes and will resolve those by
    /// using a suffix for each
    pub(crate) fn property_names<'b>(
        &self,
        urls: impl IntoIterator<Item = &'b VersionedUrl>,
    ) -> HashMap<&'b VersionedUrl, PropertyName> {
        let mut names: HashMap<String, Vec<_>> = HashMap::new();

        for url in urls {
            let name = self.property_name(url);

            let urls = names.entry(name.0.clone()).or_default();

            urls.push((url, name));
        }

        let mut output = HashMap::new();

        for mut names in names.into_values() {
            if names.len() > 1 {
                // we have a naming clash, suffix with their index
                for (index, (_, name)) in names.iter_mut().enumerate() {
                    name.0 = format!("{}_{index}", name.0);
                }
            }

            for (url, name) in names {
                output.insert(url, name);
            }
        }

        output
    }

    pub(crate) const fn analyzer(&self) -> &'a DependencyAnalyzer<'a> {
        self.analyzer
    }

    pub(crate) fn facts(&self) -> &'a Facts {
        self.facts
    }
}

// TODO: tests
