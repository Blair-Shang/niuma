//! handler 实现 sftp-service 的 IPC 方法分发与会话管理。

mod methods;

use std::sync::Arc;

use async_trait::async_trait;
use niuma_serviceipc::{parse_request, FrameHandler, Response};
use russh::Disconnect;
use serde_json::Value;
use tracing::{error, info, warn};

use crate::eventpub::AsyncPublisher;
use crate::idgen::Snowflake;
use crate::session::{connect_transport, open_sftp_session, ConnectParams, SessionManager};
use crate::transfer::TransferManager;

/// 能力服务内部方法名（platform-core 代理时映射为 sftp.* 命名空间）。
pub mod method {
    pub const SESSION_OPEN: &str = "session.open";
    pub const SESSION_CLOSE: &str = "session.close";
    pub const SESSION_TEST: &str = "session.test";
    pub const DIR_LIST: &str = "dir.list";
    pub const DIR_MAKE: &str = "dir.make";
    pub const ENTRY_DELETE: &str = "entry.delete";
    pub const ENTRY_RENAME: &str = "entry.rename";
    pub const FILE_READ: &str = "file.read";
    pub const FILE_WRITE: &str = "file.write";
    pub const TRANSFER_ENQUEUE: &str = "transfer.enqueue";
    pub const TRANSFER_CANCEL: &str = "transfer.cancel";
    pub const TRANSFER_PAUSE: &str = "transfer.pause";
    pub const TRANSFER_RESUME: &str = "transfer.resume";
    pub const TRANSFER_LIST: &str = "transfer.list";
    pub const HOSTKEY_REMEMBER: &str = "hostkey.remember";
}

/// Dispatcher 管理 SFTP 会话并处理方法。
pub struct Dispatcher {
    sessions: Arc<SessionManager>,
    transfers: Arc<TransferManager>,
    ids: Arc<Snowflake>,
}

impl Dispatcher {
    pub fn new(ids: Arc<Snowflake>, events: AsyncPublisher) -> Self {
        let sessions = Arc::new(SessionManager::new(events.clone()));
        let transfers = TransferManager::new(Arc::clone(&sessions), Arc::clone(&ids), events);
        Self {
            sessions,
            transfers,
            ids,
        }
    }

    async fn dispatch(&self, method: &str, id: &str, params: Value) -> Response {
        match method {
            method::SESSION_OPEN => self.session_open(id, params).await,
            method::SESSION_CLOSE => self.session_close(id, params).await,
            method::SESSION_TEST => self.session_test(id, params).await,
            method::DIR_LIST => methods::dir_list(&self.sessions, id, params).await,
            method::DIR_MAKE => methods::dir_make(&self.sessions, id, params).await,
            method::ENTRY_DELETE => methods::entry_delete(&self.sessions, id, params).await,
            method::ENTRY_RENAME => methods::entry_rename(&self.sessions, id, params).await,
            method::FILE_READ => methods::file_read(&self.sessions, id, params).await,
            method::FILE_WRITE => methods::file_write(&self.sessions, id, params).await,
            method::TRANSFER_ENQUEUE => methods::transfer_enqueue(&self.transfers, id, params).await,
            method::TRANSFER_CANCEL => methods::transfer_cancel(&self.transfers, id, params).await,
            method::TRANSFER_PAUSE => methods::transfer_pause(&self.transfers, id, params).await,
            method::TRANSFER_RESUME => methods::transfer_resume(&self.transfers, id, params).await,
            method::TRANSFER_LIST => methods::transfer_list(&self.transfers, id, params).await,
            method::HOSTKEY_REMEMBER => methods::hostkey_remember(id, params),
            other => Response::err(id, format!("method not found: {other}")),
        }
    }

