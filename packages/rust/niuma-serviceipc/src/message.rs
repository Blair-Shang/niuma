use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Request 是 Platform → 能力服务的 IPC 请求信封。
#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    #[serde(default)]
    pub v: u32,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub id: String,
    #[serde(default, rename = "traceId")]
    pub trace_id: String,
}

/// Response 是能力服务 → Platform 的 IPC 响应信封。
#[derive(Debug, Clone, Serialize)]
pub struct Response {
    pub v: u32,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    #[serde(rename = "error")]
    pub error_message: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    #[serde(rename = "errorCode")]
    pub error_code: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    #[serde(rename = "traceId")]
    pub trace_id: String,
    pub result: String,
}

/// PROTOCOL_VERSION 与 Go envelope.Version 对齐。
pub const PROTOCOL_VERSION: u32 = 1;

/// infer_error_code 从错误文案推断稳定码（与 Go envelope.InferCode 常用子集对齐）。
pub fn infer_error_code(message: &str) -> &'static str {
    let m = message.trim();
    let lower = m.to_ascii_lowercase();
    if lower.starts_with("method not found") {
        "method_not_found"
    } else if lower.starts_with("invalid request json") || lower.starts_with("invalid method") {
        "invalid_request"
    } else if lower.starts_with("invalid params") {
        "invalid_params"
    } else if lower.contains("context canceled") || lower == "cancelled" {
        "cancelled"
    } else if lower.contains("deadline exceeded")
        || lower.contains("i/o timeout")
        || lower.contains("timeout exceeded")
        || lower.contains("wait timeout")
    {
        "timeout"
    } else if lower.contains("broken pipe")
        || lower.contains("connection reset")
        || lower.contains("connection refused")
        || lower.contains("forcibly closed")
        || lower.contains("use of closed network")
        || lower.contains("invalid connection")
        || lower.contains("driver: bad connection")
        || lower.contains("unexpected eof")
        || lower.contains("connection lost")
        || lower.contains("wsasend")
        || lower.contains("wsarecv")
    {
        "lost"
    } else if lower.contains("unavailable") {
        "unavailable"
    } else if lower.contains("use mariadb connection kind")
        || lower.contains("use the matching connection kind")
    {
        "engine_mismatch"
    } else {
        "internal"
    }
}

impl Response {
    /// ok 构造成功响应，result 为 JSON 对象序列化后的字符串。
    pub fn ok(id: impl Into<String>, result: &impl Serialize) -> Self {
        let id = id.into();
        let result = match serde_json::to_string(result) {
            Ok(result) => result,
            Err(e) => {
                return Self::err(id, format!("marshal result: {e}"));
            }
        };
        Self {
            v: PROTOCOL_VERSION,
            id: id.clone(),
            ok: true,
            error_message: String::new(),
            error_code: String::new(),
            trace_id: id,
            result,
        }
    }

    /// err 构造失败响应。
    pub fn err(id: impl Into<String>, message: impl Into<String>) -> Self {
        let id = id.into();
        let error_message = message.into();
        let error_code = infer_error_code(&error_message).to_string();
        Self {
            v: PROTOCOL_VERSION,
            id: id.clone(),
            ok: false,
            error_message,
            error_code,
            trace_id: id,
            result: String::new(),
        }
    }

    /// to_bytes 序列化为 JSON 字节。
    pub fn to_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_else(|_| {
            br#"{"v":1,"ok":false,"error":"internal marshal error","errorCode":"internal","result":""}"#.to_vec()
        })
    }
}

/// parse_request 解析请求 JSON。
pub fn parse_request(raw: &[u8]) -> Result<Request, Response> {
    serde_json::from_slice(raw).map_err(|e| Response::err("", format!("invalid request json: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    fn golden(name: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../go/serviceipc/envelope/golden")
            .join(name);
        let raw = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        serde_json::from_str(raw.trim()).expect("golden json")
    }

    fn to_value(resp: &Response) -> Value {
        serde_json::from_str(&serde_json::to_string(resp).unwrap()).unwrap()
    }

    #[test]
    fn golden_ok_v1() {
        let resp = Response::ok("req-1", &json!({"closed": true}));
        assert_eq!(to_value(&resp), golden("ok-v1.json"));
    }

    #[test]
    fn golden_fail_method_not_found() {
        let resp = Response::err("req-2", "method not found: foo");
        assert_eq!(to_value(&resp), golden("fail-method_not_found-v1.json"));
    }

    #[test]
    fn golden_fail_engine_mismatch() {
        let resp = Response::err(
            "req-3",
            "mysql: server is MariaDB; use mariadb connection kind instead",
        );
        assert_eq!(to_value(&resp), golden("fail-engine_mismatch-v1.json"));
        assert_eq!(
            infer_error_code("postgres: server is not PostgreSQL; use the matching connection kind"),
            "engine_mismatch"
        );
    }
}
