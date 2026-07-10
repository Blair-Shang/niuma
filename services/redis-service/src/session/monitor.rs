//! `INFO` / `SLOWLOG` / `MONITOR` parsing helpers.
//!
//! All numeric parsing here is defensive: unexpected or missing fields fall back to `0`
//! instead of panicking, since the exact field set returned by `INFO` varies across Redis
//! versions, forks (Valkey) and deployment topologies (standalone/cluster/sentinel).

use std::collections::HashMap;

use serde_json::{json, Value};

/// Parses the `# Section\r\nkey:value\r\n...` text returned by `INFO` into a flat map.
fn parse_info_text(text: &str) -> HashMap<String, String> {
    let mut kv = HashMap::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once(':') {
            kv.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    kv
}

fn get_i64(kv: &HashMap<String, String>, key: &str) -> i64 {
    kv.get(key).and_then(|s| s.parse::<i64>().ok()).unwrap_or(0)
}

fn get_f64(kv: &HashMap<String, String>, key: &str) -> f64 {
    kv.get(key).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0)
}

fn get_str<'a>(kv: &'a HashMap<String, String>, key: &str) -> &'a str {
    kv.get(key).map(String::as_str).unwrap_or("")
}

/// Computes `hits / (hits + misses)` without risking a division by zero.
fn hit_rate(hits: i64, misses: i64) -> f64 {
    let total = hits.saturating_add(misses);
    if total <= 0 {
        0.0
    } else {
        hits as f64 / total as f64
    }
}

/// Parses raw `INFO` output into a structured metrics object for the monitor UI.
pub fn parse_info_metrics(text: &str) -> Value {
    let kv = parse_info_text(text);

    let keyspace_hits = get_i64(&kv, "keyspace_hits");
    let keyspace_misses = get_i64(&kv, "keyspace_misses");
    let used_memory = get_i64(&kv, "used_memory");
    let maxmemory = get_i64(&kv, "maxmemory");

    json!({
        "redisVersion": get_str(&kv, "redis_version"),
        "role": get_str(&kv, "role"),
        "uptimeSeconds": get_i64(&kv, "uptime_in_seconds"),
        "connectedClients": get_i64(&kv, "connected_clients"),
        "blockedClients": get_i64(&kv, "blocked_clients"),
        "connectedSlaves": get_i64(&kv, "connected_slaves"),
        "usedMemory": used_memory,
        "usedMemoryHuman": get_str(&kv, "used_memory_human"),
        "usedMemoryRss": get_i64(&kv, "used_memory_rss"),
        "usedMemoryPeak": get_i64(&kv, "used_memory_peak"),
        "maxMemory": maxmemory,
        "maxMemoryPolicy": get_str(&kv, "maxmemory_policy"),
        "memFragmentationRatio": get_f64(&kv, "mem_fragmentation_ratio"),
        "totalConnectionsReceived": get_i64(&kv, "total_connections_received"),
        "totalCommandsProcessed": get_i64(&kv, "total_commands_processed"),
        "instantaneousOpsPerSec": get_i64(&kv, "instantaneous_ops_per_sec"),
        "totalNetInputBytes": get_i64(&kv, "total_net_input_bytes"),
        "totalNetOutputBytes": get_i64(&kv, "total_net_output_bytes"),
        "rejectedConnections": get_i64(&kv, "rejected_connections"),
        "expiredKeys": get_i64(&kv, "expired_keys"),
        "evictedKeys": get_i64(&kv, "evicted_keys"),
        "keyspaceHits": keyspace_hits,
        "keyspaceMisses": keyspace_misses,
        "keyspaceHitRate": hit_rate(keyspace_hits, keyspace_misses),
        "latestForkUsec": get_i64(&kv, "latest_fork_usec"),
        "masterReplOffset": get_i64(&kv, "master_repl_offset"),
        "usedCpuSys": get_f64(&kv, "used_cpu_sys"),
        "usedCpuUser": get_f64(&kv, "used_cpu_user"),
        "keyspace": parse_keyspace_sections(&kv),
    })
}

/// Parses `dbN:keys=..` lines into `(db, keys)` pairs for tree metadata.
pub fn keyspace_db_keys_from_info(text: &str) -> Vec<(i64, i64)> {
    let kv = parse_info_text(text);
    let mut dbs: Vec<(i64, i64)> = Vec::new();
    for (key, value) in kv {
        let Some(index) = key.strip_prefix("db").and_then(|s| s.parse::<i64>().ok()) else {
            continue;
        };
        let fields = parse_semicolon_kv(&value);
        let keys = fields
            .get("keys")
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        dbs.push((index, keys));
    }
    dbs.sort_by_key(|(db, _)| *db);
    dbs
}

/// Reads `CONFIG GET databases` reply; falls back to 16 when unavailable.
pub async fn parse_config_databases(
    backend: &mut crate::session::connect::RedisBackend,
) -> i64 {
    const DEFAULT_DATABASE_COUNT: i64 = 16;
    let reply = match backend.exec_raw("CONFIG", &[b"GET".to_vec(), b"databases".to_vec()]).await {
        Ok(value) => value,
        Err(_) => return DEFAULT_DATABASE_COUNT,
    };
    let redis::Value::Array(items) = reply else {
        return DEFAULT_DATABASE_COUNT;
    };
    if items.len() < 2 {
        return DEFAULT_DATABASE_COUNT;
    }
    match &items[1] {
        redis::Value::Int(n) => (*n).max(1),
        redis::Value::BulkString(bytes) => std::str::from_utf8(bytes)
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(DEFAULT_DATABASE_COUNT)
            .max(1),
        redis::Value::SimpleString(s) => s.parse::<i64>().unwrap_or(DEFAULT_DATABASE_COUNT).max(1),
        _ => DEFAULT_DATABASE_COUNT,
    }
}

