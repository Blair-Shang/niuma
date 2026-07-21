# 22 — Vastbase 管理模块（Layer 1 能力服务 + Web 模块）

> 版本：v0.11 · 日期：2026-07-20  
> 状态：**Capability 模型落地**（对齐 DBeaver/Navicat；方言缺口 v0.10 已加固）；Query / 对象面板可用  

> 关联：[14 — 能力连接框架](./14-capability-connection-framework.md) · [18 — 运维连接树](./18-ops-connection-tree.md) · [19 — MongoDB](./19-mongodb-module.md) · [21 — 会话注册表](./21-session-registry.md) · [23 — SQL 方言补全基调](./23-sql-dialect-completion.md) · [24 — AI 助手](./24-ai-assistant.md)

> **文档边界**：本文只描述 Vastbase；其它库（MySQL 等）见各自模块文档，勿把多库实现混进本服务或本文。

---

## 1. 目标与范围

面向 **海量数据库 Vastbase**（PostgreSQL / openGauss 兼容）运维与开发场景，提供：

- 连接站点、对象导航（database → schema → table / 函数 / 存储过程）
- SQL 查询执行与结果集浏览
- 对象元数据（列、索引、约束、DDL）
- **企业级能力**：存储过程 / 函数 **编译、调用、DBE_PLDEBUGGER 调试**

归属 `ops` / `data` 域，与 FTP / SSH / Redis / MongoDB 共用侧栏连接树与 `platform.connection.*` 凭据模型。

### 1.1 架构对齐

| 能力层 | 参考 | NiuMa 做法 |
|--------|------|-----------|
| GUI / 对象树 / SQL | Vastbase Data Studio / DBeaver / Navicat | Vue + Monaco + Go 能力服务 |
| 连接与查询 | PG wire + 厂商扩展 | **Go + `jackc/pgx/v5`** |
| 存储过程调试 | VDS + `DBE_PLDEBUGGER` | **双 SQL 会话状态机（Go）**，事件推前端 |
| 安装包 | 独立客户端 / JDBC IDE | 仅 `niuma-vastbase-service` Go 二进制 |

### 1.2 关键决策

| 维度 | 决策 | 理由 |
|------|------|------|
| 能力服务落位 | **独立 Layer-1 进程 `vastbase-service`** | 长连接、双连接调试、查询取消，崩溃隔离 |
| 服务语言 | **Go（唯一）** | 对齐 `mongodb-service` / `ftp-service`；`pgx` 成熟；不引入 JVM |
| 驱动 | **`jackc/pgx/v5`** | PG 线协议；Vastbase 公开调试面为 SQL 函数，与连接语言无关 |
| **禁止 Java / JDBC** | 本模块 **不引入** `vastbase-jdbc`、不启 JVM sidecar | 降低桌面体积与运维复杂度；调试走 `DBE_PLDEBUGGER.*` SQL API |
| 协议 kind | **`vastbase`**（产品面）；内部包可名 `pg` / `vb` | 便于品牌与默认选项；后续原生 PG 可复用内核 |
| Bridge namespace | **`vastbase`** | `vastbase.session.open` 等 |
| 进程拉起 | **platform-core 按 manifest 懒拉起** | 壳层零业务 |
| 凭据边界 | **平台注入明文密码，能力服务进程内使用** | 与现有模型一致 |
| 会话策略 | **`per_profile` + idle 回收** | 同站点多 Tab 共享一条业务会话；调试会话服务内独立托管 |

### 1.3 协议与兼容范围

| 项 | 说明 |
|----|------|
| 目标产品 | Vastbase G100 等（PG / 高斯系兼容） |
| 线协议 | PostgreSQL wire（默认端口 **5432**） |
| **产品模型（对齐 DBeaver / Navicat）** | **DialectFamily + CapabilitySet**：`session.open` 探测并返回 `dialect`；模板 / 拆句 / 格式化 / 编辑器 / AI **只读能力开关**，禁止散落 `if vastbase` |
| SQL DML/DDL | 标准 SQL + 厂商扩展 |
| **默认能力（Vastbase）** | `proc.plsql_bare`、`func.plpgsql_dollar`、`script.oracle_slash`、`split.plsql_blocks`、`editor.suppress_pg_diagnostics`、`format.plsql` |
| **Probe** | 事务内 `SAVEPOINT` + 试探 `CREATE PROCEDURE … LANGUAGE plpgsql`；成功则追加 `proc.plpgsql_dollar`，无论成败 `ROLLBACK` |
| **过程** | 默认 PL/SQL：`AS\|IS … BEGIN … END;`（可选 `/`）。探测到 `proc.plpgsql_dollar` 后模板/AI 规则可放宽 |
| **函数** | 默认 `LANGUAGE plpgsql AS $$…$$`（调试友好） |
| 编辑器 | 有 `editor.suppress_pg_diagnostics` → Monaco 内置 `sql`（不挂 pgsql Worker）；否则 `pgsql` + sql-languages |
| AI | Context Pack 携带 `capabilities` / `dialectRules`（由能力生成；`dialect_vastbase.txt` 仅无能力时回退） |
| 调试扩展 | **`DBE_PLDEBUGGER`**；未安装则 UI 降级 |
| 后续其它库 | **不在本文范围**；共享契约见 [23](./23-sql-dialect-completion.md)，各库自建 Probe / Cap / 服务 |

