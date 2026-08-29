# 18 — 运维连接树与资源子节点（Connection Tree & Resource Children）

> 版本：v0.3 · 日期：2026-07-20  
> 状态：**P0/P1 已实现**（Redis 库展开）；SQL 树扩展见 §9（实现细节在各库模块文档）  
> 关联：[14 — 能力连接框架](./14-capability-connection-framework.md) · [09 — App Shell](./09-web-app-shell.md) · [16 — SSH/SFTP](./16-ssh-sftp-module.md) · [22 — Vastbase](./22-vastbase-module.md) · [25 — MySQL](./25-mysql-module.md)

---

## 1. 目标与范围

在现有运维侧栏连接树（文件夹 + 连接站点）之上，为 **Redis、后续 SQL 数据库** 等协议增加**可懒加载的虚拟子节点**，使用户能：

- 展开连接查看下级资源（如 Redis 逻辑库 `DB 0`…`DB 15`）
- 双击资源节点打开对应会话 Tab（并带上库号等上下文）
- 会话内切换库时与树高亮保持同步（Phase 2）

### 1.1 本期范围（Phase 0–1）

| 项 | 内容 |
|----|------|
| 基建 | 节点类型扩展、`res:*` 键空间、Provider 注册表、RsTree lazy 接线 |
| Redis | 连接下展开逻辑库；双击 `DB n` 打开 Redis Tab 并 `SELECT n` |
| 元数据 | 新增轻量 `redis.tree.databases`（短连接探测，与操作会话分离） |
| 导航 | `useConnectionNavigation` 支持 `resourcePath`；Tab props 传 `database` |

### 1.2 暂不纳入

- 连接树上的**全局对象搜索**（对标 DBeaver「数据库导航器」全文检索）
- Redis key 前缀树（Phase 3 可选）
- 各 SQL 库完整对象树（按库分期；接口预留见 §9，实现见 [22](./22-vastbase-module.md) / [25](./25-mysql-module.md)）
- 资源节点拖放、收藏夹、DDL 右键菜单
- 树上展示实时「已连接」绿点（Phase 2）

### 1.3 产品定位（对标主流）

| 对标 | 关系 |
|------|------|
| **VS Code + SQLTools** | 最接近：侧栏一棵树 + 扩展贡献子节点 |
| **DBeaver / Navicat** | 借鉴元数据分层与缓存，但不复制独立「对象导航器」双面板 |
| **RedisInsight / ARDM** | Redis 仅 1–2 层（连接 → DB），不做 SQL 式深树 |

NiuMa 是**运维连接壳**（SSH / FTP / Redis …），不是完整 DBA IDE；设计取 **VS Code 式插件树 + DBeaver 式元数据/会话分离**。

---

## 2. 核心概念：两层树

```
┌─ 组织层（持久化）────────────────────────────────────┐
│  folder:{uuid}     用户文件夹，SQLite nm_connection_organization │
│  conn:{profileId}  连接站点，SQLite nm_connection_profile        │
└───────────────────────────┬──────────────────────────┘
                            │ expand + lazy load
┌─ 资源层（虚拟）───────────▼──────────────────────────┐
│  res:{profileId}:db:0                         Redis 逻辑库        │
│  res:{profileId}:database:mydb                MySQL 库（见 25）   │
│  res:{profileId}:database:mydb:table:users    MySQL 表            │
│  res:{profileId}:database:…:schema:…:table:…  Vastbase 等（见 22）│
└───────────────────────────────────────────────────────────────────┘
```

> 段名与层级以**各库模块文档**为准；本文只约定 `res:` 键空间与 Provider 接口，禁止在 ops 基建里写死某一库的 SQL。

| 层级 | Key 前缀 | 持久化 | 可拖放 | 数据来源 |
|------|----------|--------|--------|----------|
| 文件夹 | `folder:` | SQLite `nm_connection_organization` | 是 | `platform.connection.organization.*` |
| 连接 | `conn:` | SQLite | 是 | `platform.connection.*` |
| 资源 | `res:` | **否** | **否** | 各能力服务元数据 API + 内存缓存 |

**原则**：`rootOrder`、文件夹 `profileIds` 只引用 `conn:{profileId}`，**永不写入** `res:*`。

---

## 3. 节点模型

### 3.1 TypeScript 类型（`useConnTree.ts`）