/// Parses `dbN:keys=..,expires=..,avg_ttl=..` lines into a per-database breakdown.
fn parse_keyspace_sections(kv: &HashMap<String, String>) -> Vec<Value> {
    let mut dbs: Vec<Value> = Vec::new();
    for (key, value) in kv {
        let Some(index) = key.strip_prefix("db").and_then(|s| s.parse::<i64>().ok()) else {
            continue;
        };
        let fields = parse_semicolon_kv(value);
        dbs.push(json!({
            "db": index,
            "keys": fields.get("keys").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0),
            "expires": fields.get("expires").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0),
            "avgTtlMs": fields.get("avg_ttl").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0),
        }));
    }
    dbs.sort_by_key(|v| v["db"].as_i64().unwrap_or(0));
    dbs
}

/// Parses `keys=1,expires=0,avg_ttl=0` style fragments.
fn parse_semicolon_kv(fragment: &str) -> HashMap<String, String> {
    fragment
        .split(',')
        .filter_map(|part| part.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect()
}

/// Parses one `SLOWLOG GET` entry: `[id, timestamp, duration_us, [args...], client_addr?, client_name?]`.
pub fn parse_slowlog_entry(entry: &redis::Value) -> Option<Value> {
    let redis::Value::Array(fields) = entry else {
        return None;
    };
    if fields.len() < 4 {
        return None;
    }
    let id = value_as_i64(&fields[0]);
    let timestamp = value_as_i64(&fields[1]);
    let duration_us = value_as_i64(&fields[2]).max(0);
    let args = match &fields[3] {
        redis::Value::Array(items) => items.iter().map(value_as_string).collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    let client_addr = fields.get(4).map(value_as_string).unwrap_or_default();
    let client_name = fields.get(5).map(value_as_string).unwrap_or_default();
    Some(json!({
        "id": id,
        "timestamp": timestamp,
        "durationUs": duration_us,
        "command": args,
        "clientAddr": client_addr,
        "clientName": client_name,
    }))
}

fn value_as_i64(value: &redis::Value) -> i64 {
    match value {
        redis::Value::Int(n) => *n,
        redis::Value::BulkString(bytes) => std::str::from_utf8(bytes)
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0),
        redis::Value::SimpleString(s) => s.parse::<i64>().unwrap_or(0),
        _ => 0,
    }
}

fn value_as_string(value: &redis::Value) -> String {
    match value {
        redis::Value::BulkString(bytes) => String::from_utf8_lossy(bytes).into_owned(),
        redis::Value::SimpleString(s) => s.clone(),
        redis::Value::Int(n) => n.to_string(),
        _ => String::new(),
    }
}

/// Maximum arguments kept from a single `MONITOR` line; extremely long commands (e.g. a
/// bulk `MSET` with thousands of pairs) are truncated so one noisy command cannot balloon
/// event size.
const MAX_MONITOR_ARGS: usize = 64;

/// Parses one raw `MONITOR` line, e.g.:
/// `1620000000.123456 [0 127.0.0.1:52341] "SET" "key" "value"`
pub fn parse_monitor_line(line: &str) -> Option<Value> {
    let line = line.trim();
    let (timestamp_str, rest) = line.split_once(' ')?;
    let timestamp: f64 = timestamp_str.parse().ok()?;

    let rest = rest.trim_start();
    let (bracketed, remainder) = if let Some(stripped) = rest.strip_prefix('[') {
        let end = stripped.find(']')?;
        (&stripped[..end], stripped[end + 1..].trim_start())
    } else {
        return None;
    };
    let mut bracket_parts = bracketed.splitn(2, ' ');
    let db: i64 = bracket_parts.next()?.parse().unwrap_or(0);
    let client = bracket_parts.next().unwrap_or("").to_string();

    let mut command = tokenize_quoted(remainder);
    let truncated = command.len() > MAX_MONITOR_ARGS;
    command.truncate(MAX_MONITOR_ARGS);

    Some(json!({
        "timestamp": timestamp,
        "db": db,
        "client": client,
        "command": command,
        "truncated": truncated,
    }))
}

/// Splits a sequence of double-quoted, backslash-escaped tokens: `"SET" "key" "va\"l"`.
fn tokenize_quoted(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '"' {
            continue;
        }
        let mut token = String::new();
        let mut escaped = false;
        for next in chars.by_ref() {
            if escaped {
                token.push(next);
                escaped = false;
                continue;
            }
            match next {
                '\\' => escaped = true,
                '"' => break,
                other => token.push(other),
            }
        }
        tokens.push(token);
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_monitor_line() {
        let parsed = parse_monitor_line(r#"1620000000.123456 [0 127.0.0.1:52341] "SET" "key" "value""#)
            .expect("line should parse");
        assert_eq!(parsed["db"], 0);
        assert_eq!(parsed["client"], "127.0.0.1:52341");
        assert_eq!(parsed["command"], json!(["SET", "key", "value"]));
    }

    #[test]
    fn parses_escaped_quotes_in_monitor_line() {
        let parsed = parse_monitor_line(r#"1620000000.0 [0 lua] "SET" "k" "va\"lue""#).expect("should parse");
        assert_eq!(parsed["command"], json!(["SET", "k", "va\"lue"]));
    }

    #[test]
    fn rejects_malformed_line() {
        assert!(parse_monitor_line("not a monitor line").is_none());
    }

    #[test]
    fn hit_rate_avoids_division_by_zero() {
        assert_eq!(hit_rate(0, 0), 0.0);
        assert_eq!(hit_rate(1, 1), 0.5);
    }
}
