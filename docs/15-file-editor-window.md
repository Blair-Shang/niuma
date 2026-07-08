# 15 — 文件工作台（File Workbench）：多 Tab 查看 / 编辑窗口

> 版本：v0.2.1 · 日期：2026-07-06  
> 状态：**已实现（Phase 1）**——工作台状态不持久化  
> 关联文档：[09-web-app-shell.md](./09-web-app-shell.md)、[12-ftp-module.md](./12-ftp-module.md)、[02-shell-cpp-cef.md](./02-shell-cpp-cef.md)、[14-capability-connection-framework.md](./14-capability-connection-framework.md)

---

## 1. 设计目标

NiuMa 需要一个**独立于主 AppShell 的专用 CEF 顶层窗口**，作为全平台统一的**文件查看 / 编辑工作台**：

- **多 Tab**：同一窗口内并行打开多个文件，Tab 切换、脏标记、关闭确认
- **跨模块复用**：FTP、SSH/SFTP、数据库脚本、插件等模块均通过同一套 API 打开文件，不在各模块内重复实现编辑器
- **统一读写**：编辑器只关心「文档模型 + Provider 回写」，不关心文件来自本地还是远程
- **与主窗口解耦**：主窗口负责连接/浏览；文件工作台负责展示与保存

### 1.1 与主 AppShell Tab 的区别

| 维度 | 主窗口 Tab（`useTabStore`） | 文件工作台 Tab（`useFileEditorStore`） |
|------|---------------------------|--------------------------------------|
| 挂载容器 | `ModuleWorkspace`（SSH/FTP 会话等） | 独立 CEF 窗口 `/file-workbench` |
| Tab 内容 | 整个模块视图 | 单个文件文档（`RsCodeEditor`） |
| 持久化 | `workspace.tabs`（Platform SQLite） | **不持久化**（纯内存，关窗即清空） |
| 打开方式 | 侧栏 / 连接树 | 各模块右键、双击、命令面板 |

主窗口 Tab **不会**再承载单文件编辑器；所有「打开文件编辑/查看」统一进入文件工作台。

### 1.2 不持久化（设计约束）

文件工作台**不做任何持久化**：

- Tab 列表、文档内容、脏状态仅存于**当前 CEF 窗口内的 Pinia 内存**
- Platform `fileEditor.*` 仅维护进程内窗口注册与待打开队列，**不写 SQLite / localStorage**
- 关闭工作台窗口或退出应用后状态全部丢弃；未保存内容仅依赖关闭前确认

与主窗口 `workspace.tabs` 的 Platform 持久化**完全独立**。

---

## 2. 架构总览

```
┌──────────────── 主窗口（AppShell）────────────────────────────┐
│  FTP / SSH / DB / 插件 …                                       │
│    右键「查看 / 编辑」→ openInFileEditor(spec)                  │
└────────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
              web/src/modules/file-editor/          ← 平台级模块（非 FTP 子模块）
                openInFileEditor()                  ← 各模块唯一入口
                useFileEditorStore                  ← 工作台 Tab 状态
                FileProviderRegistry                ← 读写适配器注册表
                             │
         ┌───────────────────┼───────────────────┐
         │ 已有窗口？         │ 无窗口             │
         ▼                   ▼                   │
  platform.fileEditor       windowApi.open({      │
  .focusTab / openTab       route: '/file-workbench'
         │                   })                   │
         └─────────┬─────────┘                   │
                   ▼                             │
┌──────────────── 文件工作台窗口 ────────────────────────────────┐
│  TabBar  [index.html ●] [main.go] [schema.sql ×]              │
│  Toolbar  语言 ▾  只读/编辑  保存 Ctrl+S                      │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              RsCodeEditor（当前激活 Tab）                  │ │
│  └─────────────────────────────────────────────────────────┘ │
│  StatusBar  /var/www/index.html · FTP · 已保存                │
└────────────────────────────┬─────────────────────────────────┘
                             │ FileProvider.read / write
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
   shell.fs.*          ftp.file.*          ssh.sftp.*（未来）
   （本地）              （远程 FTP）         （远程 SFTP）
```

---

## 3. 模块目录规划

文件工作台作为**平台级 Web 模块**，独立于 `modules/ftp/`：