### 1.4 能力清单（分期）

| Phase | 能力 |
|-------|------|
| **P0** | 连接 / 测试 / 会话；SQL Query（执行、取消、结果集）；最小 Home + Session |
| **P1** | 连接树 `database → schema → table`；轻量元数据 + filter/limit |
| **P2** | 表数据预览、列/索引/约束、DDL 查看、SQL 历史（表或本地） |
| **P3** | 函数 / 存储过程对象节点；编译 / 调用；**DBE_PLDEBUGGER 调试 UI** |
| **P4** | Monitor（连接 / 活动会话）、Explain、海量对象搜索增强、SSH 隧道（复用现有） |

---

## 2. 分层与进程模型

```
┌ Layer 4 ─ Web ──────────────────────────────────────────────────────────┐
│ web/src/modules/vastbase/                                                │
│   连接树 · Query · 对象面板 · 调试面板（断点 / 变量 / 堆栈）               │
│   ↑ bridgeInvoke(vastbase.*)          ↑ bridgeOnEvent(niuma:event)       │
└───┼───────────────────────────────────┼──────────────────────────────────┘
    │ cefQuery                           │ PostMessage
┌ Layer 3 ─ C++ Shell ───────────────────┴────────────────────────────────┐
│ bridge_router · platform_client · 事件回投 UI                            │
└───┼───────────────────────────────────▲──────────────────────────────────┘
    │ length-prefixed JSON               │ 事件帧
┌ Layer 2 ─ platform-core（Go）──────────┴────────────────────────────────┐
│ platform.connection.* / credential.* + vastbase.* 代理 + 凭据注入        │
└───┼───────────────────────────────────▲──────────────────────────────────┘
    │ length-prefixed JSON               │ debug.* / query 进度事件
┌ Layer 1 ─ vastbase-service（Go + pgx）─┴────────────────────────────────┐
│ 会话池 · 树元数据 · query.exec · DebugManager（双连接） · eventpub       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ PG wire
                               ▼
                         Vastbase 实例
```

要点：

- **壳层与 platform-core 不写 Vastbase 业务逻辑**。
- **不引入 Java / JDBC / 外部 JVM 进程**。
- 常规查询与对象树走业务 `sessionId`；**调试由服务内 `DebugManager` 另开 server/debug 两条 `pgx` 连接**，不交给前端自行拼双连接。
- 海量对象：**树接口默认轻量**（仅 name/type），带 `filter` / `limit` / `truncated`；禁止对树中每一张表默认 `COUNT(*)`。

---

## 3. 工程布局

### 3.1 目录

```
services/
├── manifests/vastbase-service.yaml
└── vastbase-service/
    ├── go.mod
    ├── cmd/vastbase-service/
    │   └── main.go
    └── internal/
        ├── handler/          # IPC 方法分发（session / query / tree / debug.capabilities）
        │   ├── handler.go
        │   ├── session.go
        │   ├── query.go
        │   ├── tree.go
        │   └── log.go
        ├── session/          # ConnectParams、连接池、query.exec/cancel
        ├── tree/             # databases / schemas / tables / sequences / routines（轻量 + filter/limit）
        ├── meta/             # columns / indexes / ddl（P2，仅包文档）
        ├── debug/            # DebugManager 骨架 + capabilities 探测
        ├── eventpub/
        └── idgen/

web/src/modules/vastbase/
├── views/
│   ├── VastHome.vue
│   └── VastSession.vue
├── components/
│   ├── VastConnectionFields.vue
│   ├── VastQueryPane.vue
│   ├── VastTablePane.vue          # P2
│   ├── VastProcEditorPane.vue     # P3
│   └── VastDebugPane.vue          # P3
├── composables/
│   ├── useVastQuery.ts
│   └── useVastDebug.ts
├── conn-tree-provider.ts
├── conn-nav-strategy.ts
└── pane-registry.ts

web/src/api/
├── vastbase.ts
└── types/vastbase.ts
```

### 3.2 Manifest（草案）

```yaml
id: com.niuma.vastbase
name: Vastbase Service
version: 0.1.0
bridge:
  namespace: vastbase
  connection_kind: vastbase
session:
  inject_credentials: true
  credential_methods:
    - session.open
    - session.test
    - tree.databases
    - tree.schemas
    - tree.tables
    - tree.routines
    - tree.sequences
runtime:
  executable: bin/niuma-vastbase-service.exe
  executable_windows: bin/niuma-vastbase-service.exe
  executable_unix: bin/niuma-vastbase-service
  lang: go
ipc:
  transport_windows: named_pipe
  transport_unix: unix_socket
  address_windows: '\\.\pipe\niuma.vastbase'
  address_unix: '/tmp/niuma.vastbase.sock'
  protocol: length_prefixed_json
lifecycle:
  startup: lazy
permissions: []
```

