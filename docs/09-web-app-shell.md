# 09 — Web App Shell 布局

> 版本：v0.6 · 日期：2026-07-04  
> **本文只描述布局结构与区域职责，视觉 token 与组件风格见 [08-web-design-system.md](./08-web-design-system.md)**
>
> v0.2：落地 Tab 工作区（多实例 + keep-alive 保活）、路由↔Tab 双向同步；设置入口移至 TopBar。  
> v0.3：Tab 拖拽排序、脏 Tab 关闭确认、Tab 列表持久化（localStorage）与启动对账恢复。  
> v0.4：Tab 右键菜单（关闭其他/右侧/全部）；持久化契约上移到 Platform 层（`platform.settings.*`，壳层零业务），localStorage 降级为缓存/回退；新增模块内部布局脚手架 `ModulePane`（module-sidebar + bottom-panel，SSH 模块首用）。  
> v0.5：**分屏编辑组（split editor groups）**——工作区从「单组多 Tab」升级为「多编辑组横向并排」，每组各一条 TabBar + 独立 `<keep-alive>`；支持组间拖拽分隔条调宽、跨组拖拽移动 Tab、`Ctrl/Cmd+\` 或 TabBar 按钮拆分。TabBar 从 AppShell 下沉到每个编辑组内。持久化改为 **Platform 唯一权威**（挂载前 `await hydrate()`），移除 localStorage 缓存/回退（桌面端 Platform 由壳层自动拉起、始终可用）。  
> v0.6：**设置页变为编辑器 Tab**——移除整页覆盖层（`settingsActive` / `/settings` 路由），引入 `internal-views.ts` 内置视图注册机制；TopBar 齿轮 / ⌘K 命令面板均通过 `tabStore.openSettings()` 以单例 Tab 方式打开设置，与普通模块 Tab 一样可保活/关闭/分屏，对齐 VS Code 行为。

---

## 1. 设计目标

NiuMa 是 **CEF 桌面运维工具**，Shell 布局需满足：

- 多模块（SSH、数据库、API、AI…）统一入口
- 多 Tab 并行（多个 SSH 会话、多个 SQL 窗口）
- 插件 UI 只能注入**工作区**，不能改全局框架
- 与 C++ 壳窗口/chrome 配合（无边浏览器 UI，自绘 Shell）

---

## 2. 整体结构（VS Code 模型）

```
┌─ TopBar（全宽）─ 品牌 | 拖拽 | 搜索 | 主题/设置 | — □ × ─────────────┐
├────┬──────────┬──────────────────────────────────────────────────────────┤
│Act │ Primary  │ TabBar + ModuleWorkspace                                  │
│Bar │ Side Bar │                                                           │
├────┴──────────┴──────────────────────────────────────────────────────────┤
│ StatusBar                                                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

### VS Code 对照

| VS Code | NiuMa | 组件 |
|---------|-------|------|
| Activity Bar | 领域切换（运维/数据/开发/AI/媒体/扩展） | `ActivityBar.vue` |
| Primary Side Bar | 当前领域下的模块列表 | `SideNav.vue` |
| Editor + Tabs | TabBar + ModuleWorkspace | `TabBar.vue` / `ModuleWorkspace.vue` |
| Command Palette | ⌘K / Ctrl+K（TopBar 搜索框弹出面板） | `CommandPalettePanel.vue` |
| Settings (gear) | TopBar 右侧齿轮 → 编辑器 Tab（单例，可保活/关闭/分屏） | `TopBar.vue` + `internal-views.ts` |
| Status Bar | 桥接状态、主题等 | `StatusBar.vue` |

**交互**：再点同一 Activity 图标可收起 Side Bar（同 VS Code）；`Ctrl+B` 切换侧栏显隐。

### 区域职责