```
web/src/modules/file-editor/
├── index.ts                      # 对外导出 openInFileEditor / openInFileViewer
├── types.ts                      # FileOpenSpec、FileDocument、Provider 契约
├── services/
│   └── file-editor-window.ts     # 跨窗口协调（开窗 / 聚焦 / 投递 Tab）
├── stores/
│   └── file-editor.ts            # 工作台内 Tab 列表、激活项、dirty 状态
├── providers/
│   ├── registry.ts               # FileProviderRegistry
│   ├── local-provider.ts         # provider: local
│   └── ftp-provider.ts           # provider: ftp
├── composables/
│   ├── useFileDocument.ts        # 单文档加载 / 保存 / 语言识别
│   └── useFileEditorKeyboard.ts  # Ctrl+S / Ctrl+Tab / Ctrl+W
├── components/
│   ├── FileWorkbenchShell.vue    # 窗口 chrome + 布局骨架
│   ├── FileEditorTabBar.vue      # 多 Tab 栏（脏标记、中键关闭）
│   ├── FileEditorToolbar.vue
│   ├── FileEditorStatusBar.vue
│   └── FileEditorPane.vue        # 单 Tab 编辑器面板
└── views/
    └── FileWorkbenchView.vue     # 路由入口（不套 AppShell）
```

**原则**：业务模块（FTP、SSH…）**只依赖** `@/modules/file-editor` 的 `openInFileEditor()`，不直接引用 `FileWorkbenchView` 或 Provider 实现。

---

## 4. 核心契约

### 4.1 FileOpenSpec — 各模块打开文件时的入参

```ts
/** 文件打开规格（各模块 → 文件工作台） */
export interface FileOpenSpec {
  /** Provider 类型，决定读写后端 */
  provider: 'local' | 'ftp' | 'ssh-sftp' | string

  /** 展示用文件名（Tab 标题，默认取 path 最后一段） */
  label?: string

  /** 是否只读；默认 false */
  readonly?: boolean

  /** Provider 私有上下文（读写时原样回传） */
  context: FileProviderContext
}

/** 示例：FTP 远程文件 */
const spec: FileOpenSpec = {
  provider: 'ftp',
  label: 'index.html',
  readonly: false,
  context: {
    sessionId: 'sess_abc',
    path: '/var/www/index.html',
  },
}

/** 示例：本地文件 */
const spec: FileOpenSpec = {
  provider: 'local',
  context: { path: 'C:\\Users\\foo\\test.go' },
}
```

### 4.2 FileDocument — 工作台内 Tab 状态

```ts
export interface FileDocument {
  docId: string                    // Tab 唯一 id
  spec: FileOpenSpec               // 打开规格（含 provider + context）
  label: string                    // Tab 标题
  readonly: boolean

  /** 编辑器状态 */
  content: string
  savedContent: string             // 上次成功保存的内容（用于 dirty 判断）
  language: RsCodeEditorLanguage
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  error?: string

  /** 元信息（StatusBar 展示） */
  size?: number
  sourceLabel?: string             // 「本地」「FTP · host」
}
```

**文档唯一键（去重）**：`provider + canonicalContextKey(context)`。同一文件再次打开时**聚焦已有 Tab**，不重复加载。

### 4.3 FileProvider — 读写适配器

```ts
export interface FileProvider {
  /** Provider 类型 id，与 FileOpenSpec.provider 对应 */
  readonly id: string

  /** 将 context 规范化为去重键 */
  canonicalKey(context: FileProviderContext): string

  /** 读取文件；超限 / 不存在时 throw */
  read(context: FileProviderContext): Promise<FileReadResult>

  /** 写回文件 */
  write(context: FileProviderContext, content: string): Promise<void>

  /** StatusBar 来源描述（可选） */
  sourceLabel?(context: FileProviderContext): Promise<string>
}

export interface FileReadResult {
  content: string
  size: number
  encoding?: 'utf-8' | 'binary'   // 本期仅 utf-8 文本
}
```

**注册方式**（应用 bootstrap 时）：

```ts
// web/src/modules/file-editor/providers/registry.ts
fileProviderRegistry.register(localFileProvider)
fileProviderRegistry.register(ftpFileProvider)
// 未来：sshSftpFileProvider、pluginXFileProvider …
```

各 Provider 映射到底层 Bridge：

| Provider | read | write |
|----------|------|-------|
| `local` | `shell.fs.readText` | `shell.fs.writeText` |
| `ftp` | `ftp.file.read` | `ftp.file.write` |
| `ssh-sftp` | `ssh.sftp.read`（未来） | `ssh.sftp.write`（未来） |

---

## 5. 对外 API（各业务模块唯一入口）

```ts
// web/src/modules/file-editor/index.ts

/** 在文件工作台中打开文件（可编辑，除非 spec.readonly=true） */
export function openInFileEditor(spec: FileOpenSpec): Promise<void>

/** 只读查看（等价于 openInFileEditor({ ...spec, readonly: true })） */
export function openInFileViewer(spec: FileOpenSpec): Promise<void>
```