### 3.3 Go 工作区与构建

- 根 `go.work` 追加 `services/vastbase-service`
- 构建产物：`services/bin/niuma-vastbase-service(.exe)`
- 纳入 `scripts/build-services.ps1`（与 mongodb / ftp 一致）

### 3.4 Web 注册 checklist

按 [21 §0.6](./21-session-registry.md) / [14](./14-capability-connection-framework.md) / [18 §4.3](./18-ops-connection-tree.md)：

1. `ops/types.ts` → `CONN_KIND_DEFS` 增加 `{ kind: 'vastbase', label: 'Vastbase', icon: '…', defaultPort: 5432 }`
2. `connection-form-adapter.ts` + `VastConnectionFields.vue` + `register-conn-form.ts`
3. `conn-nav-strategy.ts` + `conn-tree-provider.ts` → `register-conn-full.ts` 内注册
4. `ops/register-builtin-conn-kinds.ts` 挂 `loadForm` / `load`
5. `session-policy.ts`：`vastbase: { sharing: 'per_profile', idleMs: 60_000 }`
6. `extensions/registry/builtin-modules.ts` + Activity Bar（建议挂 **data** 分类）
7. `modules/vastbase/locale/{zh-CN,en-US}.ts`（由 `web/src/locale/index.ts` merge）
8. **无需**改壳层或 platform `*_proxy.go`

---

## 4. 数据模型与连接配置

复用现有表（见 [14](./14-capability-connection-framework.md)）：

| 表 | Vastbase 用法 |
|----|----------------|
| `nm_connection_profile` | `connection_kind = 'vastbase'` |
| `nm_credential_ref` | 密码（后期可扩证书） |
| `nm_profile_credential` | 站点绑定 |

### 4.1 `connection_options`（JSON）

```json
{
  "accentColor": "blue",
  "proxy": { "type": "none" },
  "tunnel": { "type": "none" },

  "database": "postgres",
  "ssl_mode": "prefer",
  "search_path": "",
  "application_name": "niuma-vastbase",
  "connect_timeout_seconds": 10,
  "statement_timeout_ms": 0,
  "exclude_system_schemas": true
}
```

| 字段 | 说明 | Phase |
|------|------|-------|
| `database` | 初始登录库 | P0 |
| `ssl_mode` | `disable` / `prefer` / `require` / `verify-ca` / `verify-full`；表单独立「SSL」Tab | P0 |
| `ssl_root_cert` / `ssl_cert` / `ssl_key` | libpq `sslrootcert` / `sslcert` / `sslkey` 本地 PEM 路径 | P0 |
| `search_path` | 可选，打开会话后 `SET search_path`；「高级」Tab | P1 |
| `client_encoding` | libpq `client_encoding`，默认 `UTF8`；「高级」Tab | P0 |
| `application_name` | `pg_stat_activity` 识别 | P0 |
| `connect_timeout_seconds` | 建连超时 | P0 |
| `statement_timeout_ms` | `0` = 不设置；「高级」Tab / Query 面板可覆盖 | P0 |
| `exclude_system_schemas` | 树默认隐藏 `pg_catalog` / `information_schema` 等 | P1 |
| `proxy` / `tunnel` | 与 Mongo / Redis 同形 | P4 |
| `accentColor` | 仅 Web | 已有约定 |

命名：Bridge 信封 camelCase；协议专属字段 **snake_case**（[14 §9](./14-capability-connection-framework.md)）。

### 4.2 默认端口

`5432`；`portNumber <= 0` 时由 `vastbase-service` 回退。

---

## 5. Bridge 方法契约

Web：`vastbase.*`。platform-core 剥前缀后转发。

### 5.1 会话（必选，P0）

| 方法 | 入参 | 返回 |
|------|------|------|
| `session.open` | `{ profileId }`（凭据由平台注入） | `{ sessionId, dialect? }`（`dialect` = `{ family, version?, versionNum?, capabilities[] }`；平台代理须整包透传） |
| `session.close` | `{ sessionId }` | `{ closed: true }` |
| `session.test` | `{ profileId }` 或连接参数 | `{ ok, message, version?, dialect? }` |

`session.open` / `session.test` 探测方言能力并写入 `dialect`；Web `session-registry` 缓存到 lease，各 Pane 只读 capability，禁止写死 `if vastbase`。`SELECT version()` 亦用于 UI 显示与 `DBE_PLDEBUGGER` 相关探测。

### 5.2 查询（对标 DBeaver / Navicat 分页游标）

