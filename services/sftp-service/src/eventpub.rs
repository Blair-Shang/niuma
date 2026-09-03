//! eventpub 向 platform 事件入口异步发布 SFTP 传输与会话状态事件。

use std::time::Duration;

use niuma_serviceipc::write_frame;
use serde_json::Value;
use tokio::sync::mpsc;
use tracing::warn;

/// Windows 上命名管道忙的错误码。
#[cfg(windows)]
const ERROR_PIPE_BUSY: i32 = 231;
/// 入口尚未就绪时的重试间隔。
const CONNECT_RETRY_DELAY_MS: u64 = 50;
/// Unix socket 连不上时的最多重试次数（约 2s，与 Go publishTimeout 对齐）。
#[cfg(not(windows))]
const CONNECT_RETRY_ATTEMPTS: u32 = 40;
/// Unix 下 platform 事件入口文件名。
#[cfg(not(windows))]
const UNIX_INGEST_NAME: &str = "niuma.platform.eventin.sock";
/// Windows 下 platform 事件入口地址。
#[cfg(windows)]
const WINDOWS_INGEST_ADDR: &str = r"\\.\pipe\niuma.platform.eventin";

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
            while let Some(event) = rx.recv().await {
                if let Err(err) = publish_event(event).await {
                    warn!(%err, "sftp event publish failed");
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

async fn publish_event(event: Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let payload = serde_json::to_vec(&event)?;
    #[cfg(windows)]
    {
        use tokio::net::windows::named_pipe::ClientOptions;

        let mut stream = loop {
            match ClientOptions::new().open(WINDOWS_INGEST_ADDR) {
                Ok(client) => break client,
                Err(err) if err.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                    tokio::time::sleep(Duration::from_millis(CONNECT_RETRY_DELAY_MS)).await;
                }
                Err(err) => return Err(Box::new(err)),
            }
        };
        write_frame(&mut stream, &payload).await?;
    }
    #[cfg(not(windows))]
    {
        use tokio::net::UnixStream;

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
        let mut stream = stream.ok_or_else(|| {
            last_err
                .map(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
                .unwrap_or_else(|| "unix eventin connect failed".into())
        })?;
        write_frame(&mut stream, &payload).await?;
    }
    Ok(())
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
