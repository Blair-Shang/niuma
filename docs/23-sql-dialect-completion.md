# 23 — SQL 方言自动补全 / 智能提示（统一基调）

> 版本：v0.5 · 日期：2026-07-20  
> 状态：**基调已定**；编排层跨方言共用；**各库 catalog / 树 / Cap 实现见各自模块文档**  
> 参考：DBeaver、Navicat（客户端语法分析 + 元数据缓存 + 按需查库）  
> 关联：[14 — 能力连接](./14-capability-connection-framework.md) · [21 — 会话注册表](./21-session-registry.md) · [20 — 工具组件](./20-tool-components.md)  
> 各库实现：[22 — Vastbase](./22-vastbase-module.md) · [25 — MySQL](./25-mysql-module.md) · [26 — MariaDB](./26-mariadb-module.md) ·（未来 Oracle 等单独立项）

---

## 0. 文档边界（勿混实现）

| 本文（共享基调） | 各库模块文档 |
|------------------|--------------|
| `catalog.*` **方法名**、prefix/limit/truncated 约定 | 该库 catalog SQL、database/schema 语义映射 |
| Web：completionService、CatalogCache、编排流程 | 该库 Monaco 语言包、默认 Cap、Probe |
| 反模式与验收（方言无关） | 该库树 ResourceId、ConnectParams、分期 |

**禁止**：在本文展开某库的过程语法、调试、对象树细节；换库时只增该库服务 + 模块文档，**不重写本文编排**。

---

## 1. 决策摘要

| 决策项 | 选择 |
|--------|------|
| 产品对标 | **DBeaver / Navicat** 的 SQL 对象补全模式 |
| 语法上下文 | **Web 客户端**（Monaco + 方言 parser） |
| 对象目录 | **各方言能力服务**提供同名 `catalog.*`；**会话级缓存**在 Web |
| 连接树 `tree.*` | **仅懒加载导航**；可喂缓存，禁止当全量目录预拉 |
| 多库扩展 | **同名 RPC + 共用编排**；语义差异写在模块文档，不写进本文 |
| 非整段 suggest | **默认不做**服务端「整段 SQL + 光标」suggest（MongoDB 除外，见 [19](./19-mongodb-module.md)） |

一句话：

> **前端解析槽位，后端按前缀检索对象；客户端缓存缺则补；DDL 后可刷新。各库只换 catalog 实现与语言包。**

---

## 2. 为什么对标 DBeaver / Navicat

专业 SQL IDE 的共性：

1. **本地解析**语句与光标 → 判定要补 schema/database / 表 / 列 / 关键字。  
2. **元数据 + 缓存**：未命中再查系统目录。  
3. **懒加载**：大库靠过滤、当前范围、limit。  
4. **结构变更要 Refresh**。  
5. **大对象库可降级**自动弹出（产品开关预留）。

不对齐 MongoDB `*.suggest`：NoSQL 壳语言依赖服务端目录；关系型走客户端 parser。

---

## 3. 分层与职责

```
┌─────────────────────────────────────────────────────────┐
│  Web：sql-editor（跨方言编排，无单库业务 SQL）            │
│  · completionService + CatalogCache                     │
│  · 各模块提供 getSuggestScope() / 方言 Monaco 注册       │
└───────────────────────────┬─────────────────────────────┘
                            │ catalog.schemas / tables / columns
┌───────────────────────────▼─────────────────────────────┐
│  Layer-1：各库独立进程（namespace 不同，方法名相同）       │
│  · 实现细节见 22 / 25 / …                                │
└─────────────────────────────────────────────────────────┘
```

| 层 | 做 | 不做 |
|----|----|------|
| Web 编排 | 槽位、别名、调 catalog、写缓存 | 猜全库表、无 prefix 预拉 |
| CatalogCache | 按 scope 短 TTL 去重 | P0 持久化磁盘 |
| `*.catalog.*` | 权威、可截断检索 | 解析用户 SQL 全文 |
| `*.tree.*` | UX 懒加载 | 补全唯一数据源 |

