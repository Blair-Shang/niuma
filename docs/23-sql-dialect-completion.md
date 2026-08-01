# 23 — SQL 方言自动补全 / 智能提示（统一基调）

> 版本：v0.8 · 日期：2026-07-27  
> 状态：**基调已定**；**标准实现为 Bridge 隧道 LSP**（嵌在方言 `*-service`）  
> **迁移**：MySQL 已上 LSP；其余方言 **静默内置 `sql`**（不高亮 Worker、不报错），待各库 LSP 落地  
> 参考：DBeaver、Navicat（解析槽位 + 元数据）；协议形态对齐 Language Server Protocol  
> 关联：[14 — 能力连接](./14-capability-connection-framework.md) · [21 — 会话注册表](./21-session-registry.md) · [20 — 工具组件](./20-tool-components.md)  
> 各库实现：[22 — Vastbase](./22-vastbase-module.md) · [25 — MySQL](./25-mysql-module.md) · [26 — MariaDB](./26-mariadb-module.md) · [27 — SQLite](./27-sqlite-module.md) · [28 — Dameng](./28-dameng-module.md) · [29 — Oracle](./29-oracle-module.md) · [30 — ClickHouse](./30-clickhouse-module.md) · [31 — Kingbase](./31-kingbase-module.md)

---

## 0. 文档边界（勿混实现）

| 本文（共享基调） | 各库模块文档 |
|------------------|--------------|
| `catalog.*` / `lsp.*` **方法名**、prefix/limit/truncated 约定 | 该库 catalog SQL、database/schema 语义映射、嵌入解析器 |
| Web：薄 LSP 客户端、Monaco 绑定、遗留 Worker 编排 | 该库默认 Cap、Probe |
| 反模式与验收（方言无关） | 该库树 ResourceId、ConnectParams、分期 |

**禁止**：在本文展开某库的过程语法、调试、对象树细节；换库时只增该库服务 + 模块文档，**不重写本文编排**。

---

## 1. 决策摘要

| 决策项 | 选择 |
|--------|------|
| 产品对标 | **DBeaver / Navicat** 的 SQL 对象补全模式 |
| 语法 / 关键字 / 槽位 | **方言 Language Server**（嵌在对应 `*-service`）：**启发式定槽位** + **表别名绑定** + catalog；语法诊断用方言 parser |
| 传输 | **Bridge 隧道 LSP**（`{ns}.lsp.open|rpc|close` + `{ns}.lsp` 事件）；**不上 WebSocket** |
| 对象目录 | LS **进程内**调用同服务 `catalog` 实现；权威仍在库侧会话 |
| 连接树 `tree.*` | **仅懒加载导航**；禁止当全量目录预拉 |
| 前端 Worker | **标准路径不使用** monaco-sql-languages dialect Worker（内存高、方言有限） |
| 非整段 suggest RPC | **不做**「整段 SQL + 光标」独立 suggest 方法（能力走 LSP `textDocument/completion`）；MongoDB 除外见 [19](./19-mongodb-module.md) |

一句话：

> **Monaco Language Client（薄实现）↔ Bridge ↔ 方言 service 内 LSP；解析与关键字在服务端，catalog 进程内注入；前端只做高亮与协议适配。**

**迁移状态（v0.8）**

| 方言 | 语法路径 |
|------|----------|
| **MySQL** | Bridge LSP + TiDB parser（`editor.sql_lsp`） |
| Dameng | Bridge LSP + `dmparser`（分类/DML/例程诊断 + 工作 AST；`editor.sql_lsp`） |
| **Kingbase** | Bridge LSP + `kingbaseparser`（工作 AST + 兼容模式隔离；`editor.sql_lsp`） |
| **ClickHouse** | Bridge LSP + `clickhouseparser`（启发式 + 反引号；`editor.sql_lsp`） |
| 其余（Vastbase / PG / SQLite / Oracle…） | **静默**内置 Monaco `sql`（无 sql-languages Worker）；对象补全等 LSP 落地后再开 |

---

## 2. 为什么对标 DBeaver / Navicat

专业 SQL IDE 的共性：

