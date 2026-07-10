//! 建立 Redis 连接（standalone / sentinel / cluster）。

use redis::aio::ConnectionManager;
use redis::cluster::ClusterClient;
use redis::cluster_async::ClusterConnection;
use redis::{ConnectionAddr, ConnectionInfo, IntoConnectionInfo, RedisConnectionInfo};
use serde::Deserialize;
use thiserror::Error;

use niuma_netproxy::{start_relay, RelayGuard};
use niuma_tunnel::{start_ssh_tunnel, TunnelError, TunnelGuard, TunnelOptions};

/// default_dial_timeout 是 Redis 建连默认超时（10 秒）。
const DEFAULT_DIAL_TIMEOUT_SECS: u64 = 10;
/// default_redis_port 是 Redis 默认端口。
const DEFAULT_REDIS_PORT: u16 = 6379;
/// 拓扑为 sentinel 时，逐个探测哨兵节点的默认超时（5 秒）。
const SENTINEL_PROBE_TIMEOUT_SECS: u64 = 5;

/// ConnectParams 是建连参数（含明文密码，仅进程内使用）。
///
/// 字段形状与 platform-core `capability_proxy.go` 的凭据注入信封严格对齐：无论是通过
/// `profileId` 查库注入，还是新建站点时的内联测试，platform 转发过来的顶层字段固定为
/// `hostAddress`/`portNumber`/`loginAccount`/`password`/`options`（`options` 即
/// `connection_options` JSON 整段透传，platform 不会按 connectionKind 展开任何字段）。
/// 因此 Redis 专属的 `database`/`topology`/`sentinelMasterName`/`nodes` 都放进嵌套的
/// `options` 里而不是顶层，这样新增 redis connectionKind 不需要改动 Go 侧代码。
#[derive(Debug, Clone, Deserialize)]
pub struct ConnectParams {
    #[serde(rename = "hostAddress")]
    pub host_address: String,
    #[serde(rename = "portNumber", default)]
    pub port_number: u16,
    /// platform 统一信封字段名为 `loginAccount`（FTP/SSH 共用），Redis 语义上称为
    /// `username`；用 `alias` 同时接受两种命名。
    #[serde(alias = "loginAccount", default)]
    pub username: String,
    /// 认证凭据；新信封字段名为 `secret`，兼容历史 `password`。
    #[serde(alias = "password", default)]
    pub secret: String,
    #[serde(default)]
    pub options: ConnectOptions,
}

/// ConnectOptions 与 Web connection_options JSON 对齐。
#[derive(Debug, Clone, Deserialize)]
pub struct ConnectOptions {
    /// Redis 逻辑库编号（0-15，standalone/sentinel 有效；cluster 恒为 0）。
    #[serde(default)]
    pub database: i64,
    /// "standalone" | "sentinel" | "cluster"，默认为 standalone。
    #[serde(default = "default_topology")]
    pub topology: String,
    #[serde(rename = "timeout_seconds", alias = "timeoutSeconds", default = "default_timeout_seconds")]
    pub timeout_seconds: u64,
    /// sentinel 拓扑下的主节点名（对应 `SENTINEL GET-MASTER-ADDR-BY-NAME`）。
    #[serde(rename = "sentinel_master_name", alias = "sentinelMasterName", default)]
    pub sentinel_master_name: String,
    /// 额外种子节点（`host:port`），补充 `hostAddress:portNumber`，用于 sentinel/cluster 拓扑。
    #[serde(default)]
    pub nodes: Vec<String>,
    #[serde(default)]
    pub tunnel: TunnelOptions,
    /// 直连 SOCKS5/HTTP 代理（与 `tunnel` 互斥：两者都启用时优先走 SSH 隧道）。
    #[serde(default)]
    pub proxy: niuma_netproxy::Options,
}

impl Default for ConnectOptions {
    fn default() -> Self {
        Self {
            database: 0,
            topology: default_topology(),
            timeout_seconds: default_timeout_seconds(),
            sentinel_master_name: String::new(),
            nodes: Vec::new(),
            tunnel: TunnelOptions::default(),
            proxy: niuma_netproxy::Options::default(),
        }
    }
}

