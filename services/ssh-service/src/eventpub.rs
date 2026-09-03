//! eventpub 向 platform 事件入口异步发布 SSH 终端流式事件。
//!
//! 业务层优化：持久 eventin 连接 + `ssh.terminal.data` 合并，减轻 IPC 与 Shell 压力。

use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use niuma_serviceipc::write_frame;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tracing::warn;

#[cfg(not(windows))]
use tokio::net::UnixStream;

/// Windows 上命名管道忙的错误码。
#[cfg(windows)]
const ERROR_PIPE_BUSY: i32 = 231;
/// 入口尚未就绪时的重试间隔。
const CONNECT_RETRY_DELAY_MS: u64 = 50;
/// Unix socket 连不上时的最多重试次数（约 2s，与 Go publishTimeout 对齐）。
#[cfg(not(windows))]
const CONNECT_RETRY_ATTEMPTS: u32 = 40;
/// 终端输出合并窗口。
const COALESCE_INTERVAL: Duration = Duration::from_millis(12);
/// 单帧合并上限（字节）。
const COALESCE_MAX_BYTES: usize = 48 * 1024;
/// Unix 下 platform 事件入口文件名。
#[cfg(not(windows))]
const UNIX_INGEST_NAME: &str = "niuma.platform.eventin.sock";
/// Windows 下 platform 事件入口地址。
#[cfg(windows)]
const WINDOWS_INGEST_ADDR: &str = r"\\.\pipe\niuma.platform.eventin";

#[cfg(windows)]
type IngestStream = tokio::net::windows::named_pipe::NamedPipeClient;
#[cfg(not(windows))]
type IngestStream = tokio::net::UnixStream;

/// AsyncPublisher 在后台单任务中串行写入 platform 事件入口。
#[derive(Clone)]
pub struct AsyncPublisher {
    tx: mpsc::UnboundedSender<Value>,
}

impl AsyncPublisher {
    /// new 创建异步发布器并启动后台写入循环。
    pub fn new() -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
        tokio::spawn(async move {
            let mut writer = IngestWriter::new();
            let mut coalesce: Option<CoalesceBuffer> = None;
            let mut flush_deadline: Option<tokio::time::Instant> = None;
            loop {
                let sleep = flush_deadline.map(tokio::time::sleep_until);
                tokio::select! {
                    event = rx.recv() => {
                        match event {
                            Some(event) => {
                                if let Some(buf) = coalesce.as_mut() {
                                    if !buf.can_merge(&event) {
                                        if let Err(err) = writer.publish(coalesce.take().unwrap().into_event()).await {
                                            warn!(%err, "ssh terminal event publish failed");
                                        }
                                        flush_deadline = None;
                                    }
                                }
                                if is_terminal_data(&event) {
                                    if contains_escape_bytes(&decode_terminal_bytes(&event)) {
                                        if let Some(buf) = coalesce.take() {
                                            if let Err(err) = writer.publish(buf.into_event()).await {
                                                warn!(%err, "ssh terminal event publish failed");
                                            }
                                        }
                                        flush_deadline = None;
                                        if let Err(err) = writer.publish(event).await {
                                            warn!(%err, "ssh terminal event publish failed");
                                        }
                                        continue;
                                    }
                                    match &mut coalesce {
                                        Some(buf) => buf.append(&event),
                                        None => {
                                            coalesce = Some(CoalesceBuffer::from_event(event));
                                            flush_deadline = Some(tokio::time::Instant::now() + COALESCE_INTERVAL);
                                        }
                                    }
                                    if coalesce.as_ref().is_some_and(|b| b.byte_len() >= COALESCE_MAX_BYTES) {
                                        if let Err(err) = writer.publish(coalesce.take().unwrap().into_event()).await {
                                            warn!(%err, "ssh terminal event publish failed");
                                        }
                                        flush_deadline = None;
                                    }
                                } else {
                                    if let Some(buf) = coalesce.take() {
                                        if let Err(err) = writer.publish(buf.into_event()).await {
                                            warn!(%err, "ssh terminal event publish failed");
                                        }
                                        flush_deadline = None;
                                    }
                                    if let Err(err) = writer.publish(event).await {
                                        warn!(%err, "ssh terminal event publish failed");
                                    }
                                }
                            }
                            None => {
                                if let Some(buf) = coalesce.take() {
                                    let _ = writer.publish(buf.into_event()).await;
                                }
                                break;
                            }
                        }
                    }
                    _ = async {
                        if let Some(sleep) = sleep {
                            sleep.await;
                        }
                    }, if flush_deadline.is_some() => {
                        if let Some(buf) = coalesce.take() {
                            if let Err(err) = writer.publish(buf.into_event()).await {
                                warn!(%err, "ssh terminal event publish failed");
                            }
                        }
                        flush_deadline = None;
                    }
                }
            }
        });
        Self { tx }
    }

    /// emit 入队一个 JSON 事件对象。
    pub fn emit(&self, event: Value) {
        let _ = self.tx.send(event);
    }
}

fn is_terminal_data(event: &Value) -> bool {
    event.get("type").and_then(Value::as_str) == Some("ssh.terminal.data")
}

fn contains_escape_bytes(data: &[u8]) -> bool {
    data.contains(&0x1b) || data.contains(&0x9b)
}