**FTP 模块调用示例**（`FtpSession.vue`）：

```ts
import { openInFileEditor, openInFileViewer } from '@/modules/file-editor'

function onEditRemote(entry: FtpPaneEntry) {
  void openInFileEditor({
    provider: 'ftp',
    label: entry.name,
    context: {
      sessionId: sessionId.value!,
      path: joinRemotePath(remotePath.value, entry.name),
    },
  })
}
```

**未来 SSH 模块**：

```ts
openInFileEditor({
  provider: 'ssh-sftp',
  context: { sessionId, path: '/etc/nginx/nginx.conf' },
})
```

---

## 6. 窗口与跨窗口 Tab 管理

### 6.1 单例工作台窗口

全应用默认维持 **一个** 文件工作台 CEF 顶层窗口（类似 VS Code 的 Secondary Side Bar / 独立编辑器窗口）：

1. 首次 `openInFileEditor` → `windowApi.open({ route: '/file-workbench', ... })`
2. 窗口已存在 → `windowApi.focus(editorWindowId)` + 向该窗口投递新 Tab
3. 用户手动关闭工作台窗口 → 清空 `editorWindowId`，下次打开重建

`editorWindowId` 与 Tab 列表由 **Platform 层**协调（见 §6.2），避免多窗口实例争抢。

### 6.2 Platform 协调层（新增）

主窗口与工作台窗口是**独立 JS 上下文**，Pinia 不共享。跨窗口 Tab 投递经 Platform 中转：

```
主窗口                              Platform Core                    工作台窗口
  │ openInFileEditor(spec)              │                                │
  │────────────────────────────────────▶│ fileEditor.openTab(spec)       │
  │                                     │  - 写入 pending / tabs 状态     │
  │                                     │  - 返回 { windowId, action }   │
  │◀────────────────────────────────────│                                │
  │ windowApi.focus(windowId)           │                                │
  │                                     │  emit fileEditor.tab.open      │
  │                                     │───────────────────────────────▶│
  │                                     │                                │ store.openTab(spec)
```

**Platform 方法（`platform.fileEditor.*`）**：

| 方法 | 说明 |
|------|------|
| `fileEditor.openTab` | 入参 `FileOpenSpec`；若尚无窗口则 `{ action: 'create' }`，否则 `{ action: 'append', windowId }` |
| `fileEditor.registerWindow` | 工作台 onMounted 注册 `{ windowId }`，并返回内存中的 pending 队列 |
| `fileEditor.unregisterWindow` | 工作台 onBeforeUnmount 注销（清空窗口注册，**不落盘**） |
| `fileEditor.listTabs` | 查询当前内存状态（调试用，**非**恢复接口） |

**事件（经 `niuma:event` 广播至所有 CEF 窗口）**：

| 事件 type | 载荷 | 消费者 |
|-----------|------|--------|
| `fileEditor.tab.open` | `FileOpenSpec` | 工作台窗口 → `store.openTab` |
| `fileEditor.tab.close` | `{ docId }` | 工作台窗口 |
| `fileEditor.window.focus` | `{ windowId }` | Shell 聚焦目标窗口 |

> **Shell 前置条件**：Platform 事件需广播到**所有**顶层 CEF 窗口（若当前仅推送到主窗口，需在 Shell 层补齐 fan-out）。Phase 0 可降级为：每次 `openTab` 仅支持「创建窗口 + URL 携带首个文件」，同会话内后续文件通过 `windowApi.open` 同一 route 并在 query 传 `doc` 参数（有限制）；Phase 1 必须完成 Platform 事件 fan-out。

### 6.3 路由

```ts
// web/src/router/index.ts — 顶层路由，不套 AppShell
{
  path: '/file-workbench',
  name: 'file-workbench',
  component: () => import('@/modules/file-editor/views/FileWorkbenchView.vue'),
}
```

首屏通过 `registerWindow` 消费内存 pending 队列即可，**无需** `listTabs` 恢复历史 Tab。

```ts
// web/src/router/index.ts — 顶层路由，不套 AppShell
{
  path: '/file-workbench',
  name: 'file-workbench',
  component: () => import('@/modules/file-editor/views/FileWorkbenchView.vue'),
}
```

工作台 `onMounted` 调用 `platform.fileEditor.registerWindow()` 拉取 pending；`onBeforeUnmount` 调用 `unregisterWindow()`。

---

## 7. UI 设计（多 Tab）