1. **解析**语句与光标 → 判定要补 schema/database / 表 / 列 / 关键字（现落在 **LS**，非浏览器 Worker）。  
2. **元数据**：按前缀查系统目录（LS 调进程内 catalog）。  
3. **懒加载**：大库靠过滤、当前范围、limit。  
4. **结构变更要 Refresh**。  
5. **大对象库可降级**自动弹出（产品开关预留）。

不对齐 MongoDB `*.suggest`：NoSQL 壳语言依赖服务端目录；关系型走 LSP completion。

---

## 3. 分层与职责

```
┌─────────────────────────────────────────────────────────┐
│  Web：sql-editor/lsp + 方言 monaco-bootstrap            │
│  · Bridge 隧道 JSON-RPC；Monaco completion / markers    │
│  · Monarch 高亮；格式化可仍用 sql-formatter               │
└───────────────────────────┬─────────────────────────────┘
                            │ {ns}.lsp.*  + 事件 {ns}.lsp
┌───────────────────────────▼─────────────────────────────┐
│  Layer-1：各库独立进程（namespace 不同）                  │
│  · packages/go/sqllsp + 方言 DialectParser               │
│  · 进程内 Catalog → 原 catalog 查询实现                   │
└─────────────────────────────────────────────────────────┘
```

| 层 | 做 | 不做 |
|----|----|------|
| Web LSP 客户端 | 文档同步、补全请求、markers | 方言 AST、猜全库表 |
| `*.lsp.*` | JSON-RPC Language Server | 自建第二套 DB 连接 |
| 进程内 Catalog | 权威、可截断检索 | 解析用户 SQL 全文（由 parser） |
| `*.tree.*` | UX 懒加载 | 补全唯一数据源 |
| 遗留 `completionService` | 仅未迁方言 | 新方言标准路径 |

---

## 4. Bridge 契约

### 4.1 LSP（跨方言同名）

| 方法 | 入参 | 返回 |
|------|------|------|
| `lsp.open` | `sessionId`, `clientId` | `{ connectionId }` |
| `lsp.rpc` | `connectionId`, `sessionId`, `message`（JSON-RPC） | `{ message? }` 或 `{ ok: true }` |
| `lsp.close` | `connectionId`, `sessionId?` | `{ closed }` |

下行事件：`type: "{ns}.lsp"`，`connectionId` + `message`（如 `textDocument/publishDiagnostics`）。

Document URI：`niuma-sql://{ns}/{sessionId}/{editorId}`。

支持的 LSP 方法（MySQL / Dameng）：`initialize` / `initialized` / `textDocument/didOpen|didChange|didClose` / `textDocument/completion` / `textDocument/hover` / `textDocument/documentSymbol` / `textDocument/definition` / `textDocument/formatting`；诊断经 `publishDiagnostics`（MySQL：TiDB 语法 + catalog；Dameng：StmtClassify + DML/例程启发式语法 + catalog 语义 Warning）。

分层（MySQL / Dameng）：

| 层 | 职责 |
|----|------|
| 启发式 | 定 Expect 槽位（半成品友好） |
| TableRef 绑定 | 扫描 FROM/JOIN/UPDATE/INTO 的表+别名；`alias.` 解开为真实表；CTE/派生表为 Virtual，并提取 SELECT 投影列供补全 |
| Catalog | 填候选；语义诊断与 hover；`truncated` → `isIncomplete`；截断时不报未知对象 |
| 后置 | 过程/触发器体内完整语义、definition/rename |
| Dameng parser | `internal/dmparser`：分类 + DML/例程诊断 + 工作 AST（TableRef/DECLARE）+ **按会话兼容模式隔离**（native/oracle/mysql **禁止 Auto 并集混推**）+ 内置函数/例程补全；**无**完整 Oracle AST |

Dameng 兼容模式约定：

