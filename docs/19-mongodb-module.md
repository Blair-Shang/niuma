# 19 — MongoDB 管理模块（Layer 1 能力服务 + Web 模块）

> 版本：v0.1 · 日期：2026-07-09
> 状态：Phase 1–3 已落地；Phase 4（外部 mongosh / mongo-tools）待实现

---

## 1. 目标与范围

面向 NoSQL 运维场景，提供 **集合浏览、文档编辑、查询/聚合、服务监控、Shell 控制台、导入导出** 能力，归属 `ops` 域，与 FTP / SSH / Redis 共用侧栏连接树与 `platform.connection.*` 凭据模型。

### 1.1 架构对齐（Navicat 模式）

本模块采用 **Navicat for MongoDB** 的分工，而非 MongoDB Compass（内嵌 Node/mongosh）路线：

| 能力层 | Navicat 做法 | NiuMa 做法 |
|--------|-------------|-----------|
| GUI / 数据浏览 | 自研 UI + **libmongoc** | Vue 自研面板 + **Go 官方 `mongo-driver`** |
| Shell 控制台 | **外部 mongosh**（用户配置路径） | PTY 桥接本机 `mongosh`；无则降级内置 REPL |
| 导入导出 | **外部 mongo-tools**（mongodump 等） | `os/exec` spawn 本机工具 |
| 监控 / Schema | 自研 UI + 驱动查询 | `serverStatus` / Change Stream / 文档采样 |
| 安装包 | 不捆绑 Node | 仅 `niuma-mongodb-service` Go 二进制（~10–20 MB） |

要点：**不把 Node.js / mongosh 打进主安装包**；需要 100% 官方 Shell 体验时，引导用户安装 mongosh 或在设置中配置路径（与 Navicat `Mongo Shell Path` 一致）。

### 1.2 协议范围（本期锁定）

- **MongoDB** 3.6+（wire protocol 6+；Legacy 驱动模式兼容更低版本，见 §4.1）
- 拓扑：Standalone、Replica Set、Sharded Cluster
- 连接：密码 / X.509 / LDAP / Kerberos（分期）、SRV、`mongodb+srv://`
- **不含**：GridFS 高级管理（Phase 5 可选）、mongos 路由深度运维

### 1.3 关键决策

| 维度 | 决策 | 理由 |
|------|------|------|
| 能力服务落位 | **独立 Layer-1 进程 `mongodb-service`** | 长连接、Change Stream、子进程管理，崩溃隔离 |
| 服务语言 | **Go** | 官方 `mongo-driver` 一等支持；`mongo-tools` 同栈；子进程/PTY 简单；复用 `packages/go/serviceipc`、`tunnel`、`netproxy` |
| Shell | **外部 mongosh 优先** | 对齐 Navicat；不引入 Node 打包链 |
| 导入导出 | **外部 mongo-tools** | 对齐 Navicat；不重写 BSON 备份逻辑 |
| 进程拉起层 | **platform-core 拉起并路由** | 与 FTP / Redis 一致，壳层零业务 |
| 凭据边界 | **平台注入明文密码，能力服务进程内使用** | UI 不见明文，沿用现有凭据模型 |

### 1.4 专业能力清单（分期实现）

- 连接与站点管理：拓扑、认证、SRV、SSH 隧道、代理（Phase 1）
- 对象树：database → collection → index（Phase 1）
- 文档浏览与编辑：find 分页、JSON/表格视图、CRUD（Phase 2）
- 查询与聚合：查询编辑器、补全、Explain、管道执行（Phase 3）
- 监控：serverStatus、dbStats、currentOp、Change Stream（Phase 3–5）
- Shell：mongosh PTY + 内置 REPL 降级（Phase 4）
- 工具：mongodump / mongorestore / mongoexport / mongoimport（Phase 4）
- Schema 分析：文档采样推断字段类型（Phase 3）

---

## 2. 分层与进程模型

