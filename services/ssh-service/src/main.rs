//! NiuMa SSH/SFTP 能力服务（Layer 1）独立进程入口。
//!
//! 与 platform-core 通过应用 IPC 通信（见 `packages/rust/niuma-serviceipc`）。

mod eventpub;
mod handler;
mod idgen;
mod session;
mod transfer;

use std::sync::Arc;

use niuma_serviceipc::serve;
use tokio::sync::broadcast;
use tracing::{error, info};

const WINDOWS_PIPE_ADDR: &str = r"\\.\pipe\niuma.ssh";
const UNIX_SOCKET_NAME: &str = "niuma.ssh.sock";

#[tokio::main]
async fn main() {
    if let Err(err) = niuma_logutil::init("ssh-service") {
        eprintln!("ssh-service: log init: {err}");
    }

    if let Err(err) = run().await {
        error!(%err, "ssh-service exited");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    let shutdown_tx_clone = shutdown_tx.clone();
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            let _ = shutdown_tx_clone.send(());
        }
    });

    let id_gen = Arc::new(idgen::Snowflake::new(0)?);
    let dispatcher = Arc::new(handler::Dispatcher::new(id_gen, eventpub::AsyncPublisher::new()));
    let addr = ipc_address();
    info!(
        addr,
        version = env!("NIUMMA_BUILD_VERSION"),
        build = env!("NIUMMA_BUILD_ID"),
        "ssh-service starting"
    );
    serve(&addr, dispatcher).await?;
    Ok(())
}

fn ipc_address() -> String {
    if cfg!(windows) {
        WINDOWS_PIPE_ADDR.to_string()
    } else {
        std::env::temp_dir()
            .join(UNIX_SOCKET_NAME)
            .to_string_lossy()
            .into_owned()
    }
}
