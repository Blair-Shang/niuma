//! SessionManager 管理活跃 Redis 会话、命令执行、监控流与 key 空间扫描。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use redis::ConnectionInfo;
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex, Notify, OnceCell};
use tracing::{error, warn};

use crate::eventpub::AsyncPublisher;
use crate::suggest::DynCommand;

use super::commanddocs;
use super::connect::RedisBackend;
use super::monitor::{parse_info_metrics, parse_monitor_line, parse_slowlog_entry};
use super::value::redis_value_to_json;
use niuma_netproxy::RelayGuard;
use niuma_tunnel::TunnelGuard;

/// CommandDocsOutcome 缓存一次 `COMMAND DOCS` 探测的结果（成功或失败），确保同一会话生命周期内
/// 只向服务器发起一次探测——旧版本 Redis（< 7.0）不支持该命令会持续返回错误，缓存失败结果可以
/// 避免每次 `command.suggest` 调用都重复往返一次注定失败的请求。
type CommandDocsOutcome = Result<Arc<Vec<DynCommand>>, String>;

/// TTL for cached `INFO`-derived metrics; avoids hammering Redis when the frontend polls
/// faster than this window (mirrors the ssh-service monitor cache strategy).
const METRICS_CACHE_TTL: Duration = Duration::from_secs(2);

/// Hard cap on the `COUNT` argument accepted for `SCAN`, bounding a single round trip
/// regardless of what the caller requests.
const MAX_SCAN_COUNT: i64 = 1000;
const DEFAULT_SCAN_COUNT: i64 = 100;
/// Hard cap on how many keys a single `keyspace.scan` call will describe (TYPE/PTTL/MEMORY
/// USAGE), independent of how many keys `SCAN` itself returned in one batch.
const MAX_DESCRIBE_KEYS: usize = 200;
/// Hard cap on the `MATCH` pattern length accepted from the caller.
const MAX_SCAN_MATCH_LEN: usize = 200;
/// Hard cap / default for `SLOWLOG GET <count>`.
const MAX_SLOWLOG_COUNT: i64 = 500;
const DEFAULT_SLOWLOG_COUNT: i64 = 20;

struct MetricsCacheEntry {
    captured_at: Instant,
    value: Value,
}

/// SessionEntry 保存一条 Redis 会话的后端连接与用于重开监控连接的节点信息。
struct SessionEntry {
    backend: Arc<Mutex<RedisBackend>>,
    _tunnel: Option<TunnelGuard>,
    _proxy_relay: Option<RelayGuard>,
    /// `None` for cluster sessions: `MONITOR` targets a single node and is not offered for
    /// cluster topology in v1.
    node_info: Option<ConnectionInfo>,
    /// Lazily populated, session-scoped cache of the connected server's own `COMMAND DOCS`
    /// output, letting `command.suggest` offer completion that matches this exact server
    /// build/version/modules instead of the bundled static table.
    command_docs: Arc<OnceCell<CommandDocsOutcome>>,
}

struct MonitorEntry {
    session_id: String,
    stop_tx: mpsc::Sender<()>,
}

/// SessionManager 管理活跃 Redis 会话与其派生的监控子任务。
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
    monitors: Arc<Mutex<HashMap<String, MonitorEntry>>>,
    metrics_cache: Arc<Mutex<HashMap<String, MetricsCacheEntry>>>,
    metrics_inflight: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
    events: AsyncPublisher,
}

