//! Deterministic UUID v5 scheme shared with the TS/Elixir engines: sha1 over
//! a fixed 16-byte namespace and `"{ns}::{entityType}::{entityId}"`, with RFC
//! 4122 version/variant bits. Entity ids render through JS `String()`
//! semantics (1.0 -> "1"); this byte sequence is the basis of convergence
//! and must never drift (pinned by golden vectors).

use serde_json::Value;
use sha1::{Digest, Sha1};

use crate::value::js_string;

const NAMESPACE: [u8; 16] = [
    0xd6, 0xe2, 0xc7, 0xa1, 0xf8, 0x4b, 0x4e, 0x3a, 0x9c, 0x0d, 0x5b, 0x7f, 0x1e, 0x3a, 0x2d, 0x4c,
];

pub fn deterministic_uuid(ns: &str, entity_type: &str, entity_id: &Value) -> String {
    let mut hasher = Sha1::new();
    hasher.update(NAMESPACE);
    hasher.update(format!("{ns}::{entity_type}::{}", js_string(entity_id)));
    let hash = hex::encode(hasher.finalize());

    let variant_nibble = u8::from_str_radix(&hash[16..17], 16).expect("hex digit") & 0x3 | 0x8;

    format!(
        "{}-{}-5{}-{:x}{}-{}",
        &hash[0..8],
        &hash[8..12],
        &hash[13..16],
        variant_nibble,
        &hash[17..20],
        &hash[20..32],
    )
}

pub fn composite_entity_id(web_id: &str, entity_uuid: &str) -> String {
    format!("{web_id}~{entity_uuid}")
}