| 方法 | 入参 | 返回 |
|------|------|------|
| `query.exec` | `{ sessionId, sql, limit?, timeoutMs?, requestId? }` | `{ columns, rows, rowCount, fetchedCount, hasMore?, resultSetId?, truncated?, durationMs, notices? }` |
| `query.fetch` | `{ sessionId, resultSetId, limit? }` | `{ rows, rowCount, fetchedCount, hasMore, resultSetId?, truncated?, durationMs }` |
| `query.close` | `{ sessionId, resultSetId? }` | `{ closed: true, count }` |
| `query.cancel` | `{ sessionId, requestId? }` | `{ cancelled: true }` |

约定（企业客户端语义）：

- `limit` = **页大小**（默认 1000，单页上限 10000），不是结果集硬截断。
- `hasMore: true` + `resultSetId`：服务端仍持有连接上的结果游标；UI 滚动 /「加载更多」/「全部加载」调用 `query.fetch`。
- `truncated: true`：仅触达服务端累计软上限（默认 100 万行）时出现，表示无法再续取。
- 新执行 / Tab 切换 / 会话关闭应 `query.close` 释放游标，避免占连接。
- 多语句批跑（Web 编排，非服务端 `execBatch`）：  
  - 拆句：`web/src/modules/sql-editor/split`（自研词法）。Vastbase 开启 `plsqlBlocks` + `dollarQuotes` + `oracleQQuotes`：裸 `CREATE PROCEDURE/FUNCTION … AS|IS`、`DECLARE`/`BEGIN` 匿名块体内 `;` 不拆；独立行 `/` 作结束符且不入提交 SQL。  
  - 执行前：有 `script.oracle_slash` 时 `prepareDialectExecSql` 剥离尾部 `/`。  
  - 编排：`useVastQueryPane` + `utils/query-batch.ts` — **严格顺序** `await query.exec`（禁止句间并发 / 禁止执行中重入）；绝对上限 **10000** 句；遇错停止；可中途 `query.cancel`。  
  - 「执行选中」与全文同一拆句器：选中完整过程体时按一句提交。  
  - 多结果 Tab：每个有结果集的语句一页（最多保留 **48** 个网格 Tab）；打开游标客户端封顶 **6**。  
  - 虚拟滚动：结果表 `RsTable virtual`；消息/批跑句列表 `RsVirtualList`。  
  - 勿在业务里裸 `split(';')`。
- **禁止**把超大结果一次塞进 IPC；导出海量数据后续走旁路落盘（不经结果网格）。

### 5.2.1 SQL 对象补全（对齐 [23](./23-sql-dialect-completion.md)）

基调对标 **DBeaver / Navicat**（客户端解析 + 元数据缓存 + 按需查库），**不是** MongoDB 整段 `suggest`。

| 方法 | 说明 |
|------|------|
| `catalog.schemas` | 按 `prefix` / `limit` 检索 schema；可 `truncated` |
| `catalog.tables` | 指定 schema 下按前缀检索表/视图 |
| `catalog.columns` | 指定表下列（可带 prefix） |

强制：

- 补全 **禁止** 用 `tree.*` 无前缀预拉假装全量目录（树默认 limit=500，且按 schema 懒加载）。
- Web：`monaco-sql-languages` 槽位 + 会话级 CatalogCache（编排见 [23](./23-sql-dialect-completion.md)）。
- 细节与反模式见 [23 — SQL 方言补全](./23-sql-dialect-completion.md)。

### 5.3 对象树（P1，轻量）

对齐 [18 §9](./18-ops-connection-tree.md) PostgreSQL 三级：

| 方法 | 入参 | 返回 |
|------|------|------|
| `tree.databases` | `{ profileId\|sessionId, filter?, limit? }` | `{ databases: [{ name }], truncated? }` |
| `tree.schemas` | `{ …, database, filter?, limit?, excludeSystem? }` | `{ schemas: [{ name }], truncated? }` |
| `tree.tables` | `{ …, database, schema, filter?, limit? }` | `{ tables: [{ name, type }], truncated? }` |
| `tree.sequences` | `{ …, database, schema, filter?, limit? }` | `{ sequences: [{ name }], truncated? }` |
| `tree.categoryCounts` | `{ …, database, schema }` | `{ tables, views, functions, procedures, sequences }`（对象数，非行数） |
| `meta.schemaOverview` | `{ …, database, schema }` | Schema 所有者 / 注释 / 分类对象数 |
| `meta.databaseOverview` | `{ …, database }` | 库属性（encoding / size）与粗粒度对象统计 |

`type`：`table` / `view` / `materialized_view` / `foreign_table`（按版本裁剪）。

**强制**：

- 树路径 **不调** 每表 `COUNT(*)` / 体积统计。
- 默认 `limit`（建议 500）；超限返回 `truncated` + UI 提示「请输入前缀过滤」。
- 展开分类子节点时 Web 可传更大 `limit`（≤ 5000）以展示大 schema（如 900 表）。
- `tree.categoryCounts`：返回 schema 下表/视图/函数/过程**对象数量**（轻量 COUNT，供分类节点 badge）；**不是**表行数。
- 树可用短连接或带缓存的只读 RPC；**禁止**用长会话副作用污染业务事务（对齐 [18 §5](./18-ops-connection-tree.md) 元数据会话分离原则）。

