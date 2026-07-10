//! Converts `redis::Value` (RESP2/RESP3) replies into `serde_json::Value`.

use serde_json::{json, Map, Value as JsonValue};

/// Maximum bytes kept from a single bulk string before the value is truncated in the
/// response handed back to the frontend. Bounds process memory and IPC frame size when a
/// key holds a very large blob.
pub const MAX_VALUE_PREVIEW_BYTES: usize = 64 * 1024;

/// redis_value_to_json recursively converts a Redis reply into a JSON value.
///
/// Binary-unsafe bulk strings are lossily decoded as UTF-8 (matching the convention used
/// throughout this codebase for terminal/file output) rather than base64-encoded, so no
/// extra dependency is required; the `isUtf8` flag on truncated/binary payloads tells the
/// caller whether the text is an exact or lossy representation.
pub fn redis_value_to_json(value: redis::Value) -> JsonValue {
    match value {
        redis::Value::Nil => JsonValue::Null,
        redis::Value::Int(n) => JsonValue::from(n),
        redis::Value::Okay => JsonValue::from("OK"),
        redis::Value::SimpleString(s) => JsonValue::from(s),
        redis::Value::BulkString(bytes) => bulk_string_to_json(bytes),
        redis::Value::Array(items) | redis::Value::Set(items) => {
            JsonValue::Array(items.into_iter().map(redis_value_to_json).collect())
        }
        redis::Value::Map(pairs) => {
            let mut obj = Map::with_capacity(pairs.len());
            for (key, val) in pairs {
                obj.insert(redis_map_key_to_string(key), redis_value_to_json(val));
            }
            JsonValue::Object(obj)
        }
        redis::Value::Double(d) => {
            serde_json::Number::from_f64(d).map(JsonValue::Number).unwrap_or(JsonValue::Null)
        }
        redis::Value::Boolean(b) => JsonValue::Bool(b),
        redis::Value::VerbatimString { text, .. } => JsonValue::from(text),
        redis::Value::BigNumber(digits) => JsonValue::from(digits.to_string()),
        redis::Value::Push { data, .. } => {
            JsonValue::Array(data.into_iter().map(redis_value_to_json).collect())
        }
        redis::Value::ServerError(err) => json!({ "error": err.to_string() }),
        // `redis::Value` is `#[non_exhaustive]`: new variants may be added by future crate
        // versions. Fall back to a best-effort debug string rather than failing to compile.
        other => JsonValue::from(format!("{other:?}")),
    }
}

fn redis_map_key_to_string(key: redis::Value) -> String {
    match key {
        redis::Value::BulkString(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        redis::Value::SimpleString(s) => s,
        redis::Value::Int(n) => n.to_string(),
        other => format!("{other:?}"),
    }
}

fn bulk_string_to_json(bytes: Vec<u8>) -> JsonValue {
    let byte_length = bytes.len();
    let truncated = byte_length > MAX_VALUE_PREVIEW_BYTES;
    let slice: &[u8] = if truncated { &bytes[..MAX_VALUE_PREVIEW_BYTES] } else { &bytes };
    let is_utf8 = std::str::from_utf8(slice).is_ok();
    let text = String::from_utf8_lossy(slice).into_owned();
    if truncated || !is_utf8 {
        json!({
            "text": text,
            "isUtf8": is_utf8,
            "truncated": truncated,
            "byteLength": byte_length,
        })
    } else {
        JsonValue::from(text)
    }
}
