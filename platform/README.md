# Platform Core

Layer 2：**Go** 实现的业务中枢 — 插件注册、数据权限、模块访问、凭据、配置、审计、AI Orchestrator、SQLite 迁移执行。

> 语言决策见 [docs/architecture.md §7.1](../docs/architecture.md#71-platform-core-语言决策go)。
> 设计与协议细节见 [docs/11-platform-core.md](../docs/11-platform-core.md)。

## 技术栈

| 项 | 选择 |
|----|------|
| 语言 | **Go 1.22**（受 `modernc.org/sqlite` 版本约束，见下） |
| IPC（当前） | **命名管道 + 4 字节小端长度前缀 + UTF-8 JSON**（Windows）/ UDS（其他平台） |
| IPC（规划） | gRPC over Named Pipe / UDS，替换上面的过渡协议 |
| 本地库 | SQLite（`modernc.org/sqlite` v1.29.10，纯 Go，无 cgo） |
| 凭据 | OS Keychain 封装（规划） |
| 契约 | `proto/` Protobuf（gRPC 上线后） |

> **依赖版本说明**：`modernc.org/sqlite` 最新版（v1.53+）已要求 Go ≥ 1.25，与本仓
> `go 1.22` 基线冲突；故固定在支持 Go 1.22 的 `v1.29.10`（对应 `libc v1.49.3`、
> `golang.org/x/sys v0.19.0`）。升级 Go 基线后可放开到最新。

## 目录（已实现 = ✅，规划 = ○）

```
platform/
├── go.mod
├── cmd/
│   └── platform-core/       # ✅ 主入口 main.go：解析库路径 → 迁移 → 起服务
└── internal/
    ├── protocol/            # ✅ 报文分帧（长度前缀 + JSON）
    ├── server/              # ✅ 应用 IPC 服务端（命名管道 / UDS）
    ├── handler/             # ✅ 方法分发（platform.settings.*）
    ├── store/               # ✅ SQLite 仓储（nm_app_setting KV）
    ├── migrate/             # ✅ 执行内嵌 SQL 迁移（go:embed；copy_migrations.go 从 scripts/sql 生成）
    ├── auth/                # ○ 数据权限 · 模块访问
    ├── credential/          # ○ Keychain 读写
    ├── plugin/              # ○ 插件注册表
    └── orchestrator/        # ○ AI Tool 编排
```

## 已实现的方法

| method | 入参 | 结果对象 | 说明 |
|--------|------|----------|------|
| `platform.settings.get` | `{key}` | `{value: string \| null}` | 键不存在时 `value` 为 `null` |
| `platform.settings.set` | `{key, value}` | `{updated: true}` | UPSERT，刷新 `updated_at` |

契约来源：[web/src/api/settings.ts](../web/src/api/settings.ts)。

## 边界

- **做**：鉴权、SQLite、凭据、审计、调 Layer 1 服务
- **不做**：窗口/CEF（`shell/`）、具体 SSH/SQL 执行（`services/`）

## 数据库

- 规范：[docs/database-schema.md](../docs/database-schema.md)
- **SQL 唯一权威源**：[scripts/sql/sqlite/](../scripts/sql/sqlite/)（含 `.down.sql` 与 pg/mysql 方言）——改 SQL 只改这里
- **迁移内嵌副本**：[internal/migrate/sqlite/](./internal/migrate/sqlite/) 是**构建产物**（`copy_migrations.go` 生成 + `go:embed` 随二进制发布，自包含）；
  改权威源后执行 `go generate ./...` 同步，`sync_test.go` 校验漂移——**勿手工编辑**
- 用户库：`%LOCALAPPDATA%\NiuMa\data\niuma.db`（其他平台 `~/.niuma/data/niuma.db`）
- 迁移采用 WAL；已应用版本记录在 `nm_schema_migration`，整个流程幂等

## 构建 / 运行（Windows）

```powershell
cd platform
go mod tidy                                                   # 首次拉取依赖
go build -o ../services/bin/platform-core.exe ./cmd/platform-core
../services/bin/platform-core.exe                            # 直接运行（壳层会自动 spawn）
```

验证：

```powershell
go vet ./...
go test ./...           # 含真实命名管道 set→get 往返集成测试
```
