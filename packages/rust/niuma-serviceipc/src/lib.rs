//! NiuMa Layer-1 能力服务应用 IPC 协议与服务端。
//!
//! 分帧格式：4 字节小端长度前缀 + UTF-8 JSON 载荷，与 `packages/go/serviceipc` 对齐。

mod frame;
mod message;
mod server;

pub use frame::{read_frame, write_frame, FrameError, MAX_FRAME_SIZE};
pub use message::{infer_error_code, parse_request, Request, Response, PROTOCOL_VERSION};
pub use server::{serve, FrameHandler};
