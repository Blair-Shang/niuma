use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use russh::client;
use russh_keys::key::KeyPair;
use serde::Deserialize;
use thiserror::Error;

/// default_dial_timeout 是 SSH 建连默认超时（30 秒）。
const DEFAULT_DIAL_TIMEOUT_SECS: u64 = 30;

/// default_ssh_port 是 SSH 默认端口。
const DEFAULT_SSH_PORT: u16 = 22;
const AUTH_TYPE_PASSWORD: &str = "password";
const AUTH_TYPE_KEYBOARD_INTERACTIVE: &str = "keyboard_interactive";
const AUTH_TYPE_PRIVATE_KEY: &str = "private_key";
const AUTH_TYPE_PRIVATE_KEY_FILE: &str = "private_key_file";
/// kbdint 最多往返轮数，避免服务端空请求死循环。
const KBDINT_MAX_ROUNDS: usize = 8;

/// ConnectParams 是建连参数（含明文密码，仅进程内使用）。
#[derive(Debug, Clone, Deserialize)]
pub struct ConnectParams {
    #[serde(rename = "hostAddress")]
    pub host_address: String,
    #[serde(rename = "portNumber", default)]
    pub port_number: u16,
    #[serde(rename = "loginAccount")]
    pub login_account: String,
    /// 认证凭据（密码或私钥内容）；新信封字段名为 `secret`，兼容历史 `password`。
    #[serde(alias = "password", default)]
    pub secret: String,
    #[serde(default)]
    pub options: ConnectOptions,
}

/// ConnectOptions 与 Web connection_options JSON 对齐。
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ConnectOptions {
    #[serde(rename = "timeout_seconds", alias = "timeoutSeconds", default = "default_timeout_seconds")]
    pub timeout_seconds: u64,
    /// SSH keepalive 间隔（秒）；0 表示禁用。对应 russh Config.keepalive_interval。
    #[serde(rename = "keepalive_seconds", default)]
    pub keepalive_seconds: u64,
    /// 是否对照 ~/.ssh/known_hosts 验证服务器主机密钥。false（默认）则跳过验证。
    #[serde(rename = "verify_host_key", default)]
    pub verify_host_key: bool,
    #[serde(rename = "auth_type", default = "default_auth_type")]
    pub auth_type: String,
    #[serde(rename = "private_key_path", default)]
    pub private_key_path: String,
    #[serde(default)]
    pub passphrase: String,
    #[serde(default)]
    pub proxy: niuma_netproxy::Options,
    /// SSH over SSH 跳板机隧道；platform 在转发前已注入 sshProfile 凭据。
    #[serde(default)]
    pub tunnel: niuma_tunnel::TunnelOptions,
}

fn default_timeout_seconds() -> u64 {
    DEFAULT_DIAL_TIMEOUT_SECS
}