impl SessionManager {
    pub fn new(events: AsyncPublisher) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            monitors: Arc::new(Mutex::new(HashMap::new())),
            metrics_cache: Arc::new(Mutex::new(HashMap::new())),
            metrics_inflight: Arc::new(Mutex::new(HashMap::new())),
            events,
        }
    }

    pub async fn insert(
        &self,
        session_id: String,
        backend: RedisBackend,
        node_info: Option<ConnectionInfo>,
        tunnel: Option<TunnelGuard>,
        proxy_relay: Option<RelayGuard>,
    ) -> Result<(), String> {
        let entry = SessionEntry {
            backend: Arc::new(Mutex::new(backend)),
            _tunnel: tunnel,
            _proxy_relay: proxy_relay,
            node_info,
            command_docs: Arc::new(OnceCell::new()),
        };
        self.sessions.lock().await.insert(session_id, entry);
        Ok(())
    }

    pub async fn close(&self, session_id: &str) -> Result<(), String> {
        let monitor_ids = {
            let monitors = self.monitors.lock().await;
            monitors
                .iter()
                .filter(|(_, entry)| entry.session_id == session_id)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>()
        };
        for monitor_id in monitor_ids {
            let _ = self.stop_monitor(&monitor_id).await;
        }

        let removed = self.sessions.lock().await.remove(session_id);
        self.metrics_cache.lock().await.remove(session_id);
        if let Some(notify) = self.metrics_inflight.lock().await.remove(session_id) {
            notify.notify_waiters();
        }
        match removed {
            Some(_) => Ok(()),
            None => Err(format!("session not found: {session_id}")),
        }
    }

    /// exec 执行一条命令并返回其 JSON 化的回复与耗时（毫秒）。
    pub async fn exec(&self, session_id: &str, args: &[String]) -> Result<Value, String> {
        if args.is_empty() {
            return Err("command args required".to_string());
        }
        let backend = self.backend_ref(session_id).await?;
        let byte_args: Vec<Vec<u8>> = args[1..].iter().map(|a| a.clone().into_bytes()).collect();
        let started_at = Instant::now();
        let mut backend = backend.lock().await;
        let reply = backend
            .exec_raw(&args[0], &byte_args)
            .await
            .map_err(|e| format!("redis: {e}"))?;
        let elapsed_ms = started_at.elapsed().as_secs_f64() * 1000.0;
        Ok(json!({
            "reply": redis_value_to_json(reply),
            "elapsedMs": elapsed_ms,
        }))
    }

    /// command_docs 返回该会话所连接服务器的 `COMMAND DOCS` 结果（会话生命周期内只探测一次，
    /// 无论成功或失败都会被缓存；并发调用者共享同一次探测）。
    pub async fn command_docs(&self, session_id: &str) -> Result<Arc<Vec<DynCommand>>, String> {
        let (backend, cell) = {
            let sessions = self.sessions.lock().await;
            let entry = sessions
                .get(session_id)
                .ok_or_else(|| format!("session not found: {session_id}"))?;
            (Arc::clone(&entry.backend), Arc::clone(&entry.command_docs))
        };
        let outcome = cell
            .get_or_init(|| async move {
                let mut backend = backend.lock().await;
                let reply = backend.exec_raw("COMMAND", &[b"DOCS".to_vec()]).await;
                drop(backend);
                match reply {
                    Ok(value) => Ok(Arc::new(commanddocs::parse_command_docs(&value))),
                    Err(e) => Err(format!("redis: COMMAND DOCS: {e}")),
                }
            })
            .await;
        outcome.clone()
    }

    /// collect_metrics 返回缓存或新采集的 `INFO` 指标（同一会话的并发请求会合并为一次采集）。
    pub async fn collect_metrics(&self, session_id: &str) -> Result<Value, String> {
        loop {
            if let Some(cached) = self.metrics_cache_get(session_id).await {
                return Ok(cached);
            }
            if let Some(notify) = self.metrics_try_join(session_id).await {
                notify.notified().await;
                continue;
            }

            let result = self.collect_metrics_uncached(session_id).await;
            self.metrics_finish(session_id).await;
            return result;
        }
    }

    async fn collect_metrics_uncached(&self, session_id: &str) -> Result<Value, String> {
        let backend = self.backend_ref(session_id).await?;
        let mut backend = backend.lock().await;
        let reply = backend
            .exec_raw("INFO", &[])
            .await
            .map_err(|e| format!("redis: INFO: {e}"))?;
        drop(backend);
        let text = match reply {
            redis::Value::BulkString(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            redis::Value::VerbatimString { text, .. } => text,
            redis::Value::SimpleString(s) => s,
            _ => String::new(),
        };
        let parsed = parse_info_metrics(&text);
        self.metrics_cache_set(session_id, &parsed).await;
        Ok(parsed)
    }

    async fn metrics_cache_get(&self, session_id: &str) -> Option<Value> {
        let cache = self.metrics_cache.lock().await;
        let entry = cache.get(session_id)?;
        if entry.captured_at.elapsed() > METRICS_CACHE_TTL {
            return None;
        }
        Some(entry.value.clone())
    }

    async fn metrics_cache_set(&self, session_id: &str, value: &Value) {
        self.metrics_cache.lock().await.insert(
            session_id.to_string(),
            MetricsCacheEntry {
                captured_at: Instant::now(),
                value: value.clone(),
            },
        );
    }

    async fn metrics_try_join(&self, session_id: &str) -> Option<Arc<Notify>> {
        let mut inflight = self.metrics_inflight.lock().await;
        if let Some(notify) = inflight.get(session_id) {
            return Some(Arc::clone(notify));
        }
        inflight.insert(session_id.to_string(), Arc::new(Notify::new()));
        None
    }

    async fn metrics_finish(&self, session_id: &str) {
        if let Some(notify) = self.metrics_inflight.lock().await.remove(session_id) {
            notify.notify_waiters();
        }
    }

    /// slowlog 返回最近的慢查询日志条目（按 Redis 返回顺序，最新优先）。
    pub async fn slowlog(&self, session_id: &str, count: i64) -> Result<Value, String> {
        let bounded_count = if count <= 0 {
            DEFAULT_SLOWLOG_COUNT
        } else {
            count.clamp(1, MAX_SLOWLOG_COUNT)
        };
        let backend = self.backend_ref(session_id).await?;
        let mut backend = backend.lock().await;
        let reply = backend
            .exec_raw("SLOWLOG", &[b"GET".to_vec(), bounded_count.to_string().into_bytes()])
            .await
            .map_err(|e| format!("redis: SLOWLOG GET: {e}"))?;
        drop(backend);
        let redis::Value::Array(entries) = reply else {
            return Ok(json!({ "entries": [] }));
        };
        let parsed: Vec<Value> = entries.iter().filter_map(parse_slowlog_entry).collect();
        Ok(json!({ "entries": parsed }))
    }

    /// scan_keyspace 执行一次增量 `SCAN` 并附带每个 key 的类型/剩余存活时间/近似大小。
    pub async fn scan_keyspace(
        &self,
        session_id: &str,
        cursor: u64,
        pattern: Option<&str>,
        count: i64,
        key_type: Option<&str>,
    ) -> Result<Value, String> {
        let bounded_count = if count <= 0 {
            DEFAULT_SCAN_COUNT
        } else {
            count.clamp(1, MAX_SCAN_COUNT)
        };
        let backend = self.backend_ref(session_id).await?;

        let mut args: Vec<Vec<u8>> = vec![cursor.to_string().into_bytes()];
        if let Some(pattern) = pattern {
            let truncated: String = pattern.chars().take(MAX_SCAN_MATCH_LEN).collect();
            args.push(b"MATCH".to_vec());
            args.push(truncated.into_bytes());
        }
        args.push(b"COUNT".to_vec());
        args.push(bounded_count.to_string().into_bytes());
        if let Some(key_type) = key_type {
            if !key_type.is_empty() {
                args.push(b"TYPE".to_vec());
                args.push(key_type.as_bytes().to_vec());
            }
        }

        let reply = {
            let mut backend = backend.lock().await;
            backend
                .exec_raw("SCAN", &args)
                .await
                .map_err(format_scan_error)?
        };
        let redis::Value::Array(mut parts) = reply else {
            return Err("redis: SCAN: unexpected reply shape".to_string());
        };
        if parts.len() != 2 {
            return Err("redis: SCAN: unexpected reply shape".to_string());
        }
        let keys_value = parts.pop().expect("checked len == 2");
        let cursor_value = parts.pop().expect("checked len == 2");
        let next_cursor = value_as_u64(&cursor_value);
        let keys: Vec<String> = match keys_value {
            redis::Value::Array(items) => items.iter().map(value_as_string).collect(),
            _ => Vec::new(),
        };
        let described = self.describe_keys(&backend, keys).await?;
        Ok(json!({ "cursor": next_cursor, "keys": described }))
    }

    /// describe_keys 为一批 key 附加 TYPE / 剩余存活时间(ms) / 近似字节大小。
    ///
    /// 请求数量已在 `scan_keyspace` 中被 `SCAN COUNT` 限制，此处再做一次硬上限，防止调用方
    /// 传入异常大的候选集合导致本轮产生过多命令往返。
    async fn describe_keys(
        &self,
        backend: &Arc<Mutex<RedisBackend>>,
        mut keys: Vec<String>,
    ) -> Result<Vec<Value>, String> {
        keys.truncate(MAX_DESCRIBE_KEYS);
        let mut described = Vec::with_capacity(keys.len());
        let mut backend = backend.lock().await;
        for key in keys {
            let key_bytes = vec![key.clone().into_bytes()];
            let kind = backend
                .exec_raw("TYPE", &key_bytes)
                .await
                .map(|v| value_as_string(&v))
                .unwrap_or_else(|_| "unknown".to_string());
            let ttl_ms = backend
                .exec_raw("PTTL", &key_bytes)
                .await
                .map(|v| value_as_i64(&v))
                .unwrap_or(-1);
            // `MEMORY USAGE` is unavailable on some managed/cluster deployments; treat
            // failures as "unknown size" rather than aborting the whole scan.
            let size_bytes = backend
                .exec_raw("MEMORY", &[b"USAGE".to_vec(), key.clone().into_bytes()])
                .await
                .map(|v| value_as_i64(&v))
                .unwrap_or(0)
                .max(0);
            described.push(json!({
                "key": key,
                "type": kind,
                "ttlMs": ttl_ms,
                "sizeBytes": size_bytes,
            }));
        }
        Ok(described)
    }

    /// start_monitor 打开一条独立的 `MONITOR` 连接并持续通过事件通道推送命令流。
    ///
    /// 仅支持 standalone / sentinel 会话：`MONITOR` 是单节点语义，集群会话请先选择目标节点
    /// （v1 暂未提供该选择入口，见 `RedisBackend::Cluster` 分支）。
    pub async fn start_monitor(&self, session_id: &str, monitor_id: String) -> Result<(), String> {
        let node_info = {
            let sessions = self.sessions.lock().await;
            let entry = sessions
                .get(session_id)
                .ok_or_else(|| format!("session not found: {session_id}"))?;
            entry
                .node_info
                .clone()
                .ok_or_else(|| "MONITOR is not supported for cluster sessions".to_string())?
        };

        let client = redis::Client::open(node_info).map_err(|e| format!("redis: monitor open: {e}"))?;
        let monitor = client
            .get_async_monitor()
            .await
            .map_err(|e| format!("redis: monitor: {e}"))?;

        let (stop_tx, stop_rx) = mpsc::channel::<()>(1);
        self.monitors.lock().await.insert(
            monitor_id.clone(),
            MonitorEntry {
                session_id: session_id.to_string(),
                stop_tx,
            },
        );

        let monitors = Arc::clone(&self.monitors);
        let events = self.events.clone();
        let session_id_owned = session_id.to_string();
        tokio::spawn(async move {
            run_monitor_task(monitors, events, session_id_owned, monitor_id, monitor, stop_rx).await;
        });
        Ok(())
    }

    pub async fn stop_monitor(&self, monitor_id: &str) -> Result<(), String> {
        let maybe_tx = {
            let monitors = self.monitors.lock().await;
            monitors.get(monitor_id).map(|entry| entry.stop_tx.clone())
        };
        match maybe_tx {
            Some(tx) => {
                let _ = tx.send(()).await;
                Ok(())
            }
            None => Err(format!("monitor not found: {monitor_id}")),
        }
    }

    async fn backend_ref(&self, session_id: &str) -> Result<Arc<Mutex<RedisBackend>>, String> {
        let sessions = self.sessions.lock().await;
        sessions
            .get(session_id)
            .map(|entry| Arc::clone(&entry.backend))
            .ok_or_else(|| format!("session not found: {session_id}"))
    }
}