- 未探测到兼容模式（native/`CompatAuto`）：仅达梦基线关键字与原生内置函数。
- `oracle` / `mysql`：各自追加专属关键字与函数；互不并入对方。
- `niuma/setSuggestDatabase` 可带 `uri`，按文档隔离默认 schema。
- 标识符插入经 `IdentifierQuoter`（达梦 `"`，MySQL `` ` ``）。
- 例程壳层额外检查 DECLARE 区平衡与 IF/WHILE/LOOP/CASE 成对；catalog 表/例程/序列前缀检索使用 `UPPER(...) LIKE UPPER(?)`。
- 前端 attach：先 `onNotification`，再 `setSuggestDatabase(uri)`，再 `didOpen`，避免首诊丢失。

### 4.2 Catalog（仍保留；LS 内部与遗留前端共用形状）

命名空间随连接 kind：`vastbase` / `mysql` / …。**方法名与返回形状保持一致**：

| 方法 | 入参（核心） | 返回 |
|------|--------------|------|
| `catalog.schemas` | `sessionId`, `database?`, `prefix?`, `limit?`, `excludeSystem?` | `{ schemas: [{ name }], truncated? }` |
| `catalog.tables` | `…`, `schema`（或默认）, `prefix?`, `limit?`, `types?` | `{ tables: [{ name, type }], truncated? }` |
| `catalog.columns` | `…`, `schema`, `table`, `prefix?` | `{ columns: [{ name, dataType?, nullable? }], truncated? }` |

约定：

- `prefix` 为空：返回范围内前 N 条，**不代表全集**。  
- 默认 `limit` 建议 50～100；上限单独封顶（如 500）。  
- `truncated: true` 合法。  
- **字段名 `schema` 在协议层统一**；无 schema 的产品（如 MySQL）在**该模块文档**定义映射（例如 schema ≈ database），**不在本文写死某一库的 SQL**。  
- **SQLite**（[27](./27-sqlite-module.md)）：`schema` = `main` 或 ATTACH 别名；`catalog.schemas` 来自 `PRAGMA database_list`；无独立 database 层，Web 补全把 `defaultSchema` 默认为 `main`。
- **Dameng**（[28](./28-dameng-module.md)）：`schema` 对应达梦用户 / schema；目录由独立 `dameng.catalog.*` 提供，遵循同一 prefix、limit 与 truncated 契约。LSP：`dameng.lsp.*` + 事件 `dameng.lsp`；补全默认 schema 经协议字段 `database` 传递。
- **ClickHouse**（[30](./30-clickhouse-module.md)）：`schema` ≈ **database**（无独立 schema 层）；`catalog.schemas` ← `system.databases`；tables/columns ← `system.tables` / `system.columns`。
- **Kingbase**（[31](./31-kingbase-module.md)）：与 Vastbase 同形（database → schema → 对象）；目录由独立 `kingbase.catalog.*` 提供；**禁止**用 vastbase catalog 冒充。LSP：`kingbase.lsp.*` + 事件 `kingbase.lsp`；解析器为进程内 `kingbaseparser`（工作 AST + `sqlCompatibility` 隔离）；补全默认 schema 经协议字段 `database` 传递。

可选后期：`catalog.invalidate` / UI「刷新元数据」。

---

## 5. 前端编排

落位：`web/src/modules/sql-editor/lsp/` + 各模块 `monaco-bootstrap` / `getSuggestScope()`。

**LSP 路径（MySQL 等已迁）：**

```
编辑器挂载 + sessionId
  → lsp.open → initialize
  → didOpen / 防抖 didChange
  → completion / hover → Bridge lsp.rpc
  → publishDiagnostics 事件 → setModelMarkers
```

**遗留 Worker 路径（未迁方言）：**

```
光标触发
  → monaco-sql-languages Worker 槽位
  → CatalogCache → catalog.* RPC
```

---

## 6. 反模式

- 为 LSP 新开 WebSocket / 改壳层路由（与能力框架冲突）。  
- LS 自建第二套连接池。  
- 新方言继续加 monaco-sql-languages Worker。  
- 用 `tree.*` 当补全唯一数据源。  
- 无 prefix 预拉全库对象。

---

## 7. 验收（摘要）

- MySQL：无 `mysql.worker`；补全能出关键字 + 库/表/列；`alias.` / JOIN 后 WHERE 列并集合理。  
- Dameng：Bridge LSP + `dmparser`；关键字/schema/表/列补全；过程片段无 `DELIMITER`/反引号；半成品结构问题为 Hint；常见笔误（如 FORM）为 Error。  
- 语法错误有 markers（MySQL TiDB；Dameng 启发式）；未知表/列有 Warning（半成品与过程局部名降噪）。  
- Hover / DocumentSymbol / Definition（局部变量与表标识）可用。 
- 关 tab / `session.close` 后 `lsp.close`，无泄漏。  
- 未迁方言行为不回归。
