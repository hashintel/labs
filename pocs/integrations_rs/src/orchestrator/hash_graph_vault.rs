use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::StatusCode;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::Env;
use crate::secret::Secret;

use super::managed::{ManagedError, SecretRef, SecretStore};

const USER_SECRET_ENTITY_TYPE: &str = "https://hash.ai/@h/types/entity-type/user-secret/v/1";
const EXPIRED_AT_PROPERTY: &str = "https://hash.ai/@h/types/property-type/expired-at/";
const VAULT_PATH_PROPERTY: &str = "https://hash.ai/@h/types/property-type/vault-path/";

pub struct HashGraphVaultSecretStore {
    graph_url: String,
    graph_actor_id: String,
    graph_service_secret: Secret<String>,
    vault_url: String,
    vault_mount_path: String,
    vault_token: Secret<String>,
    http: reqwest::Client,
}

impl HashGraphVaultSecretStore {
    pub fn from_env(env: &Env) -> Result<Option<Self>, String> {
        let configured = [
            "HASH_VAULT_HOST",
            "HASH_VAULT_PORT",
            "HASH_VAULT_MOUNT_PATH",
        ]
        .iter()
        .any(|name| present(env, name).is_some())
            || present(env, "HASH_VAULT_TOKEN").is_some()
            || present(env, "HASH_VAULT_ROOT_TOKEN").is_some();

        if !configured {
            return Ok(None);
        }

        let graph_url = required(env, "HASH_GRAPH_URL")?;
        let graph_actor_id = required(env, "HASH_ACTOR_ID")?;
        let graph_service_secret = required(env, "HASH_GRAPH_SERVICE_SECRET")?;
        let vault_host = required(env, "HASH_VAULT_HOST")?;
        let vault_port = required(env, "HASH_VAULT_PORT")?;
        let vault_mount_path = normalize_mount_path(&required(env, "HASH_VAULT_MOUNT_PATH")?)?;
        let vault_token = present(env, "HASH_VAULT_TOKEN")
            .or_else(|| present(env, "HASH_VAULT_ROOT_TOKEN"))
            .ok_or_else(|| {
                "HASH_VAULT_TOKEN or HASH_VAULT_ROOT_TOKEN must be set when Vault is configured"
                    .to_owned()
            })?
            .to_owned();

        let vault_url = format!("{}:{}", vault_host.trim_end_matches('/'), vault_port.trim());

        Ok(Some(Self::new(
            graph_url,
            graph_actor_id,
            graph_service_secret,
            vault_url,
            vault_mount_path,
            vault_token,
        )))
    }

    pub fn new(
        graph_url: String,
        graph_actor_id: String,
        graph_service_secret: String,
        vault_url: String,
        vault_mount_path: String,
        vault_token: String,
    ) -> Self {
        Self {
            graph_url: graph_url.trim_end_matches('/').to_owned(),
            graph_actor_id,
            graph_service_secret: Secret::new(graph_service_secret),
            vault_url: vault_url.trim_end_matches('/').to_owned(),
            vault_mount_path,
            vault_token: Secret::new(vault_token),
            http: reqwest::Client::new(),
        }
    }

    pub fn for_actor(mut self, actor_id: &str) -> Self {
        self.graph_actor_id = actor_id.to_owned();
        self
    }

