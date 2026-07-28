#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::panic,
    clippy::too_many_lines
)]

//! Cross-language byte-compatibility contract, pinned by golden vectors
//! dumped from the TS engine: deterministic UUIDs (incl. numeric `String()`
//! cases), `_key` SQL, canonical hash SQL strings, link op ids, the
//! pending-links payload wire shape, and value-level fallback hashes computed
//! by THIS build's `DuckDB` over a replayed fixture table (catching column
//! order and rendering drift that SQL-string equality alone cannot).
//! Config hashes are also portable: adoption must not mass-redeliver unchanged
//! rows merely because another engine wrote the state first.

use serde_json::Value;

use integrations_rs::blob::BlobNamespace;
use integrations_rs::build::{Accessor, ProvenanceFields, SinkConfig};
use integrations_rs::graph::hash;
use integrations_rs::graph::link_pipeline::{decode_link_op, link_op_id};
use integrations_rs::graph::uuid::{composite_entity_id, deterministic_uuid};
use integrations_rs::orchestrator::ids::{
    CanonicalIntegrationId, InvalidCanonicalIntegrationId, TenantNamespace,
    MAX_CANONICAL_INTEGRATION_ID_BYTES,
};
use integrations_rs::orchestrator::routing::{
    route, shard_path, ControlPaths, ROUTING_VERSION, SHARD_COUNT,
};
use integrations_rs::snapshot;
use integrations_rs::store::{Store, StoreOptions};
use integrations_rs::value::js_string;