P3 扩展（同级或 schema 下分组节点）：

| 方法 | 说明 |
|------|------|
| `tree.routines` | 函数 / 存储过程列表（oid、name、kind、args 摘要） |
| `tree.packages` | 若版本支持包对象 |

### 5.4 元数据面板（P2）

| 方法 | 说明 |
|------|------|
| `meta.columns` | 列名、类型、可空、默认值 |
| `meta.indexes` | 索引定义 |
| `meta.constraints` | PK / UK / FK / Check |
| `meta.ddl` | 尽可能还原 `CREATE` 文本 |
| `meta.routineSource` | 函数 / 过程源码（`pg_get_functiondef` 或厂商等价） |
| `meta.dependencies` | 对象依赖 / 被依赖（`pg_depend`） |
| `meta.primaryKey` | 主键列名（数据浏览行内编辑用） |
| `meta.foreignKeys` | 外键结构化列映射（跳转父表） |
| `ddl.designPreview` / `ddl.designApply` | 可视化表设计：受控 ADD/DROP/RENAME/TYPE/NULL/DEFAULT |

### 5.5 调试（P3，企业级）

| 方法 | 说明 |
|------|------|
| `debug.capabilities` | 探测 `DBE_PLDEBUGGER` 是否可用、权限是否足够 |
| `debug.start` | 启动调试会话：turn_on → 异步执行例程 → attach |
| `debug.step` / `debug.next` / `debug.continue` / `debug.finish` / `debug.abort` | 步进控制 |
| `debug.breakpoint.add` / `delete` / `list` | 断点 |
| `debug.variables` / `debug.evaluate` / `debug.stack` / `debug.source` | 变量、`print_var` 观察值、堆栈、源码+行号（可缓存） |
| `debug.stop` | turn_off + 释放双连接 |

> 实现状态（v0.3）：双连接编排与 Debug 面板已落地；需环境安装 `dbe_pldebugger` 且账号具备 `gs_role_pldebugger`。

事件（`niuma:event`，经 eventpub）：

```ts
{
  type: 'vastbase.debug.state',
  debugId: string,
  state: 'starting' | 'attached' | 'paused' | 'running' | 'finished' | 'aborted' | 'error',
  funcoid?: number,
  line?: number,
  message?: string
}
```

可选：`vastbase.debug.paused` 携带 `line` / `stack` 摘要，减少前端轮询。

---

## 6. 存储过程调试设计（无 Java）

### 6.1 机制

Vastbase / openGauss 系调试依赖库内 **`DBE_PLDEBUGGER`**，对外是 **SQL 函数**，官方客户端用双 JDBC 连接编排；本仓库用 **两条 `pgx` 连接** 等价实现。

```
┌─ Frontend VastDebugPane ─────────────────────────────┐
│  断点 · 单步 · 变量 · 堆栈 · 当前行高亮（Monaco）      │
└───────────────┬──────────────────────────────────────┘
                │ vastbase.debug.* + events
┌─ DebugManager（vastbase-service）────────────────────┐
│  serverConn: turn_on(oid) → CALL/执行目标例程（挂起）  │
│  debugConn:  attach → step/next/continue/…           │
└───────────────┬──────────────────┬───────────────────┘
                │                  │
                ▼                  ▼
           Vastbase           Vastbase
         (target backend)   (debug / proxy API)
```

典型时序：

1. `debug.capabilities` → 检查扩展与权限。
2. `debug.start({ sessionId 或 profile, funcoid | schema+name, args })`  
   - 开 **serverConn**：`DBE_PLDEBUGGER.turn_on(oid)`（匿名块按厂商约定可能为 `0`）  
   - 异步在 serverConn 上执行目标存储过程 / 函数  
   - 开 **debugConn**：根据 turn_on 返回的 `nodename` / `port` 调用 `DBE_PLDEBUGGER.attach(...)`  
   - 推送 `attached` / `paused`（首句前）
3. UI 操作映射到 `step` / `next` / `continue` / 断点 / `info` 类函数。
4. 例程结束或 `abort` → 自动或显式 `turn_off`，关闭双连接。

### 6.2 约束

| 项 | 约定 |
|----|------|
| 连接归属 | **仅服务内**维护；前端只持有 `debugId` |
| 与业务会话 | 调试连接 **独立于** Query 用的 `sessionId`，避免事务/超时互相污染 |
| 权限 | 文档多要求管理员；失败时返回可读错误，不崩溃服务 |
| 触发器调用 | 厂商文档常标明 **不支持** 经 trigger 间接触发的调试；UI 注明 |
| 并发 | 每 `debugId` 一条调试会话；同用户可多 Tab，但需限流（如每 profile ≤ 2） |
| PoC | 实现 P3 前用脚本验证目标版本：`turn_on → exec → attach → next → variables` |

### 6.3 为何不需要 Java

