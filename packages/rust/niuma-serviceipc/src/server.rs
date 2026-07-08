use std::sync::Arc;

use tokio::io::{AsyncRead, AsyncWrite};
use tracing::{error, info};

use crate::frame::{read_frame, write_frame, FrameError};
use crate::message::parse_request;

/// FrameHandler 处理一帧请求 JSON 并返回响应 JSON 字节。
#[async_trait::async_trait]
pub trait FrameHandler: Send + Sync {
    async fn handle_frame(&self, raw: &[u8]) -> Vec<u8>;
}

/// serve 在给定地址上监听应用 IPC 请求并分发给 handler，直到 ctx 被取消。
pub async fn serve<H>(addr: &str, handler: Arc<H>) -> Result<(), std::io::Error>
where
    H: FrameHandler + 'static,
{
    #[cfg(windows)]
    {
        serve_windows(addr, handler).await
    }
    #[cfg(not(windows))]
    {
        serve_unix(addr, handler).await
    }
}

#[cfg(windows)]
async fn serve_windows<H>(addr: &str, handler: Arc<H>) -> Result<(), std::io::Error>
where
    H: FrameHandler + 'static,
{
    use tokio::net::windows::named_pipe::ServerOptions;

    info!(addr, "serving");
    loop {
        let server = ServerOptions::new()
            .first_pipe_instance(false)
            .create(addr)?;
        server.connect().await?;
        let handler = Arc::clone(&handler);
        tokio::spawn(async move {
            if let Err(err) = handle_conn(server, handler).await {
                if !matches!(err, FrameError::Io(ref e) if e.kind() == std::io::ErrorKind::UnexpectedEof) {
                    error!(%err, "connection error");
                }
            }
        });
    }
}

#[cfg(not(windows))]
async fn serve_unix<H>(addr: &str, handler: Arc<H>) -> Result<(), std::io::Error>
where
    H: FrameHandler + 'static,
{
    use tokio::net::UnixListener;

    let _ = std::fs::remove_file(addr);
    let listener = UnixListener::bind(addr)?;
    info!(addr, "serving");
    loop {
        let (stream, _) = listener.accept().await?;
        let handler = Arc::clone(&handler);
        tokio::spawn(async move {
            if let Err(err) = handle_conn(stream, handler).await {
                if !matches!(err, FrameError::Io(ref e) if e.kind() == std::io::ErrorKind::UnexpectedEof) {
                    error!(%err, "connection error");
                }
            }
        });
    }
}

async fn handle_conn<S, H>(mut stream: S, handler: Arc<H>) -> Result<(), FrameError>
where
    S: AsyncRead + AsyncWrite + Unpin,
    H: FrameHandler + 'static,
{
    loop {
        let payload = read_frame(&mut stream).await?;
        let resp = dispatch(handler.as_ref(), &payload).await;
        write_frame(&mut stream, &resp).await?;
    }
}

async fn dispatch<H>(handler: &H, raw: &[u8]) -> Vec<u8>
where
    H: FrameHandler,
{
    if let Err(resp) = parse_request(raw) {
        return resp.to_bytes();
    }
    handler.handle_frame(raw).await
}