async fn run_monitor_task(
    monitors: Arc<Mutex<HashMap<String, MonitorEntry>>>,
    events: AsyncPublisher,
    session_id: String,
    monitor_id: String,
    monitor: redis::aio::Monitor,
    mut stop_rx: mpsc::Receiver<()>,
) {
    events.emit(json!({
        "type": "redis.monitor.state",
        "sessionId": session_id,
        "monitorId": monitor_id,
        "state": "ready",
        "message": "",
    }));

    // `into_on_message` returns `impl Stream` which is not guaranteed `Unpin`; boxing it
    // makes the stream safe to poll inside `tokio::select!` below.
    let mut stream = Box::pin(monitor.into_on_message::<String>());
    let mut closed_by_caller = false;

    loop {
        tokio::select! {
            _ = stop_rx.recv() => {
                closed_by_caller = true;
                break;
            }
            maybe_line = stream.next() => {
                match maybe_line {
                    Some(line) => {
                        match parse_monitor_line(&line) {
                            Some(parsed) => {
                                events.emit(json!({
                                    "type": "redis.monitor.line",
                                    "sessionId": session_id,
                                    "monitorId": monitor_id,
                                    "data": parsed,
                                }));
                            }
                            None => {
                                warn!(monitor = %monitor_id, "failed to parse MONITOR line");
                            }
                        }
                    }
                    None => break,
                }
            }
        }
    }

    monitors.lock().await.remove(&monitor_id);
    events.emit(json!({
        "type": "redis.monitor.state",
        "sessionId": session_id,
        "monitorId": monitor_id,
        "state": if closed_by_caller { "closed" } else { "lost" },
        "message": "",
    }));
    if !closed_by_caller {
        error!(monitor = %monitor_id, "redis monitor stream ended unexpectedly");
    }
}

fn format_scan_error(err: redis::RedisError) -> String {
    let msg = err.to_string();
    if msg.contains("Replica can't interact with the keyspace") || msg.contains("READONLY") {
        return format!(
            "redis: SCAN: {msg} (当前连接为只读副本，键空间扫描需要在主节点执行)"
        );
    }
    format!("redis: SCAN: {msg}")
}

fn value_as_u64(value: &redis::Value) -> u64 {
    match value {
        redis::Value::Int(n) => (*n).max(0) as u64,
        redis::Value::BulkString(bytes) => std::str::from_utf8(bytes)
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0),
        redis::Value::SimpleString(s) => s.parse::<u64>().unwrap_or(0),
        _ => 0,
    }
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