```ts
/** 文件夹（已有） */
export interface ConnFolderNode extends RsTreeNode {
  _type: 'folder'
  _folder: ConnFolder
}

/** 连接站点（改造：部分 kind 可展开） */
export interface ConnLeafNode extends RsTreeNode {
  _type: 'conn'
  _conn: ConnItem
  _searchText: string
  /** false 当且仅当该 kind 注册了 ConnTreeChildProvider 且 canExpand(conn) */
  // isLeaf 由 RsTreeNode 承载
}

/** 连接下的虚拟资源（新增） */
export interface ConnResourceNode extends RsTreeNode {
  _type: 'resource'
  _conn: ConnItem
  /** 结构化路径，用于导航、Tab props、缓存键 */
  _path: ConnResourcePath
  /** 预计算搜索文本（小写） */
  _searchText: string
  /** 可选角标，如 key 数量 */
  _badge?: string
}

export type ConnTreeNode = ConnFolderNode | ConnLeafNode | ConnResourceNode
```

### 3.2 资源路径

```ts
/** 从根连接向下的分段路径；各协议自定义 kind 字符串 */
export interface ConnResourcePath {
  segments: Array<{ kind: string; name: string }>
}

// Redis DB 3:
// { segments: [{ kind: 'db', name: '3' }] }

// MySQL 表 users @ database myapp（见 25；段名用 database，非 schema）:
// { segments: [
//     { kind: 'database', name: 'myapp' },
//     { kind: 'table', name: 'users' },
//   ]}
```

### 3.3 Key 编码与解析

```ts
// 现有（不变）
folderTreeKey(id)  → `folder:${id}`
connTreeKey(id)    → `conn:${profileId}`

// 新增
resourceTreeKey(profileId, path) → `res:${profileId}:${path.segments.map(s => `${s.kind}:${s.name}`).join(':')}`
// 例: res:abc-uuid:db:3

parseTreeKey(key):
  | { type: 'folder'; id: string }
  | { type: 'conn'; id: string }          // id = profileId
  | { type: 'res'; profileId: string; path: ConnResourcePath }
```

**约束**：`name` 段禁止含未转义的 `:`；协议侧对库名/表名做 URL 编码或 base64url（各库模块落地时自定）。

---

## 4. Provider 注册表

对齐 [connection/registry.ts](../web/src/modules/connection/registry.ts) 模式，新增 **连接树子节点 Provider**。

### 4.1 接口

```ts
// web/src/modules/ops/conn-tree/registry.ts

export interface ConnResourceDescriptor {
  path: ConnResourcePath
  label: string
  icon?: string
  badge?: string
  /** 是否还可展开（如 schema 下还有 table） */
  collapsible: boolean
}

export interface ConnTreeChildProvider {
  /** 该连接在树上是否显示展开箭头 */
  canExpand(conn: ConnItem): boolean

  /**
   * 懒加载直接子节点。
   * parentPath === undefined → 连接下的第一层（如 Redis 的 DB 列表）
   */
  loadChildren(
    conn: ConnItem,
    parentPath?: ConnResourcePath,
  ): Promise<ConnResourceDescriptor[]>

  /** 双击资源节点时的默认动作（通常 openTab + 上下文） */
  activate?(conn: ConnItem, path: ConnResourcePath): void
}

export function registerConnTreeProvider(kind: string, provider: ConnTreeChildProvider): void
export function getConnTreeProvider(kind: string): ConnTreeChildProvider | undefined
```

### 4.2 注册时机（懒加载）

`main.ts` 在 `app.mount()` 前只调用 **`registerBuiltinConnKindLoaders()`**，登记各协议的动态 import 入口，**不**静态拉入实现。

| API | 何时触发 | 加载内容 |
|-----|----------|----------|
| `ensureConnKindForm(kind)` | 新建 / 编辑连接对话框 | `register-conn-form.ts`（adapter + 表单字段） |
| `ensureConnKind(kind)` | 展开树、连接导航、Tab↔树同步等 | `register-conn-full.ts`（表单 + 导航 + 树 + 可选 tab-sync） |

```ts
// web/src/modules/ops/register-builtin-conn-kinds.ts（示意）
registerConnKindLoader('redis', {
  tree: true,
  loadForm: () => import('@/modules/redis/register-conn-form').then((m) => m.registerForm()),
  load: () => import('@/modules/redis/register-conn-full').then((m) => m.registerFull()),
})
```

`useConnectionProfiles` 进入面板/模块页时会 `prefetchConnKindForms`，降低首次打开对话框的等待。