    async fn vault_path(&self, web_id: &str, entity_uuid: Uuid) -> Result<String, ManagedError> {
        let response = self
            .http
            .post(format!("{}/entities/query", self.graph_url))
            .header(
                "x-authenticated-user-actor-id",
                self.graph_actor_id.as_str(),
            )
            .header(
                "authorization",
                format!("HASH-Service {}", self.graph_service_secret.expose()),
            )
            .json(&json!({
                "filter": {
                    "all": [
                        { "equal": [{ "path": ["webId"] }, { "parameter": web_id }] },
                        { "equal": [{ "path": ["uuid"] }, { "parameter": entity_uuid }] },
                        { "equal": [{ "path": ["archived"] }, { "parameter": false }] },
                        { "equal": [{ "path": ["type", "versionedUrl"] }, { "parameter": USER_SECRET_ENTITY_TYPE }] }
                    ]
                },
                "temporalAxes": {
                    "pinned": { "axis": "transactionTime", "timestamp": null },
                    "variable": {
                        "axis": "decisionTime",
                        "interval": { "start": null, "end": null }
                    }
                },
                "includeDrafts": false,
                "includePermissions": false,
                "limit": 2
            }))
            .send()
            .await
            .map_err(secret_request_failed)?;

        if response.status() != StatusCode::OK {
            tracing::warn!(status = %response.status(), "HASH Graph secret lookup failed");
            return Err(ManagedError::SecretUnavailable);
        }

        let body: Value = response.json().await.map_err(secret_request_failed)?;
        let entities = body
            .get("entities")
            .and_then(Value::as_array)
            .ok_or(ManagedError::SecretUnavailable)?;
        let [entity] = entities.as_slice() else {
            return Err(ManagedError::SecretUnavailable);
        };

        validate_entity(entity, &format!("{web_id}~{entity_uuid}"))?;
        let properties = entity
            .get("properties")
            .and_then(Value::as_object)
            .ok_or(ManagedError::SecretUnavailable)?;
        let expires_at = properties
            .get(EXPIRED_AT_PROPERTY)
            .and_then(Value::as_str)
            .ok_or(ManagedError::SecretUnavailable)?;
        let expires_at = DateTime::parse_from_rfc3339(expires_at)
            .map_err(|_error| ManagedError::SecretUnavailable)?;
        if expires_at <= Utc::now() {
            return Err(ManagedError::SecretUnavailable);
        }

        let path = properties
            .get(VAULT_PATH_PROPERTY)
            .and_then(Value::as_str)
            .ok_or(ManagedError::SecretUnavailable)?;
        validate_vault_path(path, web_id)?;
        Ok(path.to_owned())
    }

    async fn read_vault(&self, path: &str) -> Result<Secret<Vec<u8>>, ManagedError> {
        let response = self
            .http
            .get(format!(
                "{}/v1/{}/data/{path}",
                self.vault_url, self.vault_mount_path
            ))
            .header("x-vault-token", self.vault_token.expose())
            .send()
            .await
            .map_err(secret_request_failed)?;

        if response.status() != StatusCode::OK {
            tracing::warn!(status = %response.status(), "Vault secret read failed");
            return Err(ManagedError::SecretUnavailable);
        }

        let body: Value = response.json().await.map_err(secret_request_failed)?;
        let data = body
            .pointer("/data/data")
            .ok_or(ManagedError::SecretUnavailable)?;
        let bytes = match data {
            Value::Object(values) if values.len() == 1 => {
                match values.get("value").and_then(Value::as_str) {
                    Some(value) => value.as_bytes().to_owned(),
                    None => serde_json::to_vec(data)
                        .map_err(|_error| ManagedError::SecretUnavailable)?,
                }
            }
            _ => serde_json::to_vec(data).map_err(|_error| ManagedError::SecretUnavailable)?,
        };
        if bytes.is_empty() {
            return Err(ManagedError::SecretUnavailable);
        }
        Ok(Secret::new(bytes))
    }
}

#[async_trait]
impl SecretStore for HashGraphVaultSecretStore {
    async fn read(
        &self,
        web_id: &str,
        reference: &SecretRef,
    ) -> Result<Secret<Vec<u8>>, ManagedError> {
        let path = self.vault_path(web_id, reference.entity_uuid).await?;
        self.read_vault(&path).await
    }

    async fn write_once(
        &self,
        _web_id: &str,
        _reference: &SecretRef,
        _value: Secret<Vec<u8>>,
    ) -> Result<(), ManagedError> {
        Err(ManagedError::Invalid(
            "HASH Graph Vault secret store is read-only".to_owned(),
        ))
    }
}

fn validate_entity(entity: &Value, expected_id: &str) -> Result<(), ManagedError> {
    let metadata = entity
        .get("metadata")
        .ok_or(ManagedError::SecretUnavailable)?;
    let entity_id = metadata
        .pointer("/recordId/entityId")
        .and_then(Value::as_str);
    let archived = metadata.get("archived").and_then(Value::as_bool);
    let has_type = metadata
        .get("entityTypeIds")
        .and_then(Value::as_array)
        .is_some_and(|ids| {
            ids.iter()
                .any(|id| id.as_str() == Some(USER_SECRET_ENTITY_TYPE))
        });
    if entity_id != Some(expected_id) || archived != Some(false) || !has_type {
        return Err(ManagedError::SecretUnavailable);
    }
    Ok(())
}

