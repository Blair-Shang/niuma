# 11 — Platform Core（Layer 2，Go）

> 版本：v0.1 · 日期：2026-07-04
> 状态：已落地 `platform.settings.*` 持久化 + 应用 IPC（Named Pipe / UDS + JSON 信封）

---

## 1. 定位

Platform Core 是 **Layer 2** 的业务中枢（Go 常驻进程 `platform-core`）：权限、SQLite、凭据、
审计、AI 编排等**唯一裁决点**（AI 助手细则见 [24 — AI 助手](./24-ai-assistant.md)）。C++ 壳层（Layer 3）**零业务**——只做字节透传与进程启停。

```
Web UI ──① CEF IPC──> C++ Shell ──② 应用 IPC──> Platform Core ──> Services
                        (透传/管家)   (本文)        (SQLite/权限/…)
```

本期实现的最小闭环：Web 的 `platform.settings.get/set` 经壳层透传，由 Platform 落库到
SQLite `nm_app_setting`，壳层不读库、不含任何业务分支。

---

## 2. 传输与分帧（当前契约）

> **传输**：Windows 命名管道 / Unix Domain Socket；分帧为 **4 字节小端长度前缀 + UTF-8 JSON**（见 [03](./03-ipc-protocol.md)）。C++ 侧只用 Win32 API（`CreateFileW`/`WriteFile`/`ReadFile`/`WaitNamedPipe`），不引入 gRPC/protobuf。本机 IPC **不定 TCP 端口**。

| 项 | 取值 |
|----|------|
| 传输（Windows） | 命名管道 `\\.\pipe\niuma.platform` |
| 传输（其他平台） | Unix Domain Socket `${TMPDIR}/niuma.platform.sock` |
| 分帧 | **4 字节小端长度前缀** + **UTF-8 JSON 载荷**（前缀值 = 载荷字节数，不含前缀） |
| 单帧上限 | 1 GiB（`protocol.MaxFrameSize`，与 C++ `kMaxFrameBytes` 对齐） |
| 连接模型 | 每连接一个 goroutine；连接内支持多个**顺序**请求；多连接并发 |

三处地址常量必须一致：Go `main.ipcAddress()`、C++ `platform_client.cpp kPipeName`、
`service_manifest.cpp` 的 `platform.address`。

### 2.1 请求帧载荷

壳层把 Web 的 **完整原始请求 JSON 原样透传**（不重新序列化）：

```json
{ "method": "platform.settings.get", "params": { "key": "workspace.tabs" }, "id": "req-uuid" }
```

### 2.2 响应帧载荷

```json
{ "v": 1, "id": "req-uuid", "ok": true, "traceId": "req-uuid", "result": "{\"value\":\"[1,2,3]\"}" }
```

- `ok`：布尔，成功标志。
- `error`：失败原因**字符串**；成功时省略（`omitempty`）。禁止改成对象。
- `errorCode`：稳定码（如 `method_not_found`）；成功时省略。
- `traceId`：跨进程关联；缺省等于 `id`。
- **`result` 是「被 JSON 再编码一层的字符串」**：其内容为业务结果对象序列化后的文本。
  如上例 `result` 的字符串值即 `{"value":"[1,2,3]"}`。

> **为何 result 是字符串？** 壳层没有完整 JSON 库，只有极简的 `JsonGetString`。把 result
> 编码成字符串后，C++ 侧 `JsonGetString(resp, "result")` 可一次取出内层 JSON 文本，直接
> 作为 `callback->Success` 的返回体交回 Web（Web 端再 `JSON.parse`）。失败时壳把
> `error` / `errorCode` / `traceId` 再包一层 JSON 交给 cefQuery `onFailure`（见 [03](./03-ipc-protocol.md)）。

---

## 3. 已实现方法

契约源：[web/src/api/settings.ts](../web/src/api/settings.ts) / [types/settings.ts](../web/src/api/types/settings.ts)。

