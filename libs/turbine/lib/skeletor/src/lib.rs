#![feature(error_in_core)]

mod cargo;
mod vfs;

use std::{
    collections::VecDeque,
    path::{Component, Path, PathBuf},
    process::Command,
};

use codegen::{AnyTypeRepr, Flavor, ModuleFlavor, Output, Override};
use error_stack::{Result, ResultExt};
use onlyerror::Error;
use pathdiff::diff_paths;

use crate::vfs::VirtualFolder;

// https://github.com/rust-lang/cargo/blob/809b720f05494388cbd54e3a9e7dedd8b3fc13e3/crates/cargo-util/src/paths.rs#L84
pub(crate) fn normalize_path(path: &Path) -> PathBuf {
    let mut components = path.components().peekable();
    let mut ret = if let Some(c @ Component::Prefix(..)) = components.peek().cloned() {
        components.next();
        PathBuf::from(c.as_os_str())
    } else {
        PathBuf::new()
    };

    for component in components {
        match component {
            Component::Prefix(..) => unreachable!(),
            Component::RootDir => {
                ret.push(component.as_os_str());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                ret.pop();
            }
            Component::Normal(c) => {
                ret.push(c);
            }
        }
    }
    ret
}

#[derive(Debug, Clone)]
pub enum Dependency {
    Path(PathBuf),
    Workspace,
    Git {
        url: String,
        rev: Option<String>,
        branch: Option<String>,
        tag: Option<String>,
    },
    CratesIo,
}

impl Dependency {
    pub(crate) fn make_relative_to(&mut self, parent: &Path) {
        if let Self::Path(path) = self {
            let cwd = std::env::current_dir().expect("unable to get current directory");

            let canonical = cwd
                .join(&*path)
                .canonicalize()
                .expect("unable to canonicalize path");

            *path = diff_paths(canonical, parent).expect("unable to diff paths");
        }
    }
}

#[derive(Debug, Copy, Clone)]
pub enum Style {
    Mod,
    Module,
}

impl From<Style> for ModuleFlavor {
    fn from(value: Style) -> Self {
        match value {
            Style::Mod => Self::ModRs,
            Style::Module => Self::ModuleRs,
        }
    }
}

pub struct Config {
    pub root: PathBuf,
    pub style: Style,
    pub name: Option<String>,

    pub overrides: Vec<Override>,
    pub flavors: Vec<Flavor>,

    pub force: bool,
    pub timings: bool,

    pub turbine: Dependency,
}

impl Config {
    fn normalize(&mut self) {
        self.root = normalize_path(&self.root);
    }
}

#[derive(Debug, Copy, Clone, Error)]
pub enum Error {
    #[error("unable to generate code")]
    Codegen,
    #[error("cargo error")]
    Cargo,
    #[error("path error")]
    Path,
    #[error("io error")]
    Io,
    #[error("format error")]
    Format,
    #[error("http error")]
    Http,
    #[error("serde error")]
    Serde,
    #[error("unable to determine crate name")]
    Name,
    #[error("template error")]
    Template,
    #[error("directory is non-empty, and creation was not forced")]
    Exists,
}

/// # Errors
///
/// This function will return an error if:
/// * The codegen process fails
/// * Unable to contact crates.io
/// * Unable to determine the crate name
/// * Unable to create the crate
/// * Unable to format the crate
/// * Turbine library path does not exist
pub fn generate(types: Vec<AnyTypeRepr>, mut config: Config) -> Result<(), Error> {
    cargo::init(&mut config)?;

    let Output {
        files: types,
        utilities,
    } = codegen::process(types, codegen::Config {
        module: Some(config.style.into()),
        overrides: config.overrides,
        flavors: config.flavors,
        timings: config.timings,
    })
    .change_context(Error::Codegen)?;

    let mut folder = VirtualFolder::new("src".to_owned());

    for (path, contents) in types {
        let (directories, file) = path.typed.into_parts();

        folder.insert(VecDeque::from(directories), file, contents);
    }

    folder.normalize_top_level(config.style, &utilities);

    folder
        .output(config.root.join("src"))
        .change_context(Error::Io)?;

    let mut child = Command::new("cargo-fmt")
        .arg("--all")
        .arg("--")
        .arg("--config")
        .arg("normalize_doc_attributes=true")
        .current_dir(&config.root)
        .spawn()
        .change_context(Error::Format)?;

    child.wait().change_context(Error::Format)?;

    Ok(())
}
