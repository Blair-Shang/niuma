//! known_hosts 校验、拒绝密钥缓存，以及「信任并写入」。
//!
//! 校验始终对照**目标主机**（隧道场景也用最终 host:port，不用 127.0.0.1 转发端口）。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use russh_keys::key::PublicKey;

/// CachedHostKey 是最近一次被拒绝的主机密钥，供 hostkey.remember 写入 known_hosts。
#[derive(Clone)]
struct CachedHostKey {
    host: String,
    port: u16,
    key: PublicKey,
    fingerprint: String,
    algorithm: String,
    reason: String,
}

fn cache() -> &'static Mutex<HashMap<String, CachedHostKey>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CachedHostKey>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_key(host: &str, port: u16) -> String {
    format!("{host}:{port}")
}

/// known_hosts_path 返回当前用户的 `~/.ssh/known_hosts`。
pub fn known_hosts_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    PathBuf::from(home).join(".ssh").join("known_hosts")
}

/// format_fingerprint 生成 `SHA256:...` 指纹（与 OpenSSH 展示对齐）。
pub fn format_fingerprint(key: &PublicKey) -> String {
    let fp = key.fingerprint();
    if fp.starts_with("SHA256:") {
        fp
    } else {
        format!("SHA256:{fp}")
    }
}

/// RememberedHostKey 是写入 known_hosts 后回给 Web 的摘要。
pub struct RememberedHostKey {
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    pub algorithm: String,
}

/// verify_or_reject 对照 known_hosts；拒绝时缓存公钥并返回 (accepted, reason)。
pub fn verify_or_reject(host: &str, port: u16, key: &PublicKey) -> (bool, &'static str) {
    let path = known_hosts_path();
    if !path.exists() {
        remember_rejected(host, port, key, "missing_file");
        return (false, "missing_file");
    }
    match russh_keys::check_known_hosts_path(host, port, key, &path) {
        Ok(true) => (true, ""),
        Ok(false) => {
            remember_rejected(host, port, key, "unknown");
            (false, "unknown")
        }
        Err(_) => {
            remember_rejected(host, port, key, "changed");
            (false, "changed")
        }
    }
}

fn remember_rejected(host: &str, port: u16, key: &PublicKey, reason: &str) {
    let entry = CachedHostKey {
        host: host.to_string(),
        port,
        key: key.clone(),
        fingerprint: format_fingerprint(key),
        algorithm: key.name().to_string(),
        reason: reason.to_string(),
    };
    if let Ok(mut map) = cache().lock() {
        map.insert(cache_key(host, port), entry);
    }
}

/// peek_rejected 取出最近一次被拒绝的密钥摘要。
pub fn peek_rejected(host: &str, port: u16) -> Option<(String, String, String)> {
    let map = cache().lock().ok()?;
    let entry = map.get(&cache_key(host, port))?;
    Some((
        entry.fingerprint.clone(),
        entry.algorithm.clone(),
        entry.reason.clone(),
    ))
}

/// write_remembered 把缓存中的拒绝密钥写入 `~/.ssh/known_hosts`。
pub fn write_remembered(host: &str, port: u16) -> Result<RememberedHostKey, String> {
    let entry = {
        let map = cache()
            .lock()
            .map_err(|_| "hostkey cache lock poisoned".to_string())?;
        map.get(&cache_key(host, port)).cloned()
    };
    let Some(entry) = entry else {
        return Err(format!("no rejected host key cached for {host}:{port}"));
    };
    let path = known_hosts_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create .ssh: {e}"))?;
    }
    russh_keys::learn_known_hosts_path(host, port, &entry.key, &path)
        .map_err(|e| format!("write known_hosts: {e}"))?;
    Ok(RememberedHostKey {
        host: entry.host,
        port: entry.port,
        fingerprint: entry.fingerprint,
        algorithm: entry.algorithm,
    })
}