fn default_topology() -> String {
    "standalone".to_string()
}

fn default_timeout_seconds() -> u64 {
    DEFAULT_DIAL_TIMEOUT_SECS
}

impl ConnectParams {
    pub fn port_or_default(&self) -> u16 {
        if self.port_number == 0 {
            DEFAULT_REDIS_PORT
        } else {
            self.port_number
        }
    }

    pub fn dial_timeout(&self) -> std::time::Duration {
        let secs = if self.options.timeout_seconds == 0 {
            DEFAULT_DIAL_TIMEOUT_SECS
        } else {
            self.options.timeout_seconds
        };
        std::time::Duration::from_secs(secs)
    }

    /// seed_nodes 返回 `host:port` 种子节点列表：主机地址在前，`options.nodes` 补充在后。
    fn seed_nodes(&self) -> Vec<(String, u16)> {
        let mut nodes = vec![(self.host_address.clone(), self.port_or_default())];
        for node in &self.options.nodes {
            if let Some((host, port)) = split_host_port(node) {
                nodes.push((host, port));
            }
        }
        nodes
    }

    fn redis_connection_info(&self, database: i64) -> RedisConnectionInfo {
        let mut info = RedisConnectionInfo::default().set_db(database);
        if !self.username.is_empty() {
            info = info.set_username(&self.username);
        }
        if !self.secret.is_empty() {
            info = info.set_password(&self.secret);
        }
        info
    }
}

/// split_host_port 把 `host:port` 拆分为 `(host, port)`；缺省端口回落到 Redis 默认端口。
fn split_host_port(node: &str) -> Option<(String, u16)> {
    let trimmed = node.trim();
    if trimmed.is_empty() {
        return None;
    }
    match trimmed.rsplit_once(':') {
        Some((host, port_str)) => {
            let port: u16 = port_str.trim().parse().unwrap_or(DEFAULT_REDIS_PORT);
            Some((host.trim().to_string(), port))
        }
        None => Some((trimmed.to_string(), DEFAULT_REDIS_PORT)),
    }
}

