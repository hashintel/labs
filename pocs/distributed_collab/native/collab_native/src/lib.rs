use json_patch::{patch, Patch};
use rustler::{resource::ResourceTypeProvider, Encoder, Env, Error, ResourceArc, Term};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    ops::{Deref, DerefMut},
    str::FromStr,
    sync::{RwLock, RwLockWriteGuard},
};

mod atoms {
    rustler::atoms! {
        json_deserialize_error,
        malformed_patch

    }
}

#[derive(Serialize, Deserialize)]
struct EntityUpdate {
    entity_id: String,
    patch: Patch,
}

struct JsonString(RwLock<serde_json::Value>);

impl JsonString {
    fn new() -> Self {
        Self(RwLock::new(json!({})))
    }

    fn stringify(&self) -> String {
        serde_json::Value::to_string(&self.0.read().expect("no lock poisioning"))
    }

    fn as_mut(&self) -> RwLockWriteGuard<serde_json::Value> {
        self.0.write().expect("no lock poisioning")
    }
}

#[rustler::nif]
fn new_entity() -> ResourceArc<JsonString> {
    ResourceArc::new(JsonString::new())
}
#[rustler::nif]
fn entity_as_string(json_string: ResourceArc<JsonString>) -> String {
    JsonString::stringify(&json_string)
}

#[rustler::nif]
fn apply_patch(json_string: ResourceArc<JsonString>, json_patch_string: &str) -> Result<(), Error> {
    // println!("{}", json_patch_string);
    let entity_patch: EntityUpdate = serde_json::from_str(json_patch_string).map_err(|_e| {
        // println!("{}", _e);
        Error::Term(Box::new(atoms::json_deserialize_error()))
    })?;

    let mut json_string = json_string.as_mut();

    patch(&mut json_string, &entity_patch.patch)
        .map(|_| ())
        .map_err(|_| Error::Term(Box::new(atoms::malformed_patch())))
}

fn load(env: Env, _: Term) -> bool {
    rustler::resource!(JsonString, env);
    true
}

rustler::init!(
    "Elixir.CollabNative",
    [new_entity, entity_as_string, apply_patch],
    load = load
);
