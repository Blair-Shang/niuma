use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Request 是 Platform → 能力服务的 IPC 请求信封。
#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    pub method: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub id: String,
}

/// Response 是能力服务 → Platform 的 IPC 响应信封。
#[derive(Debug, Clone, Serialize)]
pub struct Response {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    #[serde(rename = "error")]
    pub error_message: String,
    pub result: String,
}

impl Response {
    /// ok 构造成功响应，result 为 JSON 对象序列化后的字符串。
    pub fn ok(id: impl Into<String>, result: &impl Serialize) -> Self {
        let id = id.into();
        let result = match serde_json::to_string(result) {
            Ok(result) => result,
            Err(e) => {
                return Self {
                    id,
                    ok: false,
                    error_message: format!("marshal result: {e}"),
                    result: String::new(),
                };
            }
        };
        Self {
            id,
            ok: true,
            error_message: String::new(),
            result,
        }
    }

    /// err 构造失败响应。
    pub fn err(id: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            ok: false,
            error_message: message.into(),
            result: String::new(),
        }
    }

    /// to_bytes 序列化为 JSON 字节。
    pub fn to_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_else(|_| {
            br#"{"ok":false,"error":"internal marshal error","result":""}"#.to_vec()
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

    #[test]
    fn ok_response_shape() {
        let resp = Response::ok("req-1", &json!({"sessionId": "42"}));
        let v: Value = serde_json::from_str(&serde_json::to_string(&resp).unwrap()).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["id"], "req-1");
        let result: Value = serde_json::from_str(v["result"].as_str().unwrap()).unwrap();
        assert_eq!(result["sessionId"], "42");
    }
}
