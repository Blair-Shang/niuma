use serde::Deserialize;
use std::net::{Ipv4Addr, SocketAddr};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{lookup_host, TcpListener, TcpStream};
use tokio::task::JoinHandle;

const PROXY_TYPE_NONE: &str = "none";
const PROXY_TYPE_HTTP: &str = "http";
const PROXY_TYPE_SOCKS4: &str = "socks4";
const PROXY_TYPE_SOCKS4A: &str = "socks4a";
const PROXY_TYPE_SOCKS5: &str = "socks5";
const DEFAULT_HTTP_PROXY_PORT: u16 = 8080;
const DEFAULT_SOCKS5_PROXY_PORT: u16 = 1080;
const HTTP_CONNECT_READ_LIMIT: usize = 16 * 1024;

#[derive(Debug, Error)]
pub enum Error {
    #[error("netproxy: io: {0}")]
    Io(#[from] std::io::Error),
    #[error("netproxy: unsupported type {0:?}")]
    UnsupportedType(String),
    #[error("netproxy: {0}")]
    Protocol(String),
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Options {
    #[serde(rename = "type", default)]
    pub proxy_type: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

impl Options {
    pub fn enabled(&self) -> bool {
        !matches!(self.proxy_type.as_str(), "" | PROXY_TYPE_NONE) && !self.host.trim().is_empty()
    }

    fn port_or_default(&self) -> u16 {
        if self.port != 0 {
            return self.port;
        }
        if self.proxy_type == PROXY_TYPE_HTTP {
            DEFAULT_HTTP_PROXY_PORT
        } else {
            DEFAULT_SOCKS5_PROXY_PORT
        }
    }
}

pub async fn dial_tcp(proxy: &Options, host: &str, port: u16) -> Result<TcpStream, Error> {
    if !proxy.enabled() {
        return TcpStream::connect((host, port)).await.map_err(Error::Io);
    }
    match proxy.proxy_type.as_str() {
        PROXY_TYPE_HTTP => dial_http_proxy(proxy, host, port).await,
        PROXY_TYPE_SOCKS4 => dial_socks4_proxy(proxy, host, port, false).await,
        PROXY_TYPE_SOCKS4A => dial_socks4_proxy(proxy, host, port, true).await,
        PROXY_TYPE_SOCKS5 => dial_socks5_proxy(proxy, host, port).await,
        other => Err(Error::UnsupportedType(other.to_string())),
    }
}

/// RelayGuard 持有本地转发监听任务的句柄；被丢弃时立即中止监听与所有已转发的连接，
/// 避免代理连接在会话关闭后继续占用本地端口与后端 TCP 连接。
pub struct RelayGuard {
    task: JoinHandle<()>,
}

impl Drop for RelayGuard {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// start_relay 在 `127.0.0.1` 上监听一个随机本地端口，把每一条到达该端口的连接经
/// `proxy` 转发到 `target_host:target_port`。
///
/// 用途：像 `redis` crate 这类不支持"自带 socket"的客户端库，其自身的 TCP 拨号逻辑无法
/// 感知 SOCKS5/HTTP 代理；让它改为连接本地转发端口，即可透明地经代理访问真实目标，无需
/// 修改客户端库本身。每条本地连接对应一次独立的代理握手，语义上与直接经代理拨号一致。
pub async fn start_relay(
    proxy: Options,
    target_host: String,
    target_port: u16,
) -> Result<(String, u16, RelayGuard), Error> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let local_port = listener.local_addr()?.port();
    let task = tokio::spawn(async move {
        loop {
            let (mut local, _) = match listener.accept().await {
                Ok(pair) => pair,
                Err(_) => break,
            };
            let proxy = proxy.clone();
            let target_host = target_host.clone();
            tokio::spawn(async move {
                if let Ok(mut upstream) = dial_tcp(&proxy, &target_host, target_port).await {
                    let _ = tokio::io::copy_bidirectional(&mut local, &mut upstream).await;
                }
            });
        }
    });
    Ok(("127.0.0.1".to_string(), local_port, RelayGuard { task }))
}

async fn dial_http_proxy(proxy: &Options, host: &str, port: u16) -> Result<TcpStream, Error> {
    let mut stream = TcpStream::connect((proxy.host.as_str(), proxy.port_or_default())).await?;
    let target = format!("{host}:{port}");
    let mut req = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if !proxy.username.is_empty() {
        let raw = format!("{}:{}", proxy.username, proxy.password);
        let encoded = base64_encode(raw.as_bytes());
        req.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
    }
    req.push_str("\r\n");
    stream.write_all(req.as_bytes()).await?;

    let mut buf = Vec::with_capacity(512);
    let mut one = [0_u8; 1];
    while !buf.ends_with(b"\r\n\r\n") {
        if buf.len() >= HTTP_CONNECT_READ_LIMIT {
            return Err(Error::Protocol("http CONNECT response too large".to_string()));
        }
        let n = stream.read(&mut one).await?;
        if n == 0 {
            return Err(Error::Protocol("http CONNECT closed by proxy".to_string()));
        }
        buf.push(one[0]);
    }
    let head = String::from_utf8_lossy(&buf);
    let status_ok = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .is_some_and(|code| code == "200");
    if !status_ok {
        let first = head.lines().next().unwrap_or("unknown status");
        return Err(Error::Protocol(format!("http CONNECT failed: {first}")));
    }
    Ok(stream)
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((input.len() + 2) / 3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

async fn dial_socks4_proxy(proxy: &Options, host: &str, port: u16, remote_dns: bool) -> Result<TcpStream, Error> {
    let mut stream = TcpStream::connect((proxy.host.as_str(), proxy.port_or_default())).await?;
    let mut req = Vec::with_capacity(10 + proxy.username.len() + host.len());
    req.push(0x04);
    req.push(0x01);
    req.extend_from_slice(&port.to_be_bytes());
    if remote_dns {
        req.extend_from_slice(&[0, 0, 0, 1]);
    } else {
        req.extend_from_slice(&resolve_socks4_ipv4(host, port).await?.octets());
    }
    req.extend_from_slice(proxy.username.as_bytes());
    req.push(0);
    if remote_dns {
        req.extend_from_slice(host.as_bytes());
        req.push(0);
    }
    stream.write_all(&req).await?;

    let mut resp = [0_u8; 8];
    stream.read_exact(&mut resp).await?;
    if resp[1] != 0x5a {
        return Err(Error::Protocol(format!("SOCKS4 connect failed: {}", resp[1])));
    }
    Ok(stream)
}

async fn resolve_socks4_ipv4(host: &str, port: u16) -> Result<Ipv4Addr, Error> {
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        return Ok(ip);
    }
    let addrs = lookup_host((host, port)).await?;
    for addr in addrs {
        if let SocketAddr::V4(v4) = addr {
            return Ok(*v4.ip());
        }
    }
    Err(Error::Protocol("SOCKS4 requires an IPv4 target; use SOCKS4a for remote DNS".to_string()))
}

async fn dial_socks5_proxy(proxy: &Options, host: &str, port: u16) -> Result<TcpStream, Error> {
    let mut stream = TcpStream::connect((proxy.host.as_str(), proxy.port_or_default())).await?;
    if proxy.username.is_empty() {
        stream.write_all(&[0x05, 0x01, 0x00]).await?;
    } else {
        stream.write_all(&[0x05, 0x01, 0x02]).await?;
    }

    let mut method = [0_u8; 2];
    stream.read_exact(&mut method).await?;
    if method[0] != 0x05 {
        return Err(Error::Protocol("invalid SOCKS5 version".to_string()));
    }
    match method[1] {
        0x00 => {}
        0x02 => socks5_auth(&mut stream, &proxy.username, &proxy.password).await?,
        0xff => return Err(Error::Protocol("SOCKS5 proxy rejected auth methods".to_string())),
        other => return Err(Error::Protocol(format!("unsupported SOCKS5 auth method {other}"))),
    }

    let host_bytes = host.as_bytes();
    if host_bytes.len() > u8::MAX as usize {
        return Err(Error::Protocol("SOCKS5 target host is too long".to_string()));
    }
    let mut req = Vec::with_capacity(host_bytes.len() + 7);
    req.extend_from_slice(&[0x05, 0x01, 0x00, 0x03, host_bytes.len() as u8]);
    req.extend_from_slice(host_bytes);
    req.extend_from_slice(&port.to_be_bytes());
    stream.write_all(&req).await?;

    let mut head = [0_u8; 4];
    stream.read_exact(&mut head).await?;
    if head[0] != 0x05 {
        return Err(Error::Protocol("invalid SOCKS5 response version".to_string()));
    }
    if head[1] != 0x00 {
        return Err(Error::Protocol(format!("SOCKS5 connect failed: {}", head[1])));
    }
    consume_socks5_bound_address(&mut stream, head[3]).await?;
    Ok(stream)
}

async fn socks5_auth(stream: &mut TcpStream, username: &str, password: &str) -> Result<(), Error> {
    let user = username.as_bytes();
    let pass = password.as_bytes();
    if user.len() > u8::MAX as usize || pass.len() > u8::MAX as usize {
        return Err(Error::Protocol("SOCKS5 username or password is too long".to_string()));
    }
    let mut req = Vec::with_capacity(user.len() + pass.len() + 3);
    req.push(0x01);
    req.push(user.len() as u8);
    req.extend_from_slice(user);
    req.push(pass.len() as u8);
    req.extend_from_slice(pass);
    stream.write_all(&req).await?;

    let mut resp = [0_u8; 2];
    stream.read_exact(&mut resp).await?;
    if resp != [0x01, 0x00] {
        return Err(Error::Protocol("SOCKS5 username/password auth failed".to_string()));
    }
    Ok(())
}

async fn consume_socks5_bound_address(stream: &mut TcpStream, atyp: u8) -> Result<(), Error> {
    match atyp {
        0x01 => {
            let mut rest = [0_u8; 6];
            stream.read_exact(&mut rest).await?;
        }
        0x03 => {
            let mut len = [0_u8; 1];
            stream.read_exact(&mut len).await?;
            let mut rest = vec![0_u8; len[0] as usize + 2];
            stream.read_exact(&mut rest).await?;
        }
        0x04 => {
            let mut rest = [0_u8; 18];
            stream.read_exact(&mut rest).await?;
        }
        other => return Err(Error::Protocol(format!("unsupported SOCKS5 address type {other}"))),
    }
    Ok(())
}