| 论点 | 说明 |
|------|------|
| 公开 API 是 SQL | `DBE_PLDEBUGGER.*` / `pldbg_*` 类函数均可经任意线协议驱动调用 |
| 双连接是编排问题 | Go goroutine + context 取消足以表达 hang / attach 时序 |
| JDBC 非协议必需 | VDS「依赖 JDBC」指其客户端实现选型，不是协议锁定 |
| 桌面成本 | 不捆绑 JRE；与现有 Go/Rust 能力服务一致 |

若未来个别版本出现 **仅官方 JDBC 才能解析的类型/包调试差异**，再评估为 **可选独立工具**，**不改本模块「主路径无 Java」决策**；当前版本明确 **不做**。

---

## 7. 前端交互要点

### 7.1 连接树

- Provider：`database` → `schema` → **分类夹**（表 / 视图 / 函数 / 过程）→ 对象叶子。
- 展开走 `tree.*`；侧栏搜索以 **本地级联过滤**（RsTree `filter`）为主，保证输入即时；`tree.*.filter` 留给显式检索/超大 schema 场景，勿在每次按键时 invalidate 重拉已展开节点。
- 节点超限：展示前 N 条 + truncated 提示。
- 虚拟滚动：连接树子节点多时开启 `RsTree` `virtual`（与 UI 库能力对齐）。
- **双击**：可展开节点（库 / Schema / 分类）只展开/折叠；叶子（表 / 例程）才 `activate` 打开工作区。
- **刷新**：资源节点与可展开连接节点由 `OpsConnectionPanel` 统一追加「刷新」（`resource-refresh` / `conn-refresh`），Provider 无需实现。

#### 7.1.1 各层右键菜单（对齐 Navicat / DBeaver）

| 层级 | 已落地 | 规划（后置） |
|------|--------|--------------|
| **连接** | 连接/断开、刷新、新建数据库、新建查询、**实例属性 / 监控**、**备份/还原工具**、编辑/删除（面板基建） | — |
| **数据库** | 打开（**库概览**）、新建 Schema、新建查询、**工具**（转储 SQL / 执行 SQL / 备份还原 / 复制 shell 命令）、**改 Owner**、重命名/删除（系统库除外）、复制名称、**复制 CREATE DATABASE** | — |
| **Schema** | 打开（**Schema 概览**）、新建查询、**设 search_path（查询）**、**GRANT/REVOKE**、**改 Owner**、重命名/删除（系统 schema 除外）、复制名 / `库.schema` | — |
| **分类夹** | 新建对象、新建查询（绑 schema）、打开 Schema 概览、**批量 DROP 脚本**；面板统一刷新 | — |
| **表** | 浏览、查询、结构、DDL、设计、依赖、脚本（SELECT/COUNT/INSERT/UPDATE/DELETE）、**VACUUM/ANALYZE**、**导入/导出数据（COPY 旁路落盘向导）**、**GRANT/REVOKE**、重命名、截断、删除、复制名/限定名、复制 DDL | — |
| **视图** | 同表（无截断 / 无 VACUUM / 无导入导出）；**物化视图 REFRESH**；**编辑视图定义**；**GRANT/REVOKE** | — |
| **函数 / 过程** | 打开函数/存储过程（可编辑定义并应用）、生成调用、调试、依赖、**GRANT/REVOKE**、改 Owner、重命名、删除、复制名/限定名、复制 DDL（按 oid/args 消歧） | — |

**语义约定：**

- 「打开」库 / Schema → **概览面板**（属性 + 对象数量），不是进空查询。
- 「新建查询」→ 始终 `forceNew`；从 Schema / 分类入口时 Tab 绑定 `database + schema`（标题 `db.schema · 查询`，种子含 `SET search_path`）；从连接 / 库入口只绑库。
- 「实例属性 / 监控」→ `monitor` 面板（`meta.instanceOverview` / `meta.activity` / `meta.locks`）。
- 「导入/导出数据」→ `VastDataTransferDialog`：`dialogApi` 选本地路径，服务端 `COPY` 写/读文件（`io.exportCsv` / `io.importCsv`），不经结果网格。
- 「转储 / 执行 SQL 文件」→ `io.dumpSql` / `io.execSqlFile` 旁路落盘任务；结构+数据 dump 为 DDL + `COPY FROM STDIN`（`niuma-vastbase-dump/1`），执行端用协议 `CopyFrom` 吃数据段至 `\.`；文件不含 `CREATE DATABASE`，新建库需先建空库再导入。
- 堆转储选项（对齐 Navicat / DBeaver 常用项）：内容模式、表/视图/物化视图、CREATE SCHEMA、DROP IF EXISTS、TRUNCATE before data、排除系统 Schema；Schema 节点下可多选对象。完整逻辑备份走 `tools.*` / 本机 `vb_dump`。
- 「备份 / 还原工具」→ `tools` 面板（本机 `vb_dump` / `vb_restore`，组件包 `vastbase-tools`；支持格式/内容/schema·表过滤/并行/压缩/clean 等专业化参数）；「复制 shell 命令」按当前选项生成。`postgresql-client` 仅作通用 PG 备选。
- 「批量 DROP」「编辑视图」「GRANT」→ 生成 SQL 并打开查询编辑器审阅（不静默执行危险操作）。
- DDL 变更成功后：优先 `refreshPath` 局部刷新（如库下 schema 列表），否则 `refreshConnTreeRoot`。