### 4.3 新增协议 Checklist

1. `ops/types.ts` → `CONN_KIND_DEFS` 追加 kind
2. `modules/<kind>/connection-form-adapter.ts` + `*ConnectionFields.vue`
3. `modules/<kind>/register-conn-form.ts`（`registerForm`）
4. （可选）`conn-tree-provider.ts` / `conn-nav-strategy.ts` / `conn-tree-tab-sync.ts`
5. `modules/<kind>/register-conn-full.ts`（`registerFull`：调用 `registerForm` + 树/导航等）
6. `register-builtin-conn-kinds.ts` 追加 `loadForm` / `load` 一行
7. 能力服务实现 `xxx.tree.*`（若有树；**禁止**复用长会话 `session.open` 做树展开）
8. 模块文案放 `modules/<kind>/locale/{zh-CN,en-US}.ts`，由 `web/src/locale/index.ts` merge

**无需修改**：`OpsConnectionPanel.vue` 主体、`useConnFolders` 组织 JSON 形状（现写入 `nm_connection_organization`）。

---

## 5. 元数据层 vs 操作会话（关键）

### 5.1 问题

若侧栏每展开一个连接就 `redis.session.open`，会导致：

- 多连接同时展开 → 多个长连接占用
- 树状态与 Tab 内 session 生命周期纠缠
- 不符合 DBeaver / VS Code 数据库扩展的常规做法

### 5.2 分层

```
┌─ Web ─────────────────────────────────────────────────────────┐
│  OpsConnectionPanel / ConnTreeChildProvider                   │
│       ↓                                                        │
│  ConnMetadataCache（内存 Map + TTL + 并发去重）                │
└───────┼────────────────────────────────────────────────────────┘
        │ bridgeInvoke
┌───────▼────────────────────────────────────────────────────────┐
│  redis.tree.databases   短连接 | 只读 | 可缓存 2–30s             │
│  redis.session.open     用户 Tab | 长连接 | SELECT / SCAN …    │
└────────────────────────────────────────────────────────────────┘
```

| 用途 | Bridge 方法 | 连接生命周期 |
|------|-------------|--------------|
| 树展开列库 | `redis.tree.databases` | 请求内建连 → INFO keyspace → 断开 |
| 用户操作 | `redis.session.open` | Tab 打开至关闭 |

### 5.3 Redis 元数据 API（新增）

**方法**：`redis.tree.databases`

**入参**：

```ts
interface RedisTreeDatabasesParams {
  profileId: string
}
```

**返回**：

```ts
interface RedisTreeDatabasesResult {
  /** 服务器配置的 databases 数量（CONFIG GET databases，默认 16） */
  databaseCount: number
  /** 有 key 的库（来自 INFO keyspace） */
  keyspace: Array<{ db: number; keys: number }>
  /** 连接配置中的默认库（保证出现在列表中） */
  defaultDatabase: number
}
```

**实现位置**：`services/redis-service` 新增 handler；逻辑复用 `parse_keyspace_sections`，建连后 `INFO keyspace` + `CONFIG GET databases`（失败则回退 16），**不**创建 `sessionId`。

**缓存**：Web 侧 `ConnMetadataCache` 默认 TTL **15s**；同一 `profileId` 并发请求合并为一次 flight。

---

## 6. RsTree 集成

### 6.1 现有能力

`packages/ui/src/components/RsTree.vue` 已支持：

- `lazy: boolean`
- `loadData(node, key): Promise<void>` — 展开时若 `children` 为空则调用
- `virtual` — 运维树已开启

### 6.2 连接节点改造

```ts
function makeLeaf(conn: ConnItem): ConnLeafNode {
  const provider = getConnTreeProvider(conn.kind)
  const expandable = provider?.canExpand(conn) ?? false

  return {
    key: connTreeKey(conn.profileId),
    label: conn.profileName,
    isLeaf: !expandable,
    children: expandable ? [] : undefined,  // lazy：占位空数组
    _type: 'conn',
    _conn: conn,
    _searchText: `${conn.profileName} ${conn.hostAddress}`.toLowerCase(),
  }
}
```

### 6.3 `useConnTreeChildren`（新 composable）

职责：

1. 维护 `loadedChildren: Map<string, ConnResourceNode[]>`（key → 子节点列表）
2. 实现 `loadData(node, key)`：
   - 解析 key → 取 `conn` + `parentPath`
   - 调 Provider `loadChildren`
   - 写入 cache 并 patch 到树（通过 `mergeChildrenIntoTree` 或响应式 nodes 重算）