| 区域 | 职责 | 谁实现 |
|------|------|--------|
| `TopBar` | 全宽顶栏：拖拽、命令搜索、主题、设置、窗口控制 | `web/src/shell/TopBar.vue` |
| `ActivityBar` | 一级领域切换、设置入口 | `web/src/shell/ActivityBar.vue` |
| `SideNav` | 当前 category 下的模块 | Shell 固定，读 `useShellStore.activeCategory` |
| `ModuleHeader` | 模块内工具栏 | 各 `modules/*` 可选注册 |
| `TabBar` | **每个编辑组各一条**：该组多 Tab（图标/标题/脏标记/关闭，中键关闭）+ 拆分/关组按钮 | Shell + `useTabStore` |
| `ModuleWorkspace` | **唯一**模块/插件 UI 挂载容器：横向并排渲染多个编辑组，每组 TabBar + `<keep-alive>` 保活；内置视图（设置等）与模块 Tab 统一渲染 | Shell |
| `StatusBar` | 全局状态展示 | Shell 固定 |

### SideNav 与 ModuleCategory

模块挂载到 `ModuleCategory`：`ops` · `data` · `devtools` · `ai` · `media` · `extensions`。  
Activity Bar 只显示**已有模块**的领域；SideNav 仅列出当前领域的模块。  
插件 manifest 可选 `module.category`，默认 `extensions`。

### 窗口 Chrome 策略

| 阶段 | 方案 | 说明 |
|------|------|------|
| **当前** | CEF **无边框** + Web 全宽 `TopBar` | 窗口按钮在 TopBar 最右侧（设置之后）；拖拽区在品牌 + 空白区 |
| **调试** | 启动参数 `--native-frame` | 恢复系统标题栏，便于对比 |
| **DevTools** | 保留原生边框 | 避免 Alloy/Chrome 样式冲突 |

拖拽：Web 侧 `-webkit-app-region: drag/no-drag` → `CefDragHandler::OnDraggableRegionsChanged` → `CefWindow::SetDraggableRegions`。

工作区 **无 max-width / 无全局 Card 包裹**；模块内自行布局（如 DB：左树 + 中编辑器 + 右属性）。

---

## 3. 路由结构

实际实现见 `web/src/router/index.ts`（hash 历史）：

```ts
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'shell',                       // 插件动态 addRoute('shell', ...) 挂到此
      component: () => import('@/shell/AppShell.vue'),
      children: [
        { path: '', redirect: '/ssh' },
        ...createModuleRoutes(),           // 由模块 registry 生成
      ],
    },
  ],
})
```

- **Shell 路由**（首页 `''` redirect）不可被插件覆盖
- **模块路由**由 registry（`createModuleRoutes()`）生成；插件在 `bootstrapExtensions` 里 `router.addRoute('shell', ...)` 动态追加
- **路由与 Tab 的关系**：模块内容**不再**直接经 `<router-view>` 渲染，而是由 `ModuleWorkspace` 按「当前激活 Tab」渲染（见第 6 节）。路由此时只承担两件事：
  1. 反映当前激活 Tab 所属模块，用于 ActivityBar / SideNav 高亮；
  2. 深链 / 刷新恢复：命中模块路由时自动为其打开 / 聚焦一个 Tab。
- **设置页**（v0.6+）不再有专属路由，而是以 `internal-views.ts` 中的 `SETTINGS_VIEW_ID` 作为内置 Tab 呈现；TopBar 齿轮 / 命令面板调用 `tabStore.openSettings()` 打开。

---

## 4. 组件文件规划

```
web/src/shell/
├── AppShell.vue              # 根布局容器（全局快捷键 ⌘K / Ctrl+B / Ctrl+I）
├── TopBar.vue                # 全宽顶栏（拖拽 + 命令搜索 + AI + 设置齿轮 + 窗口控制）
├── AppBrandIcon.vue          # 品牌图标
├── WindowControls.vue        # 最小化 / 最大化 / 关闭（无边框窗口）
├── ActivityBar.vue           # 一级领域切换（图标列，不含设置/AI 入口）
├── SideNav.vue               # 当前领域模块列表
├── TabBar.vue                # 编辑组 Tab 条（每组各一条）
├── ModuleWorkspace.vue       # Tab 内容区（多编辑组 keep-alive；模块 + 内置视图统一渲染）
├── AiPanel.vue               # 全局 AI 助手面板（右侧常驻，Ctrl+I 开关；设计见 [24](./24-ai-assistant.md)）
├── CommandPalettePanel.vue   # ⌘K 命令面板（TopBar 弹出）
├── StatusBar.vue             # 全局状态展示
├── internal-views.ts         # 内置视图注册表（settings 等非模块 Tab 的元数据 + 组件加载器）
└── views/
    └── SettingsView.vue      # 设置页组件（以内置 Tab 形式加载，无专属路由）

web/src/extensions/host/
├── resolve-module.ts         # moduleId → 可渲染组件（记忆化 async 组件）
└── ExtensionModuleView.vue   # 插件 UI 宿主（route.meta 或 Tab props 二选一）
```