---

## 4. Bridge 契约（跨方言方法名）

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

可选后期：`catalog.invalidate` / UI「刷新元数据」。

---

## 5. 前端编排（共用）

落位：`web/src/modules/sql-editor/` + 各模块 `getSuggestScope()`。

```
光标触发
  → parser 给出 syntax 与 entities
  → active 面板 scope = { sessionId, database, defaultSchema?, table? }
  → 组装 catalog 请求（带 prefix）
  → CatalogCache → 未命中则 RPC → 合并关键字/snippets
```

槽位 → RPC（协议层通用；**具体 defaultSchema / database 含义由当前 kind 模块解释**）：

| 语法上下文 | 请求 |
|------------|------|
| schema / database 槽 | `catalog.schemas({ prefix })` |
| 表槽、无限定前缀 | schemas（可选）+ `tables({ schema: default, prefix })` |
| 表槽、已有 `x.` | `tables({ schema: x, prefix })` |
| 列槽 | 解析关系 → `columns({ schema, table, prefix? })` |

**prefix 解析**（方言无关，`completion/prefix.ts`）：

1. 优先 parser `wordRanges`。  
2. 否则 Monaco `getWordUntilPosition`（SQL `wordPattern` 含 `_`）。  
3. **必须**把 prefix 传给 `catalog.*`。  
4. `catalogLimitForPrefix(prefix)` 自适应；截断时提示继续输入。  
5. 已做前缀过滤的方言可关 `filterGraceful`。

多查询 Tab：仅当前激活面板注册 suggest scope。

---

## 6. 与既有能力的边界

| 能力 | 关系 |
|------|------|
| `tree.*` | 导航；可喂 CatalogCache；补全以 catalog 为准 |
| `meta.columns` | 结构面板；catalog 可委托更轻形状 |
| MongoDB suggest | **例外**，见 [19](./19-mongodb-module.md) |
| 关键字 / snippets | 语言包默认，与 catalog 合并 |

DialectFamily + CapabilitySet（编辑器 / 拆句 / 格式化 / AI）由**各库 Probe** 填充；共享层只读 Cap，规则见各模块文档。

---

## 7. 落地顺序（按模块，不混进度）

| 阶段 | 内容 | 文档 |
|------|------|------|
| 编排 P0 | CatalogCache + completionService + 首个方言 catalog | [22](./22-vastbase-module.md) |
| 编排增强 | 树展开写缓存、刷新元数据、truncated 提示 | 本文 |
| 下一库 | 该库 `*.catalog.*` + 语言包；**不改编排基调** | [25](./25-mysql-module.md) 等 |

---

## 8. 反模式

1. 打开查询 Tab 即无 prefix 狂拉 `tree.*`。  
2. 用 tree 高 limit 假装目录完整。  
3. 每个方言各写互不相通的补全协议（必须同名 `catalog.*`）。  
4. 半成品 SQL 一律丢服务端 suggest（除非单独立项）。  
5. 在本文或共享编排里堆叠多库特有 SQL / Cap 实现细节。

---

## 9. 验收标准（方言无关）

- 槽位能出合理对象候选（权限与 limit 内）。  
- 大库不拖死 UI / 打爆实例。  
- 新建对象后：刷新或再拉 prefix 后可见。  
- 新增一种库：只增 Layer-1 + 模块文档 + 语言注册，不重写编排。

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-15 | 初稿 |
| v0.2 | 2026-07-16 | 短前缀自适应 limit；pgsql filterGraceful |
| v0.2 | 2026-07-15 | Vastbase P0 catalog 落地 |
| v0.3 | 2026-07-15 | prefix 标准 |
| v0.4 | 2026-07-16 | 跨方言拆句词法能力表 |
| v0.5 | 2026-07-20 | **边界**：本文只保留共享契约；各库实现改指向 22/25，去掉混写落地清单 |