3. 提供 `invalidate(profileId?)` 供刷新按钮 / 连接编辑后调用

### 6.4 OpsConnectionPanel 改动摘要

```vue
<RsTree
  lazy
  :load-data="treeChildren.loadData"
  ...
/>
```

```ts
function onNodeDblclick(node: RsTreeNode) {
  const n = node as ConnTreeNode
  if (n._type === 'conn') { connect(n._conn); return }
  if (n._type === 'resource') {
    const p = getConnTreeProvider(n._conn.kind)
    if (p?.activate) p.activate(n._conn, n._path)
    else connect(n._conn, { resourcePath: n._path })
  }
}

function allowTreeDrop(...) {
  if (dragKey.startsWith('res:') || dropKey.startsWith('res:')) return false
  // 其余不变
}
```

### 6.5 模板 `#title` 分支

在 `folder` / `conn` 之外增加 `resource` 行渲染：

- 图标：`database`（DB）、`table`（表）等，由 descriptor 指定
- 可选 badge：`128 keys`
- **无**右键菜单（Phase 1）；Phase 2 可接 `ConnResourceCommand` 注册表

### 6.6 搜索

扩展 `connTreeSearchMatch`：

```ts
if (node._type === 'resource') return node._searchText.includes(q)
```

---

## 7. 导航与 Tab