fn validate_vault_path(path: &str, web_id: &str) -> Result<(), ManagedError> {
    let mut segments = path.split('/');
    if segments.next() != Some("users") || segments.next() != Some(web_id) {
        return Err(ManagedError::SecretUnavailable);
    }
    let mut remaining = 0;
    for segment in segments {
        remaining += 1;
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || !segment
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
        {
            return Err(ManagedError::SecretUnavailable);
        }
    }
    if remaining < 2 {
        return Err(ManagedError::SecretUnavailable);
    }
    Ok(())
}

fn normalize_mount_path(path: &str) -> Result<String, String> {
    let path = path.trim().trim_matches('/');
    let valid = !path.is_empty()
        && path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
        && path
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        && path
            .as_bytes()
            .last()
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_');
    if !valid {
        return Err(
            "HASH_VAULT_MOUNT_PATH must start and end with an alphanumeric character or underscore and contain only alphanumeric characters, underscores, hyphens, or periods"
                .to_owned(),
        );
    }
    Ok(path.to_owned())
}

fn present<'a>(env: &'a Env, name: &str) -> Option<&'a str> {
    env.get(name)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn required(env: &Env, name: &str) -> Result<String, String> {
    present(env, name)
        .map(str::to_owned)
        .ok_or_else(|| format!("{name} must be set when Vault is configured"))
}

