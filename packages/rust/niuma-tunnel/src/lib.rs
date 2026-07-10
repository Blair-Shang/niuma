use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use russh::client;
use russh_keys::key::KeyPair;
use serde::Deserialize;
use thiserror::Error;
use tokio::io;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

const DEFAULT_SSH_PORT: u16 = 22;
const DEFAULT_SSH_TIMEOUT_SECS: u64 = 30;
const AUTH_TYPE_PASSWORD: &str = "password";
const AUTH_TYPE_PRIVATE_KEY: &str = "private_key";
const AUTH_TYPE_PRIVATE_KEY_FILE: &str = "private_key_file";

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TunnelOptions {
    #[serde(rename = "type", default)]
    pub tunnel_type: String,
    #[serde(rename = "sshProfileId", default)]
    pub ssh_profile_id: String,
    #[serde(rename = "targetHost", default)]
    pub target_host: String,
    #[serde(rename = "targetPort", default)]
    pub target_port: u16,
    #[serde(rename = "sshProfile", default)]
    pub ssh_profile: Option<SshTunnelProfile>,
}

impl TunnelOptions {
    pub fn enabled(&self) -> bool {
        self.tunnel_type == "ssh"
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SshTunnelProfile {
    #[serde(rename = "hostAddress")]
    pub host_address: String,
    #[serde(rename = "portNumber", default)]
    pub port_number: u16,
    #[serde(rename = "loginAccount")]
    pub login_account: String,
    /// 认证凭据（密码或私钥内容）；新字段名为 `secret`，兼容历史 `password`。
    #[serde(alias = "password", default)]
    pub secret: String,
    #[serde(default)]
    pub options: SshTunnelConnectOptions,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SshTunnelConnectOptions {
    #[serde(rename = "timeout_seconds", default)]
    pub timeout_seconds: u64,
    #[serde(rename = "auth_type", default = "default_auth_type")]
    pub auth_type: String,
    #[serde(rename = "private_key_path", default)]
    pub private_key_path: String,
    #[serde(default)]
    pub passphrase: String,
    #[serde(default)]
    pub proxy: niuma_netproxy::Options,
}

#[derive(Debug, Error)]
pub enum TunnelError {
    #[error("tunnel: ssh profile was not injected")]
    MissingProfile,
    #[error("tunnel: ssh profile host required")]
    MissingHost,
    #[error("tunnel: ssh auth failed for {user}@{host}")]
    AuthFailed { user: String, host: String },
    #[error("tunnel: ssh private key required")]
    PrivateKeyRequired,
    #[error("tunnel: ssh private key path required")]
    PrivateKeyPathRequired,
    #[error("tunnel: unsupported ssh auth type: {0}")]
    UnsupportedAuthType(String),
    #[error("tunnel: io: {0}")]
    Io(#[from] std::io::Error),
    #[error("tunnel: proxy: {0}")]
    NetProxy(#[from] niuma_netproxy::Error),
    #[error("tunnel: ssh: {0}")]
    Ssh(#[from] russh::Error),
    #[error("tunnel: private key: {0}")]
    Key(#[from] russh_keys::Error),
}

pub struct TunnelGuard {
    task: JoinHandle<()>,
}

impl Drop for TunnelGuard {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct SshClientHandler;

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

pub async fn start_ssh_tunnel(
    tunnel: &TunnelOptions,
    default_target_host: &str,
    default_target_port: u16,
) -> Result<(String, u16, TunnelGuard), TunnelError> {
    let profile = tunnel.ssh_profile.as_ref().ok_or(TunnelError::MissingProfile)?;
    if profile.host_address.trim().is_empty() {
        return Err(TunnelError::MissingHost);
    }
    let target_host = if tunnel.target_host.trim().is_empty() {
        default_target_host.to_string()
    } else {
        tunnel.target_host.trim().to_string()
    };
    let target_port = if tunnel.target_port == 0 {
        default_target_port
    } else {
        tunnel.target_port
    };
    let handle = Arc::new(Mutex::new(connect_ssh(profile).await?));
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let local_port = listener.local_addr()?.port();
    let task = tokio::spawn(async move {
        while let Ok((local, _)) = listener.accept().await {
            let handle = Arc::clone(&handle);
            let target_host = target_host.clone();
            tokio::spawn(async move {
                if let Ok(channel) = handle
                    .lock()
                    .await
                    .channel_open_direct_tcpip(target_host, target_port as u32, "127.0.0.1", 0)
                    .await
                {
                    let mut channel_stream = channel.into_stream();
                    let mut local = local;
                    let _ = io::copy_bidirectional(&mut local, &mut channel_stream).await;
                }
            });
        }
    });
    Ok(("127.0.0.1".to_string(), local_port, TunnelGuard { task }))
}

async fn connect_ssh(profile: &SshTunnelProfile) -> Result<client::Handle<SshClientHandler>, TunnelError> {
    let config = Arc::new(client::Config::default());
    let host = profile.host_address.clone();
    let port = if profile.port_number == 0 {
        DEFAULT_SSH_PORT
    } else {
        profile.port_number
    };
    let socket = tokio::time::timeout(
        ssh_timeout(&profile.options),
        niuma_netproxy::dial_tcp(&profile.options.proxy, &host, port),
    )
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "ssh tunnel connect timed out"))??;
    let mut handle = client::connect_stream(config, socket, SshClientHandler).await?;
    let user = profile.login_account.clone();
    let auth_ok = authenticate(&mut handle, &user, profile).await?;
    if !auth_ok {
        return Err(TunnelError::AuthFailed { user, host });
    }
    Ok(handle)
}

async fn authenticate(
    handle: &mut client::Handle<SshClientHandler>,
    user: &str,
    profile: &SshTunnelProfile,
) -> Result<bool, TunnelError> {
    match profile.options.auth_type.as_str() {
        "" | AUTH_TYPE_PASSWORD => Ok(handle.authenticate_password(user, &profile.secret).await?),
        AUTH_TYPE_PRIVATE_KEY => {
            if profile.secret.trim().is_empty() {
                return Err(TunnelError::PrivateKeyRequired);
            }
            let key = decode_private_key(&profile.secret, &profile.options.passphrase)?;
            Ok(handle.authenticate_publickey(user, Arc::new(key)).await?)
        }
        AUTH_TYPE_PRIVATE_KEY_FILE => {
            if profile.options.private_key_path.trim().is_empty() {
                return Err(TunnelError::PrivateKeyPathRequired);
            }
            let key = russh_keys::load_secret_key(
                expand_home_path(&profile.options.private_key_path),
                optional_passphrase(&profile.options.passphrase),
            )?;
            Ok(handle.authenticate_publickey(user, Arc::new(key)).await?)
        }
        other => Err(TunnelError::UnsupportedAuthType(other.to_string())),
    }
}

fn default_auth_type() -> String {
    AUTH_TYPE_PASSWORD.to_string()
}

fn ssh_timeout(options: &SshTunnelConnectOptions) -> Duration {
    Duration::from_secs(if options.timeout_seconds == 0 {
        DEFAULT_SSH_TIMEOUT_SECS
    } else {
        options.timeout_seconds
    })
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