> **Tab 栈分层**：本节描述 **L3 连接导航**（树 → Tab）与 **L1 Tab Store** 的协作。
> 物理会话（`sessionId`）属 **L4 Session Registry**，见 [21 — Session Registry §0](./21-session-registry.md#0-tab-管理架构总览)。
> Shell 渲染与 keep-alive 属 **L2**，见 [09 §6.3](./09-web-app-shell.md#63-渲染与保活moduleworkspacevue)。

### 7.0 在 Tab 架构中的位置

```
连接树双击 / Provider.activate
        ↓
useConnectionNavigation.connect()     ← 本节（L3）
        ↓
tabStore.openTab / activateTab        ← L1（docs/09 §6）
        ↓
ModuleWorkspace 挂载 *Session.vue     ← L2 keep-alive
        ↓
sessionRegistry.acquire / release     ← L4（docs/21）
```

**L3 只做**：经 `ConnectionNavStrategy` 构造 Tab props / 去重；**不做** `session.open/close`。

### 7.1 策略注册表（`connection-nav`）

```
connect(item, ctx)
  → ensureConnKind(item.kind)            // 懒加载完整注册
  → getConnectionNavStrategy(item.kind)  // registry.ts
  → strategy.buildTabSpec(item, ctx)     // modules/*/conn-nav-strategy.ts
  → [dedupFocus] findExistingTab → activateTab
  → tabStore.openTab(spec)
```

| 文件 | 职责 |
|------|------|
| `ops/composables/useConnectionNavigation.ts` | 薄编排，**不含** `switch(kind)`；先 `ensureConnKind` |
| `ops/connection-nav/types.ts` | `ConnectionNavStrategy` 接口 |
| `ops/connection-nav/registry.ts` | `register` / `get` |
| `ops/connection-nav/utils.ts` | Redis DB / Mongo 库表路径解析、标题 |
| `ops/register-builtin-conn-kinds.ts` | 内置 kind → `loadForm` / `load` 入口 |
| `ops/conn-kind-loaders.ts` | `ensureConnKind` / `ensureConnKindForm` / prefetch（表单 chunk 内同步含字段组件） |
| `ops/conn-tree/tab-sync.ts` | Tab↔树聚焦策略 |
| `ops/conn-tree/registry.ts` | Provider + **响应式** ActionHost 列表 |
| `modules/*/register-conn-full.ts` | 各协议完整自注册（含 nav strategy） |
| `modules/{ssh,ftp,redis,mongodb,mysql,vastbase}/conn-nav-strategy.ts` | 各协议实现 |

**新增协议**：实现 `conn-nav-strategy.ts` → 在本模块 `register-conn-full.ts` 内 `registerConnectionNavStrategy` → `register-builtin-conn-kinds.ts` 挂 loader → 无需改 Panel。

```ts
// modules/mysql/conn-nav-strategy.ts（示例）
export const mysqlConnectionNavStrategy: ConnectionNavStrategy = {
  kind: 'mysql',
  dedupFocus: true,
  buildTabSpec(item, ctx) { /* props + title */ },
  findExistingTab(tabs, spec) { /* 可选 */ },
}
```

### 7.2 Tab 打开策略（已实现）

实现位置：各 `modules/*/conn-nav-strategy.ts`；编排见 `useConnectionNavigation.ts`。

| 模块 | 连接树双击 / 右键「连接」 | 去重聚焦 |
|------|---------------------------|----------|
| **SSH / FTP** | **每次新建 Tab** | 否（每 Tab 独立会话，`session-policy` per_tab） |
| **Redis** | **每次新建 Tab** | 否（同 DB 多 Tab 共享 lease，见 [21 §3.3](./21-session-registry.md)） |
| **MongoDB** | 同库/集合已开 → **聚焦** | 是（`profileId` + `database` + `collection`） |
| **分屏 `Ctrl+\`** | 新建 Tab | — |

| 场景 | 行为 |
|------|------|
| SSH/FTP/Redis 同站点再次双击 | **新建** Tab（可多终端 / 多窗口） |
| MongoDB 同 profile + 同库 + 同集合 | **聚焦**已有 Tab |
| Redis 双击不同 DB 子节点 | 各建 Tab，标题 `· DBn` |
| `Ctrl+\` 分屏 | 复制 props 新建 Tab |

### 7.3 RedisSession

```ts
defineProps<{
  profileId: string
  /** 来自树节点或 Tab props；覆盖 connectionOptions.database */
  database?: number
}>()
```

打开会话后：`redisDb.reset(props.database ?? profileDefault, topology)`（**已实现** `useRedisDatabase`，仅需接 prop）。

### 7.4 树 ↔ Tab 同步（Phase 2，已实现）

- Tab 内 `SELECT` / 下拉切库 → `useConnTreeSyncStore.requestFocus` → 侧栏 `RsTree.focusNode`
- 切换激活 Tab → `OpsConnectionPanel` 调用通用 `ConnTreeTabSyncStrategy.resolveFocusKey`（先 `ensureConnKind`）
- **Redis 业务**在 `modules/redis/conn-tree-tab-sync.ts`，经 `registerConnTreeTabSync` 注册；面板不含 `moduleId === 'redis'` 分支
- 多 Tab 场景通过 `tabId` prop 保证仅**激活会话**上报库变更（`ModuleWorkspace` 注入）

---

## 8. Redis Provider 细则

### 8.1 `canExpand`

```ts
canExpand(conn) {
  const { topology } = readRedisDatabaseFromOptions(conn.connectionOptions)
  return topology !== 'cluster'  // Cluster 仅 db0，不按库展开
}
```

### 8.2 `loadChildren`（第一层）

1. 调 `redisApi.treeDatabases({ profileId })`
2. 合并集合：`defaultDatabase` ∪ `keyspace[].db`，排序
3. 若 API 失败：**降级**为 `0..15` 静态列表（badge 为空）
4. 映射为 `ConnResourceDescriptor`：

```ts
{
  path: { segments: [{ kind: 'db', name: String(db) }] },
  label: `DB ${db}`,
  icon: 'database',
  badge: keys > 0 ? String(keys) : undefined,
  collapsible: false,  // Phase 1 不展开 key 前缀
}
```

### 8.3 `activate`

```ts
activate(conn, path) {
  connect(conn, { resourcePath: path })
}
```

---

## 9. SQL / 多协议树扩展（预留接口）

同一 **Provider 接口**；**层级与 ResourceId 段名按协议分文档实现**，勿在本文混写多库 SQL：

| 协议 | 典型层级 | ResourceId 段（示意） | 实现文档 |
|------|----------|----------------------|----------|
| Redis | 连接 → DB | `db` | 本文 § Redis |
| MySQL | 连接 → database → table | `database` / `table` | [25](./25-mysql-module.md) |
| MariaDB | 连接 → database → table（与 MySQL 同形，**独立 kind**） | `database` / `table` | [26](./26-mariadb-module.md) |
| Vastbase | 连接 → database → schema → table | `database` / `schema` / `table` | [22](./22-vastbase-module.md) |

元数据方法命名（namespace 随服务）：

```
{namespace}.tree.databases   / .schemas / .tables / .routines
```

**禁止**在 `platform-core` 或 `modules/ops` 基建内写某库业务 SQL；各能力服务独立实现，platform 仅代理（见 [14](./14-capability-connection-framework.md)）。

---

## 10. 工程布局（连接协议相关）

```
web/src/modules/ops/
├── register-builtin-conn-kinds.ts  # 内置 kind → loadForm / load
├── conn-kind-loaders.ts            # ensureConnKind(Form) / prefetch
├── conn-tree/
│   ├── registry.ts                 # Provider 注册表
│   ├── tab-sync.ts                 # Tab↔树聚焦策略注册表
│   ├── types.ts
│   ├── keys.ts
│   └── metadata-cache.ts
├── connection-nav/                 # L3 导航策略类型与注册表
├── composables/
│   ├── useConnTree.ts
│   ├── useConnTreeChildren.ts
│   └── useConnectionNavigation.ts
└── components/
    └── OpsConnectionPanel.vue      # 薄壳：编排 ensure + 策略，无协议业务分支

web/src/modules/<kind>/
├── connection-form-adapter.ts
├── register-conn-form.ts           # 对话框路径（轻）
├── register-conn-full.ts           # 完整：form + nav + tree + …
├── conn-nav-strategy.ts            # 可选
├── conn-tree-provider.ts           # 可选
├── conn-tree-tab-sync.ts           # 可选（如 Redis）
└── locale/{zh-CN,en-US}.ts
```

---

## 11. 实施分期

| 阶段 | 交付 | 验收 |
|------|------|------|
| **P0 基建** | 类型、key、registry、metadata-cache、useConnTreeChildren、Panel lazy 接线 | 单元测试 key 解析；展开连接触发 loadData |
| **P1 Redis** | `redis.tree.databases`、Provider、Tab props、Session database | 展开见 DB 列表与 key 数；双击 DB3 打开 Tab 且键空间为 DB3 |
| **P2 体验** | Tab 去重（✅）、树高亮同步、刷新缓存、加载/错误态 | 切库后树与 Tab 一致；失败显示重试 |
| **P3 Redis 深** | key 前缀子节点（可选） | 大数据量下 SCAN 分页 |
| **P4 SQL** | 各库自建 provider + tree API（勿混实现） | MySQL：database → table（[25](./25-mysql-module.md)）；Vastbase 见 [22](./22-vastbase-module.md) |

**动手顺序**：严格按 P0 → P1；P2 可与 P1 末尾并行。

---

## 12. 非目标与约束

- 资源节点**不参与**文件夹拖放与 `rootOrder` 持久化
- 不在 `toolsvc` / `platform` 内硬编码 Redis 树逻辑（[external-tools 规则](../.cursor/rules/external-tools-mcp-skills.mdc) 精神一致：协议逻辑在能力服务）
- SSH / FTP 连接保持叶节点（`canExpand === false`），行为不变
- 集群 Redis 不展开库节点

---

## 13. 测试要点

| 用例 | 预期 |
|------|------|
| 展开 Redis 单机连接 | 显示 DB 列表，有 key 的库显示 badge |
| 展开 Redis 集群连接 | 无展开箭头 |
| 双击 `DB 5` | 新 Tab，`database=5`，键空间扫描在 DB5 |
| 再次双击 `DB 5` | 聚焦已有 Tab（P2） |
| 拖放 `res:*` | 不允许 |
| 搜索 `db 3` | 匹配资源节点 label |
| `redis.tree.databases` 失败 | 降级 0–15，无 badge |
| 编辑连接后 | `invalidate(profileId)` 清缓存 |

---

## 14. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-09 | 初稿：两层树、Provider、元数据 API、Redis Phase 0–1 |
| v0.2 | 2026-07-20 | SQL 预留：按库分文档；MySQL ResourceId 改为 `database`（非 schema）；§9 指向 22/25 |
| v0.3 | 2026-07-20 | 连接协议改为按 kind 懒注册（`register-builtin-conn-kinds` + `ensureConnKind(Form)`）；Redis Tab↔树同步迁入 `conn-tree-tab-sync` |

---

## 15. 相关文档

- [14 — 能力连接框架](./14-capability-connection-framework.md)
- [09 — App Shell / Tab 工作区](./09-web-app-shell.md)
- [16 — SSH / SFTP（连接树共用约定 §8.1）](./16-ssh-sftp-module.md)
- [10 — Web 扩展体系](./10-web-extension-system.md)
- [22 — Vastbase](./22-vastbase-module.md)（本库树层级）
- [25 — MySQL](./25-mysql-module.md)（本库树层级）