```
┌──────────────────────────────────────────────────────────────────┐
│ ███ 文件工作台   [index.html ●][main.go][schema.sql ×]    [─][□][×] │  ← 标题 + TabBar + 窗口控制
├──────────────────────────────────────────────────────────────────┤
│  HTML ▾    只读    [保存 Ctrl+S]    [关闭 Tab Ctrl+W]              │  ← 工具栏（随当前 Tab）
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                     RsCodeEditor                                 │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  /var/www/index.html · FTP · host.example · UTF-8 · 已保存         │  ← 状态栏
└──────────────────────────────────────────────────────────────────┘
```

### 7.1 TabBar 行为

| 操作 | 行为 |
|------|------|
| 左键点击 Tab | 切换激活文档 |
| 中键 / Tab 上 × | 关闭；dirty 时确认 |
| Ctrl+Tab / Ctrl+Shift+Tab | 切换上/下一个 Tab |
| Ctrl+W | 关闭当前 Tab |
| Ctrl+S | 保存当前 Tab（非 readonly） |
| 窗口 × | 若有 dirty Tab，列出未保存项并确认 |

### 7.2 脏标记与保存

- `dirty = content !== savedContent`
- Tab 标题旁显示 `●`；窗口标题同步显示当前文件 + 脏标记
- 保存成功 → 更新 `savedContent`，调用 `FileProvider.write`
- 只读 Tab：隐藏保存按钮，编辑器 `readonly=true`；工具栏可显示「切换为编辑」（重新 `openTab` 且 `readonly=false`，或就地 toggle 若 Provider 允许）

### 7.3 语言识别

按扩展名映射到 `RsCodeEditorLanguage`（与 v0.1 相同，集中在 `utils/detectLanguage.ts`）。

---

## 8. 后端能力（按 Provider 分期）

### 8.1 本地 — `shell.fs.*`（已有）

| 方法 | 状态 |
|------|------|
| `shell.fs.readText` | C++ 已实现 |
| `shell.fs.writeText` | C++ 已实现 |

Web 层 `fsApi.readText / writeText` 需补齐（见 §9.2）。

### 8.2 FTP — `ftp.file.*`（新增）

`services/ftp-service/internal/handler/handler.go`：

| 方法 | 逻辑 |
|------|------|
| `file.read` | `conn.Retr` + `io.ReadAll(LimitReader 10MB+1)` → `{ content, size }` |
| `file.write` | `conn.Stor` ← `bytes.NewReader` → `{ written: true }` |

常量：`maxFileReadSize = 10 * 1024 * 1024`。

### 8.3 SSH/SFTP — 未来

在 `ssh-service` 增加 `sftp.read` / `sftp.write`，注册 `ssh-sftp` Provider；文件工作台**零改动**。

---

## 9. 改动清单（分阶段）

### Phase 1 — 文件工作台骨架 + FTP/本地 Provider

| 层级 | 文件 | 改动 |
|------|------|------|
| Go | `services/ftp-service/.../handler.go` | `file.read` / `file.write` |
| Go | `platform/internal/.../file_editor.go`（新） | `platform.fileEditor.*` 方法 + 事件 |
| Web | `web/src/modules/file-editor/**` | 完整模块目录 |
| Web | `web/src/router/index.ts` | `/file-workbench` 顶层路由 |
| Web | `web/src/api/fs.ts`、`types/fs.ts` | `readText` / `writeText` |
| Web | `web/src/api/ftp.ts`、`types/ftp.ts` | `fileRead` / `fileWrite` |
| Web | `web/src/modules/ftp/...` | 右键菜单 → `openInFileEditor` |
| Web | `web/src/main.ts` 或 bootstrap | 注册 `local` + `ftp` Provider |
| Shell | 事件 fan-out（若缺失） | Platform 事件推送至所有窗口 |
| i18n | `zh-CN.ts` / `en-US.ts` | `fileEditor.*` 命名空间 |

### Phase 2 — 体验增强

- Tab 拖拽排序、Pin Tab
- 命令面板：`文件: 打开路径…`（本地对话框）
- 二进制 / 图片预览 Provider（`readonly` + 非 CodeMirror 渲染）

> **明确不做**：文件工作台 Tab / 窗口状态的 Platform 或 localStorage 持久化。

### Phase 3 — 更多 Provider

- `ssh-sftp`
- 数据库「打开 SQL 片段」→ `memory` 或 `platform.script.*` Provider
- Diff 模式：双 Tab 或 Merge 视图

---

## 10. FTP 模块集成（示例）

### 10.1 右键菜单

`useFtpContextMenu.ts` 对文件追加：

| key | 文案 |
|-----|------|
| `view-in-editor` | 在文件工作台中查看 |
| `edit-in-editor` | 在文件工作台中编辑 |