| method | 入参 | 结果对象（result 内层） | 行为 |
|--------|------|--------------------------|------|
| `platform.settings.get` | `{ key }` | `{ value: string \| null }` | 读 `nm_app_setting`；键不存在 → `value:null` |
| `platform.settings.set` | `{ key, value }` | `{ updated: true }` | UPSERT，`updated_at = now(UTC, RFC3339)` |
| `platform.diag.trace` / `summary` / `crashes` | 见 [35](./35-desktop-observability.md) | 本机 `observe.jsonl` / `crashes/` | 不上 APM |
| 其他 | — | — | `ok:false, error:"method not found: <m>"` |

`key` 为空一律 `ok:false, error:"key required"`。

---

## 4. 数据库

| 项 | 值 |
|----|----|
| 用户库路径（Windows） | `%LOCALAPPDATA%\NiuMa\data\niuma.db` |
| 用户库路径（其他） | `~/.niuma/data/niuma.db`（无 HOME 时回退可执行文件同级 `data/`） |
| 驱动 | `modernc.org/sqlite`（纯 Go，无 cgo） |
| 连接 | `SetMaxOpenConns(1)` + `journal_mode=WAL` + `busy_timeout=5000` |
| KV 表 | `nm_app_setting(setting_key PK, setting_value, updated_at)` |

Windows 库路径与壳层 `GetUserDataDir()`（`plugin_registry.cpp`）一致，同一用户目录。

### 4.1 迁移

- **唯一权威源**：[scripts/sql/sqlite/](../scripts/sql/sqlite/)（含 `.down.sql` 与 postgres/mysql
  方言，见 [database-schema](./database-schema.md)）。**改 SQL 只改这里。**
- **内嵌副本**：`platform/internal/migrate/sqlite/`（仅 `*.up.sql`）是**构建产物**，由
  `platform/internal/migrate/copy_migrations.go` 从权威源生成，经 `go:embed` 打进二进制
  （发布自包含、可离线）。**勿手工编辑。**
- **同步方式**：改权威源后在 `platform/internal/migrate` 下执行 `go generate ./...`；
  `sync_test.go`（`go test ./...`）逐字节校验二者一致，漂移即 CI 失败。
- 应用顺序：按文件名升序（`000000_schema` → `000001_core` → `000002_connection`），
  每个脚本独立事务、版本记入 `nm_schema_migration`，幂等。
- 版本记录：`nm_schema_migration(version, applied_at)`；版本号取文件名首个下划线前缀。
- **幂等**：已记录版本跳过；每个脚本在独立事务内执行，失败回滚该脚本。
- 遵循 [database-schema.mdc](../.cursor/rules/database-schema.mdc)：`nm_` 前缀、物理删除、
  无 `AUTOINCREMENT`、主键应用层生成。本期仅**使用**既有 `nm_app_setting`，不新增表。

---

## 5. 壳层侧（C++）职责

| 环节 | 文件 | 做什么 |
|------|------|--------|
| 方法路由 | `bridge/bridge_router.cpp` | `platform.*` 解析为 `service=platform.settings, action=get`，透传 `req.params`（**完整原始请求 JSON**） |
| 进程管家 | `core/runtime/service_manager.cpp` | `platform*` 段映射到 manifest `com.niuma.platform`；未监听则 `CreateProcessW` 拉起 `services/bin/platform-core.exe`；退出时 `TerminateProcess` + 关句柄 |
| 应用 IPC | `ipc/platform_client.cpp` | **工作线程**上连接管道、成帧收发、解析 `ok/result/error`，经 `CefPostTask(TID_UI)` 回 UI 线程触发 callback |

关键约束：

- IO 在独立 `std::thread`，**绝不阻塞 CEF UI 线程**；结果回投 UI 线程再回调。
- 连接带重试：`ERROR_PIPE_BUSY` → `WaitNamedPipe` 重试；`ERROR_FILE_NOT_FOUND`
  （进程刚起、监听器未就绪）→ 短暂退避重试。