#### 7.1.2 相关 API

| 方法 | 用途 |
|------|------|
| `tree.*` / `tree.categoryCounts` | 懒加载与分类数量 |
| `meta.schemaOverview` | Schema 概览 |
| `meta.databaseOverview` | 数据库概览 |
| `meta.instanceOverview` | 实例属性 |
| `meta.activity` / `meta.locks` | 活动会话 / 锁 |
| `meta.ddl` / `meta.routineSource` | 复制 DDL / 例程源码到剪贴板；编辑视图定义 |
| `ddl.script` / `ddl.exec` | 白名单 DDL（含库 / Schema 级；改 Owner） |
| `io.exportCsv` / `io.importCsv` | 表级 CSV COPY 旁路落盘 |
| `io.dumpSql` / `io.execSqlFile` | Dump / Execute SQL 文件 |
| `io.cancel` | 取消 IO 任务 |
| `tools.detect` / `tools.dump` / `tools.restore` / `tools.cancel` | 本机 vb_dump / vb_restore（`options` 专业化参数） |

**UI 约定：** 对话框 / 工具栏 / 表格 / 空态一律使用 `@niuma/ui`（`RsDialog`、`RsToolbar`、`RsTable`、`RsSelect` 等），禁止业务模块自造原生表单控件外壳。

### 7.2 Session Tab

| 面板 | Phase |
|------|-------|
| Query（Monaco sql + 结果 RsTable） | P0 |
| 表浏览 / 元数据 / 设计 / 依赖 | P2 |
| Schema / 数据库概览 | P2+ |
| 过程源码编辑 + 调试 | P3 |
| Monitor（实例 / 会话 / 锁） | P4 |
| Tools（vb_dump / vb_restore） | P4 |
| 表级 CSV / Dump SQL 旁路落盘 | P4 |

导航：双击表打开浏览；右键过程「调试」打开 Debug 面板；连接右键「实例属性 / 监控」打开 Monitor；双击可展开节点只展开树。

### 7.3 调试 UI（P3）

- 源码区：Monaco，断点 gutter，当前行高亮
- 右栏：变量、调用堆栈
- 工具条：启动 / 继续 / 单步进入 / 单步跳过 / 中止
- 启动前：参数输入对话框（与 VDS 类似）
- 能力探测失败：灰掉调试入口并说明原因（未装插件 / 非管理员）

### 7.4 Session Registry

```ts
// session-policy.ts
vastbase: { sharing: 'per_profile', idleMs: 60_000 }
```

- Tab `release` 不立即断物理连接（idle 回收）。
- 用户「断开」→ `disconnect(profileId)`；服务端应级联 `debug.stop` 与未完成 `query.cancel`。

---

## 8. 海量对象与性能

承接「海量库」原则，Vastbase 一并遵守：

| 场景 | 要求 |
|------|------|
| 库 / schema / 表极多 | `filter` + `limit` + `truncated`；树不拉统计 |
| 查询大结果 | 默认页大小 + 服务端游标 `query.fetch`；表格虚拟滚动；导出不经 IPC 扛全量 |
| 调试 | 事件推送；避免每步全量拉源码（`debug.source` 缓存） |
| 元数据缓存 | 复用 `connMetadataCache` TTL；编辑对象后 `invalidate(profileId)` |

---

## 9. 实施分期与验收

| 阶段 | 交付 | 验收 |
|------|------|------|
| **P0** | 服务骨架、manifest、kind 注册、session、query.exec/cancel、Query 面板 | 保存站点 → Test → 开会话 → `SELECT 1` 出结果 |
| **P1** | tree.* + conn-tree-provider + 虚拟滚动/过滤 | 展开见库/模式/表；超限 truncated；无全量 collStats 类行为 |
| **P2** | 表预览、meta.*、结果集体验 | 双击表可看列与样例数据；DDL 可查看 |
| **P3** | routines + DebugManager + VastDebugPane | 在具备 DBE_PLDEBUGGER 的环境完成断点/单步/变量；无插件时优雅降级 |
| **P4** | Monitor、Explain、隧道、导出 | 与运维场景闭环 |

**建议动手顺序**：严格 P0 → P1；P3 前先做目标环境调试 PoC（Go 脚本即可）。

---

## 10. 非目标与约束

- **不引入 Java / JDBC / ODBC / CLR 宿主**
- **不把协议逻辑写进 platform-core 或壳层**
- **不做**一期通用「所有 SQL 库」方言抽象；内核可复用 `internal/pg`，产品 kind 仍为 `vastbase`
- **不在**连接树默认展示行数 / 表大小（按需打开面板再查）
- 连接树上的全局对象全文搜索：P4 可选，非 P0
- Skills / MCP 工具：若需 AI 侧查库，走 **外部 MCP**，禁止编译进 platform（仓库规则）；总设计见 [24](./24-ai-assistant.md)