```
┌ Layer 4 ─ Web ─────────────────────────────────────────────────────┐
│ web/src/modules/mongodb/  连接树 · 集合浏览 · 查询 · Shell · 工具   │
│   ↑ bridgeInvoke(mongodb.*)          ↑ bridgeOnEvent(niuma:event)   │
└───┼──────────────────────────────────┼──────────────────────────────┘
    │ cefQuery（请求/响应）             │ PostMessage（事件推送）
┌ Layer 3 ─ C++ Shell ──────────────────┴────────────────────────────┐
│ bridge_router · platform_client · 事件回投 UI                      │
└───┼──────────────────────────────────▲──────────────────────────────┘
    │ 4B 长度前缀 + JSON 帧             │ 事件帧
┌ Layer 2 ─ platform-core（Go）─────────┴────────────────────────────┐
│ platform.connection.* / platform.credential.*                      │
│ + mongodb.* 代理转发 + 凭据注入 + 鉴权 / 审计                       │
└───┼──────────────────────────────────▲──────────────────────────────┘
    │ length-prefixed JSON             │ Shell 输出 / Change Stream / 工具进度
┌ Layer 1 ─ mongodb-service（Go）──────┴────────────────────────────┐
│ mongo-driver 会话池 · 文档 CRUD · 监控 · mongosh PTY · tools spawn │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ 可选 spawn（用户本机）
                    ┌──────────┴──────────┐
                    ▼                     ▼
              mongosh.exe          mongodump / mongoexport …
```

要点：

- 壳层只负责桥接与进程承载，**不处理 MongoDB 业务**。
- `mongodb-service` 与 `ftp-service` 平级，均由 `platform-core` 按 manifest 懒拉起。
- Shell / 导入导出字节流**不经过 IPC 帧**；桥上只走控制指令、PTY 输出片段与进度事件。
- 大数据备份目录在本地磁盘与 `mongo-tools` 子进程之间流动，UI 仅展示进度与结果路径。

---

## 3. 工程布局

### 3.1 目录

```
packages/go/
├── serviceipc/          # IPC 帧协议（已有，ftp-service 复用）
├── tunnel/              # SSH 隧道（已有）
└── netproxy/            # HTTP/SOCKS 代理（已有）

services/
├── manifests/mongodb-service.yaml
└── mongodb-service/
    ├── go.mod
    ├── cmd/mongodb-service/
    │   └── main.go
    └── internal/
        ├── handler/         # IPC 方法分发
        ├── session/         # 连接、会话池、指标缓存
        ├── query/           # find / aggregate / explain
        ├── schema/          # 文档采样 → 字段树
        ├── monitor/         # serverStatus / currentOp
        ├── stream/          # Change Stream
        ├── shell/           # mongosh PTY + 内置 REPL
        ├── tools/           # mongo-tools 探测与 spawn
        ├── eventpub/        # 事件推送（对齐 ftp-service）
        └── idgen/

web/src/modules/mongodb/
├── views/
│   ├── MongoHome.vue
│   └── MongoSession.vue
├── components/
│   ├── MongoConnectionFields.vue
│   ├── MongoConsolePane.vue
│   ├── MongoCollectionsPane.vue
│   ├── MongoDocumentViewer.vue
│   ├── MongoAggregatePane.vue
│   ├── MongoSchemaPane.vue
│   ├── MongoMonitorPane.vue
│   ├── MongoCurrentOpPane.vue
│   ├── MongoLivePane.vue
│   └── MongoToolsPane.vue
├── composables/
├── conn-tree-provider.ts
└── utils/
```

### 3.2 Go 工作区

在根 `go.work` 中追加：

- `services/mongodb-service`

构建产物：`services/bin/niuma-mongodb-service.exe`（Windows）/ `niuma-mongodb-service`（Unix）。

---

## 4. 数据模型与连接配置

MongoDB 连接配置复用现有三张表（[14 §3](./14-capability-connection-framework.md)）：

| 表 | 用途 | MongoDB 用法 |
|----|------|--------------|
| `nm_connection_profile` | 连接站点 | `connection_kind = 'mongodb'` |
| `nm_credential_ref` | 凭据引用 | `password` 或 `x509_certificate`（由 `auth_mechanism` 决定） |
| `nm_profile_credential` | 站点与凭据绑定 | 一个站点至少绑定一份认证材料 |

### 4.1 `connection_options`（JSON）

