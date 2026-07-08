//! NiuMa 桌面子进程落盘日志。
//!
//! 目录优先级：`NIUMMA_LOG_DIR` > `NIUMMA_LOG_ROOT` > 仓库根 `logs/`。

mod resolve;
mod rotate;

use std::io;
use std::sync::Arc;

use tracing_subscriber::fmt::format::FmtSpan;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

pub use rotate::MAX_FILE_BYTES;

/// InitError 表示日志初始化失败。
#[derive(Debug, thiserror::Error)]
pub enum InitError {
    #[error("create log directory: {0}")]
    CreateDir(#[from] io::Error),
}

/// init 将 tracing 默认输出重定向到 `<logDir>/<service_name>.log`。
///
/// 无法解析 logDir 时回退 stderr（便于纯终端调试）。
pub fn init(service_name: &str) -> Result<(), InitError> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    if let Some(dir) = resolve::resolve_log_dir() {
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{service_name}.log"));
        let writer = Arc::new(rotate::RotatingWriter::new(path));
        let file_layer = tracing_subscriber::fmt::layer()
            .with_writer({
                let writer = Arc::clone(&writer);
                move || rotate::LogWriter(Arc::clone(&writer))
            })
            .with_ansi(false)
            .with_target(false)
            .with_span_events(FmtSpan::NONE)
            .with_timer(tracing_subscriber::fmt::time::ChronoLocal::new(
                "%Y-%m-%d %H:%M:%S".to_string(),
            ));
        tracing_subscriber::registry()
            .with(filter)
            .with(file_layer)
            .init();
        tracing::info!(service = service_name, "logging initialized");
        return Ok(());
    }

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .init();
    tracing::warn!(service = service_name, "file logging unavailable, using stderr");
    Ok(())
}
