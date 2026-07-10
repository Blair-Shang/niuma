//! IPC 方法参数解析与处理函数（不涉及会话生命周期的部分，见 `handler::Dispatcher`）。

use niuma_serviceipc::Response;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{info, warn};

use crate::session::connect::{connect_redis, ConnectParams};
use crate::session::monitor::{keyspace_db_keys_from_info, parse_config_databases};
use crate::session::SessionManager;
use crate::suggest;

/// Hard cap on the number of args accepted by a single `command.exec` call, bounding the
/// size of one IPC request regardless of what the frontend sends.
const MAX_COMMAND_ARGS: usize = 4096;
/// Hard cap on the `MATCH` pattern length accepted from `keyspace.scan` callers.
const MAX_SCAN_MATCH_LEN: usize = 200;
/// 日志中单条字符串的最大字符数，避免超长 value 撑爆日志文件。
const MAX_LOG_FIELD_CHARS: usize = 200;
/// 命令日志里最多展示的参数个数（超出部分以 `+N more` 表示）。
const MAX_LOG_COMMAND_ARGS: usize = 4;

#[derive(Debug, Deserialize)]
struct SessionIdParams {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Debug, Deserialize)]
struct CommandExecParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    args: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CommandSuggestParams {
    #[serde(default)]
    input: String,
    /// 可选：若提供且该会话存在，优先使用其 `COMMAND DOCS` 动态命令表（与实际连接的服务器
    /// 版本/模块严格对齐）；缺省或探测失败（如服务器不支持 `COMMAND DOCS`）时回退到静态表。
    #[serde(rename = "sessionId", default)]
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MonitorSlowlogParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(default = "default_slowlog_count")]
    count: i64,
}

fn default_slowlog_count() -> i64 {
    20
}

#[derive(Debug, Deserialize)]
struct MonitorStreamStopParams {
    #[serde(rename = "monitorId")]
    monitor_id: String,
}

#[derive(Debug, Deserialize)]
struct KeyspaceScanParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(default)]
    cursor: u64,
    #[serde(rename = "match", default)]
    match_pattern: Option<String>,
    #[serde(default = "default_scan_count")]
    count: i64,
    #[serde(rename = "type", default)]
    key_type: Option<String>,
}

fn default_scan_count() -> i64 {
    100
}

/// command.exec 在指定会话上执行一条已切分好的命令并返回其 JSON 化回复。
pub async fn command_exec(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: CommandExecParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() {
        return Response::err(id, "sessionId required");
    }
    if params.args.is_empty() {
        return Response::err(id, "args required");
    }
    if params.args.len() > MAX_COMMAND_ARGS {
        return Response::err(id, format!("too many args (max {MAX_COMMAND_ARGS})"));
    }
    match sessions.exec(&params.session_id, &params.args).await {
        Ok(result) => {
            let elapsed_ms = result
                .get("elapsedMs")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            info!(
                session = %params.session_id,
                command = %format_command_log(&params.args),
                elapsed_ms,
                "command.exec"
            );
            Response::ok(id, &result)
        }
        Err(e) => {
            warn!(
                session = %params.session_id,
                command = %format_command_log(&params.args),
                error = %e,
                "command.exec"
            );
            Response::err(id, e)
        }
    }
}

/// command.suggest 在给出 `sessionId` 且该会话的服务器支持 `COMMAND DOCS` 时，使用与该服务器
/// 严格对齐的动态命令表；否则回退到内置的静态命令表，两种情况都不需要调用方关心其中差异。
pub async fn command_suggest(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: CommandSuggestParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    let (source, result) =
        if let Some(session_id) = params.session_id.as_deref().filter(|s| !s.is_empty()) {
            if let Ok(docs) = sessions.command_docs(session_id).await {
                if !docs.is_empty() {
                    ("dynamic", suggest::suggest_dynamic(&params.input, &docs))
                } else {
                    ("static", suggest::suggest(&params.input))
                }
            } else {
                // Session missing / server predates `COMMAND DOCS` (Redis < 7.0) / empty reply:
                // best-effort UX affordance — silently fall back rather than surfacing an error.
                ("static", suggest::suggest(&params.input))
            }
        } else {
            ("static", suggest::suggest(&params.input))
        };
    log_suggest(&params.session_id, &params.input, source, &result);
    Response::ok(id, &result)
}

pub async fn monitor_metrics(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: SessionIdParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() {
        return Response::err(id, "sessionId required");
    }
    match sessions.collect_metrics(&params.session_id).await {
        Ok(result) => {
            info!(session = %params.session_id, "monitor.metrics");
            Response::ok(id, &result)
        }
        Err(e) => {
            warn!(session = %params.session_id, error = %e, "monitor.metrics");
            Response::err(id, e)
        }
    }
}

pub async fn monitor_slowlog(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: MonitorSlowlogParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() {
        return Response::err(id, "sessionId required");
    }
    match sessions.slowlog(&params.session_id, params.count).await {
        Ok(result) => {
            info!(session = %params.session_id, count = params.count, "monitor.slowlog");
            Response::ok(id, &result)
        }
        Err(e) => {
            warn!(session = %params.session_id, error = %e, "monitor.slowlog");
            Response::err(id, e)
        }
    }
}

