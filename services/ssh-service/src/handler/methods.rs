use niuma_serviceipc::Response;
use serde::Deserialize;
use serde_json::Value;

use crate::session::SessionManager;

#[derive(Debug, Deserialize)]
struct SftpPathParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct SftpWriteParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ExecParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    command: String,
    #[serde(default = "default_exec_stream")]
    stream: bool,
    #[serde(rename = "execId", default)]
    exec_id: String,
}

fn default_exec_stream() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct TerminalOpenParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub cols: u32,
    pub rows: u32,
    #[serde(rename = "termType", default = "default_term_type")]
    pub term_type: String,
}

#[derive(Debug, Deserialize)]
struct TerminalInputParams {
    #[serde(rename = "terminalId")]
    terminal_id: String,
    data: String,
}

#[derive(Debug, Deserialize)]
struct TerminalResizeParams {
    #[serde(rename = "terminalId")]
    terminal_id: String,
    cols: u32,
    rows: u32,
}

#[derive(Debug, Deserialize)]
struct TerminalCloseParams {
    #[serde(rename = "terminalId")]
    terminal_id: String,
}

fn default_term_type() -> String {
    "xterm-256color".to_string()
}

pub async fn sftp_dir_list(
    sessions: &SessionManager,
    id: &str,
    params: Value,
) -> Response {
    let params: SftpPathParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() {
        return Response::err(id, "sessionId required");
    }
    let path = normalize_remote_path(&params.path);
    match sessions.sftp_dir_list(&params.session_id, &path).await {
        Ok(result) => Response::ok(id, &result),
        Err(e) => Response::err(id, e),
    }
}

pub async fn sftp_file_read(
    sessions: &SessionManager,
    id: &str,
    params: Value,
) -> Response {
    let params: SftpPathParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() || params.path.is_empty() {
        return Response::err(id, "sessionId and path required");
    }
    let path = normalize_remote_path(&params.path);
    match sessions.sftp_file_read(&params.session_id, &path).await {
        Ok(result) => Response::ok(id, &result),
        Err(e) => Response::err(id, e),
    }
}

pub async fn sftp_file_write(
    sessions: &SessionManager,
    id: &str,
    params: Value,
) -> Response {
    let params: SftpWriteParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() || params.path.is_empty() {
        return Response::err(id, "sessionId and path required");
    }
    let path = normalize_remote_path(&params.path);
    let content = params.content.into_bytes();
    match sessions
        .sftp_file_write(&params.session_id, &path, &content)
        .await
    {
        Ok(result) => Response::ok(id, &result),
        Err(e) => Response::err(id, e),
    }
}

#[derive(Debug, Deserialize)]
struct SftpEntryDeleteParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    path: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    recursive: bool,
}

#[derive(Debug, Deserialize)]
struct SftpEntryRenameParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "fromPath")]
    from_path: String,
    #[serde(rename = "toPath")]
    to_path: String,
}

#[derive(Debug, Deserialize)]
struct TransferTaskParams {
    #[serde(rename = "taskId")]
    task_id: String,
}

#[derive(Debug, Deserialize)]
struct TransferListParams {
    #[serde(rename = "sessionId", default)]
    session_id: Option<String>,
}

pub async fn sftp_dir_make(
    sessions: &SessionManager,
    id: &str,
    params: Value,
) -> Response {
    let params: SftpPathParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() || params.path.is_empty() {
        return Response::err(id, "sessionId and path required");
    }
    let path = normalize_remote_path(&params.path);
    match sessions.sftp_dir_make(&params.session_id, &path).await {
        Ok(result) => Response::ok(id, &result),
        Err(e) => Response::err(id, e),
    }
}

pub async fn sftp_entry_delete(
    sessions: &SessionManager,
    id: &str,
    params: Value,
) -> Response {
    let params: SftpEntryDeleteParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() || params.path.is_empty() {
        return Response::err(id, "sessionId and path required");
    }
    let path = normalize_remote_path(&params.path);
    let kind = if params.kind.is_empty() {
        "file"
    } else {
        &params.kind
    };
    match sessions
        .sftp_entry_delete(&params.session_id, &path, kind, params.recursive)
        .await
    {
        Ok(result) => Response::ok(id, &result),
        Err(e) => Response::err(id, e),
    }
}

pub async fn sftp_entry_rename(
    sessions: &SessionManager,
    id: &str,
    params: Value,
) -> Response {
    let params: SftpEntryRenameParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() || params.from_path.is_empty() || params.to_path.is_empty() {
        return Response::err(id, "sessionId, fromPath and toPath required");
    }
    let from_path = normalize_remote_path(&params.from_path);
    let to_path = normalize_remote_path(&params.to_path);
    match sessions
        .sftp_entry_rename(&params.session_id, &from_path, &to_path)
        .await
    {
        Ok(result) => Response::ok(id, &result),
        Err(e) => Response::err(id, e),
    }
}

pub async fn transfer_enqueue(
    transfers: &std::sync::Arc<crate::transfer::TransferManager>,
    id: &str,
    params: Value,
) -> Response {
    let params: crate::transfer::EnqueueParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    match transfers.enqueue(params).await {
        Ok(task_id) => Response::ok(id, &serde_json::json!({ "taskId": task_id })),
        Err(e) => Response::err(id, e),
    }
}

pub async fn transfer_cancel(
    transfers: &std::sync::Arc<crate::transfer::TransferManager>,
    id: &str,
    params: Value,
) -> Response {
    let params: TransferTaskParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.task_id.is_empty() {
        return Response::err(id, "taskId required");
    }
    match transfers.cancel(&params.task_id).await {
        Ok(()) => Response::ok(id, &serde_json::json!({ "canceled": true })),
        Err(e) => Response::err(id, e),
    }
}

