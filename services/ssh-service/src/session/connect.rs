use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use russh::client;
use serde::Deserialize;
use thiserror::Error;

/// default_dial_timeout 是 SSH 建连默认超时（30 秒）。
const DEFAULT_DIAL_TIMEOUT_SECS: u64 = 30;

/// default_ssh_port 是 SSH 默认端口。
const DEFAULT_SSH_PORT: u16 = 22;

/// ConnectParams 是建连参数（含明文密码，仅进程内使用）。
#[derive(Debug, Clone, Deserialize)]
pub struct ConnectParams {
    #[serde(rename = "hostAddress")]
    pub host_address: String,
    #[serde(rename = "portNumber", default)]
    pub port_number: u16,
    #[serde(rename = "loginAccount")]
    pub login_account: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub options: ConnectOptions,
}

/// ConnectOptions 与 Web connection_options JSON 对齐。
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ConnectOptions {
    #[serde(rename = "timeout_seconds", default = "default_timeout_seconds")]
    pub timeout_seconds: u64,
}

fn default_timeout_seconds() -> u64 {
    DEFAULT_DIAL_TIMEOUT_SECS
}

impl ConnectParams {
    pub fn port_or_default(&self) -> u16 {
        if self.port_number == 0 {
            DEFAULT_SSH_PORT
        } else {
            self.port_number
        }
    }

    pub fn dial_timeout(&self) -> Duration {
        let secs = if self.options.timeout_seconds == 0 {
            DEFAULT_DIAL_TIMEOUT_SECS
        } else {
            self.options.timeout_seconds
        };
        Duration::from_secs(secs)
    }
}

#[derive(Debug, Error)]
pub enum ConnectError {
    #[error("ssh: connect {host}:{port}: {source}")]
    Dial {
        host: String,
        port: u16,
        source: russh::Error,
    },
    #[error("ssh: authentication failed for {user}@{host}")]
    AuthFailed { user: String, host: String },
    #[error("ssh: {0}")]
    Other(#[from] russh::Error),
}

/// SshClientHandler 是 russh 客户端回调（信任首次主机密钥，后续可扩展 known_hosts）。
pub struct SshClientHandler;

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// connect_ssh 建立已认证的 SSH 客户端会话。
pub async fn connect_ssh(params: &ConnectParams) -> Result<client::Handle<SshClientHandler>, ConnectError> {
    let config = Arc::new(client::Config::default());
    let host = params.host_address.clone();
    let port = params.port_or_default();
    let addr = (host.as_str(), port);

    let connect_fut = client::connect(config, addr, SshClientHandler);
    let mut handle = match tokio::time::timeout(params.dial_timeout(), connect_fut).await {
        Ok(Ok(h)) => h,
        Ok(Err(e)) => {
            return Err(ConnectError::Dial {
                host,
                port,
                source: e,
            })
        }
        Err(_) => {
            return Err(ConnectError::Dial {
                host,
                port,
                source: russh::Error::Disconnect,
            })
        }
    };

    let user = params.login_account.clone();
    let auth_ok = handle
        .authenticate_password(&user, &params.password)
        .await
        .map_err(ConnectError::Other)?;
    if !auth_ok {
        return Err(ConnectError::AuthFailed {
            user,
            host,
        });
    }
    Ok(handle)
}

/// max_file_read_size 是在线读取文件内容的最大字节数（10 MiB）。
pub const MAX_FILE_READ_SIZE: usize = 10 * 1024 * 1024;
