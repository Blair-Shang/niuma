# sqlserver-service（Go + microsoft/go-mssqldb）

Layer-1 Microsoft SQL Server / Azure SQL 能力服务。设计见 [docs/32-sqlserver-module.md](../../docs/32-sqlserver-module.md)。

与 Oracle 模块对照：Oracle 走 **C++ + ODPI-C + Instant Client**（[oracle-service/README.md](../oracle-service/README.md)）；本服务走 **纯 Go TDS 驱动**，**无**旁载 Native Client / ODBC / .NET 运行时。

## 依赖

| 组件 | 位置 | 说明 |
|------|------|------|
| **microsoft/go-mssqldb** | `go.mod` | 微软维护的纯 Go TDS 驱动；`database/sql` |
| **niuma/pkg/serviceipc** | `packages/go/serviceipc` | length-prefixed JSON IPC（Pipe / UDS） |
| **niuma/pkg/sqllsp** | `packages/go/sqllsp` | Bridge 隧道 LSP 框架 |
| **niuma/pkg/tunnel** / **netproxy** | `packages/go/*` | SSH 隧道 / 代理（无引擎语义） |
| **niuma/pkg/logutil** / **common** | `packages/go/*` | 日志与公共工具 |

构建约定：`CGO_ENABLED=0`。驱动**仅**出现在本服务 `go.mod`，不进入 platform-core。

## 本地 / Linux 服务器 SQL Server（Docker）

远端库常有权限 / 审计限制，不适合测 DDL。本目录提供 `docker-compose.yml`（官方 `mssql/server:2022`，**仅 linux/amd64**）：

```bash
# 主机：uname -m 应为 x86_64；free -h 建议可用 ≥ 4GB
docker compose -f services/sqlserver-service/docker-compose.yml pull
docker compose -f services/sqlserver-service/docker-compose.yml up -d
docker compose -f services/sqlserver-service/docker-compose.yml logs -f
# 看到 SQL Server is now ready for client connections 后即可连接
```

| 项 | 值 |
|----|-----|
| Host | 本机用 `127.0.0.1`；远程用服务器 IP（勿用会解析到 IPv6 的 `localhost`） |
| Port | `61433`（容器内仍为 1433） |
| Database | `master`（或自建库） |
| Login | `sa` |
| Password | `Your_strong_Passw0rd` |
| Auth | SQL 认证（`auth_type: sql`） |
| Encrypt | `disable`（联调） |
| Trust Server Certificate | `true` |

P0 仅保证 **SQL 认证**；Windows / AAD 认证见文档分期（P2+）。

容器内快速自检（若镜像含 sqlcmd）：

```bash
docker exec -it niuma-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'Your_strong_Passw0rd' -C \
  -Q "SELECT @@VERSION"
```

主机可用内存建议 **≥ 4GB**（compose：`mem_limit: 3g`，`MSSQL_MEMORY_LIMIT_MB=2048`）。停止：`docker compose -f services/sqlserver-service/docker-compose.yml down`（加 `-v` 会清数据卷）。

若日志出现 `Capturing core dump` / `/proc/... Permission denied` 后容器反复退出（dump 段可忽略，看更早的 fatal error）：

```bash
# 1) 架构 / 内存
uname -m && free -h
# 2) 清损坏卷 + 拉新镜像重建
docker compose -f services/sqlserver-service/docker-compose.yml down -v
docker compose -f services/sqlserver-service/docker-compose.yml pull
docker compose -f services/sqlserver-service/docker-compose.yml up -d
docker logs niuma-sqlserver 2>&1 | head -n 80
```

`arm64` 主机不要用本镜像（需换 Azure SQL Edge 等，本仓库联调路径未覆盖）。

## 构建

```powershell
# 随整仓服务一起编（推荐）
.\scripts\shared\build\build-services.ps1

# 或仅本模块
Push-Location services/sqlserver-service
$env:CGO_ENABLED = '0'
go build -o ..\bin\niuma-sqlserver-service.exe ./cmd/sqlserver-service
Pop-Location
```

产物：

- 矩阵目录：`services/bin/windows-x64/niuma-sqlserver-service.exe`（供 `stage-services` / `dev:hot` 拷贝）
- 兼容平铺：`services/bin/niuma-sqlserver-service.exe`（本机 Windows）

`build-services.ps1` / `pnpm dev:hot` 默认编入本服务（Go，无额外本机 SDK）。

## IPC

- Windows：`\\.\pipe\niuma.sqlserver`
- Unix：`/tmp/niuma.sqlserver.sock`
- 帧：4 字节小端长度 + UTF-8 JSON（与其它 Go / C++ 能力服务一致）
- manifest：`services/manifests/sqlserver-service.yaml`
- Bridge 命名空间：`sqlserver`（platform 剥前缀后 method 为 `session.open` 等）

已落地方法：

| 组 | 方法 |
|----|------|
| 会话 | `session.open` / `session.close` / `session.test` |
| 查询 | `query.exec` / `query.fetch` / `query.close` / `query.cancel` |
| 例程 | `routine.call`（过程 TDS RPC / 函数绑定 SELECT；OUTPUT 与返回值走协议，不走 `query.exec`） |
| 树 | `tree.databases` / `tree.schemas` / `tree.tables` / `tree.routines` / `tree.sequences` / `tree.categoryCounts` |
| LSP | `lsp.open` / `lsp.rpc` / `lsp.close` / `lsp.lexicon` |

`GO` 批分隔符只在 Web / 编排层按 Cap `split.go_batches` 拆批；**禁止**把客户端 `GO` 行发给服务器。

## 连接参数（P0 常用）

与 Web `connection_options`（snake_case）对齐，详见 [docs/32](../../docs/32-sqlserver-module.md) §4：

| 字段 | 默认 / 说明 |
|------|-------------|
| host / port | port 默认 **1433**；本仓库 Docker 映射为 **61433** |
| instance | 命名实例（如 `SQLEXPRESS`）；可与显式 port 配合 |
| user / password | SQL 认证；Vault 注入；错误信息不含明文密码 |
| database | 初始库；空则不强制 `USE` |
| auth_type | P0：`sql` |
| encrypt | `optional` / `disable` / `mandatory` |
| trust_server_certificate | 本地开发常为 `true` |
| application_name | `NiuMa` |
| tunnel / proxy | 与其它能力服务同形 |

## 工程布局

```
services/sqlserver-service/
├── README.md
├── docker-compose.yml
├── go.mod
├── cmd/sqlserver-service/main.go
└── internal/
    ├── dialect/           # Probe / Cap / ServerProfile
    ├── session/           # 连接、池、query、结果集
    ├── tree/              # databases / schemas / tables / routines / …
    ├── handler/           # IPC 分发（session / query / tree / lsp）
    ├── sqlserverparser/   # T-SQL 启发式词法（LSP）
    ├── eventpub/
    └── idgen/

web/src/modules/sqlserver/ # Web 业务模块（独立 kind）
```

## 红线（摘要）

1. **禁止**与其它 `*-service` 混用实现或同进程 if 分流。  
2. **禁止**默认路径使用 JVM+JDBC、ODBC、捆绑 .NET。  
3. **禁止**把客户端 `GO` 发送给服务器。  
4. 新工具 / MCP 保持外部化（如 sqlcmd/bcp 走工具组件，不编进 platform）。

完整契约、Cap 表、分期与 Web 接线见 [docs/32-sqlserver-module.md](../../docs/32-sqlserver-module.md)。