```json
{
  "accentColor": "green",
  "proxy": { "type": "none" },
  "tunnel": { "type": "none" },

  "topology": "standalone",
  "auth_mechanism": "default",
  "auth_database": "admin",
  "replica_set": "",
  "read_preference": "primary",
  "srv_record": false,
  "timeout_seconds": 10,
  "client_driver": "default",
  "default_database": "",

  "tool_paths": {
    "mongosh": "",
    "mongodump": "",
    "mongorestore": "",
    "mongoexport": "",
    "mongoimport": ""
  }
}
```

| 字段 | 说明 | 实现状态（v0.1 规划） |
|------|------|----------------------|
| `topology` | `standalone` / `replica_set` / `sharded` | Phase 1 |
| `auth_mechanism` | `default` / `scram` / `x509` / `ldap` / `kerberos` | Phase 1（LDAP/Kerberos Phase 5） |
| `auth_database` | 认证库，默认 `admin` | Phase 1 |
| `replica_set` | 副本集名称 | Phase 1 |
| `read_preference` | `primary` / `primaryPreferred` / `secondary` / … | Phase 1 |
| `srv_record` | 使用 `mongodb+srv://` | Phase 1 |
| `timeout_seconds` | 连接超时（秒） | Phase 1 |
| `client_driver` | `default` / `legacy`（低版本服务端兼容，对标 Navicat Client Driver） | Phase 1 |
| `default_database` | 打开会话时的默认库 | Phase 1 |
| `tool_paths.*` | 外部工具路径；空 = 自动探测 `PATH` | Phase 4 |
| `proxy` | HTTP/SOCKS 代理 | Phase 2 |
| `tunnel` | SSH 跳板隧道（platform 注入 `sshProfile`） | Phase 2 |
| `accentColor` | Web UI 标签色；服务不读取 | 已生效（Web） |

命名约定见 [14 §9.1](./14-capability-connection-framework.md)：Bridge 信封 camelCase；协议专属字段 **snake_case**。

### 4.2 默认端口

- Standalone / Replica Set：`27017`
- `portNumber <= 0` 时由 `mongodb-service` 回退至 `27017`（platform 不强行写死）。

---

## 5. Bridge 方法契约

Web 侧命名空间：`mongodb.*`。platform-core 剥前缀后转发至能力服务内部方法名（如 `session.open`）。

### 5.1 会话（必选）

| Bridge 方法 | 入参 | 返回 |
|-------------|------|------|
| `mongodb.session.open` | `{ profileId }` | `{ sessionId }` |
| `mongodb.session.close` | `{ sessionId }` | `{ closed: true }` |
| `mongodb.session.test` | `{ profileId }` 或内联 host/options | `{ ok, message }` |

### 5.2 连接树

| Bridge 方法 | 入参 | 返回 |
|-------------|------|------|
| `mongodb.tree.databases` | `{ profileId }` 或 `{ sessionId }` | `{ databases: [{ name, sizeOnDisk, empty }] }` |
| `mongodb.tree.collections` | `{ sessionId, database }` | `{ collections: [{ name, type, count? }] }` |
| `mongodb.tree.indexes` | `{ sessionId, database, collection }` | `{ indexes: [...] }` |

### 5.3 文档与查询（驱动层，对标 Navicat Data Viewer / Query Editor）

| Bridge 方法 | 入参 | 返回 |
|-------------|------|------|
| `mongodb.document.find` | `{ sessionId, database, collection, filter?, sort?, projection?, skip?, limit? }` | `{ documents, total?, hasMore }` |
| `mongodb.document.get` | `{ sessionId, database, collection, id }` | `{ document }` |
| `mongodb.document.insert` | `{ sessionId, database, collection, document }` | `{ insertedId }` |
| `mongodb.document.update` | `{ sessionId, database, collection, id, document }` | `{ matched, modified }` |
| `mongodb.document.delete` | `{ sessionId, database, collection, id }` | `{ deleted }` |
| `mongodb.aggregate.run` | `{ sessionId, database, collection, pipeline }` | `{ documents }` |
| `mongodb.aggregate.explain` | `{ sessionId, database, collection, pipeline }` | `{ explain }` |
| `mongodb.command.exec` | `{ sessionId, input }` | `{ output, error? }`（内置 REPL 降级） |
| `mongodb.command.suggest` | `{ sessionId, input }` | `{ suggestions }` |
| `mongodb.schema.sample` | `{ sessionId, database, collection, sampleSize? }` | `{ fields: [{ path, types, frequency }] }` |