#[derive(Debug, Error)]
pub enum ConnectError {
    #[error("redis: connect {host}:{port}: {source}")]
    Dial {
        host: String,
        port: u16,
        source: redis::RedisError,
    },
    #[error("redis: sentinel {0}")]
    Sentinel(String),
    #[error("redis: unsupported topology {0:?}")]
    UnsupportedTopology(String),
    #[error("redis: ssh tunnel is only supported for standalone topology")]
    TunnelUnsupportedTopology,
    #[error("{0}")]
    Tunnel(#[from] TunnelError),
    #[error("redis: direct proxy is only supported for standalone topology")]
    ProxyUnsupportedTopology,
    #[error("redis: proxy: {0}")]
    Proxy(#[from] niuma_netproxy::Error),
    #[error("redis: {0}")]
    Other(#[from] redis::RedisError),
}

/// RedisBackend 统一封装 standalone（含 sentinel 解析后的主节点）与 cluster 两种后端连接。
///
/// `ConnectionManager` 内建自动重连，`ClusterConnection` 自身也会在拓扑变化或节点失联时
/// 自动重连，因此两个分支都不需要额外的心跳/重试逻辑。
pub enum RedisBackend {
    Standalone(ConnectionManager),
    Cluster(ClusterConnection),
}

impl RedisBackend {
    /// exec_raw 执行一条任意 Redis 命令并返回原始 `redis::Value`。
    ///
    /// `args` 为已切分好的二进制安全参数（不做命令行解析/引号处理，由调用方负责切分）。
    pub async fn exec_raw(&mut self, name: &str, args: &[Vec<u8>]) -> redis::RedisResult<redis::Value> {
        let mut cmd = redis::cmd(name);
        for arg in args {
            cmd.arg(arg);
        }
        match self {
            RedisBackend::Standalone(conn) => cmd.query_async(conn).await,
            RedisBackend::Cluster(conn) => cmd.query_async(conn).await,
        }
    }

    /// ping 发送 `PING` 以验证连接仍然可用。
    pub async fn ping(&mut self) -> redis::RedisResult<()> {
        self.exec_raw("PING", &[]).await.map(|_| ())
    }
}

/// Connected 是一次成功建连的结果：既包含可执行命令的后端句柄，也包含（若适用）解析出的
/// 单节点连接信息，供后续按需打开专用连接（如 `MONITOR` 流）复用同一组认证凭据。
pub struct Connected {
    pub backend: RedisBackend,
    pub _tunnel: Option<TunnelGuard>,
    /// 直连代理转发任务句柄；与 `_tunnel` 互斥，仅其中一个会为 `Some`。两者都只是"保活
    /// 句柄"——被丢弃时会话背后的本地转发/隧道就会终止，因此必须和 `backend` 存活周期一致
    /// （由 `SessionEntry` 持有），不能在 `connect_redis` 返回后立即释放。
    pub _proxy_relay: Option<RelayGuard>,
    /// standalone / sentinel 拓扑下为已解析的目标节点连接信息；cluster 拓扑下为 `None`
    /// （`MONITOR` 语义上是单节点操作，v1 暂不支持对整个集群做流式监控）。
    pub node_info: Option<ConnectionInfo>,
}

fn build_connection_info(host: &str, port: u16, redis_info: RedisConnectionInfo) -> Result<ConnectionInfo, ConnectError> {
    let info = ConnectionAddr::Tcp(host.to_string(), port)
        .into_connection_info()?
        .set_redis_settings(redis_info);
    Ok(info)
}

/// connect_redis 根据拓扑建立已就绪的 Redis 连接。
///
/// `tunnel`（SSH 跳板机隧道）与 `proxy`（直连 SOCKS5/HTTP 代理）在语义上互斥：都配置时优先
/// 使用隧道。两者当前都只支持 standalone 拓扑——sentinel 需要先探测多个哨兵节点、cluster
/// 需要连接多个分片节点，逐节点转发的复杂度和收益都不匹配 v1 的需求。
pub async fn connect_redis(params: &ConnectParams) -> Result<Connected, ConnectError> {
    if params.options.tunnel.enabled() {
        if params.options.topology.as_str() != "standalone" && !params.options.topology.is_empty() {
            return Err(ConnectError::TunnelUnsupportedTopology);
        }
        let target_host = params.host_address.clone();
        let target_port = params.port_or_default();
        let (local_host, local_port, guard) =
            start_ssh_tunnel(&params.options.tunnel, &target_host, target_port).await?;
        return connect_standalone(params, &local_host, local_port, Some(guard), None).await;
    }
    if params.options.proxy.enabled() {
        if params.options.topology.as_str() != "standalone" && !params.options.topology.is_empty() {
            return Err(ConnectError::ProxyUnsupportedTopology);
        }
        let target_host = params.host_address.clone();
        let target_port = params.port_or_default();
        let (local_host, local_port, guard) =
            start_relay(params.options.proxy.clone(), target_host, target_port).await?;
        return connect_standalone(params, &local_host, local_port, None, Some(guard)).await;
    }
    match params.options.topology.as_str() {
        "standalone" | "" => connect_standalone(params, &params.host_address, params.port_or_default(), None, None).await,
        "sentinel" => connect_sentinel(params).await,
        "cluster" => connect_cluster(params).await,
        other => Err(ConnectError::UnsupportedTopology(other.to_string())),
    }
}

async fn connect_standalone(
    params: &ConnectParams,
    host: &str,
    port: u16,
    tunnel: Option<TunnelGuard>,
    proxy_relay: Option<RelayGuard>,
) -> Result<Connected, ConnectError> {
    let redis_info = params.redis_connection_info(params.options.database);
    let info = build_connection_info(host, port, redis_info)?;
    let client = redis::Client::open(info.clone()).map_err(|e| ConnectError::Dial {
        host: host.to_string(),
        port,
        source: e,
    })?;
    let manager = tokio::time::timeout(params.dial_timeout(), client.get_connection_manager())
        .await
        .map_err(|_| ConnectError::Dial {
            host: host.to_string(),
            port,
            source: redis::RedisError::from(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "connect timed out",
            )),
        })?
        .map_err(|e| ConnectError::Dial {
            host: host.to_string(),
            port,
            source: e,
        })?;
    Ok(Connected {
        backend: RedisBackend::Standalone(manager),
        _tunnel: tunnel,
        _proxy_relay: proxy_relay,
        node_info: Some(info),
    })
}

async fn connect_cluster(params: &ConnectParams) -> Result<Connected, ConnectError> {
    let redis_info = params.redis_connection_info(0);
    let seeds = params.seed_nodes();
    let mut infos = Vec::with_capacity(seeds.len());
    for (host, port) in seeds {
        infos.push(build_connection_info(&host, port, redis_info.clone())?);
    }
    let client = ClusterClient::new(infos)?;
    let conn = tokio::time::timeout(params.dial_timeout(), client.get_async_connection())
        .await
        .map_err(|_| ConnectError::Dial {
            host: params.host_address.clone(),
            port: params.port_or_default(),
            source: redis::RedisError::from(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "connect timed out",
            )),
        })??;
    Ok(Connected {
        backend: RedisBackend::Cluster(conn),
        _tunnel: None,
        _proxy_relay: None,
        node_info: None,
    })
}

/// connect_sentinel 先向哨兵节点询问当前主节点地址，再以 standalone 方式连接该主节点。
///
/// 不依赖 `redis` crate 的 `sentinel` feature：`SENTINEL GET-MASTER-ADDR-BY-NAME` 是一条
/// 普通命令，通过任意一个哨兵节点的 standalone 连接即可发出，减少一个可选 feature 的编译面。
async fn connect_sentinel(params: &ConnectParams) -> Result<Connected, ConnectError> {
    if params.options.sentinel_master_name.is_empty() {
        return Err(ConnectError::Sentinel(
            "sentinel_master_name required for sentinel topology".to_string(),
        ));
    }
    let mut last_error = ConnectError::Sentinel("no sentinel node reachable".to_string());
    for (host, port) in params.seed_nodes() {
        match probe_sentinel_master(&host, port, &params.options.sentinel_master_name).await {
            Ok((master_host, master_port)) => {
                return connect_standalone(params, &master_host, master_port, None, None).await;
            }
            Err(err) => last_error = err,
        }
    }
    Err(last_error)
}

/// probe_sentinel_master 向单个哨兵节点查询主节点地址。
async fn probe_sentinel_master(
    host: &str,
    port: u16,
    master_name: &str,
) -> Result<(String, u16), ConnectError> {
    let info = build_connection_info(host, port, RedisConnectionInfo::default())?;
    let client = redis::Client::open(info)?;
    let connect_fut = client.get_multiplexed_async_connection();
    let mut conn = tokio::time::timeout(
        std::time::Duration::from_secs(SENTINEL_PROBE_TIMEOUT_SECS),
        connect_fut,
    )
    .await
    .map_err(|_| ConnectError::Sentinel(format!("probe {host}:{port} timed out")))??;

    let reply: Vec<String> = redis::cmd("SENTINEL")
        .arg("GET-MASTER-ADDR-BY-NAME")
        .arg(master_name)
        .query_async(&mut conn)
        .await
        .map_err(|e| ConnectError::Sentinel(format!("{host}:{port}: {e}")))?;
    if reply.len() < 2 {
        return Err(ConnectError::Sentinel(format!(
            "{host}:{port}: master {master_name:?} not found"
        )));
    }
    let master_host = reply[0].clone();
    let master_port: u16 = reply[1]
        .parse()
        .map_err(|_| ConnectError::Sentinel(format!("{host}:{port}: invalid master port {:?}", reply[1])))?;
    Ok((master_host, master_port))
}