pub async fn monitor_stream_stop(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: MonitorStreamStopParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.monitor_id.is_empty() {
        return Response::err(id, "monitorId required");
    }
    match sessions.stop_monitor(&params.monitor_id).await {
        Ok(()) => {
            info!(monitor = %params.monitor_id, "monitor.stream.stop");
            Response::ok(id, &serde_json::json!({ "closed": true }))
        }
        Err(e) => {
            warn!(monitor = %params.monitor_id, error = %e, "monitor.stream.stop");
            Response::err(id, e)
        }
    }
}

pub async fn keyspace_scan(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: KeyspaceScanParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() {
        return Response::err(id, "sessionId required");
    }
    let match_pattern = params
        .match_pattern
        .as_deref()
        .map(|p| p.chars().take(MAX_SCAN_MATCH_LEN).collect::<String>());
    match sessions
        .scan_keyspace(
            &params.session_id,
            params.cursor,
            match_pattern.as_deref(),
            params.count,
            params.key_type.as_deref(),
        )
        .await
    {
        Ok(result) => {
            let key_count = result
                .get("keys")
                .and_then(|v| v.as_array())
                .map(|items| items.len())
                .unwrap_or(0);
            let next_cursor = result.get("cursor").and_then(|v| v.as_u64()).unwrap_or(0);
            info!(
                session = %params.session_id,
                cursor = params.cursor,
                next_cursor,
                keys = key_count,
                pattern = match_pattern.as_deref().unwrap_or("*"),
                key_type = params.key_type.as_deref().unwrap_or(""),
                "keyspace.scan"
            );
            Response::ok(id, &result)
        }
        Err(e) => {
            warn!(
                session = %params.session_id,
                cursor = params.cursor,
                pattern = match_pattern.as_deref().unwrap_or("*"),
                error = %e,
                "keyspace.scan"
            );
            Response::err(id, e)
        }
    }
}

/// tree_databases 短连接探测逻辑库列表，供连接树懒加载（不创建 sessionId）。
pub async fn tree_databases(id: &str, params: Value) -> Response {
    let params: ConnectParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    let default_database = params.options.database;
    match connect_redis(&params).await {
        Ok(connected) => {
            let mut backend = connected.backend;
            let info_text = match backend.exec_raw("INFO", &[b"keyspace".to_vec()]).await {
                Ok(reply) => info_reply_to_string(reply),
                Err(e) => {
                    warn!(host = %params.host_address, error = %e, "tree.databases INFO keyspace");
                    String::new()
                }
            };
            let keyspace: Vec<Value> = keyspace_db_keys_from_info(&info_text)
                .into_iter()
                .map(|(db, keys)| json!({ "db": db, "keys": keys }))
                .collect();
            let database_count = if params.options.topology == "cluster" {
                1
            } else {
                parse_config_databases(&mut backend).await
            };
            info!(
                host = %params.host_address,
                databases = database_count,
                keyspace_entries = keyspace.len(),
                "tree.databases"
            );
            Response::ok(
                id,
                &json!({
                    "databaseCount": database_count,
                    "defaultDatabase": default_database,
                    "keyspace": keyspace,
                }),
            )
        }
        Err(e) => {
            warn!(
                host = %params.host_address,
                topology = %params.options.topology,
                %e,
                "tree.databases"
            );
            Response::err(id, e.to_string())
        }
    }
}

fn info_reply_to_string(reply: redis::Value) -> String {
    match reply {
        redis::Value::BulkString(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        redis::Value::VerbatimString { text, .. } => text,
        redis::Value::SimpleString(s) => s,
        _ => String::new(),
    }
}

fn log_suggest(session_id: &Option<String>, input: &str, source: &str, result: &Value) {
    if input.trim().is_empty() {
        return;
    }
    let suggestions = result
        .get("suggestions")
        .and_then(|v| v.as_array())
        .map(|items| items.len())
        .unwrap_or(0);
    info!(
        session = session_id.as_deref().unwrap_or(""),
        input = %truncate_for_log(input, MAX_LOG_FIELD_CHARS),
        suggestions,
        source,
        "command.suggest"
    );
}

fn truncate_for_log(text: &str, max_chars: usize) -> String {
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return text.to_string();
    }
    let truncated: String = text.chars().take(max_chars).collect();
    format!("{truncated}…")
}

/// 把命令参数格式化为可落盘的单行摘要；敏感命令与超长 value 做脱敏/截断。
fn format_command_log(args: &[String]) -> String {
    if args.is_empty() {
        return "(empty)".to_string();
    }
    let cmd = args[0].to_ascii_uppercase();
    if matches!(cmd.as_str(), "AUTH" | "HELLO") {
        return format!("{cmd} (+{} hidden)", args.len().saturating_sub(1));
    }
    if args.len() == 1 {
        return cmd;
    }
    let preview: Vec<String> = args
        .iter()
        .take(MAX_LOG_COMMAND_ARGS)
        .map(|part| truncate_for_log(part, 80))
        .collect();
    if args.len() <= MAX_LOG_COMMAND_ARGS {
        preview.join(" ")
    } else {
        format!("{} (+{} more)", preview.join(" "), args.len() - MAX_LOG_COMMAND_ARGS)
    }
}