- 任何失败都返回 `ok:false, error:"platform unavailable: …"`，**壳层不崩溃**；Web 端仅
  告警、不做本地持久化（桌面端 Platform 由 `ServiceManager` 自动拉起，见 `web/src/stores/tab.ts`）。
- `EnsureRunning` 快速返回、不等管道就绪（等待交给 PlatformClient 的重试）。

---

## 6. 端到端时序

```
Renderer            C++ Shell                               Platform Core
   │  cefQuery(JSON)   │                                          │
   │ ────────────────> │ message_router_handler                   │
   │                   │ bridge_router: ParseMethod               │
   │                   │ ServiceManager.EnsureRunning (spawn?)    │
   │                   │ PlatformClient.Invoke → 工作线程          │
   │                   │   4B len + JSON  ───────────────────────>│ ReadFrame → dispatch
   │                   │                                          │ SQLite get/set
   │                   │   <─────────────────────  4B len + JSON  │ WriteFrame
   │                   │ 解析 ok/result/error                     │
   │                   │ CefPostTask(TID_UI) → callback           │
   │ <── Success(result)│                                          │
```

---

## 7. 构建 / 运行 / 验证（Windows）

```powershell
cd platform
go mod tidy
go build -o ../services/bin/platform-core.exe ./cmd/platform-core

go vet ./...
go test ./...     # 含 internal/server 的真实命名管道 set→get 往返测试
```

壳层运行时会在首个 `platform.*` 请求时自动 spawn 该 exe，一般无需手动启动；手动运行便于
单独调试：直接执行 `services/bin/platform-core.exe`，日志打印库路径与监听地址。

> **依赖版本**：`modernc.org/sqlite` 固定 `v1.29.10`（支持 Go 1.22）。最新版要求 Go ≥ 1.25，
> 待仓库升级 Go 基线后再放开。

---

## 8. 风险 / 后续

- **进程生命周期**：能力服务崩溃后 **立即** 广播 `{ns}.session.state{sessionId:"*",state:"lost"}` 与 `platform.service.state`，并按 1s→30s 退避自动拉起；`Shutdown` 先置停再杀进程，避免退出时误重启。硬杀仍用于 Windows 子进程（无可靠 SIGTERM）。
- **崩溃转储**：各进程把 panic / 原生异常写到会话日志目录 `crashes/`（Go `debug.SetCrashOutput`、C++ MiniDump、Rust panic hook）。
- **重复 spawn**：靠 `WaitNamedPipe` 探测「已在监听」来避免；壳层非正常退出遗留的孤儿
  进程会被下次会话探测复用。
- ~~迁移副本同步~~：**已解决**——`internal/migrate/sqlite/` 由 `go generate`（`copy_migrations.go`）
  从 `scripts/sql/sqlite/` 生成，`sync_test.go` 做漂移校验，无需人工保持一致。
- **IPC 总线**：Go 与 C++ 壳均复用空闲 Named Pipe（取出后该连接上同时只跑一个请求；仅池连接写出失败才换新连接重发，写出成功后读失败不重发）。事件 `*.progress` 10 Hz 合并为可丢的 `platform.event.batch`，`session.state` / `transfer.state` 阻塞入队直至发出或订阅连接已死。查询分页仍走既有 `query.fetch`；`ftp.dir.list` 仅在请求带 `limit>0` 时截断并标 `truncated`。传输断开发具体 `sessionId` 的 `lost` 并带 `errorCode:lost`。不上 gRPC、不改信封 `result` 类型。
- **C++ 未整体编译验证**：仅对新增 Win32 源码做了 `-fsyntax-only` 语法检查（无 CEF）；完整 CEF 构建未在本期执行。

---

## 9. 相关文档

- [总体架构 — 两层 IPC / 壳层零业务](./architecture.md#24-两层-ipc)
- [02 — C++ 壳层设计](./02-shell-cpp-cef.md)
- [数据库规范](./database-schema.md)