---

## 11. 风险与开放问题

| 风险 | 缓解 |
|------|------|
| 不同 Vastbase 版本 `DBE_PLDEBUGGER` 签名差异 | `debug.capabilities` 探测；按 version 分支；文档锁定实测版本 |
| Oracle 兼容语法 / 包对象不完整 | 默认 `proc.plsql_bare` + SAVEPOINT Probe；编辑器走内置 sql（suppress 能力）；AI 读 `capabilities`/`dialectRules` |
| SSL / 企业认证 | P0 覆盖常见 ssl_mode；LDAP 等后续 |
| 双连接在跳板/隧道下端口可达性 | `PrepareDialParams` 只启一次 SSH；server/debug 共用本地转发口；attach 用厂商 nodename/port |

**后续 backlog（仅 Vastbase）：**

- PACKAGE / synonym / trigger 树节点与 DDL 模板
- 真·PL/SQL Monaco grammar（当前内置 sql 已解误报）
- P2 表设计器完整对齐 Navicat

已落地（不再列入缺口）：连接树 `sequences` 分类、Browse「全表 CSV」走 `io.exportCsv`、调试结束清理 DBMS_OUTPUT helper。

> 其它数据库产品不列入本文 backlog；见各库模块文档（如 [25 — MySQL](./25-mysql-module.md)）。

开放问题（实现前确认）：

1. Activity Bar：独立 `vastbase` 模块 vs 挂在现有 `database` 占位下。
2. SQL 历史：优先落 `nm_sql_history`（见 [database-schema.md](./database-schema.md)）还是先 Tab 内本地。

---

## 12. 相关文档

| 文档 | 关系 |
|------|------|
| [14 — 能力连接框架](./14-capability-connection-framework.md) | namespace、凭据注入、新增服务 checklist |
| [18 — 运维连接树](./18-ops-connection-tree.md) | Provider 接口；本库树层级见本文 tree 章节 |
| [19 — MongoDB](./19-mongodb-module.md) | 其它能力服务模板（对照进程模型，非 SQL 混写） |
| [21 — 会话注册表](./21-session-registry.md) | `per_profile`、Tab 与 sessionId |
| [23 — SQL 方言补全基调](./23-sql-dialect-completion.md) | 共用 catalog 编排契约 |
| [13 — 服务目录布局](./13-service-layout.md) | manifests / bin / go.work |

---

## 13. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-14 | 初稿：Go + pgx、无 Java；树轻量；DBE_PLDEBUGGER 双连接调试；分期 P0–P4 |
| v0.2 | 2026-07-14 | P0 后端落地：`vastbase-service` 骨架、session/query/tree 轻量、debug/meta 包边界 |
| v0.3 | 2026-07-14 | Web：ConnKind / 表单 / 导航 / 树 / Session Registry / data 分类注册 |
| v0.4 | 2026-07-15 | 查询结果对标 DBeaver/Navicat：`query.fetch/close` 服务端游标 + Load more / Fetch all |
| v0.5 | 2026-07-16 | 连接树后置能力落地：Monitor、批量 DROP、编辑视图、CSV 入口、GRANT、备份脚本 |
| v0.6 | 2026-07-16 | 专业 IO：`io.*` COPY/Dump/Execute SQL 旁路落盘；`tools.*` + `postgresql-client` 组件包；树菜单对齐 Navicat/DBeaver |
| v0.7 | 2026-07-17 | `tools.*` 改用本机 `vb_dump` / `vb_restore`（组件包 `vastbase-tools`）+ 专业化参数；`postgresql-client` 降为 PG 备选 |
| v0.8 | 2026-07-20 | 产品方言对齐 Navicat：过程 PL/SQL 模板+`/`、拆句 plsqlBlocks、执行前剥 `/`、编辑器 suppress、AI dialect 注入、文案口径 |
| v0.9 | 2026-07-20 | **DialectFamily + CapabilitySet**：session.open 返回 dialect；模板/拆句/AI/编辑器读能力；删除写死 if vastbase 补丁路径 |
| v0.10 | 2026-07-20 | 方言缺口加固：SAVEPOINT 真实 Probe；suppress→genericsql；树新建 DDL 带 session caps；文案去永久禁令 |
| v0.11 | 2026-07-20 | 文档边界：剥离其它库混写；backlog / 关联改为只指 Vastbase + 共享契约 |
| v0.12 | 2026-07-20 | 缺口收口：`tree.sequences`、DBMS helper 清理、Browse 全表 CSV / SpreadsheetML 标注；侧栏搜索保持本地过滤 |
| v0.13 | 2026-07-20 | 调试不稳定面：同连接 turn_on、共享隧道、attach 超时分类、capabilities 角色探测、空 DBMS_OUTPUT 降噪 |