文档与 BSON 在 IPC 层统一为 **Extended JSON**（`relaxed`），与官方工具展示习惯对齐。

### 5.4 监控

| Bridge 方法 | 入参 | 返回 |
|-------------|------|------|
| `mongodb.monitor.stats` | `{ sessionId }` | `serverStatus` + 当前库 `dbStats` 摘要 |
| `mongodb.monitor.currentOp` | `{ sessionId, activeOnly? }` | `{ operations: [...] }` |
| `mongodb.monitor.stream.start` | `{ sessionId, database, collection, pipeline? }` | `{ streamId }` |
| `mongodb.monitor.stream.stop` | `{ streamId }` | `{ stopped: true }` |

`monitor.stats` 在服务端缓存 **2 秒**（对齐 `redis-service` 策略），避免前端轮询压垮实例。

### 5.5 Shell（外部 mongosh，对标 Navicat Console）

| Bridge 方法 | 入参 | 返回 |
|-------------|------|------|
| `mongodb.shell.detect` | `{ toolPaths? }` | `{ available, path?, version? }` |
| `mongodb.shell.open` | `{ sessionId, cols, rows }` | `{ shellId }` |
| `mongodb.shell.input` | `{ shellId, data }` | `{ ok: true }` |
| `mongodb.shell.resize` | `{ shellId, cols, rows }` | `{ ok: true }` |
| `mongodb.shell.close` | `{ shellId }` | `{ closed: true }` |

探测顺序（对齐 Navicat Environment 设置）：

1. `connection_options.tool_paths.mongosh`
2. 全局用户设置（后续 `platform.settings` 或本地配置）
3. `PATH` 中的 `mongosh` / `mongo`
4. Windows 常见安装目录

无 mongosh 时，Console Tab 自动切换为 **内置 REPL**（`command.exec`），并提示安装或配置路径。

### 5.6 工具（外部 mongo-tools，对标 Navicat Import/Export）

| Bridge 方法 | 入参 | 返回 |
|-------------|------|------|
| `mongodb.tools.detect` | `{ toolPaths? }` | `{ mongodump, mongorestore, mongoexport, mongoimport: { available, path? } }` |
| `mongodb.tools.dump` | `{ sessionId, database, outputDir, options? }` | `{ taskId }` |
| `mongodb.tools.restore` | `{ sessionId, inputDir, options? }` | `{ taskId }` |
| `mongodb.tools.export` | `{ sessionId, database, collection, format, outputPath }` | `{ taskId }` |
| `mongodb.tools.import` | `{ sessionId, database, collection, format, inputPath }` | `{ taskId }` |
| `mongodb.tools.cancel` | `{ taskId }` | `{ cancelled: true }` |

子进程通过 **连接 URI** 建连；密码优先经环境变量 `MONGODB_PASSWORD` 或临时凭据文件传入，**禁止**写入日志。

SSH 隧道场景：工具连接 `127.0.0.1:<localForwardPort>`，隧道由 `packages/go/tunnel` 维持，与 Redis 隧道模型一致。

### 5.7 事件（`niuma:event`）

| type | 载荷 | 说明 |
|------|------|------|
| `mongodb.session.state` | `{ sessionId, state, message? }` | `connected` / `closed` / `lost` |
| `mongodb.shell.output` | `{ shellId, data }` | PTY 输出片段 |
| `mongodb.shell.state` | `{ shellId, state }` | `opening` / `connected` / `closed` |
| `mongodb.monitor.event` | `{ streamId, document }` | Change Stream 文档 |
| `mongodb.tools.progress` | `{ taskId, phase, percent?, message? }` | 工具执行进度 |
| `mongodb.tools.done` | `{ taskId, ok, message?, outputPath? }` | 完成或失败 |

---

## 6. manifest 契约

