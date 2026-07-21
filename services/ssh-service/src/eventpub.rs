//! eventpub 向 platform 事件入口异步发布 SSH 终端流式事件。
//!
//! 业务层优化：持久 eventin 连接 + `ssh.terminal.data` 合并，减轻 IPC 与 Shell 压力。

use std::time::Duration;

use niuma_serviceipc::write_frame;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tracing::warn;

#[cfg(not(windows))]
use tokio::net::UnixStream;

/// Windows 上命名管道忙的错误码。
const ERROR_PIPE_BUSY: i32 = 231;
/// 管道忙时的重试间隔。
const PIPE_RETRY_DELAY_MS: u64 = 50;
/// 终端输出合并窗口。
const COALESCE_INTERVAL: Duration = Duration::from_millis(12);
/// 单帧合并上限（字节）。
const COALESCE_MAX_BYTES: usize = 48 * 1024;
/// Unix 下 platform 事件入口文件名。
#[cfg(not(windows))]
const UNIX_INGEST_NAME: &str = "niuma.platform.eventin.sock";
/// Windows 下 platform 事件入口地址。
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
                                    if contains_escape_sequence(terminal_data_bytes(&event)) {
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

fn contains_escape_sequence(data: &str) -> bool {
    data.as_bytes().contains(&0x1b) || data.as_bytes().contains(&0x9b)
}

fn terminal_data_bytes(event: &Value) -> &str {
    event
        .get("data")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

struct CoalesceBuffer {
    terminal_id: String,
    session_id: String,
    stream: String,
    data: String,
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
            data: event
                .get("data")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
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
        if let Some(chunk) = event.get("data").and_then(Value::as_str) {
            self.data.push_str(chunk);
        }
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
            "data": self.data,
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
                        tokio::time::sleep(Duration::from_millis(PIPE_RETRY_DELAY_MS)).await;
                    }
                    Err(err) => return Err(Box::new(err)),
                }
            };
            self.stream = Some(stream);
        }
        #[cfg(not(windows))]
        {
            let addr = std::env::temp_dir().join(UNIX_INGEST_NAME);
            let stream = UnixStream::connect(addr).await?;
            self.stream = Some(stream);
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