pub async fn transfer_pause(
    transfers: &std::sync::Arc<crate::transfer::TransferManager>,
    id: &str,
    params: Value,
) -> Response {
    let params: TransferTaskParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.task_id.is_empty() {
        return Response::err(id, "taskId required");
    }
    match transfers.pause(&params.task_id).await {
        Ok(()) => Response::ok(id, &serde_json::json!({ "paused": true })),
        Err(e) => Response::err(id, e),
    }
}

pub async fn transfer_resume(
    transfers: &std::sync::Arc<crate::transfer::TransferManager>,
    id: &str,
    params: Value,
) -> Response {
    let params: TransferTaskParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.task_id.is_empty() {
        return Response::err(id, "taskId required");
    }
    match transfers.resume(&params.task_id).await {
        Ok(()) => Response::ok(id, &serde_json::json!({ "resumed": true })),
        Err(e) => Response::err(id, e),
    }
}

pub async fn transfer_list(
    transfers: &std::sync::Arc<crate::transfer::TransferManager>,
    id: &str,
    params: Value,
) -> Response {
    let params: TransferListParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    let session_id = params.session_id.as_deref();
    let tasks = transfers.list(session_id).await;
    let json_tasks: Vec<Value> = tasks
        .into_iter()
        .map(|t| {
            serde_json::json!({
                "taskId": t.task_id,
                "sessionId": t.session_id,
                "direction": t.direction.as_str(),
                "localPath": t.local_path,
                "remotePath": t.remote_path,
                "state": t.state.as_str(),
                "total": t.total,
                "transferred": t.transferred,
                "speedBps": t.speed_bps,
                "error": t.error.unwrap_or_default(),
            })
        })
        .collect();
    Response::ok(id, &serde_json::json!({ "tasks": json_tasks }))
}

pub async fn exec_run(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: ExecParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() || params.command.is_empty() {
        return Response::err(id, "sessionId and command required");
    }
    let exec_id = if params.exec_id.is_empty() { id.to_string() } else { params.exec_id };
    match sessions
        .exec(&params.session_id, &params.command, &exec_id, params.stream)
        .await
    {
        Ok(result) => Response::ok(id, &result),
        Err(e) => Response::err(id, e),
    }
}

#[derive(Debug, Deserialize)]
struct MonitorMetricsParams {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Debug, Deserialize)]
struct MonitorProcessInspectParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    pid: i64,
}

/// Collects system performance metrics from the remote host.
///
/// Delegates to `SessionManager::collect_metrics` which executes a compiled-in
/// shell script and returns structured JSON. No shell commands are visible to
/// the frontend — it receives only the parsed result object.
pub async fn monitor_metrics(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: MonitorMetricsParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() {
        return Response::err(id, "sessionId required");
    }
    match sessions.collect_metrics(&params.session_id).await {
        Ok(result) => Response::ok(id, &result),
        Err(e) => Response::err(id, e),
    }
}

/// Inspects a single process on the remote host and returns richer context.
pub async fn monitor_process_inspect(
    sessions: &SessionManager,
    id: &str,
    params: Value,
) -> Response {
    let params: MonitorProcessInspectParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.session_id.is_empty() || params.pid <= 0 {
        return Response::err(id, "sessionId and positive pid required");
    }
    match crate::session::monitor::inspect_process(sessions, &params.session_id, params.pid).await {
        Ok(result) => Response::ok(id, &result),
        Err(e) => Response::err(id, e),
    }
}

pub fn parse_terminal_open_params(params: Value) -> Result<TerminalOpenParams, String> {
    let params: TerminalOpenParams =
        serde_json::from_value(params).map_err(|e| format!("invalid params: {e}"))?;
    if params.session_id.is_empty() || params.cols == 0 || params.rows == 0 {
        return Err("sessionId, cols and rows required".to_string());
    }
    Ok(params)
}

pub async fn terminal_input(
    sessions: &SessionManager,
    id: &str,
    params: Value,
) -> Response {
    let params: TerminalInputParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.terminal_id.is_empty() {
        return Response::err(id, "terminalId required");
    }
    match sessions.terminal_input(&params.terminal_id, &params.data).await {
        Ok(()) => Response::ok(id, &serde_json::json!({ "ok": true })),
        Err(e) => Response::err(id, e),
    }
}

pub async fn terminal_resize(
    sessions: &SessionManager,
    id: &str,
    params: Value,
) -> Response {
    let params: TerminalResizeParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.terminal_id.is_empty() || params.cols == 0 || params.rows == 0 {
        return Response::err(id, "terminalId, cols and rows required");
    }
    match sessions
        .resize_terminal(&params.terminal_id, params.cols, params.rows)
        .await
    {
        Ok(()) => Response::ok(id, &serde_json::json!({ "ok": true })),
        Err(e) => Response::err(id, e),
    }
}

pub async fn terminal_close(
    sessions: &SessionManager,
    id: &str,
    params: Value,
) -> Response {
    let params: TerminalCloseParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    if params.terminal_id.is_empty() {
        return Response::err(id, "terminalId required");
    }
    match sessions.close_terminal(&params.terminal_id).await {
        Ok(()) => Response::ok(id, &serde_json::json!({ "closed": true })),
        Err(e) => Response::err(id, e),
    }
}

fn normalize_remote_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "." {
        ".".to_string()
    } else {
        trimmed.replace('\\', "/")
    }
}

#[cfg(test)]
mod tests {
    use super::parse_terminal_open_params;
    use serde_json::json;

    #[test]
    fn parse_terminal_open_requires_dimensions() {
        let err = parse_terminal_open_params(json!({
            "sessionId": "s1",
            "cols": 0,
            "rows": 24
        }))
        .unwrap_err();
        assert!(err.contains("cols and rows"));
    }
}
