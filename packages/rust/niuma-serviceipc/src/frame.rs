use std::io;

use thiserror::Error;

/// MAX_FRAME_SIZE 限制单帧 JSON 载荷的最大字节数（1 GiB）。
/// 桌面工具查询页可能含大字段，故放宽到 1 GiB（仍低于 uint32 协议上限）。
pub const MAX_FRAME_SIZE: u32 = 1 << 30;

/// FrameError 表示分帧读写错误。
#[derive(Debug, Error)]
pub enum FrameError {
    #[error("frame exceeds max size: {0} bytes")]
    TooLarge(u32),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

/// read_frame 从 reader 读取一帧并返回 JSON 载荷。
pub async fn read_frame<R>(reader: &mut R) -> Result<Vec<u8>, FrameError>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut header = [0u8; 4];
    tokio::io::AsyncReadExt::read_exact(reader, &mut header).await?;
    let n = u32::from_le_bytes(header);
    if n > MAX_FRAME_SIZE {
        return Err(FrameError::TooLarge(n));
    }
    if n == 0 {
        return Ok(Vec::new());
    }
    let mut payload = vec![0u8; n as usize];
    tokio::io::AsyncReadExt::read_exact(reader, &mut payload).await?;
    Ok(payload)
}

/// write_frame 把 payload 作为一帧写入 writer。
pub async fn write_frame<W>(writer: &mut W, payload: &[u8]) -> Result<(), FrameError>
where
    W: tokio::io::AsyncWrite + Unpin,
{
    if payload.len() as u32 > MAX_FRAME_SIZE {
        return Err(FrameError::TooLarge(payload.len() as u32));
    }
    let header = (payload.len() as u32).to_le_bytes();
    tokio::io::AsyncWriteExt::write_all(writer, &header).await?;
    tokio::io::AsyncWriteExt::write_all(writer, payload).await?;
    tokio::io::AsyncWriteExt::flush(writer).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn round_trip_frame() {
        let payload = br#"{"method":"ping"}"#;
        let mut buf = Vec::new();
        write_frame(&mut buf, payload).await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let mut reader = tokio::io::BufReader::new(&mut cursor);
        let got = read_frame(&mut reader).await.unwrap();
        assert_eq!(got, payload);
    }
}
