use integrations_rs::config::Env;
use integrations_rs::orchestrator::hash_graph_vault::HashGraphVaultSecretStore;
use integrations_rs::orchestrator::managed::{SecretRef, SecretStore as _};
use sha2::{Digest as _, Sha256};
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires an explicitly approved HASH User Secret entity and Vault value"]
async fn real_hash_graph_vault_secret_read() {
    assert_eq!(
        std::env::var("INTEGRATIONS_VAULT_CONTRACT").as_deref(),
        Ok("1"),
        "INTEGRATIONS_VAULT_CONTRACT should confirm access to the secret"
    );
    let web_id = std::env::var("INTEGRATIONS_VAULT_CONTRACT_WEB_ID")
        .expect("INTEGRATIONS_VAULT_CONTRACT_WEB_ID should identify the owning web");
    let entity_uuid = std::env::var("INTEGRATIONS_VAULT_CONTRACT_ENTITY_UUID")
        .expect("INTEGRATIONS_VAULT_CONTRACT_ENTITY_UUID should identify the User Secret entity");
    let entity_uuid = Uuid::parse_str(&entity_uuid)
        .expect("INTEGRATIONS_VAULT_CONTRACT_ENTITY_UUID should be a UUID");
    let expected_digest = std::env::var("INTEGRATIONS_VAULT_CONTRACT_EXPECTED_SHA256")
        .expect("INTEGRATIONS_VAULT_CONTRACT_EXPECTED_SHA256 should contain the expected digest");
    let store = HashGraphVaultSecretStore::from_env(&Env::process())
        .expect("Vault settings should be valid")
        .expect("Vault settings should be present");

    let value = store
        .read(&web_id, &SecretRef { entity_uuid })
        .await
        .expect("HASH User Secret should be readable");

    assert_eq!(
        hex::encode(Sha256::digest(value.expose())),
        expected_digest,
        "Vault secret digest should match the approved value"
    );
}
