use std::{
    fmt::{Display, Formatter},
    path::Path,
    time::SystemTime,
};

use askama::Template;
use error_stack::{Report, Result, ResultExt};
use url::Url;

use crate::{Config, Dependency, Error};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Index {
    name: String,
    #[serde(rename = "vers")]
    version: String,
}

/// Implementation of the registry index
///
/// This is an implementation of the protocol discussed in <https://doc.rust-lang.org/cargo/reference/registry-index.html>
fn fetch_version(name: &str, timings: bool) -> Result<String, Error> {
    let now = SystemTime::now();

    let url = Url::parse("https://index.crates.io/").expect("failed to parse url");

    let url = match name.len() {
        1 => url.join(&format!("1/{name}")).expect("failed to join url"),
        2 => url.join(&format!("2/{name}")).expect("failed to join url"),
        3 => {
            // longer than 3 chars, so we are always able to get the first char
            let (index, _) = name
                .char_indices()
                .nth(1)
                .expect("failed to get char index");

            #[allow(clippy::string_slice)] // False-Positive, from trusted source
            url.join(&format!("3/{}/{name}", &name[..index]))
                .expect("failed to join url")
        }
        _ => {
            // longer than 4 chars, so we are always able to get the first two chars (and four
            // chars)
            let (prefix1, _) = name
                .char_indices()
                .nth(2)
                .expect("failed to get char index");
            let prefix2 = name
                .char_indices()
                .nth(4)
                .map_or_else(|| name.len() + 1, |(index, _)| index);

            #[allow(clippy::string_slice)] // False-Positive, from trusted source
            url.join(&format!(
                "{}/{}/{}",
                &name[..prefix1],
                &name[prefix1..prefix2],
                name
            ))
            .expect("failed to join url")
        }
    };

    let response = reqwest::blocking::get(url).change_context(Error::Http)?;

    let text = response.text().change_context(Error::Http)?;

    let latest = text
        .lines()
        .last()
        .ok_or_else(|| Report::new(Error::Http))?;

    let index: Index = serde_json::from_str(latest).change_context(Error::Serde)?;

    if timings {
        let elapsed = now.elapsed().expect("failed to get elapsed time");
        tracing::info!(?elapsed, "fetched version from index of crate `{}`", name);
    }

    Ok(index.version)
}

#[derive(Debug, Clone)]
enum TurbineVersion {
    Path(String),
    Workspace,
    Git {
        url: String,
        rev: Option<String>,
        branch: Option<String>,
        tag: Option<String>,
    },
}

// Reason: it is only fallible in a case which we don't support just yet.
#[allow(clippy::fallible_impl_from)]
impl From<Dependency> for TurbineVersion {
    fn from(value: Dependency) -> Self {
        match value {
            Dependency::Path(path) => Self::Path(path.to_string_lossy().into_owned()),
            Dependency::Workspace => Self::Workspace,
            Dependency::Git {
                url,
                rev,
                branch,
                tag,
            } => Self::Git {
                url,
                rev,
                branch,
                tag,
            },
            Dependency::CratesIo => {
                panic!("turbine crate not yet published to crates.io");
            }
        }
    }
}

impl Display for TurbineVersion {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Path(path) => f.write_fmt(format_args!(r##"{{ path = "{path}" }}"##)),
            Self::Workspace => f.write_str("{ workspace = true }"),
            Self::Git {
                url,
                rev,
                branch,
                tag,
            } => {
                let mut spec = format!(r##"{{ git = "{url}" "##);

                if let Some(rev) = rev {
                    spec.push_str(&format!(r##", rev = "{rev}" "##));
                }

                if let Some(branch) = branch {
                    spec.push_str(&format!(r##", branch = "{branch}" "##));
                }

                if let Some(tag) = tag {
                    spec.push_str(&format!(r##", tag = "{tag}" "##));
                }

                spec.push_str(" }");

                f.write_str(&spec)
            }
        }
    }
}

#[derive(Debug)]
struct Versions {
    error_stack: String,
    hashbrown: String,
    serde: String,
    serde_json: String,
    turbine: TurbineVersion,
}

impl Versions {
    fn latest(config: &Config) -> Result<Self, Error> {
        let error_stack = fetch_version("error-stack", config.timings)?;
        let hashbrown = fetch_version("hashbrown", config.timings)?;
        let serde = fetch_version("serde", config.timings)?;
        let serde_json = fetch_version("serde_json", config.timings)?;
        let turbine = TurbineVersion::from(config.turbine.clone());

        Ok(Self {
            error_stack,
            hashbrown,
            serde,
            serde_json,
            turbine,
        })
    }
}

#[derive(Debug, Template)]
#[template(path = "Cargo.toml.askama", escape = "none")]
struct CargoToml {
    name: String,
    versions: Versions,
}

impl CargoToml {
    fn render_from_config(config: &mut Config) -> Result<String, Error> {
        config.turbine.make_relative_to(&config.root);

        let versions = Versions::latest(config)?;

        let name = config
            .name
            .clone()
            .or_else(|| {
                config
                    .root
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
            })
            .ok_or_else(|| Report::new(Error::Name))?;

        let template = Self { name, versions };

        let cargo = template.render().change_context(Error::Template)?;

        Ok(cargo)
    }
}

fn is_empty(path: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(path) {
        return entries.count() == 0;
    }

    false
}

pub(crate) fn init(config: &mut Config) -> Result<(), Error> {
    config.normalize();

    // if config is not force, and the folder already exists (and is not empty), we abort
    if !config.force && config.root.exists() && !is_empty(&config.root) {
        return Err(Report::new(Error::Exists));
    }

    // if the folder already exists, and we are in force mode, we delete it first, this way we
    // ensure that we work with a blank slate
    if config.force && config.root.exists() {
        std::fs::remove_dir_all(&config.root).change_context(Error::Io)?;
    }

    // to create a new library we need:
    // A) a Cargo.toml file
    // B) a src/lib.rs file

    // create folder if it doesn't exist
    if !config.root.exists() {
        std::fs::create_dir_all(&config.root).change_context(Error::Io)?;
    }

    // create Cargo.toml file
    let cargo = CargoToml::render_from_config(config)?;
    let cargo_path = config.root.join("Cargo.toml");
    std::fs::write(cargo_path, cargo).change_context(Error::Io)?;

    // create src/lib.rs file
    // the contents of this file are going to be generated by turbine, therefore we simply leave it
    // empty. This ensures that we do not leave a broken library behind if the process fails.
    // create src folder (if it doesn't exist)
    std::fs::create_dir_all(config.root.join("src")).change_context(Error::Io)?;

    let lib_path = config.root.join("src").join("lib.rs");
    std::fs::write(lib_path, "").change_context(Error::Io)?;

    Ok(())
}