---

## 5. SideNav 与模块注册

SideNav 项来自 **模块 registry**（Pinia `useModuleStore`），不由各模块自行改 DOM：

```ts
interface ModuleNavItem {
  moduleId: string           // com.niuma.ssh
  labelKey: string           // i18n key
  icon: string               // lucide 图标名
  routePath: string
  order: number
  badge?: () => number       // 可选角标
}
```

内置模块在 `web/src/modules/registry.ts` 静态注册；插件通过 manifest 动态追加。

---

## 6. Tab 工作区（split editor group 模型）

运维场景需多实例并行：多个 SSH 会话、多个 SQL 查询、多个 API 请求各占一个 Tab，
互不干扰。**并可横向分屏**（editor group）左右对比。这是「工具扩充」的承载层。

层级：`workspace → groups[]（编辑组，横向并排）→ 每组 tabs[]（该组的多个实例）`。

> **架构分层**：Tab Store 只管 **L1 页签元数据**；物理连接由
> [Session Registry](./21-session-registry.md) **L4** 统一管理。
> 端到端时序与开发者约定见 [21 §0.5–§0.6](./21-session-registry.md#05-端到端时序速查)。

### 6.0 职责边界（Tab 栈内）

| 组件 | 路径 | 职责 |
|------|------|------|
| **Tab Store** | `web/src/stores/tab.ts` | `tabId` / `moduleId` / `props` / 编辑组 / Platform 持久化 |
| **ModuleWorkspace** | `web/src/shell/workspace/ModuleWorkspace.vue` | 每组渲染**当前激活** Tab；`<keep-alive>` 保活 UI |
| **连接导航** | `useConnectionNavigation` | 树双击 → `openTab` 或聚焦已有 Tab（去重） |
| **Session Registry** | `session-registry.ts` + `useSessionLease` | `acquire` / `release`；**唯一**调用 `session.open/close` 的 Web 入口 |

**`WorkspaceTab.props` 运维会话常用字段**：`profileId`（必填）、`database` / `collection`（Redis、Mongo）、`tabId`（由 Shell 注入，供树同步）。

### 6.1 数据模型（`web/src/stores/tab.ts`）

```ts
interface WorkspaceTab {
  tabId: string
  moduleId: string           // ssh | database | 插件 id …
  title?: string             // 自定义标题（如会话主机名），优先于 titleKey
  titleKey?: string          // i18n 键，默认取模块 labelKey，随语言切换更新
  icon?: string              // 默认取模块 icon
  closable: boolean
  dirty: boolean             // 未保存标记，TabBar 显示圆点
  props: Record<string, unknown>  // 透传给模块组件（扩展模块含 pluginRoot/pluginUiEntry）
}

interface EditorGroup {
  groupId: string
  tabs: WorkspaceTab[]
  activeTabId: string | null
  grow: number               // 分屏宽度伸缩系数（默认 1）
}
// store 状态：groups: EditorGroup[]（恒 ≥1）、activeGroupId: string
```

### 6.2 Store API

| 方法 / getter | 说明 |
|------|------|
| `openTab(spec)` | **始终新建**一个实例，加入**激活组**并激活（模块内「新建会话」用它，可多开） |
| `openModule(id, opts?)` | 默认**聚焦**已存在同模块 Tab（优先激活组），没有才在激活组新建；`forceNew` 时总新建 |
| `activateTab(id)` | 激活指定 Tab，并把其所在组设为激活组 |
| `setActiveGroup(gid)` | 设为激活组（点击某组任意处） |
| `closeTab(id)` | 关闭；若关的是该组当前项，激活相邻 Tab（优先左侧）；组空则回收（保留至少 1 组）。**规划**：同时 `sessionRegistry.release(id)`，见 [21](./21-session-registry.md) |
| `closeOthers(id)` / `closeToRight(id)` / `closeAll(id?)` | 同组内批量关闭（保留不可关闭的 Tab），右键菜单用 |
| `moveTab(id, toIndex)` | **组内**拖拽排序：把 Tab 移到目标下标（越界自动夹取） |
| `moveTabToGroup(id, gid, toIndex?)` | **跨组**移动 Tab（拖到另一编辑组）；同组时退化为 `moveTab` |
| `splitGroup(gid?)` | 在指定组（默认激活组）右侧新建编辑组，并打开当前激活 Tab 模块的**新实例** |
| `closeGroup(gid)` | 关闭整组（最后一组则仅清空其可关闭 Tab） |
| `resizeGroups(lId, lGrow, rId, rGrow)` | 设相邻两组的伸缩系数（拖分隔条时调用） |
| `setDirty(id, v)` / `updateTitle(id, s)` | 更新脏标记 / 标题（跨组查找） |
| `hydrate()` | 以 Platform 权威数据对齐本地状态（启动时调用一次） |
| `groups` / `activeGroupId` | 编辑组列表 / 激活组 id |
| `activeGroup` (getter) | 当前激活编辑组（恒非空） |
| `activeTab` (getter) | 全局激活 Tab（激活组的激活 Tab） |
| `activeTabId` (getter) | 激活组的激活 tabId |
| `allTabs` (getter) | 所有组 Tab 的扁平集合（跨组统计/查找，如 SSH 会话列表） |

> **持久化（Platform 唯一权威）**：编辑组结构（`{ groups, activeGroupId }`）由 **Platform 层** SQLite（`nm_app_setting`，键 `workspace.tabs`）经 `platform.settings.get/set` 桥接读写；**壳层只透传应用 IPC，不落盘、不解析业务**（见 [architecture](./architecture.md) 壳层零业务 / [11-platform-core](./11-platform-core.md)）。Web 侧 `web/src/api/settings.ts` 封装该契约。
>
> **不设 localStorage 缓存/回退**：桌面端 Platform 进程由壳层自动拉起、始终可用，故应用在 **`mount()` 前 `await useTabStore().hydrate()`** 一次直接从 Platform 取回状态（无首屏闪动）；此后状态变化即写回 Platform。恢复时统一丢弃已卸载模块、复位 `dirty`、重算插件 `props`；持久化形态仅为 `{ groups, activeGroupId }`（产品未发布，不保留旧单组格式迁移）。纯浏览器 dev（无桥接）下不持久化。

### 6.3 渲染与保活（`ModuleWorkspace.vue`）

- 横向并排渲染 `tabStore.groups`，每组一个 `<section class="nm-group">`（`flex-grow: group.grow`），组间插入可拖拽分隔条（`startResize` 仅调整相邻两组、其余不变，带最小宽度夹取）。
- 组件由 `resolveModuleComponent(moduleId)` 从模块 registry 的 `load` 解析并**按 moduleId 记忆化**（保证 `<keep-alive>` 缓存稳定）。
- **每组各一个 `<keep-alive>`** + `:key="tabId"` 渲染该组**当前激活** Tab：
  - **切换 Tab**：旧实例 `deactivated`（UI 状态保留），**不**等于关闭连接。
  - **关闭 Tab**：从 `tabStore` 删除条目；keep-alive 内缓存的实例**不保证**立即 `unmount`，故**不可**依赖 `onBeforeUnmount` 释放 Layer-1 会话（见 [21 §0.4](./21-session-registry.md#04-实现状态截至-v02-设计稿)）。
- 点击某组任意处 → `setActiveGroup`（激活组 TabBar 顶部有高亮线）。跨组拖拽移动 Tab 会在源/目标 keep-alive 间重挂载（该实例状态重置，属预期）。
- `allTabs` 为空时显示空状态（`workspace.emptyTitle/emptyDesc`）。

```vue
<div class="nm-groups">
  <template v-for="(group, i) in tabStore.groups" :key="group.groupId">
    <section class="nm-group" :style="{ flexGrow: group.grow }" @mousedown="tabStore.setActiveGroup(group.groupId)">
      <TabBar :group-id="group.groupId" />
      <keep-alive>
        <component :is="groupComponent(group)" :key="groupActiveTab(group)!.tabId" v-bind="groupActiveTab(group)!.props" />
      </keep-alive>
    </section>
    <div v-if="i < tabStore.groups.length - 1" class="nm-group__resizer" @pointerdown="startResize(i, $event)" />
  </template>
</div>
```

> **拆分触发**：TabBar 右侧「拆分」按钮、Tab 右键菜单「向右拆分编辑器」、`Ctrl/Cmd+\`、命令面板 `workbench.editor.split`。**跨组拖拽**：跨组共享拖拽状态在 `web/src/shell/tab-dnd.ts`（模块级 ref），因每组 TabBar 是独立实例、`<script setup>` 顶层变量无法跨实例共享。

### 6.4 路由 ↔ Tab 同步

`ModuleWorkspace` 内两个 watch 双向同步，均带「已一致则跳过」守卫避免回环：

| 方向 | 触发场景 | 行为 |
|------|----------|------|
| 路由 → Tab | 初始加载 / 深链 / 前进后退 / 侧栏导航 | 命中模块路由且当前激活 Tab 非该模块 → `openModule` 聚焦或新建 |
| Tab → 路由 | 激活 Tab 的模块变化（切换/关闭 Tab） | `router.push` 到该模块路由（驱动 ActivityBar/SideNav 高亮） |

> **启动对账**：`initialSync` 标记确保首屏若已从持久化恢复出 Tab，则以「恢复的激活 Tab」为准，用 `router.replace` 把 URL 切到它，而非被 redirect 的默认模块（`/ssh`）覆盖上次会话。

> 设置页为整页单例，不进入 Tab 体系：`shellStore.settingsActive` 为真时 `ModuleWorkspace` 以**绝对定位覆盖层**渲染 `SettingsView`（`.nm-workspace-settings`），底层 Tab 的 `<keep-alive>` 不卸载，返回后状态仍在。点击 Tab 会经 `TabBar.focusTab` 显式切回模块路由以退出设置（点已激活 Tab 不改状态，故不能只依赖 watch）。

### 6.5 待办

| 能力 | 状态 |
|------|------|
| `dirty` 关闭前 `RsConfirmDialog` 确认 | ✅ 已实现（`TabBar.requestClose`） |
| 扩展 API `window.openTab(...)` | ✅ 已实现（见 [10](./10-web-extension-system.md) 第 5.1 节） |
| 内置 ⌘K 命令（打开模块/设置、关闭 Tab） | ✅ 已实现（`builtin-commands.ts`） |
| Tab 拖拽排序 | ✅ 已实现（`moveTab` + TabBar HTML5 DnD） |
| Tab 右键菜单（关闭其他 / 右侧 / 全部） | ✅ 已实现（`RsContextMenu` + 批量关闭 + 脏 Tab 确认） |
| 持久化 Tab 列表并恢复 | ✅ 契约已切至 Platform（`platform.settings.*`）+ localStorage 回退（Platform Go 层见 [11](./11-platform-core.md)） |
| Tab 分组 / 分屏（split editor group） | ✅ 已实现（多编辑组横向并排 + 组内/跨组 DnD + 组间调宽 + `Ctrl/Cmd+\`） |
| 上下分屏 / 网格布局（vertical / grid split） | 待实现（当前仅横向并排） |

---

## 7. 模块工作区约定

### 7.1 模块布局脚手架 `ModulePane`

文件：`web/src/shell/ModulePane.vue`。为**单个工具**提供 VS Code 式的三区容器（与全局 SideNav/ActivityBar 无关，那是跨模块导航；本组件是模块**内部**导航与输出）：

```
┌──────────────┬───────────────────────────────┐
│ module-sidebar│  #toolbar（主区工具条）        │
│ （内部导航）  ├───────────────────────────────┤
│ #sidebar      │  默认插槽（主内容）            │
├──────────────┴───────────────────────────────┤
│ bottom-panel（输出/日志）  #panel              │
└───────────────────────────────────────────────┘
```

| 能力 | 说明 |
|------|------|
| 插槽 | `#sidebar`、`#sidebar-actions`、`#toolbar`、默认（主区）、`#panel`、`#panel-actions` |
| 折叠 | 侧栏折叠为窄轨可再展开；面板可关可开，主区工具条含开合按钮 |
| 调尺寸 | 侧栏（col-resize）与面板（row-resize）均可 pointer 拖拽，带 min/max 夹取 |
| v-model | `v-model:sidebar-open` / `v-model:panel-open` 供模块外部控制 |

`ModulePane` 作为模块内部布局原语按需使用；注意**会话/实例的管理归 TabBar**（切换/关闭/分屏），模块内部不应再重复维护「会话列表」侧栏（SSH 模块即因此简化为纯占位页，新建会话直接开 Tab）。

### 7.2 尺寸与分割

- 使用 `ModulePane` / `RsContainer` / CSS Grid/Flex，**禁止**写死像素宽度（除 min-width）
- 终端 / 编辑器区域 **`flex: 1`** 占满剩余空间
- 编辑区级别的横向分屏（多 editor group）已在工作区层实现（见 6.3）；模块内部再分栏用 `ModulePane`（见 7.1）

### 7.3 SSH 模块示例布局

```
┌─ ModuleToolbar ─────────────────────────────┐
│ [新建连接] [断开] [SFTP]          [profile ▼] │
├─────────────────────────────────────────────┤
│                                             │
│  xterm.js 终端（flex:1, min-height:0）      │
│                                             │
└─────────────────────────────────────────────┘
```

### 7.4 数据库模块示例布局

```
┌─ ModuleToolbar ─────────────────────────────┐
│ [执行] [格式化] [保存]     [连接 profile ▼] │
├──────────┬──────────────────────────────────┤
│ Schema   │  RsCodeEditor（SQL）              │
│ RsTree   ├──────────────────────────────────┤
│          │  RsTable（结果集）                 │
└──────────┴──────────────────────────────────┘
```

---

## 8. 命令面板（Command Palette）

TopBar 搜索框或 `⌘K` / `Ctrl+K` 打开：

| 能力 | 来源 |
|------|------|
| 切换模块 | Shell |
| 最近连接 | `useConnectionStore` |
| 插件注册命令 | manifest `commands[]` |
| AI 快捷提问 | `useAiStore` |

实现：`CommandPalette.vue` + `RsDialog` 或专用 combobox 模式。

---

## 9. 与 C++ 壳的配合

| Web 区域 | C++ 壳 |
|----------|--------|
| `TopBar` 拖拽 | 壳转发 `-webkit-app-region: drag` → `SetDraggableRegions` |
| 窗口按钮 | TopBar 最右侧；Bridge `shell.window.*` |
| 全屏 / 最大化 | 同上 |
| 默认尺寸 | 壳 `CefWindowInfo` 初始 1280×800 |

Web Shell **不负责** OS 菜单栏（可后期加）；窗口 chrome 并入全宽 TopBar。

---

## 10. 响应与最小尺寸

| 断点 | 行为 |
|------|------|
| ≥ 1280px | SideNav 展开（图标+文字） |
| 1024–1279px | SideNav 仅图标 |
| < 1024px | 桌面 App 最小宽度警告（运维工具不建议更窄） |

最小窗口：**1024 × 640**（壳层 enforce）。

---

## 11. 插件布局边界（强制）

插件 / 模块 **允许**：

- 在 `ModuleWorkspace` 内任意布局
- 注册 SideNav 项、命令、Tab 类型

插件 / 模块 **禁止**：

- 替换 `AppShell` 或隐藏 SideNav / StatusBar
- 全屏覆盖 TopBar（除 Dialog/Drawer 模态层）
- 注入全局 CSS 覆盖 `--rs-*`
- 在 Shell 外挂载 second root

---

## 12. 相关文档

- [07 — Web 总览](./07-web-overview.md)
- [08 — UI 设计规范](./08-web-design-system.md)
- [04 — 插件系统](./04-plugin-system.md)（待补充）
