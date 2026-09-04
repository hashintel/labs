use std::path::Path;

use error_stack::{Report, ResultExt as _};
use serde::Deserialize;
use serde_json::Value;

use crate::config::DuckdbLimits;
use crate::error::SourceError;
use crate::secret::Secret;
use crate::store::{lit, qi};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SslMode {
    Disable,
    Require,
    #[default]
    VerifyFull,
}

impl SslMode {
    fn libpq(self) -> &'static str {
        match self {
            Self::Disable => "disable",
            Self::Require => "require",
            Self::VerifyFull => "verify-full",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostgresSource {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub database: String,
    pub schema: String,
    pub table: String,
    #[serde(default)]
    pub ssl_mode: SslMode,
    #[serde(deserialize_with = "deserialize_primary_key")]
    pub primary_key: Vec<String>,
    pub credentials: SecretReference,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretReference {
    pub secret_entity_uuid: uuid::Uuid,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum PrimaryKey {
    One(String),
    Many(Vec<String>),
}

const fn default_port() -> u16 {
    5432
}

fn deserialize_primary_key<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let columns = match PrimaryKey::deserialize(deserializer)? {
        PrimaryKey::One(column) => vec![column],
        PrimaryKey::Many(columns) => columns,
    };
    if columns.is_empty() || columns.iter().any(String::is_empty) {
        return Err(serde::de::Error::custom(
            "primaryKey must contain one or more non-empty column names",
        ));
    }
    Ok(columns)
}

impl PostgresSource {
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let source: Self =
            serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
        for (field, value) in [
            ("host", source.host.as_str()),
            ("database", source.database.as_str()),
            ("schema", source.schema.as_str()),
            ("table", source.table.as_str()),
        ] {
            if value.is_empty() {
                return Err(format!("{field} must be a non-empty string"));
            }
        }
        if source.port == 0 {
            return Err("port must be an integer from 1 through 65535".to_owned());
        }
        Ok(source)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredCredentials {
    username: String,
    password: String,
}

struct Credentials {
    username: String,
    password: Secret<String>,
}

pub async fn capture(
    source: &PostgresSource,
    stored_credentials: &Secret<Vec<u8>>,
    output: &Path,
    limits: DuckdbLimits,
) -> Result<(), Report<SourceError>> {
    let credentials = parse_credentials(stored_credentials)?;
    let source = source.clone();
    let output = output.to_owned();
    tokio::task::spawn_blocking(move || capture_blocking(&source, &credentials, &output, &limits))
        .await
        .change_context(SourceError)
        .attach_printable("PostgreSQL capture task failed to join")??;
    Ok(())
}

fn parse_credentials(value: &Secret<Vec<u8>>) -> Result<Credentials, Report<SourceError>> {
    let stored: StoredCredentials = serde_json::from_slice(value.expose())
        .change_context(SourceError)
        .attach_printable(
            "PostgreSQL User Secret must contain string fields named username and password",
        )?;
    if stored.username.trim().is_empty() || stored.password.is_empty() {
        return Err(Report::new(SourceError).attach_printable(
            "The username and password fields in the PostgreSQL User Secret must be non-empty strings",
        ));
    }
    Ok(Credentials {
        username: stored.username,
        password: Secret::new(stored.password),
    })
}

fn capture_blocking(
    source: &PostgresSource,
    credentials: &Credentials,
    output: &Path,
    limits: &DuckdbLimits,
) -> Result<(), Report<SourceError>> {
    let connection = duckdb::Connection::open_in_memory()
        .change_context(SourceError)
        .attach_printable("DuckDB failed to open the PostgreSQL capture database")?;
    apply_limits(&connection, limits)?;
    connection
        .execute_batch("SET allow_community_extensions = false; INSTALL postgres; LOAD postgres")
        .change_context(SourceError)
        .attach_printable("DuckDB failed to load the PostgreSQL extension")?;

    let connection_string = connection_string(source, credentials);
    connection
        .execute_batch(&format!(
            "ATTACH {} AS {} (TYPE postgres, READ_ONLY)",
            lit(&connection_string),
            qi("_capture")
        ))
        // DuckDB includes the connection string in attachment errors.
        .map_err(|_error| {
            Report::new(SourceError)
                .attach_printable("DuckDB failed to attach the PostgreSQL source")
        })?;
    connection
        .execute_batch(&capture_sql(source, output))
        .change_context(SourceError)
        .attach_printable("DuckDB failed to copy the PostgreSQL source to Parquet")?;
    Ok(())
}

fn apply_limits(
    connection: &duckdb::Connection,
    limits: &DuckdbLimits,
) -> Result<(), Report<SourceError>> {
    let mut settings = vec![format!("SET threads = {}", limits.threads)];
    if let Some(memory_limit) = &limits.memory_limit {
        settings.push(format!("SET memory_limit = {}", lit(memory_limit)));
    }
    if let Some(temp_limit) = &limits.max_temp_directory_size {
        settings.push(format!("SET max_temp_directory_size = {}", lit(temp_limit)));
    }
    for setting in settings {
        connection
            .execute_batch(&setting)
            .change_context(SourceError)?;
    }
    Ok(())
}

fn connection_string(source: &PostgresSource, credentials: &Credentials) -> String {
    let port = source.port.to_string();
    [
        ("host", source.host.as_str()),
        ("port", port.as_str()),
        ("dbname", source.database.as_str()),
        ("user", credentials.username.as_str()),
        ("password", credentials.password.expose().as_str()),
        ("sslmode", source.ssl_mode.libpq()),
    ]
    .into_iter()
    .map(|(name, value)| format!("{name}={}", libpq_value(value)))
    .collect::<Vec<_>>()
    .join(" ")
}

fn libpq_value(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn capture_sql(source: &PostgresSource, output: &Path) -> String {
    format!(
        "COPY (SELECT * FROM {}.{}.{}) TO {} (FORMAT PARQUET)",
        qi("_capture"),
        qi(&source.schema),
        qi(&source.table),
        lit(&output.display().to_string())
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn source() -> PostgresSource {
        PostgresSource {
            host: "127.0.0.1".to_owned(),
            port: 15439,
            database: "dev".to_owned(),
            schema: "integration demo".to_owned(),
            table: "orders".to_owned(),
            ssl_mode: SslMode::Require,
            primary_key: vec!["order_key".to_owned()],
            credentials: SecretReference {
                secret_entity_uuid: uuid::Uuid::nil(),
            },
        }
    }

    fn credentials() -> Credentials {
        Credentials {
            username: "reader".to_owned(),
            password: Secret::new("pa'ss\\word".to_owned()),
        }
    }

    #[test]
    fn quotes_libpq_credentials() {
        let value = connection_string(&source(), &credentials());

        assert_eq!(
            value,
            "host='127.0.0.1' port='15439' dbname='dev' user='reader' password='pa\\'ss\\\\word' sslmode='require'"
        );
    }

    #[test]
    fn capture_statement_uses_quoted_identifiers() {
        assert_eq!(
            capture_sql(&source(), &PathBuf::from("/tmp/capture.parquet")),
            "COPY (SELECT * FROM \"_capture\".\"integration demo\".\"orders\") TO '/tmp/capture.parquet' (FORMAT PARQUET)"
        );
    }
}
