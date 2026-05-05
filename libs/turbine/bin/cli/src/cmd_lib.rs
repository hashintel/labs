use std::{
    fmt::{Display, Formatter},
    path::PathBuf,
    time::SystemTime,
};

use clap::{Args, ValueEnum, ValueHint};
use codegen::{AnyTypeRepr, Flavor, Override};
use error_stack::{Result, ResultExt};
use figment::{
    providers::{Env, Format, Toml},
    Figment, Profile,
};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use skeletor::Style;
use thiserror::Error;
use tracing_subscriber::EnvFilter;
use url::Url;
use uuid::Uuid;

#[derive(ValueEnum, Copy, Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LibStyle {
    Mod,
    Module,
}

impl Display for LibStyle {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Mod => f.write_str("mod"),
            Self::Module => f.write_str("module"),
        }
    }
}

impl From<LibStyle> for Style {
    fn from(value: LibStyle) -> Self {
        match value {
            LibStyle::Mod => Self::Mod,
            LibStyle::Module => Self::Module,
        }
    }
}

#[derive(Args, Debug)]
#[group(required = false)]
pub(crate) struct LibOrigin {
    #[arg(long)]
    remote: Option<Url>,

    #[arg(long, value_hint = ValueHint::FilePath)]
    local: Option<PathBuf>,
}

#[derive(Args, Debug)]
pub(crate) struct Lib {
    #[arg(value_hint = ValueHint::DirPath)]
    root: Option<PathBuf>,

    #[command(flatten)]
    origin: LibOrigin,

    #[arg(long)]
    style: Option<LibStyle>,

    #[arg(long)]
    name: Option<String>,

    #[arg(long)]
    force: Option<bool>,

    #[arg(long)]
    timings: Option<bool>,

    #[arg(long)]
    actor_id: Option<Uuid>,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(tag = "type", content = "value", rename_all = "kebab-case")]
enum Origin {
    Remote(Url),
    Local(PathBuf),
}

impl TryFrom<LibOrigin> for Origin {
    type Error = ();

    fn try_from(value: LibOrigin) -> core::result::Result<Self, Self::Error> {
        match (value.remote, value.local) {
            (Some(remote), None) => Ok(Self::Remote(remote)),
            (None, Some(local)) => Ok(Self::Local(local)),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Copy, Clone, Error)]
pub(crate) enum Error {
    #[error("unable to join URL with path")]
    Url,
    #[error("unable to send request to remote")]
    Http,
    #[error("io error")]
    Io,
    #[error("unable to deserialize into type")]
    Serde,
    #[error("unable to create new project")]
    Skeletor,
    #[error("unable to load config")]
    Config,
}

fn call_remote(url: &Url, actor_id: Uuid) -> Result<Vec<AnyTypeRepr>, Error> {
    let url = url.join("entity-types/query").change_context(Error::Url)?;

    let query = json!({
      "filter": {
        "all": []
      },
      "graphResolveDepths": {
        "inheritsFrom": {
          "outgoing": 1
        },
        "constrainsValuesOn": {
          "outgoing": 128
        },
        "constrainsPropertiesOn": {
          "outgoing": 128
        },
        "constrainsLinksOn": {
          "outgoing": 1
        },
        "constrainsLinkDestinationsOn": {
          "outgoing": 1
        },
        "isOfType": {
          "outgoing": 0
        },
        "hasLeftEntity": {
          "outgoing": 0,
          "incoming": 0
        },
        "hasRightEntity": {
          "outgoing": 0,
          "incoming": 0
        }
      },
      "temporalAxes": {
        "pinned": {
          "axis": "transactionTime",
          "timestamp": null
        },
        "variable": {
          "axis": "decisionTime",
          "interval": {
            "start": null,
            "end": null
          }
        }
      }
    });

    let client = Client::new();
    let response = client
        .post(url)
        .json(&query)
        .header("X-Authenticated-User-Actor-Id", actor_id.to_string())
        .send()
        .change_context(Error::Http)?;

    // Do the same as:
    // .vertices | .[] | .[] | .inner.schema
    let response: Value = response.json().change_context(Error::Http)?;

    // TODO: propagate error?!
    let types = response["vertices"]
        .as_object()
        .expect("should conform to format")
        .values()
        .flat_map(|value| {
            value
                .as_object()
                .expect("should conform to format")
                .values()
        })
        .map(|value| value["inner"]["schema"].clone())
        .map(|value| serde_json::from_value::<AnyTypeRepr>(value).expect("should be valid type"))
        .collect();

    Ok(types)
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "kebab-case")]
pub enum Dependency {
    Path(PathBuf),
    Workspace,
    Git {
        url: Url,
        rev: Option<String>,
        branch: Option<String>,
        tag: Option<String>,
    },
    CratesIo,
}