`services/manifests/mongodb-service.yaml`：

```yaml
id: com.niuma.mongodb
name: MongoDB Service
version: 0.1.0
bridge:
  namespace: mongodb
  connection_kind: mongodb
session:
  inject_credentials: true
  credential_methods:
    - session.open
    - session.test
    - tree.databases
runtime:
  executable: bin/niuma-mongodb-service.exe
  executable_windows: bin/niuma-mongodb-service.exe
  executable_unix: bin/niuma-mongodb-service
  lang: go
ipc:
  transport: named_pipe
  transport_windows: named_pipe
  transport_unix: unix_socket
  address: '\\.\pipe\niuma.mongodb'
  address_windows: '\\.\pipe\niuma.mongodb'
  address_unix: '/tmp/niuma.mongodb.sock'
  protocol: length_prefixed_json
lifecycle:
  startup: lazy
permissions: []
```

约束：

- `bridge.namespace` 固定为 `mongodb`
- `connection_kind` 固定为 `mongodb`
- 凭据注入作用于 `session.open`、`session.test`、`tree.databases`（短连接探测）

---

## 7. Go 实现约定

### 7.1 依赖

```go
go.mongodb.org/mongo-driver/mongo
go.mongodb.org/mongo-driver/bson
go.mongodb.org/mongo-driver/mongo/options
```

公共包：

- `niuma/pkg/serviceipc` — IPC 服务端
- `niuma/pkg/tunnel` — SSH 隧道
- `niuma/pkg/netproxy` — 代理

### 7.2 服务入口

- `main.go` 只做日志初始化、信号处理、Handler 装配、IPC 启动
- 监听地址与 manifest 保持一致：Windows `\\.\pipe\niuma.mongodb`

### 7.3 会话管理

- 一个 `sessionId` 对应一个 `*mongo.Client`（连接池由 driver 管理）
- `session.close` 释放 Client、关闭关联 Shell 子进程与 Change Stream
- `client_driver = legacy` 时不设置 Server API 版本，兼容 wire version 较低的服务端

### 7.4 Shell（PTY）

- 使用 `os/exec` + `github.com/creack/pty`（或平台等价方案）拉起 `mongosh`
- 连接串由会话上下文拼装（含 `--authenticationDatabase`、`--tls` 等）
- 输出通过 goroutine 读取 PTY，经 `eventpub` 推送 `mongodb.shell.output`

### 7.5 工具子进程

- 使用 `exec.CommandContext` + 独立 `context`，支持 `tools.cancel`
- 解析 stderr 行推送 `mongodb.tools.progress`
- 工作目录与输出路径使用系统临时目录，任务结束后按策略清理

### 7.6 日志与错误

- 对齐 `ftp-service` 日志字段：`session`、`database`、`collection`、`method`
- 错误字符串可读，**禁止**泄露密码、URI 中的凭据、完整连接串

### 7.7 安全与限额

| 项 | 限制 |
|----|------|
| 单次 `document.find` | `limit` 上限 **1000** |
| 单次文档大小（在线编辑） | **16 MiB** |
| `command.exec` 输入 | **64 KiB** |
| Change Stream 并发 | 每会话 **1** 条活跃流 |
| Shell 会话 | 每 MongoDB 会话 **1** 个 PTY |

---

## 8. Web 集成约定

### 8.1 模块注册

- `web/src/extensions/registry/builtin-modules.ts` 追加 `mongodb` 模块（`category: 'ops'`）
- `web/src/modules/ops/connection-kinds.ts` 注册 `MongoConnectionFields`
- `web/src/modules/ops/types.ts` 的 `CONN_KIND_DEFS` 追加 `mongodb`
- `web/src/api/mongodb.ts` — `createCapabilityClient('mongodb')` 或显式方法表

### 8.2 连接树

复用 [18 — 运维连接树](./18-ops-connection-tree.md) 资源子节点机制：

```
MongoDB 连接
└── database: mydb
    ├── collection: users
    └── collection: orders
```

- `conn-tree-provider.ts` 实现 `tree.databases` / `tree.collections` 懒加载
- 点击集合 → 打开 `MongoSession` 并定位 Collections Tab

