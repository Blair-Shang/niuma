# 13 — 能力服务目录与工程布局

> Layer-1 能力服务独立于 `platform/`，按 manifest 注册、由 platform-core 懒拉起。

## 目录约定

```
services/
├── manifests/              # 服务注册（platform-core supervisor 读取）
│   ├── platform-core.yaml  # Layer 2 注册契约（com.niuma.platform）
│   └── ftp-service.yaml
├── bin/                    # 编译产物（git 忽略 *.exe，保留 .gitkeep）
│   ├── platform-core.exe
│   └── ftp-service.exe
├── ftp-service/            # 独立 Go 模块
│   ├── go.mod
│   ├── cmd/ftp-service/
│   └── internal/
├── vastbase-service/       # Vastbase（Go + pgx，见 docs/22）
│   ├── go.mod
│   ├── cmd/vastbase-service/
│   └── internal/             # handler · session · tree · meta · debug · eventpub · idgen
├── mysql-service/          # MySQL（见 docs/25）
├── sqlite-service/         # SQLite（modernc，见 docs/27）
│   ├── go.mod
│   ├── cmd/sqlite-service/
│   └── internal/             # dialect · session · tree · catalog · meta · ddl · dataio · backup
├── dameng-service/         # 达梦 DM8（官方纯 Go dm，见 docs/28）
│   ├── go.mod
│   ├── cmd/dameng-service/
│   └── internal/             # dialect · session · tree · catalog · meta · handler
├── oracle-service/         # Oracle（C++20 + ODPI-C，见 docs/29）
│   ├── CMakeLists.txt
│   ├── src/                  # ipc · dialect · session · handler
│   └── third_party/          # odpi · nlohmann/json
├── clickhouse-service/     # ClickHouse（clickhouse-go/v2，见 docs/30；P0–P1）
│   ├── go.mod
│   ├── cmd/clickhouse-service/
│   └── internal/             # dialect · session · tree · catalog · handler（meta 后续）
├── kingbase-service/       # 人大金仓（pgx/v5，见 docs/31；P0 session/query）
│   ├── go.mod
│   ├── cmd/kingbase-service/
│   └── internal/             # dialect · session · handler（tree/catalog/meta 后续）
├── sqlserver-service/      # SQL Server（go-mssqldb，见 docs/32；P0 session/query）
│   ├── go.mod
│   ├── cmd/sqlserver-service/
│   └── internal/             # dialect · session · handler（tree/catalog/meta 后续）
└── …                       # 其它库服务：Go 同构独立 go.mod；Native 见各模块文档

packages/
├── go/serviceipc/          # Go 能力服务 IPC
├── rust/niuma-serviceipc/  # Rust 能力服务 IPC
└── cpp/serviceipc/         # C++ 能力服务 IPC（静态库 niuma::serviceipc）
```

> Oracle 等 L3 Native 服务**不**进入 `go.work`；C++ 服务通过 `add_subdirectory(packages/cpp/serviceipc)` 链接 `niuma::serviceipc`，**不要**在各服务内复制 frame/server。Instant Client 旁载于 `bin/runtime/oracle/`。

- **`runtime.executable`**：相对 `services/` 根目录，如 `bin/ftp-service.exe` / `bin/niuma-sqlite-service.exe`。
- **platform-core 位置**：同样位于 `services/bin/platform-core.exe`；`ResolveServicesDir()` 从可执行文件路径推断 services 根（`bin` 的父目录）。
- **manifest 消费方**：
  - `platform-core.yaml`（`id: com.niuma.platform`）— **保留**为 Layer 2 注册契约；壳层 `ServiceManifestLoader` 当前硬编码同内容，与 Go 管道地址三处对齐；未来可改为直接读此文件。
  - 其余 `*.yaml`（如 `ftp-service.yaml`、`sqlite-service.yaml`）— 由 platform-core `supervisor` 加载并懒拉起。
- **本机 IPC 不用 TCP 端口**：均为命名管道 / UDS 固定地址，无动态端口分配。

## Go 工作区

仓库根 `go.work` 串联（节选）：

- `platform`
- `services/ftp-service`
- `services/mongodb-service`
- `services/vastbase-service`
- `services/mysql-service`
- `services/sqlite-service`
- `services/dameng-service`
- `services/clickhouse-service`
- `services/kingbase-service`
- `services/sqlserver-service`
- `packages/go/serviceipc`

本地开发在任意模块目录执行 `go build` / `go test` 均可解析 replace 依赖。

## 构建

```powershell
.\scripts\build-services.ps1
```

或分别构建：

```powershell
cd platform
go build -o ../services/bin/platform-core.exe ./cmd/platform-core

cd ../services/ftp-service
go build -o ../bin/ftp-service.exe ./cmd/ftp-service
```

Oracle（独立，需 VS + ODPI 源码；Instant Client 仅运行时）：

```powershell
.\scripts\shared\build\build-oracle-service.ps1
```

## IPC 契约

- 帧格式：4 字节小端长度 + UTF-8 JSON（与 platform-core 一致）。
- Web → 壳层 → platform-core：`{namespace}.*`（如 `ftp.session.open`）。
- platform-core → 能力服务：剥 namespace 后的内部方法（如 `session.open`）。
- 路由与 manifest 规范见 [docs/14-capability-connection-framework.md](../docs/14-capability-connection-framework.md)。

## 新增能力服务 checklist

1. 在 `services/<name>/` 创建独立工程（任意语言；Go 可复用 `packages/go/serviceipc`）。
2. 添加 `services/manifests/<name>.yaml`（`id`、`bridge.namespace`、`runtime.executable`、`ipc.address`、`session`）。
3. 构建脚本输出到 `services/bin/`。
4. **无需**修改壳层或新增 platform `*_proxy.go`（由 `CapabilityRegistry` 自动路由）。
5. 更新 [14-capability-connection-framework.md](./14-capability-connection-framework.md)。

## 相关文档

- [12 — FTP 模块](./12-ftp-module.md)
- [16 — SSH / SFTP 模块](./16-ssh-sftp-module.md)
- [19 — MongoDB 模块](./19-mongodb-module.md)
- [22 — Vastbase 模块](./22-vastbase-module.md)
- [25 — MySQL 模块](./25-mysql-module.md)
- [27 — SQLite 模块](./27-sqlite-module.md)
- [28 — 达梦模块](./28-dameng-module.md)
- [29 — Oracle 模块](./29-oracle-module.md)
- [30 — ClickHouse 模块](./30-clickhouse-module.md)
- [31 — 人大金仓模块](./31-kingbase-module.md)
- [11 — Platform Core](./11-platform-core.md)