### 10.2 与 v0.1「每文件一新窗口」方案差异

| v0.1 | v0.2（本文） |
|------|-------------|
| 每个文件 `windowApi.open` 一次 | **单例**工作台窗口 + 多 Tab |
| 路由 `/file-editor?path=…` | 路由 `/file-workbench` + Platform 协调 Tab |
| 组件在 `modules/ftp/views/` | 组件在 `modules/file-editor/`（平台级） |
| FTP 专用 | 全模块复用 Provider 机制 |

---

## 11. 数据流时序（多 Tab）

```
FTP 主窗口                file-editor 服务           Platform              工作台窗口
     │                          │                      │                      │
     │ 右键编辑 file A            │                      │                      │
     │ openInFileEditor(A)        │                      │                      │
     │─────────────────────────▶│ fileEditor.openTab   │                      │
     │                          │─────────────────────▶│ 无窗口 → create       │
     │                          │◀─────────────────────│                      │
     │                          │ windowApi.open       │                      │
     │                          │─────────────────────────────────────────────▶│ mount
     │                          │                      │◀── registerWindow ───│
     │                          │                      │── tab.open(A) ──────▶│ openTab(A)
     │                          │                      │                      │ ftp.read → 展示
     │                          │                      │                      │
     │ 右键编辑 file B            │                      │                      │
     │ openInFileEditor(B)        │                      │                      │
     │─────────────────────────▶│ fileEditor.openTab   │                      │
     │                          │─────────────────────▶│ 有窗口 → append       │
     │                          │ windowApi.focus      │                      │
     │                          │                      │── tab.open(B) ──────▶│ openTab(B)
     │                          │                      │                      │ Tab 切换 A/B
     │                          │                      │                      │
     │                          │                      │                      │ Ctrl+S on B
     │                          │                      │                      │ ftp.write(B)
```

---

## 12. 约束与风险

| 约束 | 说明 |
|------|------|
| **单文件 10 MB** | 各 Provider 的 read 必须限制大小；超出 Tab 显示错误态，不加载编辑器 |
| **FTP session 生命周期** | 工作台 Tab 持有 `sessionId`；主窗口断开 FTP 后，保存失败并提示「会话已关闭」 |
| **跨窗口状态** | 必须通过 Platform 协调，不能依赖 Pinia 跨窗口共享 |
| **事件 fan-out** | 若 Shell 仅向单窗口推事件，Phase 1 阻塞；需优先确认或实现 |
| **编码** | 本期仅 UTF-8 文本；GBK 等编码列为 Phase 2 |
| **并发写** | 同一文件多 Tab 打开时，后保存者覆盖；可选 Phase 2 做「文件已被外部修改」检测 |

---

## 13. 国际化（`fileEditor` 命名空间）

| key | 中文 | 英文 |
|-----|------|------|
| `fileEditor.title` | 文件工作台 | File Workbench |
| `fileEditor.open` | 在文件工作台中打开 | Open in File Workbench |
| `fileEditor.view` | 查看 | View |
| `fileEditor.edit` | 编辑 | Edit |
| `fileEditor.save` | 保存 | Save |
| `fileEditor.saveAll` | 全部保存 | Save All |
| `fileEditor.closeTab` | 关闭标签页 | Close Tab |
| `fileEditor.readonly` | 只读 | Read-only |
| `fileEditor.loading` | 正在加载… | Loading… |
| `fileEditor.saving` | 正在保存… | Saving… |
| `fileEditor.saved` | 已保存 | Saved |
| `fileEditor.loadError` | 加载失败 | Failed to load |
| `fileEditor.saveError` | 保存失败 | Failed to save |
| `fileEditor.fileTooLarge` | 文件超过 10 MB | File exceeds 10 MB |
| `fileEditor.unsavedWarning` | 有未保存的更改，确定关闭？ | Unsaved changes. Close anyway? |
| `fileEditor.sessionClosed` | 连接会话已关闭，无法保存 | Session closed; cannot save |
| `fileEditor.empty` | 没有打开的文件 | No open files |

FTP 右键仍用 `modules.ftp.session.viewInEditor` / `editInEditor`，内部调用 `openInFileViewer` / `openInFileEditor`。

---

## 14. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-06 | 初稿：FTP 单文件单窗口 `/file-editor` |
| v0.2 | 2026-07-06 | 升级为平台级**文件工作台**：多 Tab、Provider 机制、`platform.fileEditor.*` 跨窗口协调、全模块复用 |
| v0.2.1 | 2026-07-06 | 明确**不持久化**：工作台状态仅进程内内存，关窗即清空 |
