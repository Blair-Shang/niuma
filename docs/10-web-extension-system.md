# 10 — Web 扩展系统

> 版本：v0.3 · 日期：2026-07-04  
> Layer 4 动态模块与 IDE 级贡献点架构

---

## 1. 目标

在 **不修改 App Shell 源码** 的前提下，支持：

1. **内置模块**与**外部插件**统一注册
2. 运行时动态追加路由与 SideNav
3. 未来 IDE 级 **contributions**（commands、views、keybindings）
4. 受控 **Extension API**（`niuma.*`），禁止裸暴露全部 `bridge.invoke`

---

## 2. 架构图

```
┌─────────────────────────────────────────────────────────┐
│ App Shell（固定）                                         │
│ TopBar · SideNav · TabBar · ModuleWorkspace · StatusBar │
└───────────────────────────┬─────────────────────────────┘
                            │ 只读 Registry
┌───────────────────────────▼─────────────────────────────┐
│ ExtensionRegistry                                        │
│  · builtinModules[]     ← web/src/modules/*              │
│  · extensionModules[]   ← plugins/*/manifest（P2）       │
│  · contributions[]      ← commands / views（P3）         │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│ Extension API（niuma.*）                                │
│  commands · window · workspace · bridge（白名单）          │
└───────────────────────────┬─────────────────────────────┘
                            │ useNiumaBridge.invoke
┌───────────────────────────▼─────────────────────────────┐
│ CEF Shell → Platform → Services                          │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 核心类型

### 3.1 ModuleDescriptor（模块描述符）

内置与插件共用，见 `web/src/extensions/types/module.ts`：

| 字段 | 说明 |
|------|------|
| `id` | 唯一 ID，如 `ssh`、`com.niuma.db-postgres` |
| `source` | `builtin` \| `extension` |
| `labelKey` | i18n key |
| `icon` | Lucide 图标名 |
| `routePath` | 如 `/ssh` |
| `order` | SideNav 排序 |
| `load` | `() => Promise<Component>` 懒加载 |

### 3.2 ExtensionManifest（插件清单）

见 `web/src/extensions/types/manifest.ts`，对应 `plugins/*/manifest.json`。

### 3.3 Contributions（贡献点，P3）

见 `web/src/extensions/types/contribution.ts`：

| 贡献点 | 用途 |
|--------|------|
| `commands` | 命令面板、快捷键 |
| `views` | 模块内侧边视图 |
| `menus` | 上下文菜单项 |

---

## 4. ExtensionRegistry 职责

文件：`web/src/extensions/registry/extension-registry.ts`

| 方法 | 阶段 | 说明 |
|------|------|------|
| `getModuleNavItems()` | P0 | SideNav 数据源 |
| `createModuleRoutes()` | P0 | Vue Router children |
| `getModuleById(id)` | P0 | Tab 工作区按 id 解析模块（内置 + 扩展） |
| `getModuleByRoutePath(path)` | P0 | 路由 → Tab 同步时反查模块 |
| `registerExtensionModule(desc, root?, uiEntry?)` | P1/P2 | 动态追加模块；同时登记插件根与 `uiEntry`，供 Tab 直接挂载插件 UI |
| `getExtensionRoot(id)` / `getExtensionUiEntry(id)` | P1 | 供 `tab.props` 注入 `pluginRoot` / `pluginUiEntry` |
| `registerCommandContributions(id, cmds)` | P3 | CommandPalette |

### 4.1 启动流程（P0 已实现部分）

```ts
// main.ts / router/index.ts
import { createModuleRoutes } from '@/extensions/registry/extension-registry'

const routes = [
  {
    path: '/',
    component: AppShell,
    children: [
      { path: '', redirect: '/ssh' },
      ...createModuleRoutes(),
      { path: 'settings', component: SettingsView },
    ],
  },
]
```

### 4.2 动态插件（P2 规划）

```ts
const manifests = await bridge.invoke<ExtensionManifest[]>('platform.plugin.list')
for (const manifest of manifests) {
  extensionRegistry.register(manifest)
  router.addRoute(createRouteFromManifest(manifest))
}
```

---

## 5. Extension API 与命令

### 5.1 activate 上下文

插件 `ui/entry.js` 导出 `activate(context)`，由 `activatePluginEntry` 动态 import 后调用。上下文由 `web/src/extensions/api/create-extension-context.ts` 构造：

| 分组 | 方法 | 说明 |
|------|------|------|
| `commands` | `register(id, handler)` | 绑定 manifest 中已声明命令的执行器 |
| `commands` | `execute(id)` | 执行任意已注册命令（可跨插件），返回 `Promise<boolean>` |
| `window` | `openTab(spec?)` | 新开一个 Tab（多实例）；`spec.moduleId` 省略时用插件自身模块 |
| `window` | `openModule(id?, opts?)` | 聚焦已有同模块 Tab 或新建；`opts.forceNew` 强制新建 |
| `window` | `closeTab(tabId)` | 关闭指定 Tab |
| `window` | `getActiveTab()` | 返回当前激活 `WorkspaceTab \| null` |
| — | `subscriptions[]` | 插件放置 `{ dispose() }`，卸载时统一清理 |

```ts
// 插件 ui/entry.js
export function activate(context) {
  context.commands.register('hello.run', () => {
    context.window.openTab({ title: 'Hello 实例' }) // 默认打开插件自身模块
  })
}

export function deactivate() {}
```

> `window.*` 通过 `useTabStore()` 直连工作区。上下文在 `main.ts` `setActivePinia` 之后创建，故组件外调用安全。

### 5.2 内置（第一方）命令

文件：`web/src/extensions/contributions/builtin-commands.ts`，`main.ts` 于 `bootstrapExtensions` 之后调用 `registerBuiltinCommands()`。它把第一方动作写入命令注册表，让 ⌘K 开箱即用：

| 命令 id | 动作 |
|---------|------|
| `workbench.settings.open` | 打开设置覆盖层 |
| `workbench.tab.close` | 关闭当前激活 Tab |
| `workbench.open.<moduleId>` | 为每个模块（内置 + 已注册扩展）生成「打开模块」命令 |

标题按当前语言本地化，并 `watch(i18n.global.locale)` 在语言切换时重建（注册表以 id 去重覆盖）。

### 5.3 受控 Bridge 门面

`web/src/extensions/api/index.ts` 的 `createExtensionApi` 暴露 `invoke` / `onEvent` 占位，后续替换为方法白名单，禁止插件直接调用任意 Bridge method。

---

## 6. 与 App Shell 的集成点

| Shell 组件 | 集成方式 |
|------------|----------|
| `SideNav.vue` | `useModuleStore` ← Registry nav items |
| `ModuleWorkspace.vue` | 按激活 Tab 用 `resolveModuleComponent(moduleId)` + `<keep-alive>` 渲染；设置页为覆盖层（底层 Tab 保活） |
| `TabBar.vue` | `useTabStore`，`WorkspaceTab` 带 `moduleId` 与 `props`；脏 Tab 关闭走 `RsConfirmDialog` 确认 |
| `TopBar.vue` | CommandPalette 读 contributions.commands（含内置命令）；设置齿轮 |

### 6.1 插件 UI 在 Tab 中的渲染

扩展模块的 `load` 统一指向宿主组件 `ExtensionModuleView.vue`。它的挂载信息（`pluginRoot` / `pluginUiEntry` / `moduleId`）**两个来源二选一**：

- **Tab 工作区**渲染时经 `tab.props` 传入（`tab store` 用 `getExtensionRoot/UiEntry` 构造）——支持同一插件多实例；
- 直接经**路由**渲染时回退到 `route.meta`。

**禁止**：插件 import `@/shell/AppShell.vue` 或修改 Shell 文件。

---

## 7. 隔离与安全（路线图）

| 阶段 | 方案 |
|------|------|
| P0–P1 | 信任第一方；ESM 同域加载 |
| P2 | Platform 权限白名单 + manifest 签名校验 |
| P3 | iframe sandbox 或 Web Worker 跑不可信插件 UI |
| P4 | 独立 Extension Host 进程（长期） |

---

## 8. 实现状态

| 项 | 状态 |
|----|------|
| `extensions/types/*` | ✅ P0 类型 |
| `extensions/registry/builtin-modules.ts` | ✅ 内置模块 |
| `extensions/registry/extension-registry.ts` | ✅ 路由 + Nav |
| `modules/registry.ts` | ✅ 重导出 |
| `stores/module.ts` 读 Registry | ✅ |
| `router` 动态 routes | ✅ |
| `plugins/_examples/` | ✅ 示例 manifest + entry.js |
| `shell.plugin.list` + `app://plugins/` | ✅ P1 |
| `platform.plugin.list` + 启用状态持久化 | ✅ P2（Shell 回退） |
| `shell.plugin.setEnabled` | ✅ P2 |
| contributions / CommandPalette | ✅ P3 |
| Settings 插件管理 | ✅ P2 |
| activate 上下文 `window.*` / `commands.execute` | ✅ P1 |
| 内置命令 `workbench.*`（⌘K 开箱即用） | ✅ P1 |
| `@niuma/extension-api` 包 | ❌ P1 |

---

## 9. 相关文档

- [04-plugin-system.md](./04-plugin-system.md)
- [06-directory-structure.md](./06-directory-structure.md)
- [09-web-app-shell.md](./09-web-app-shell.md)

---

## 10. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-03 | 初版：Registry + API 门面 + 分阶段路线 |
| v0.2 | 2026-07-04 | Tab 工作区落地：新增 `getModuleById/ByRoutePath`、登记 `uiEntry`；插件 UI 支持经 `tab.props` 多实例渲染 |
| v0.3 | 2026-07-04 | activate 上下文扩 `window.openTab/openModule/closeTab/getActiveTab` 与 `commands.execute`；新增内置命令 `workbench.*` 让 ⌘K 开箱即用；TabBar 脏 Tab 关闭确认 |
