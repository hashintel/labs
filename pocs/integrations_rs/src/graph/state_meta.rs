//! Per-sink state metadata in `_state/meta` (same table as the TS/Elixir
//! engines): hash algorithm version, config hash, and the target fingerprint.
//! hash_version applies to newly written hashes; old-hash rows reclassify as
//! updates once and converge.

use error_stack::Report;
use serde_json::Value;

use crate::error::StoreError;
use crate::store::{lit, qi, Store};

const TABLE: &str = "_state/meta";
pub const HASH_VERSION: i64 = 2;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Meta {
    pub hash_version: Option<i64>,
    pub config_hash: Option<String>,
    pub graph_identity: Option<String>,
    pub web_id: Option<String>,
    pub namespace: Option<String>,
}

pub async fn ensure_table(store: &Store) -> Result<(), Report<StoreError>> {
    store
        .exec(&format!(
            "CREATE TABLE IF NOT EXISTS {} (scope VARCHAR, connector_id VARCHAR, sink_id VARCHAR, hash_version INTEGER, config_hash VARCHAR, graph_identity VARCHAR, web_id VARCHAR, namespace VARCHAR, updated_at TIMESTAMP)",
            qi(TABLE)
        ))
        .await
}

pub async fn read(
    store: &Store,
    scope: &str,
    connector_id: &str,
    sink_id: &str,
) -> Result<Option<Meta>, Report<StoreError>> {
    ensure_table(store).await?;

    let result = store
        .query(&format!(
            "SELECT hash_version, config_hash, graph_identity, web_id, namespace FROM {} WHERE scope = {} AND connector_id = {} AND sink_id = {}",
            qi(TABLE),
            lit(scope),
            lit(connector_id),
            lit(sink_id)
        ))
        .await?;

    Ok(result.rows.first().map(|row| Meta {
        hash_version: row.first().and_then(Value::as_i64),
        config_hash: row.get(1).and_then(Value::as_str).map(str::to_owned),
        graph_identity: row.get(2).and_then(Value::as_str).map(str::to_owned),
        web_id: row.get(3).and_then(Value::as_str).map(str::to_owned),
        namespace: row.get(4).and_then(Value::as_str).map(str::to_owned),
    }))
}

pub async fn write(
    store: &Store,
    scope: &str,
    connector_id: &str,
    sink_id: &str,
    meta: &Meta,
) -> Result<(), Report<StoreError>> {
    ensure_table(store).await?;

    store
        .exec(&format!(
            "DELETE FROM {} WHERE scope = {} AND connector_id = {} AND sink_id = {}",
            qi(TABLE),
            lit(scope),
            lit(connector_id),
            lit(sink_id)
        ))
        .await?;

    let opt = |value: &Option<String>| value.clone().map(Value::from).unwrap_or(Value::Null);
    store
        .exec_params(
            &format!(
                "INSERT INTO {} VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())",
                qi(TABLE)
            ),
            vec![
                Value::from(scope),
                Value::from(connector_id),
                Value::from(sink_id),
                meta.hash_version.map(Value::from).unwrap_or(Value::Null),
                opt(&meta.config_hash),
                opt(&meta.graph_identity),
                opt(&meta.web_id),
                opt(&meta.namespace),
            ],
        )
        .await
}
