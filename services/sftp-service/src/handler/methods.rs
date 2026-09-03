use niuma_serviceipc::Response;
use serde::Deserialize;
use serde_json::Value;

use crate::session::SessionManager;

#[derive(Debug, Deserialize)]
struct PathParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct WriteParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct EntryDeleteParams {
    #[serde(rename = "sessionId")]
    session_id: String,
    path: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    recursive: bool,
}

#[derive(Debug, Deserialize)]
struct EntryRenameParams {
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

pub async fn dir_list(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: PathParams = match serde_json::from_value(params) {
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

pub async fn file_read(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: PathParams = match serde_json::from_value(params) {
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

pub async fn file_write(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: WriteParams = match serde_json::from_value(params) {
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

pub async fn dir_make(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: PathParams = match serde_json::from_value(params) {
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

pub async fn entry_delete(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: EntryDeleteParams = match serde_json::from_value(params) {
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

pub async fn entry_rename(sessions: &SessionManager, id: &str, params: Value) -> Response {
    let params: EntryRenameParams = match serde_json::from_value(params) {
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

#[derive(Debug, Deserialize)]
struct HostkeyRememberParams {
    host: String,
    #[serde(default)]
    port: u16,
}

/// hostkey_remember 把上次被拒绝的主机密钥写入 ~/.ssh/known_hosts。
pub fn hostkey_remember(id: &str, params: Value) -> Response {
    let params: HostkeyRememberParams = match serde_json::from_value(params) {
        Ok(v) => v,
        Err(e) => return Response::err(id, format!("invalid params: {e}")),
    };
    let host = params.host.trim();
    if host.is_empty() {
        return Response::err(id, "host required");
    }
    let port = if params.port == 0 { 22 } else { params.port };
    match crate::session::write_remembered(host, port) {
        Ok(remembered) => Response::ok(
            id,
            &serde_json::json!({
                "remembered": true,
                "host": remembered.host,
                "port": remembered.port,
                "fingerprint": remembered.fingerprint,
                "algorithm": remembered.algorithm,
            }),
        ),
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
