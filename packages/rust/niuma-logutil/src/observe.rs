use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;

use crate::resolve::resolve_log_dir;
use crate::rotate::RotatingWriter;

const OBSERVE_FILE: &str = "observe.jsonl";
const DIAG_PREFIX: &str = "platform.diag.";

static SERVICE: OnceLock<String> = OnceLock::new();
static WRITER: OnceLock<Mutex<ObserveWriter>> = OnceLock::new();

struct ObserveWriter {
    dir: String,
    inner: Option<RotatingWriter>,
}

/// Event 是一条本机 RPC 观测记录。
#[derive(Serialize)]
struct Event<'a> {
    ts: String,
    kind: &'a str,
    service: &'a str,
    method: &'a str,
    #[serde(skip_serializing_if = "str::is_empty")]
    id: &'a str,
    #[serde(rename = "traceId", skip_serializing_if = "str::is_empty")]
    trace_id: &'a str,
    ok: bool,
    #[serde(rename = "errorCode", skip_serializing_if = "str::is_empty")]
    error_code: &'a str,
    #[serde(rename = "durationMs")]
    duration_ms: i64,
}

/// set_service_name 由 init 调用，供 observe_ipc 写入 service 字段。
pub fn set_service_name(name: &str) {
    let _ = SERVICE.set(name.to_string());
}

/// observe_ipc 把一次 IPC 往返写成 observe.jsonl。诊断方法自身不记录。
pub fn observe_ipc(req_json: &[u8], resp_json: &[u8], d: Duration) {
    let req: serde_json::Value = serde_json::from_slice(req_json).unwrap_or(serde_json::Value::Null);
    let resp: serde_json::Value = serde_json::from_slice(resp_json).unwrap_or(serde_json::Value::Null);
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    if method.is_empty() || method.starts_with(DIAG_PREFIX) {
        return;
    }
    let id = resp
        .get("id")
        .and_then(|v| v.as_str())
        .or_else(|| req.get("id").and_then(|v| v.as_str()))
        .unwrap_or("");
    let mut trace = resp
        .get("traceId")
        .and_then(|v| v.as_str())
        .or_else(|| req.get("traceId").and_then(|v| v.as_str()))
        .unwrap_or("");
    if trace.is_empty() {
        trace = id;
    }
    let ok = resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    let error_code = resp.get("errorCode").and_then(|v| v.as_str()).unwrap_or("");
    let service = SERVICE.get().map(|s| s.as_str()).unwrap_or("unknown");
    let ev = Event {
        ts: chrono::Local::now().to_rfc3339(),
        kind: "rpc",
        service,
        method,
        id,
        trace_id: trace,
        ok,
        error_code: if ok { "" } else { error_code },
        duration_ms: i64::try_from(d.as_millis()).unwrap_or(i64::MAX),
    };
    let Ok(mut line) = serde_json::to_vec(&ev) else {
        return;
    };
    line.push(b'\n');
    write_observe(&line);
}

fn write_observe(line: &[u8]) {
    let Some(dir) = resolve_log_dir() else {
        return;
    };
    let dir_s = dir.to_string_lossy().into_owned();
    let slot = WRITER.get_or_init(|| {
        Mutex::new(ObserveWriter {
            dir: String::new(),
            inner: None,
        })
    });
    let Ok(mut st) = slot.lock() else {
        return;
    };
    if st.dir != dir_s || st.inner.is_none() {
        let _ = std::fs::create_dir_all(&dir);
        st.inner = Some(RotatingWriter::new(dir.join(OBSERVE_FILE)));
        st.dir = dir_s;
    }
    if let Some(w) = st.inner.as_ref() {
        let _ = w.write_bytes(line);
    }
}
