#![feature(result_option_inspect)]
#![feature(iter_array_chunks)]

mod analysis;
mod data;
mod entity;
mod error;
mod graph;
mod name;
mod property;
mod shared;
mod utilities;

use std::{
    cmp::Ordering,
    collections::BTreeMap,
    hash::{Hash, Hasher},
    path::PathBuf,
    time::SystemTime,
};

use error_stack::{Result, ResultExt};
use quote::__private::TokenStream;
use thiserror::Error;
use type_system::{repr, url::VersionedUrl, DataType, EntityType, PropertyType};

pub use crate::name::{Directory, File, Flavor, ModuleFlavor, Override, OverrideAction, Path};
use crate::{
    analysis::{unify::UnificationAnalyzer, DependencyAnalyzer},
    name::NameResolver,
};

// what we need to do:
// 1) Configuration:
//      - URL to get entity types
//      - style of module (mod.rs vs. module.rs)
//
// 2) fetch all types
// 3) categorize into:
//      - data types (if built-in refer to those, otherwise error out)
//      - property types
//      - entity types
// 4) create modules for each type, they are designated by if hash: url base (backwards) / org /
//    entity|property / id.rs if blockprotocol: bp / org / entity|property / id.rs
// 5) if there are multiple versions transform into a module, put the current one in mod, there
//    others in v1.rs etc and suffix name w/ V1
// 6) for property types inner types should be named Inner (if multiple Inner1, Inner2, etc.)
// 7) when referring to those just use crate::<URL>::...
// 8) generate the code required: 2 variants: Owned and Ref (ref is lightweight) with proper
//    accessors, id converted to snake_case, if duplicate error out, sort properties, then increment
//    same for import problems, just alias with the name we want
//
// internally we also need to keep track which entity is in which file
// todo: generate code, that selects Ref out of all verticies of a specific type, should not be
//  generated, but generic code instead
//
// result: BTreeMap<File, String>
// where File is the module name as a Path, so it can be created by e.g. CLI
//
// Problematic: multi layered objects/properties (validating them correctly ~> needs intermediate
// types (with names (?)))
//
// If multiple versions, the latest version is named Example, while the others are called ExampleV1
//
// TODO: entities can also have link data associated with them! (important on self?)
//
// TODO: tests?

#[derive(Debug, Clone)]
pub struct OutputPath {
    pub path: PathBuf,
    pub typed: Path,
}

impl Hash for OutputPath {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.path.hash(state);
    }
}

impl PartialOrd<Self> for OutputPath {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for OutputPath {
    fn cmp(&self, other: &Self) -> Ordering {
        self.path.cmp(&other.path)
    }
}

impl PartialEq<Self> for OutputPath {
    fn eq(&self, other: &Self) -> bool {
        self.path.eq(&other.path)
    }
}

impl Eq for OutputPath {}

#[derive(Debug, Clone, Error)]
pub enum Error {
    #[error("unable to parse type from repr")]
    Parse,
    #[error("error while trying to analyze dependencies")]
    DependencyAnalysis,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(untagged)]
pub enum AnyTypeRepr {
    Data(repr::DataType),
    Property(repr::PropertyType),
    Entity(repr::EntityType),
}

#[derive(Debug, Clone)]
pub enum AnyType {
    Data(DataType),
    Property(PropertyType),
    Entity(EntityType),
}

impl AnyType {
    const fn id(&self) -> &VersionedUrl {
        match self {
            Self::Data(ty) => ty.id(),
            Self::Property(ty) => ty.id(),
            Self::Entity(ty) => ty.id(),
        }
    }

    fn title(&self) -> &str {
        match self {
            Self::Data(ty) => ty.title(),
            Self::Property(ty) => ty.title(),
            Self::Entity(ty) => ty.title(),
        }
    }
}

pub struct Config {
    pub module: Option<ModuleFlavor>,
    pub overrides: Vec<Override>,
    pub flavors: Vec<Flavor>,
    pub timings: bool,
}

pub struct Output {
    pub files: BTreeMap<OutputPath, TokenStream>,
    pub utilities: TokenStream,
}

/// ## Errors
///
/// if `AnyTypeRepr` is malformed, or an error occurred while generating code
pub fn process(values: Vec<AnyTypeRepr>, config: Config) -> Result<Output, Error> {
    let now = SystemTime::now();
    let values: Result<Vec<_>, _> = values
        .into_iter()
        .map(|any| match any {
            AnyTypeRepr::Data(data) => DataType::try_from(data)
                .map(AnyType::Data)
                .change_context(Error::Parse),
            AnyTypeRepr::Property(property) => PropertyType::try_from(property)
                .map(AnyType::Property)
                .change_context(Error::Parse),
            AnyTypeRepr::Entity(entity) => EntityType::try_from(entity)
                .map(AnyType::Entity)
                .change_context(Error::Parse),
        })
        .collect();
    if config.timings {
        let elapsed = now.elapsed();
        tracing::info!(?elapsed, "converting types to internal representation");
    }

    let now = SystemTime::now();
    let analyzer = UnificationAnalyzer::new(values?);
    let (lookup, facts) = analyzer.run().change_context(Error::DependencyAnalysis)?;
    if config.timings {
        let elapsed = now.elapsed();
        tracing::info!(?elapsed, "unifying types");
    }

    let analyzer =
        DependencyAnalyzer::new(lookup.values()).change_context(Error::DependencyAnalysis)?;

    let mut names = NameResolver::new(&lookup, &analyzer, &facts);
    for value in config.overrides {
        names.with_override(value);
    }
    for flavor in config.flavors {
        names.with_flavor(flavor);
    }
    if let Some(module) = config.module {
        names.with_module_flavor(module);
    }

    let mut files = BTreeMap::new();
    let mut entities = vec![];

    let now = SystemTime::now();
    for value in lookup.values() {
        let location = names.location(value.id());
        let file = OutputPath {
            path: location.path.clone().into(),
            typed: location.path,
        };

        let now = SystemTime::now();
        let contents = match value {
            AnyType::Data(data) => data::generate(data, &names),
            AnyType::Property(property) => Some(property::generate(property, &names)),
            AnyType::Entity(entity) => {
                entities.push(entity);
                Some(entity::generate(entity, &names))
            }
        };
        if config.timings {
            let elapsed = now.elapsed();
            tracing::info!(
                ?elapsed,
                "generating code for {} ({})",
                value.title(),
                match value {
                    AnyType::Data(_) => "data",
                    AnyType::Property(_) => "property",
                    AnyType::Entity(_) => "entity",
                }
            );
        }

        if let Some(contents) = contents {
            files.insert(file, contents);
        }
    }
    if config.timings {
        let elapsed = now.elapsed();
        tracing::info!(?elapsed, "generating code");
    }

    Ok(Output {
        files,
        utilities: utilities::generate(entities, &names),
    })
}
