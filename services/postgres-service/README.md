# postgres-service（Go + jackc/pgx/v5）

Layer-1 官方 PostgreSQL 能力服务。设计见 [docs/34-postgresql-module.md](../../docs/34-postgresql-module.md)。

与金仓 / Vastbase 对照：线协议同为 PG wire，但 **独立进程 / 独立 kind / 独立实现**。Probe 拒绝 KingbaseES、Vastbase、openGauss 等分叉。与 Oracle 对照：本服务走 **纯 Go pgx**，无旁载 libpq / JVM。

## 依赖

| 组件 | 位置 | 说明 |
|------|------|------|
| **jackc/pgx/v5** | `go.mod` | PG 线协议事实标准；池化 / 取消 / COPY |
| **niuma/pkg/serviceipc** | `packages/go/serviceipc` | length-prefixed JSON IPC（Pipe / UDS） |
| **niuma/pkg/sqllsp** | `packages/go/sqllsp` | Bridge 隧道 LSP 框架 |
| **niuma/pkg/tunnel** / **netproxy** | `packages/go/*` | SSH 隧道 / 代理（无引擎语义） |
| **niuma/pkg/logutil** / **common** | `packages/go/*` | 日志与公共工具 |

构建约定：`CGO_ENABLED=0`。驱动**仅**出现在本服务 `go.mod`，不进入 platform-core。

## 本地 PostgreSQL（Docker）

```bash
docker compose -f services/postgres-service/docker-compose.yml up -d
docker compose -f services/postgres-service/docker-compose.yml logs -f
# 看到 database system is ready to accept connections 后即可连接
```

| 项 | 值 |
|----|-----|
| Host | 本机用 `127.0.0.1`（勿用会解析到 IPv6 的 `localhost`） |
| Port | `65432`（容器内仍为 5432） |
| Database | `postgres` |
| Login | `postgres` |
| Password | `postgres` |
| SSL | `disable`（联调） |

停止：`docker compose -f services/postgres-service/docker-compose.yml down`（加 `-v` 会清数据卷）。

## 构建

```powershell
# 随整仓服务一起编（推荐）
.\scripts\shared\build\build-services.ps1

# 或仅本模块
Push-Location services/postgres-service
$env:CGO_ENABLED = '0'
go build -o ..\bin\niuma-postgres-service.exe ./cmd/postgres-service
Pop-Location
```

产物：

- 矩阵目录：`services/bin/windows-x64/niuma-postgres-service.exe`（供 `stage-services` / `dev:hot` 拷贝）
- 兼容平铺：`services/bin/niuma-postgres-service.exe`（本机 Windows）

## IPC

- Windows：`\\.\pipe\niuma.postgres`
- Unix：`/tmp/niuma.postgres.sock`
- 帧：4 字节小端长度 + UTF-8 JSON
- manifest：`services/manifests/postgres-service.yaml`
- Bridge 命名空间：`postgres`（platform 剥前缀后 method 为 `session.open` 等）
- Dialect `family`：`postgresql`（与 kind `postgres` 区分：kind 是连接类型，family 是产品方言）

## 工程布局

```
services/postgres-service/
├── README.md
├── docker-compose.yml
├── go.mod
├── cmd/postgres-service/main.go
└── internal/
    ├── dialect/           # Probe / Cap / ServerProfile
    ├── session/           # 连接、池、query、事务、结果集
    ├── tree/              # databases / schemas / tables / routines / …
    ├── meta/              # columns / indexes / ddl / activity
    ├── ddl/               # 白名单脚本 / 表设计器
    ├── dataio/            # COPY / dump / execSqlFile
    ├── handler/           # IPC 分发
    ├── postgresparser/    # SQL 启发式词法（LSP）
    ├── eventpub/
    └── idgen/
```

## 红线（摘要）

1. **禁止**与 `vastbase-service` / `kingbase-service` 或其它 `*-service` 混用实现。  
2. **禁止**用 `family: "vastbase"` / `"kingbase"` 冒充原生 PostgreSQL。  
3. **禁止** Java / JDBC / libpq CGO 作为默认路径。  
4. **禁止**对树节点默认全表 `COUNT(*)`。  
5. 外部 `pg_dump` / `psql` 走 [20 — 工具组件](../../docs/20-tool-components.md) 的 `postgresql-client`，不编进 platform。

完整契约、Cap 表、分期与 Web 接线见 [docs/34-postgresql-module.md](../../docs/34-postgresql-module.md)。