/// encode_terminal_b64 把 PTY 原始字节编成 JSON 可传输的 base64。
pub fn encode_terminal_b64(data: &[u8]) -> String {
    STANDARD.encode(data)
}

fn decode_terminal_bytes(event: &Value) -> Vec<u8> {
    let data = event
        .get("data")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match event.get("encoding").and_then(Value::as_str) {
        Some("base64") => STANDARD.decode(data).unwrap_or_default(),
        _ => data.as_bytes().to_vec(),
    }
}

struct CoalesceBuffer {
    terminal_id: String,
    session_id: String,
    stream: String,
    data: Vec<u8>,
}

impl CoalesceBuffer {
    fn from_event(event: Value) -> Self {
        Self {
            terminal_id: event
                .get("terminalId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            session_id: event
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            stream: event
                .get("stream")
                .and_then(Value::as_str)
                .unwrap_or("stdout")
                .to_string(),
            data: decode_terminal_bytes(&event),
        }
    }

    fn can_merge(&self, event: &Value) -> bool {
        if !is_terminal_data(event) {
            return false;
        }
        event.get("terminalId").and_then(Value::as_str) == Some(self.terminal_id.as_str())
            && event.get("stream").and_then(Value::as_str) == Some(self.stream.as_str())
    }

    fn append(&mut self, event: &Value) {
        self.data.extend_from_slice(&decode_terminal_bytes(event));
    }

    fn byte_len(&self) -> usize {
        self.data.len()
    }

    fn into_event(self) -> Value {
        json!({
            "type": "ssh.terminal.data",
            "sessionId": self.session_id,
            "terminalId": self.terminal_id,
            "stream": self.stream,
            "encoding": "base64",
            "data": encode_terminal_b64(&self.data),
        })
    }
}

struct IngestWriter {
    stream: Option<IngestStream>,
}

impl IngestWriter {
    fn new() -> Self {
        Self { stream: None }
    }

    async fn publish(&mut self, event: Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = serde_json::to_vec(&event)?;
        self.write_payload(&payload).await
    }

    async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        #[cfg(windows)]
        {
            use tokio::net::windows::named_pipe::ClientOptions;

            let stream = loop {
                match ClientOptions::new().open(WINDOWS_INGEST_ADDR) {
                    Ok(client) => break client,
                    Err(err) if err.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                        tokio::time::sleep(Duration::from_millis(CONNECT_RETRY_DELAY_MS)).await;
                    }
                    Err(err) => return Err(Box::new(err)),
                }
            };
            self.stream = Some(stream);
        }
        #[cfg(not(windows))]
        {
            let addr = std::env::temp_dir().join(UNIX_INGEST_NAME);
            let mut last_err = None;
            let mut stream = None;
            for _ in 0..CONNECT_RETRY_ATTEMPTS {
                match UnixStream::connect(&addr).await {
                    Ok(s) => {
                        stream = Some(s);
                        break;
                    }
                    Err(err) if is_transient_unix_connect(&err) => {
                        last_err = Some(err);
                        tokio::time::sleep(Duration::from_millis(CONNECT_RETRY_DELAY_MS)).await;
                    }
                    Err(err) => return Err(Box::new(err)),
                }
            }
            self.stream = Some(stream.ok_or_else(|| {
                last_err
                    .map(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
                    .unwrap_or_else(|| "unix eventin connect failed".into())
            })?);
        }
        Ok(())
    }

    async fn write_payload(
        &mut self,
        payload: &[u8],
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if self.stream.is_none() {
            self.connect().await?;
        }
        let stream = self.stream.as_mut().expect("ingest stream");
        if write_frame(stream, payload).await.is_err() {
            self.stream = None;
            self.connect().await?;
            write_frame(self.stream.as_mut().expect("ingest stream"), payload).await?;
        }
        Ok(())
    }
}

#[cfg(not(windows))]
fn is_transient_unix_connect(err: &std::io::Error) -> bool {
    matches!(
        err.kind(),
        std::io::ErrorKind::NotFound
            | std::io::ErrorKind::ConnectionRefused
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::WouldBlock
    )
}

#[cfg(test)]
mod tests {
    use super::{contains_escape_bytes, decode_terminal_bytes, encode_terminal_b64, CoalesceBuffer};
    use serde_json::json;

    #[test]
    fn coalesce_merges_decoded_bytes_not_base64_text() {
        let first = json!({
            "type": "ssh.terminal.data",
            "sessionId": "s1",
            "terminalId": "t1",
            "stream": "stdout",
            "encoding": "base64",
            "data": encode_terminal_b64(b"hello"),
        });
        let second = json!({
            "type": "ssh.terminal.data",
            "sessionId": "s1",
            "terminalId": "t1",
            "stream": "stdout",
            "encoding": "base64",
            "data": encode_terminal_b64(b" world"),
        });
        let mut buf = CoalesceBuffer::from_event(first);
        assert!(buf.can_merge(&second));
        buf.append(&second);
        assert_eq!(buf.byte_len(), 11);
        let merged = buf.into_event();
        assert_eq!(merged["encoding"], "base64");
        assert_eq!(decode_terminal_bytes(&merged), b"hello world");
    }

    #[test]
    fn escape_detected_on_raw_bytes() {
        assert!(contains_escape_bytes(&[0x1b, b'[', b'H']));
        assert!(!contains_escape_bytes(b"plain"));
    }
}