    async fn session_open(&self, id: &str, params: Value) -> Response {
        let params: ConnectParams = match serde_json::from_value(params) {
            Ok(v) => v,
            Err(e) => return Response::err(id, format!("invalid params: {e}")),
        };
        match connect_transport(&params).await {
            Ok((handle, tunnel)) => match open_sftp_session(&handle).await {
                Ok(sftp) => {
                    let session_id = match self.ids.next_string() {
                        Ok(s) => s,
                        Err(e) => return Response::err(id, e.to_string()),
                    };
                    if let Err(e) = self
                        .sessions
                        .insert(session_id.clone(), handle, sftp, tunnel)
                        .await
                    {
                        return Response::err(id, e);
                    }
                    info!(
                        session = %session_id,
                        host = %params.host_address,
                        port = params.port_or_default(),
                        "session.open"
                    );
                    Response::ok(id, &serde_json::json!({ "sessionId": session_id }))
                }
                Err(e) => {
                    let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
                    error!(
                        host = %params.host_address,
                        port = params.port_or_default(),
                        %e,
                        "session.open sftp"
                    );
                    Response::err(id, e)
                }
            },
            Err(e) => {
                error!(
                    host = %params.host_address,
                    port = params.port_or_default(),
                    %e,
                    "session.open"
                );
                Response::err(id, e.to_string())
            }
        }
    }

    async fn session_close(&self, id: &str, params: Value) -> Response {
        let session_id = match params.get("sessionId").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s,
            _ => return Response::err(id, "sessionId required"),
        };
        match self.sessions.close(session_id).await {
            Ok(()) => {
                info!(session = %session_id, "session.close");
                Response::ok(id, &serde_json::json!({ "closed": true }))
            }
            Err(e) => Response::err(id, e),
        }
    }

    async fn session_test(&self, id: &str, params: Value) -> Response {
        let params: ConnectParams = match serde_json::from_value(params) {
            Ok(v) => v,
            Err(e) => return Response::err(id, format!("invalid params: {e}")),
        };
        match connect_transport(&params).await {
            Ok((handle, _tunnel)) => match open_sftp_session(&handle).await {
                Ok(_sftp) => {
                    let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
                    Response::ok(
                        id,
                        &serde_json::json!({ "ok": true, "message": "connected" }),
                    )
                }
                Err(e) => {
                    let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
                    warn!(
                        host = %params.host_address,
                        port = params.port_or_default(),
                        %e,
                        "session.test sftp"
                    );
                    Response::ok(
                        id,
                        &serde_json::json!({ "ok": false, "message": e }),
                    )
                }
            },
            Err(e) => {
                warn!(
                    host = %params.host_address,
                    port = params.port_or_default(),
                    %e,
                    "session.test"
                );
                Response::ok(
                    id,
                    &serde_json::json!({ "ok": false, "message": e.to_string() }),
                )
            }
        }
    }
}

fn log_dispatch_error(method: &str, id: &str, req_trace: &str, resp: &Response) {
    if resp.ok || resp.error_message.trim().is_empty() {
        return;
    }
    if resp.error_message.contains("context canceled") {
        return;
    }
    let trace = if !resp.trace_id.is_empty() {
        resp.trace_id.as_str()
    } else if !req_trace.is_empty() {
        req_trace
    } else {
        id
    };
    let code = if resp.error_code.is_empty() {
        "internal"
    } else {
        resp.error_code.as_str()
    };
    error!(
        op = method,
        err = %resp.error_message,
        id,
        traceId = trace,
        errorCode = code,
        "{method}"
    );
}

#[async_trait]
impl FrameHandler for Dispatcher {
    async fn handle_frame(&self, raw: &[u8]) -> Vec<u8> {
        let req = match parse_request(raw) {
            Ok(r) => r,
            Err(resp) => return resp.to_bytes(),
        };
        let resp = self.dispatch(&req.method, &req.id, req.params).await;
        log_dispatch_error(&req.method, &req.id, &req.trace_id, &resp);
        resp.to_bytes()
    }
}