fn default_auth_type() -> String {
    AUTH_TYPE_PASSWORD.to_string()
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
    #[error("ssh: private key required")]
    PrivateKeyRequired,
    #[error("ssh: private key path required")]
    PrivateKeyPathRequired,
    #[error("ssh: unsupported auth type: {0}")]
    UnsupportedAuthType(String),
    #[error("ssh: host key rejected for {host}:{port} fingerprint={fingerprint} algo={algorithm} reason={reason}")]
    HostKeyRejected {
        host: String,
        port: u16,
        fingerprint: String,
        algorithm: String,
        reason: String,
    },
    #[error("ssh: tunnel: {0}")]
    Tunnel(#[from] niuma_tunnel::TunnelError),
    #[error("ssh: proxy: {0}")]
    NetProxy(#[from] niuma_netproxy::Error),
    #[error("ssh: {0}")]
    Other(#[from] russh::Error),
    #[error("ssh: private key: {0}")]
    Key(#[from] russh_keys::Error),
}

/// SshClientHandler 是 russh 客户端回调；可选对照 ~/.ssh/known_hosts 验证主机密钥。
pub struct SshClientHandler {
    /// 若为 true，在 check_server_key 时对照 known_hosts 文件校验；false 则跳过（默认）。
    verify: bool,
    host:   String,
    port:   u16,
    /// 握手因主机密钥未通过校验而失败时置位，供 connect_ssh 返回 HostKeyRejected。
    host_key_rejected: Arc<AtomicBool>,
}

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        if !self.verify {
            return Ok(true);
        }
        let (accepted, _reason) =
            super::hostkey::verify_or_reject(&self.host, self.port, server_public_key);
        if !accepted {
            self.host_key_rejected.store(true, Ordering::Relaxed);
        }
        Ok(accepted)
    }
}

/// connect_ssh 建立已认证的 SSH 客户端会话。
/// 返回 (会话句柄, 可选隧道守卫)；隧道守卫 drop 时自动关闭本地转发端口。
pub async fn connect_ssh(
    params: &ConnectParams,
) -> Result<(client::Handle<SshClientHandler>, Option<niuma_tunnel::TunnelGuard>), ConnectError> {
    // 若启用了 SSH 跳板机隧道，先建隧道，再把连接目标改为本地转发端口。
    let (actual_host, actual_port, tunnel_guard) = if params.options.tunnel.enabled() {
        let (h, p, guard) = niuma_tunnel::start_ssh_tunnel(
            &params.options.tunnel,
            &params.host_address,
            params.port_or_default(),
        )
        .await?;
        (h, p, Some(guard))
    } else {
        (params.host_address.clone(), params.port_or_default(), None)
    };

    let keepalive = if params.options.keepalive_seconds > 0 {
        Some(std::time::Duration::from_secs(params.options.keepalive_seconds))
    } else {
        None
    };
    let config = Arc::new(client::Config {
        keepalive_interval: keepalive,
        ..Default::default()
    });
    // known_hosts 始终对照最终目标，不用隧道本地转发地址。
    let verify_host = params.host_address.clone();
    let verify_port = params.port_or_default();
    let host_key_rejected = Arc::new(AtomicBool::new(false));
    let handler = SshClientHandler {
        verify: params.options.verify_host_key,
        host: verify_host.clone(),
        port: verify_port,
        host_key_rejected: Arc::clone(&host_key_rejected),
    };

    let connect_fut = async {
        let socket = niuma_netproxy::dial_tcp(&params.options.proxy, &actual_host, actual_port)
            .await
            .map_err(ConnectError::NetProxy)?;
        client::connect_stream(config, socket, handler)
            .await
            .map_err(ConnectError::Other)
    };
    let mut handle = match tokio::time::timeout(params.dial_timeout(), connect_fut).await {
        Ok(Ok(h)) => h,
        Ok(Err(ConnectError::Other(_))) if host_key_rejected.load(Ordering::Relaxed) => {
            return Err(host_key_rejected_error(&verify_host, verify_port));
        }
        Ok(Err(e)) => return Err(e),
        Err(_) => {
            return Err(ConnectError::Dial {
                host: actual_host,
                port: actual_port,
                source: russh::Error::Disconnect,
            })
        }
    };

    let user = params.login_account.clone();
    let auth_ok = authenticate(&mut handle, &user, params).await?;
    if !auth_ok {
        return Err(ConnectError::AuthFailed {
            user,
            host: actual_host,
        });
    }
    Ok((handle, tunnel_guard))
}

async fn authenticate(
    handle: &mut client::Handle<SshClientHandler>,
    user: &str,
    params: &ConnectParams,
) -> Result<bool, ConnectError> {
    match params.options.auth_type.as_str() {
        "" | AUTH_TYPE_PASSWORD => authenticate_password_or_kbdint(handle, user, &params.secret).await,
        AUTH_TYPE_KEYBOARD_INTERACTIVE => {
            authenticate_keyboard_interactive(handle, user, &params.secret).await
        }
        AUTH_TYPE_PRIVATE_KEY => {
            if params.secret.trim().is_empty() {
                return Err(ConnectError::PrivateKeyRequired);
            }
            let key = decode_private_key(&params.secret, params.options.passphrase.as_str())?;
            handle
                .authenticate_publickey(user, Arc::new(key))
                .await
                .map_err(ConnectError::Other)
        }
        AUTH_TYPE_PRIVATE_KEY_FILE => {
            if params.options.private_key_path.trim().is_empty() {
                return Err(ConnectError::PrivateKeyPathRequired);
            }
            let key = russh_keys::load_secret_key(
                expand_home_path(&params.options.private_key_path),
                optional_passphrase(params.options.passphrase.as_str()),
            )?;
            handle
                .authenticate_publickey(user, Arc::new(key))
                .await
                .map_err(ConnectError::Other)
        }
        other => Err(ConnectError::UnsupportedAuthType(other.to_string())),
    }
}

fn host_key_rejected_error(host: &str, port: u16) -> ConnectError {
    let (fingerprint, algorithm, reason) = super::hostkey::peek_rejected(host, port)
        .unwrap_or_else(|| {
            (
                String::new(),
                String::new(),
                "unknown".to_string(),
            )
        });
    ConnectError::HostKeyRejected {
        host: host.to_string(),
        port,
        fingerprint,
        algorithm,
        reason,
    }
}

/// authenticate_password_or_kbdint 先试 password，失败再走 keyboard-interactive（许多堡垒机只开后者）。
async fn authenticate_password_or_kbdint(
    handle: &mut client::Handle<SshClientHandler>,
    user: &str,
    secret: &str,
) -> Result<bool, ConnectError> {
    if handle
        .authenticate_password(user, secret)
        .await
        .map_err(ConnectError::Other)?
    {
        return Ok(true);
    }
    if secret.is_empty() {
        return Ok(false);
    }
    authenticate_keyboard_interactive(handle, user, secret).await
}

/// authenticate_keyboard_interactive 用已存口令回答 echo=false 的提示（Password: 等）。
/// 多轮 OTP 等 echo=true / 额外提示暂不弹窗，填空后由服务端拒绝。
async fn authenticate_keyboard_interactive(
    handle: &mut client::Handle<SshClientHandler>,
    user: &str,
    secret: &str,
) -> Result<bool, ConnectError> {
    use russh::client::KeyboardInteractiveAuthResponse;

    let mut reply = handle
        .authenticate_keyboard_interactive_start(user, None::<String>)
        .await
        .map_err(ConnectError::Other)?;
    for _ in 0..KBDINT_MAX_ROUNDS {
        match reply {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let responses: Vec<String> = prompts
                    .iter()
                    .map(|prompt| {
                        if prompt.echo {
                            String::new()
                        } else {
                            secret.to_string()
                        }
                    })
                    .collect();
                reply = handle
                    .authenticate_keyboard_interactive_respond(responses)
                    .await
                    .map_err(ConnectError::Other)?;
            }
        }
    }
    Ok(false)
}

fn optional_passphrase(passphrase: &str) -> Option<&str> {
    let trimmed = passphrase.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn decode_private_key(secret: &str, passphrase: &str) -> Result<KeyPair, russh_keys::Error> {
    russh_keys::decode_secret_key(secret, optional_passphrase(passphrase))
}

fn expand_home_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed == "~" {
        return std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| trimmed.to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            return format!("{home}/{rest}");
        }
    }
    trimmed.to_string()
}

/// max_file_read_size 是在线读取文件内容的最大字节数（10 MiB）。
pub const MAX_FILE_READ_SIZE: usize = 10 * 1024 * 1024;