### 8.3 会话 Tab 布局

| Tab | 组件 | Phase |
|-----|------|-------|
| Collections | `MongoCollectionsPane` + `MongoDocumentViewer` | 2 |
| Query | 查询编辑器 + Explain | 3 |
| Aggregate | `MongoAggregatePane` | 3 |
| Schema | `MongoSchemaPane` | 3 |
| Console | `MongoConsolePane`（mongosh PTY 或 REPL） | 4 |
| Monitor | `MongoMonitorPane` + `MongoCurrentOpPane` | 3 |
| Live | `MongoLivePane`（Change Stream） | 5 |
| Tools | `MongoToolsPane` | 4 |

`MongoConsolePane` 复用 `RsTerminal`（与 Redis / SSH 一致）。PTY 模式设置 `normalizeNewlines: false`。

### 8.4 Shell 双模式 UX

```
打开 Console
  → shell.detect()
      ├─ available → PTY mongosh（Navicat 模式）
      └─ 不可用   → 内置 REPL + 横幅提示配置 mongosh 路径
```

设置页（或连接高级选项）提供外部工具路径配置，对标 Navicat **Environment → Executables**；全局管理见 [19 §12](./19-mongodb-module.md#12-工具组件管理设置页)。

---

## 9. 分阶段路线

### Phase 1 — 骨架 + 连接（目标：可连、可列库表）

- [x] `services/mongodb-service` Go 工程 + manifest
- [x] `session.open` / `close` / `test`
- [x] `tree.databases` / `tree.collections`
- [x] Web：`MongoHome`、`MongoConnectionFields`、侧栏树 provider
- [x] `go.work` + `build-services` 脚本接入

### Phase 2 — 数据浏览

- [x] `document.find` / `get` / `insert` / `update` / `delete`
- [x] `MongoCollectionsPane`（表格 + JSON）
- [x] `proxy` / `tunnel` 消费

### Phase 3 — 查询与监控

- [x] `aggregate.run` / `explain`
- [x] `monitor.stats` / `monitor.currentOp`
- [x] `schema.sample`
- [x] 内置 REPL（`command.exec` / `command.suggest`）

### Phase 4 — 外部工具

- [ ] `shell.detect` / `open` / PTY 事件链
- [ ] `tools.detect` / dump / restore / export / import
- [ ] `MongoToolsPane` + 会话内工具入口
- [ ] **设置 → 工具组件**：`platform.components.*`（见 [20](./20-tool-components.md)）

### Phase 4b — 可选组件包安装

- [ ] `components/mongodb-tools/manifest.yaml`
- [ ] `platform.components.install` 下载解压至 `appData/components/`

### Phase 5 — 高级（可选）

- [ ] Change Stream（`MongoLivePane`）
- [ ] Aggregation Pipeline 可视化构建器
- [ ] LDAP / Kerberos 认证
- [ ] GridFS 浏览

---

## 12. 工具组件管理（设置页）

完整契约与 Phase 4a 实现见 **[20 — 工具组件管理](./20-tool-components.md)**。

MongoDB 依赖的 mongosh / mongo-tools 在 **设置 → 工具组件** 统一配置；`mongodb-service` 后续通过 `components.Registry.EffectivePath` 读取有效路径。

---

## 13. 与相关模块的关系

| 模块 | 关系 |
|------|------|
| [14 — 能力连接框架](./14-capability-connection-framework.md) | Bridge 路由、凭据注入、`connection_options` 约定 |
| [13 — 服务目录布局](./13-service-layout.md) | `services/mongodb-service/` 独立工程 |
| [18 — 运维连接树](./18-ops-connection-tree.md) | database / collection 资源子节点 |
| Redis 模块 | 控制台 REPL 模式、监控缓存、Change Stream 事件模式可参考 |
| FTP 模块 | Go `serviceipc`、`eventpub`、子进程任务模式可参考 |
| SSH 模块 | PTY 终端事件模式可参考 |

---

## 14. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-09 | 初版：Navicat 架构对齐、Go 服务语言、Bridge 契约、分阶段路线 |
| v0.2 | 2026-07-09 | §12 工具组件管理（设置页独立分区、platform.components.*） |