impl Default for Dependency {
    fn default() -> Self {
        Self::Git {
            url: Url::parse("https://github.com/blockprotocol/incubator")
                .expect("infallible; static url"),
            rev: None,
            branch: None,
            tag: None,
        }
    }
}

impl From<Dependency> for skeletor::Dependency {
    fn from(value: Dependency) -> Self {
        match value {
            Dependency::Path(path) => Self::Path(path),
            Dependency::Workspace => Self::Workspace,
            Dependency::Git {
                url,
                rev,
                branch,
                tag,
            } => Self::Git {
                url: url.to_string(),
                rev,
                branch,
                tag,
            },
            Dependency::CratesIo => Self::CratesIo,
        }
    }
}

#[derive(serde::Deserialize)]
pub(crate) struct Config {
    root: PathBuf,

    name: Option<String>,
    style: LibStyle,

    origin: Origin,

    overrides: Vec<Override>,
    flavors: Vec<Flavor>,

    #[serde(default)]
    force: bool,
    #[serde(default)]
    timings: bool,

    actor_id: Uuid,

    turbine: Option<Dependency>,
}

pub(crate) fn load_config(lib: Lib) -> core::result::Result<Config, figment::Error> {
    let Lib {
        root,
        origin,
        style,
        name,
        force,
        timings,
        actor_id,
    } = lib;

    let mut figment = Figment::new();

    for name in &["turbine", ".turbine"] {
        figment = figment.merge(Toml::file(format!("{name}.toml")));

        for (abbreviation, full) in &[
            ("prod", "production"),
            ("production", "production"),
            ("dev", "development"),
            ("devel", "development"),
            ("development", "development"),
            ("test", "test"),
        ] {
            let path = format!("{name}.{abbreviation}.toml");
            figment = figment.merge(Toml::file(path).profile(Profile::const_new(full)));
        }
    }

    figment = figment.merge(Env::prefixed("TURBINE_").split("__").global());

    if let Some(root) = root {
        figment = figment.merge(("root".to_owned(), figment::value::Value::serialize(root)?));
    }
    if let Ok(origin) = Origin::try_from(origin) {
        figment = figment.merge((
            "origin".to_owned(),
            figment::value::Value::serialize(origin)?,
        ));
    }
    if let Some(style) = style {
        figment = figment.merge(("style".to_owned(), figment::value::Value::serialize(style)?));
    }
    if let Some(name) = name {
        figment = figment.merge(("name", figment::value::Value::from(name)));
    }
    if let Some(force) = force {
        figment = figment.merge(("force", figment::value::Value::from(force)));
    }
    if let Some(timings) = timings {
        figment = figment.merge(("timings", figment::value::Value::from(timings)));
    }
    if let Some(actor_id) = actor_id {
        figment = figment.merge((
            "actor_id",
            figment::value::Value::from(actor_id.to_string()),
        ))
    }

    if let Some(profile) = Profile::from_env("TURBINE_PROFILE") {
        figment = figment.select(profile);
    }

    figment.extract()
}

pub(crate) fn execute(lib: Lib) -> Result<(), Error> {
    tracing_subscriber::fmt()
        .pretty()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = load_config(lib).change_context(Error::Config)?;

    let now = SystemTime::now();

    let types = match config.origin {
        Origin::Remote(remote) => call_remote(&remote, config.actor_id)?,
        Origin::Local(local) => {
            let types = std::fs::read_to_string(local).change_context(Error::Io)?;

            serde_json::from_str::<Vec<AnyTypeRepr>>(&types).change_context(Error::Serde)?
        }
    };

    if config.timings {
        let elapsed = now.elapsed();
        tracing::info!(?elapsed, "fetching types");
    }

    skeletor::generate(types, skeletor::Config {
        root: config.root,
        style: config.style.into(),
        name: config.name,

        overrides: config.overrides,
        flavors: config.flavors,

        force: config.force,
        timings: config.timings,

        turbine: config.turbine.unwrap_or_default().into(),
    })
    .change_context(Error::Skeletor)
}