fn golden(name: &str) -> Value {
    let path = format!("{}/tests/golden/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).expect("golden file")).expect("golden json")
}

#[test]
fn routing_matches_the_internal_v1_contract() {
    let vectors = golden("routing.json");
    assert_eq!(
        u64::from(ROUTING_VERSION),
        vectors["routingVersion"].as_u64().expect("routing version")
    );
    assert_eq!(
        u64::from(SHARD_COUNT),
        vectors["shardCount"].as_u64().expect("shard count")
    );
    assert_eq!(
        MAX_CANONICAL_INTEGRATION_ID_BYTES as u64,
        vectors["maxCanonicalIntegrationIdBytes"]
            .as_u64()
            .expect("maximum ID bytes")
    );

    for case in vectors["cases"].as_array().expect("routing cases") {
        let id = CanonicalIntegrationId::parse(case["id"].as_str().expect("integration id"))
            .expect("valid integration id");
        let routed = route(&id);
        assert_eq!(
            format!("{:016x}", routed.routing_value),
            case["routingValueHex"].as_str().expect("routing value"),
            "case: {case}"
        );
        assert_eq!(
            u64::from(routed.shard.get()),
            case["shard"].as_u64().expect("shard"),
            "case: {case}"
        );
        assert_eq!(
            shard_path(routed.shard),
            case["shardPath"].as_str().expect("shard path"),
            "case: {case}"
        );
        assert_eq!(
            routed.integration_path.to_hex(),
            case["sha256"].as_str().expect("digest"),
            "case: {case}"
        );
    }

    for value in vectors["invalidWhitespace"]
        .as_array()
        .expect("invalid whitespace cases")
    {
        assert_eq!(
            CanonicalIntegrationId::parse(value.as_str().expect("invalid ID")),
            Err(InvalidCanonicalIntegrationId::ContainsWhitespace)
        );
    }
    assert!(CanonicalIntegrationId::parse("x".repeat(MAX_CANONICAL_INTEGRATION_ID_BYTES)).is_ok());
    assert!(matches!(
        CanonicalIntegrationId::parse("x".repeat(MAX_CANONICAL_INTEGRATION_ID_BYTES + 1)),
        Err(InvalidCanonicalIntegrationId::TooLong { .. })
    ));

    let path_case = &vectors["tenantPathCase"];
    let tenant = TenantNamespace::parse(
        path_case["tenantNamespace"]
            .as_str()
            .expect("tenant namespace"),
    )
    .expect("valid tenant namespace");
    let id = CanonicalIntegrationId::parse(
        path_case["canonicalIntegrationId"]
            .as_str()
            .expect("canonical integration ID"),
    )
    .expect("valid canonical integration ID");
    let integration = route(&id).integration_path;
    let control = ControlPaths::new(tenant.clone());
    assert_eq!(
        control.root(),
        path_case["controlRoot"].as_str().expect("control root")
    );
    assert_eq!(
        control.admission(&integration),
        path_case["admission"].as_str().expect("admission path")
    );
    assert_eq!(
        BlobNamespace::v1(&tenant, &integration).root(),
        path_case["artifactRoot"].as_str().expect("artifact root")
    );

    for value in vectors["invalidTenantNamespaces"]
        .as_array()
        .expect("invalid tenant namespaces")
    {
        assert!(TenantNamespace::parse(value.as_str().expect("invalid tenant namespace")).is_err());
    }
}

#[test]
fn uuids_match_the_ts_engine() {
    for case in golden("uuids.json").as_array().expect("array") {
        let uuid = deterministic_uuid(
            case["ns"].as_str().expect("ns"),
            case["entityType"].as_str().expect("type"),
            &case["entityId"],
        );
        assert_eq!(uuid, case["uuid"].as_str().expect("uuid"), "case: {case}");

        let composite = case["composite"].as_str().expect("composite");
        let web_id = composite.split('~').next().expect("web id");
        assert_eq!(composite_entity_id(web_id, &uuid), composite);
    }
}

#[test]
fn key_sql_matches_the_ts_engine() {
    for case in golden("key-sql.json")["cases"].as_array().expect("cases") {
        let primary_key: Vec<String> = case["primaryKey"]
            .as_array()
            .expect("pk")
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        assert_eq!(
            snapshot::key_expr(&primary_key),
            case["keySql"].as_str().expect("keySql"),
            "pk: {primary_key:?}"
        );
    }
}

fn sink_config_from_golden(config: &Value) -> SinkConfig {
    let accessor = |value: &Value| -> Accessor {
        if let Some(column) = value.as_str() {
            // TS function accessors dump as "fn:..." strings: non-column,
            // forcing the whole-row fallback exactly like coerce/measure.
            if let Some(body) = column.strip_prefix("fn:") {
                return Accessor::Coerce {
                    name: "fn".to_owned(),
                    column: body.to_owned(),
                };
            }
            Accessor::Column(column.to_owned())
        } else if let (Some(column), Some(name)) = (
            value.get("column").and_then(Value::as_str),
            value.get("coerce").and_then(Value::as_str),
        ) {
            Accessor::Coerce {
                name: name.to_owned(),
                column: column.to_owned(),
            }
        } else {
            Accessor::Measure {
                amount: value["amount"].as_str().unwrap_or("").to_owned(),
                unit: value["unit"].as_str().unwrap_or("").to_owned(),
                map_name: value["measure"].as_str().unwrap_or("").to_owned(),
            }
        }
    };

    let properties: Vec<(String, Accessor)> = config["properties"]
        .as_object()
        .map(|properties| {
            properties
                .iter()
                .map(|(url, value)| (url.clone(), accessor(value)))
                .collect()
        })
        .unwrap_or_default();

    let field = |name: &str| {
        config
            .pointer(&format!("/provenanceFields/{name}"))
            .filter(|value| !value.is_null())
            .map(&accessor)
    };

    SinkConfig {
        entity_type: config["entityType"].as_str().unwrap_or("").to_owned(),
        entity_id: config["entityId"].as_str().unwrap_or("").to_owned(),
        web_id: config["webId"].as_str().unwrap_or("").to_owned(),
        id_namespace: config
            .get("idNamespace")
            .and_then(Value::as_str)
            .map(str::to_owned),
        property_fields: vec![],
        provenance: None,
        properties,
        provenance_fields: ProvenanceFields {
            authors: field("authors"),
            first_published: field("firstPublished"),
            last_updated: field("lastUpdated"),
        },
    }
}

#[test]
fn canonical_hash_sql_matches_the_ts_engine() {
    for case in golden("hash-sql.json").as_array().expect("array") {
        let config = sink_config_from_golden(&case["config"]);
        let column_types: std::collections::HashMap<String, String> = case["columnTypes"]
            .as_object()
            .expect("columnTypes")
            .iter()
            .map(|(column, sql_type)| (column.clone(), sql_type.as_str().unwrap_or("").to_owned()))
            .collect();

        let expr = hash::canonical_hash_expr(&config, &column_types, |_| {});
        match case["canonicalSql"].as_str() {
            Some(expected) => assert_eq!(expr.as_deref(), Some(expected), "case: {}", case["note"]),
            None => assert!(
                expr.is_none(),
                "expected fallback for case: {}",
                case["note"]
            ),
        }
    }
}

#[test]
fn sink_config_hashes_match_the_ts_engine() {
    let vectors = golden("config-hash.json");
    let connector_id = vectors["connectorId"].as_str().expect("connector id");
    for case in vectors["configs"].as_array().expect("configs") {
        let config = sink_config_from_golden(&case["config"]);
        assert_eq!(
            hash::sink_config_hash(&config, connector_id),
            case["sha256"].as_str().expect("sha256"),
            "case: {}",
            case["config"]
        );
    }
}

#[test]
fn link_op_ids_match_the_ts_engine() {
    for case in golden("op-ids.json").as_array().expect("array") {
        if case["kind"].as_str() != Some("upsert") {
            continue;
        }
        let input = &case["input"];
        let op_id = link_op_id(
            input["ns"].as_str().expect("ns"),
            input["webId"].as_str().expect("web"),
            input["linkType"].as_str().expect("link"),
            &js_string(&input["sourceId"]),
            &js_string(&input["targetId"]),
        );
        assert_eq!(op_id, case["opId"].as_str().expect("opId"), "case: {case}");
    }
}

#[test]
fn pending_payload_wire_shape_decodes() {
    let payload = golden("pending-payload.json");
    let op = decode_link_op(payload["payload"].as_str().expect("payload"));
    assert!(op.op_id.starts_with("upsert::"));
    assert!(!op.source_entity_id.is_empty());
    assert!(!op.target_id.is_empty());
}

#[tokio::test]
async fn fallback_and_canonical_hashes_match_value_for_value() {
    let vectors = golden("fallback-hash.json");
    let store = Store::open(StoreOptions::default()).expect("store");

    store
        .exec(vectors["ddl"].as_str().expect("ddl"))
        .await
        .expect("ddl");
    for insert in vectors["inserts"].as_array().expect("inserts") {
        store
            .exec(insert.as_str().expect("insert"))
            .await
            .expect("insert");
    }

    // The canonical expression is built from the fixture's sink config (the
    // same one the TS dumper used) and must match the golden string byte for
    // byte before its hashes are compared value for value.
    let config = SinkConfig {
        entity_type: "https://x/@t/types/entity-type/material/v/1".to_owned(),
        entity_id: "MATNR".to_owned(),
        web_id: "w".to_owned(),
        id_namespace: None,
        properties: vec![
            (
                "https://x/@t/types/property-type/name/v/1".to_owned(),
                Accessor::Column("MAKTX".to_owned()),
            ),
            (
                "https://x/@t/types/property-type/weight/v/1".to_owned(),
                Accessor::Column("BRGEW".to_owned()),
            ),
            (
                "https://x/@t/types/property-type/created/v/1".to_owned(),
                Accessor::Column("ERSDA".to_owned()),
            ),
        ],
        property_fields: vec![],
        provenance: None,
        provenance_fields: ProvenanceFields::default(),
    };
    let types: std::collections::HashMap<String, String> = [
        ("MATNR", "VARCHAR"),
        ("MAKTX", "VARCHAR"),
        ("BRGEW", "DOUBLE"),
        ("ERSDA", "DATE"),
    ]
    .into_iter()
    .map(|(column, sql_type)| (column.to_owned(), sql_type.to_owned()))
    .collect();

    let expr = hash::canonical_hash_expr(&config, &types, |_| {}).expect("canonical");
    assert_eq!(Some(expr.as_str()), vectors["canonicalSql"].as_str());

    let canonical_query = format!(
        "SELECT \"MATNR\" AS _entity_id, {expr} AS _content_hash FROM \"fallback_fixture\" ORDER BY _entity_id"
    );

    for (label, query, rows_key) in [
        (
            "fallback",
            vectors["fallbackQuery"]
                .as_str()
                .expect("fallbackQuery")
                .to_owned(),
            "fallbackRows",
        ),
        ("canonical", canonical_query, "canonicalRows"),
    ] {
        let result = store.query(&query).await.expect(label);

        let expected: Vec<(String, String)> = vectors[rows_key]
            .as_array()
            .expect(rows_key)
            .iter()
            .map(|row| {
                (
                    row["_entity_id"].as_str().unwrap_or("").to_owned(),
                    row["_content_hash"].as_str().unwrap_or("").to_owned(),
                )
            })
            .collect();

        let actual: Vec<(String, String)> = result
            .rows
            .iter()
            .map(|row| {
                (
                    row.first().map(js_string).unwrap_or_default(),
                    row.get(1).map(js_string).unwrap_or_default(),
                )
            })
            .collect();

        assert_eq!(actual, expected, "{label} value-level drift");
    }
}