fn secret_request_failed(error: reqwest::Error) -> ManagedError {
    tracing::warn!(error = %error, "Graph or Vault User Secret request failed");
    ManagedError::SecretUnavailable
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;
    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    const WEB_ID: &str = "11111111-1111-4111-8111-111111111111";
    const SECRET_UUID: &str = "22222222-2222-4222-8222-222222222222";
    const ENTITY_ID: &str =
        "11111111-1111-4111-8111-111111111111~22222222-2222-4222-8222-222222222222";
    const VAULT_PATH: &str =
        "users/11111111-1111-4111-8111-111111111111/salesforce/client-credentials";

    fn store(server: &MockServer) -> HashGraphVaultSecretStore {
        HashGraphVaultSecretStore::new(
            server.uri(),
            "33333333-3333-4333-8333-333333333333".to_owned(),
            "graph-service-secret".to_owned(),
            server.uri(),
            "secret".to_owned(),
            "vault-token".to_owned(),
        )
    }

    fn reference() -> SecretRef {
        SecretRef {
            entity_uuid: Uuid::parse_str(SECRET_UUID).expect("fixture secret UUID should be valid"),
        }
    }

    fn query_body() -> Value {
        json!({
            "filter": {
                "all": [
                    { "equal": [{ "path": ["webId"] }, { "parameter": WEB_ID }] },
                    { "equal": [{ "path": ["uuid"] }, { "parameter": SECRET_UUID }] },
                    { "equal": [{ "path": ["archived"] }, { "parameter": false }] },
                    { "equal": [{ "path": ["type", "versionedUrl"] }, { "parameter": USER_SECRET_ENTITY_TYPE }] }
                ]
            },
            "temporalAxes": {
                "pinned": { "axis": "transactionTime", "timestamp": null },
                "variable": {
                    "axis": "decisionTime",
                    "interval": { "start": null, "end": null }
                }
            },
            "includeDrafts": false,
            "includePermissions": false,
            "limit": 2
        })
    }

    fn graph_response(expires_at: &str, vault_path: &str) -> Value {
        json!({
            "entities": [{
                "properties": {
                    EXPIRED_AT_PROPERTY: expires_at,
                    VAULT_PATH_PROPERTY: vault_path
                },
                "metadata": {
                    "recordId": {
                        "entityId": ENTITY_ID,
                        "editionId": "44444444-4444-4444-8444-444444444444"
                    },
                    "entityTypeIds": [USER_SECRET_ENTITY_TYPE],
                    "archived": false
                }
            }]
        })
    }

    #[tokio::test]
    async fn reads_vault_after_graph_authorizes_the_run_owner() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/entities/query"))
            .and(header(
                "x-authenticated-user-actor-id",
                "55555555-5555-4555-8555-555555555555",
            ))
            .and(header("authorization", "HASH-Service graph-service-secret"))
            .and(body_json(query_body()))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(graph_response("2999-01-01T00:00:00Z", VAULT_PATH)),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(format!("/v1/secret/data/{VAULT_PATH}")))
            .and(header("x-vault-token", "vault-token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": {
                    "data": { "value": "webhook-secret" },
                    "metadata": { "version": 1 }
                }
            })))
            .expect(1)
            .mount(&server)
            .await;

        let value = store(&server)
            .for_actor("55555555-5555-4555-8555-555555555555")
            .read(WEB_ID, &reference())
            .await
            .expect("Graph-authorized User Secret should be readable from Vault");

        assert_eq!(
            value.expose(),
            b"webhook-secret",
            "authorized User Secret should contain the Vault value"
        );
    }

    #[tokio::test]
    async fn rejects_an_expired_graph_secret_before_reading_vault() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/entities/query"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(graph_response("2000-01-01T00:00:00Z", VAULT_PATH)),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let result = store(&server).read(WEB_ID, &reference()).await;

        assert!(
            matches!(result, Err(ManagedError::SecretUnavailable)),
            "expired User Secret should be unavailable"
        );
    }

    #[tokio::test]
    async fn rejects_a_vault_path_owned_by_another_web() {
        let server = MockServer::start().await;
        let other_path = "users/99999999-9999-4999-8999-999999999999/salesforce/client-credentials";
        Mock::given(method("POST"))
            .and(path("/entities/query"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(graph_response("2999-01-01T00:00:00Z", other_path)),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let result = store(&server).read(WEB_ID, &reference()).await;

        assert!(
            matches!(result, Err(ManagedError::SecretUnavailable)),
            "User Secret with a Vault path in another web should be unavailable"
        );
    }

    #[tokio::test]
    async fn rejects_a_graph_entity_owned_by_another_web() {
        let server = MockServer::start().await;
        let mut response = graph_response("2999-01-01T00:00:00Z", VAULT_PATH);
        response["entities"][0]["metadata"]["recordId"]["entityId"] =
            json!("99999999-9999-4999-8999-999999999999~22222222-2222-4222-8222-222222222222");
        Mock::given(method("POST"))
            .and(path("/entities/query"))
            .and(body_json(query_body()))
            .respond_with(ResponseTemplate::new(200).set_body_json(response))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let result = store(&server).read(WEB_ID, &reference()).await;

        assert!(
            matches!(result, Err(ManagedError::SecretUnavailable)),
            "User Secret entity from another web should be unavailable"
        );
    }

    #[tokio::test]
    async fn rejects_direct_vault_writes() {
        let server = MockServer::start().await;

        let result = store(&server)
            .write_once(WEB_ID, &reference(), Secret::new(b"value".to_vec()))
            .await;

        assert!(
            matches!(result, Err(ManagedError::Invalid(_))),
            "HASH Graph Vault secret store should reject writes"
        );
    }

    #[test]
    fn accepts_a_vault_token_from_the_environment() {
        let env = Env::from_map(HashMap::from([
            ("HASH_GRAPH_URL".to_owned(), "http://graph:4000".to_owned()),
            ("HASH_ACTOR_ID".to_owned(), "actor".to_owned()),
            (
                "HASH_GRAPH_SERVICE_SECRET".to_owned(),
                "graph-secret".to_owned(),
            ),
            ("HASH_VAULT_HOST".to_owned(), "http://vault".to_owned()),
            ("HASH_VAULT_PORT".to_owned(), "8200".to_owned()),
            ("HASH_VAULT_MOUNT_PATH".to_owned(), "secret".to_owned()),
            ("HASH_VAULT_TOKEN".to_owned(), "token".to_owned()),
        ]));

        let configured = HashGraphVaultSecretStore::from_env(&env)
            .expect("complete Vault settings should be accepted");

        assert!(
            configured.is_some(),
            "complete Vault settings should configure the secret store"
        );
    }

    #[test]
    fn rejects_partial_vault_configuration() {
        let env = Env::from_map(HashMap::from([(
            "HASH_VAULT_HOST".to_owned(),
            "http://vault".to_owned(),
        )]));

        let result = HashGraphVaultSecretStore::from_env(&env);

        assert!(
            matches!(result, Err(message) if message.contains("HASH_GRAPH_URL")),
            "partial Vault settings should report the first missing setting"
        );
    }
}
