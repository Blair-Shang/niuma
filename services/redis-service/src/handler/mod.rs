//! handler 实现 redis-service 的 IPC 方法分发与会话管理。

mod methods;

use std::sync::Arc;

use async_trait::async_trait;
use niuma_serviceipc::{parse_request, FrameHandler, Response};
use serde_json::Value;
use tracing::{error, info, warn};

use crate::eventpub::AsyncPublisher;
use crate::idgen::Snowflake;
use crate::session::{connect_redis, ConnectParams, SessionManager};

/// 能力服务内部方法名（platform-core 代理时映射为 redis.* 命名空间）。
pub mod method {
    pub const SESSION_OPEN: &str = "session.open";
    pub const SESSION_CLOSE: &str = "session.close";
    pub const SESSION_TEST: &str = "session.test";
    pub const COMMAND_EXEC: &str = "command.exec";
    pub const COMMAND_SUGGEST: &str = "command.suggest";
    pub const MONITOR_METRICS: &str = "monitor.metrics";
    pub const MONITOR_SLOWLOG: &str = "monitor.slowlog";
    pub const MONITOR_STREAM_START: &str = "monitor.stream.start";
    pub const MONITOR_STREAM_STOP: &str = "monitor.stream.stop";
    pub const KEYSPACE_SCAN: &str = "keyspace.scan";
    pub const TREE_DATABASES: &str = "tree.databases";
}

/// Dispatcher 管理 Redis 会话并处理方法。
pub struct Dispatcher {
    sessions: Arc<SessionManager>,
    ids: Arc<Snowflake>,
}

impl Dispatcher {
    pub fn new(ids: Arc<Snowflake>, events: AsyncPublisher) -> Self {
        Self {
            sessions: Arc::new(SessionManager::new(events)),
            ids,
        }
    }

    async fn dispatch(&self, method: &str, id: &str, params: Value) -> Response {
        match method {
            method::SESSION_OPEN => self.session_open(id, params).await,
            method::SESSION_CLOSE => self.session_close(id, params).await,
            method::SESSION_TEST => self.session_test(id, params).await,
            method::COMMAND_EXEC => methods::command_exec(&self.sessions, id, params).await,
            method::COMMAND_SUGGEST => methods::command_suggest(&self.sessions, id, params).await,
            method::MONITOR_METRICS => methods::monitor_metrics(&self.sessions, id, params).await,
            method::MONITOR_SLOWLOG => methods::monitor_slowlog(&self.sessions, id, params).await,
            method::MONITOR_STREAM_START => self.monitor_stream_start(id, params).await,
            method::MONITOR_STREAM_STOP => methods::monitor_stream_stop(&self.sessions, id, params).await,
            method::KEYSPACE_SCAN => methods::keyspace_scan(&self.sessions, id, params).await,
            method::TREE_DATABASES => methods::tree_databases(id, params).await,
            other => Response::err(id, format!("method not found: {other}")),
        }
    }

    async fn session_open(&self, id: &str, params: Value) -> Response {
        let params: ConnectParams = match serde_json::from_value(params) {
            Ok(v) => v,
            Err(e) => return Response::err(id, format!("invalid params: {e}")),
        };
        match connect_redis(&params).await {
            Ok(connected) => {
                let session_id = match self.ids.next_string() {
                    Ok(s) => s,
                    Err(e) => return Response::err(id, e.to_string()),
                };
                if let Err(e) = self
                    .sessions
                    .insert(
                        session_id.clone(),
                        connected.backend,
                        connected.node_info,
                        connected._tunnel,
                        connected._proxy_relay,
                    )
                    .await
                {
                    return Response::err(id, e);
                }
                info!(
                    session = %session_id,
                    host = %params.host_address,
                    port = params.port_or_default(),
                    topology = %params.options.topology,
                    "session.open"
                );
                Response::ok(id, &serde_json::json!({ "sessionId": session_id }))
            }
            Err(e) => {
                error!(
                    host = %params.host_address,
                    port = params.port_or_default(),
                    topology = %params.options.topology,
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
            Err(e) => {
                warn!(session = %session_id, error = %e, "session.close");
                Response::err(id, e)
            }
        }
    }

    async fn session_test(&self, id: &str, params: Value) -> Response {
        let params: ConnectParams = match serde_json::from_value(params) {
            Ok(v) => v,
            Err(e) => return Response::err(id, format!("invalid params: {e}")),
        };
        match connect_redis(&params).await {
            Ok(mut connected) => match connected.backend.ping().await {
                Ok(()) => Response::ok(id, &serde_json::json!({ "ok": true, "message": "connected" })),
                Err(e) => Response::ok(id, &serde_json::json!({ "ok": false, "message": e.to_string() })),
            },
            Err(e) => {
                warn!(
                    host = %params.host_address,
                    port = params.port_or_default(),
                    topology = %params.options.topology,
                    %e,
                    "session.test"
                );
                Response::ok(id, &serde_json::json!({ "ok": false, "message": e.to_string() }))
            }
        }
    }

    async fn monitor_stream_start(&self, id: &str, params: Value) -> Response {
        let session_id = match params.get("sessionId").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Response::err(id, "sessionId required"),
        };
        let monitor_id = match self.ids.next_string() {
            Ok(value) => value,
            Err(err) => return Response::err(id, err.to_string()),
        };
        match self.sessions.start_monitor(&session_id, monitor_id.clone()).await {
            Ok(()) => {
                info!(session = %session_id, monitor = %monitor_id, "monitor.stream.start");
                Response::ok(id, &serde_json::json!({ "monitorId": monitor_id }))
            }
            Err(err) => {
                warn!(session = %session_id, error = %err, "monitor.stream.start");
                Response::err(id, err)
            }
        }
    }
}

#[async_trait]
impl FrameHandler for Dispatcher {
    async fn handle_frame(&self, raw: &[u8]) -> Vec<u8> {
        let req = match parse_request(raw) {
            Ok(r) => r,
            Err(resp) => return resp.to_bytes(),
        };
        self.dispatch(&req.method, &req.id, req.params).await.to_bytes()
    }
}
