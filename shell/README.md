# NiuMa CEF Shell（Layer 3）

C++17 CEF 宿主：**只做桌面运行时基础设施，不承担任何业务逻辑**。

> 权限、凭据、模块访问、数据裁决 → **Layer 2 Platform（Go）**  
> 壳层仅：CEF 封装、窗口、资源协议、IPC 透传、后端进程启停。

## 启动

```powershell
pnpm setup:desktop   # 首次：CEF + CMake + MSVC
pnpm dev             # 构建并启动 niuma.exe
pnpm dev:hot         # CEF + Vite 热更新（NIUMMA_DEV_URL）
pnpm dev:debug       # 同上 + Debug 构建（壳层/Go 保留符号）
pnpm build:shell     # 仅构建壳
```

调试（全链路）：

```powershell
# 终端 1 — 调试 platform-core（占住管道，壳层不会重复 spawn）
pnpm dev:platform          # go run
pnpm dev:platform:delve    # delve

# 终端 2 — 壳层 + Web 热更
pnpm dev:hot:ext-platform  # 或 pnpm dev:debug:ext

# 日志：仓库根 logs/<session>/
# Web：开发态 CEF 内 F12，或 Chrome http://localhost:9222（安装包默认关闭）
# VS Code：Run and Debug → Platform Core / FTP Service
```

- UI 组件测试 → `packages/ui`（不走本目录）
- Web 产物 → `web/dist` 复制到 `resources/web/`

## 目录划分

```
shell/src/
├── main.cpp                 # 进程入口、CEF 多进程分发
│
├── core/                    # 壳层内核（无业务）
│   ├── cef/                 # CEF 初始化、生命周期、Renderer 注册
│   ├── window/              # 窗口：MainWindow / AuxiliaryWindowManager / WindowManager 门面
│   └── runtime/             # manifest 解析、后端子进程启停（不裁决权限）
│
├── browser/                 # CEF Browser 实例封装
│   ├── main_browser.*       # 主工作台 Browser（CefClient）
│   └── handlers/            # CEF 事件回调
│       └── message_router_handler   # ① cefQuery 入口
│
├── bridge/                  # 请求路由与流代理（透传，不鉴权）
│   ├── bridge_router.*      # method 解析 → runtime / ipc
│   └── stream_proxy.*       # 反向事件 / 长流分片 → Web
│
├── ipc/                     # ② 应用 IPC（Shell → Platform/Services）
│   └── platform_client.*    # Named Pipe / UDS 透传，不读 SQLite、不持凭据
│
├── protocol/                # app:// 静态资源协议
└── util/                    # JSON、路径、method 解析
```

## 两层 IPC

| 层级 | 目录 | 协议 | 壳层做什么 | 壳层**不做** |
|------|------|------|------------|--------------|
| **① Web ↔ Shell** | `browser/handlers/` | `cefQuery` / `niuma:event` | 收发包、JSON 解析、`shell.window.*` 多窗口 | 权限、业务语义 |
| **② Shell ↔ 后端** | `ipc/` + `core/runtime/` | Named Pipe / UDS + JSON | 起进程、原样转发 | 鉴权、SQLite、凭据 |

## 多窗口 API（`shell.window.*`）

Shell 只管理 CEF 窗口，不解析文件/路由业务。Web 通过 `cefQuery` 调用：

| method | params | 返回 |
|--------|--------|------|
| `shell.window.open` | `route`, `title`, `width`, `height`, `resizable`, `maximized`, `minWidth`, `minHeight`（或完整 `url`） | `{ windowId }` |
| `shell.window.close` | `windowId` | `{ closed: true }` |
| `shell.window.focus` | `windowId` | `{ focused: true }` |
| `shell.window.maximize` | `windowId`（可选，默认当前） | `{ maximized: true }` |
| `shell.window.minimize` | `windowId` | `{ minimized: true }` |
| `shell.window.restore` | `windowId` | `{ restored: true }` |
| `shell.window.fullscreen` | `windowId`, `enabled` | `{ fullscreen: true }` |
| `shell.window.state` | `windowId` | `{ maximized, minimized, fullscreen }` |
| `shell.window.list` | — | `{ windows: [...] }` |

窗口默认带 **Windows 原生边框**，支持拖拽缩放、最大化/最小化；`SetToFillLayout` 保证内容随窗口伸缩。

## 原生对话框（`shell.dialog.*`）

| method | params | 返回 |
|--------|--------|------|
| `shell.dialog.openFile` | `title`, `defaultPath`, `filters`, `multiple`, `windowId` | `{ canceled, filePaths }` |
| `shell.dialog.saveFile` | `title`, `defaultPath`, `filters`, `windowId` | `{ canceled, filePaths }` |
| `shell.dialog.openFolder` | `title`, `defaultPath`, `windowId` | `{ canceled, filePaths }` |
| `shell.dialog.message` | `type`, `title`, `message`, `windowId` | `{ button }` |

`type` 可选：`info` / `warning` / `error` / `confirm` / `yesno`。  
页面内 `<input type="file">`、`alert()` 等也会走 **CEF 默认 OS 对话框**（`CefDialogHandler` / `CefJSDialogHandler` 返回 false）。

## 文件拖放

- 外部文件拖入窗口：Shell 注入 `dragover/drop` 钩子，派发 `niuma:file-drop` 事件（`detail.paths` 为本地绝对路径）
- `-webkit-app-region: drag` 区域：通过 `CefDragHandler::OnDraggableRegionsChanged` 同步到原生窗口

```ts
window.addEventListener('niuma:file-drop', (e) => {
  const paths = (e as CustomEvent).detail.paths as string[]
})
```

## 本地文件访问（`shell.fs.*`）

仅读写路径与元数据，不解析文件内容业务：

| method | params | 返回 |
|--------|--------|------|
| `shell.fs.exists` | `path`（绝对路径） | `{ exists }` |
| `shell.fs.stat` | `path` | `{ path, isFile, isDirectory, size }` |
| `shell.fs.readText` | `path` | `{ path, content }` |
| `shell.fs.writeText` | `path`, `content` | `{ written: true }` |
| `shell.fs.showInFolder` | `path` | `{ shown: true }`（资源管理器定位） |

## 刻意不放在壳层的模块

参考其他桌面项目常见的 `core/security`、`core/plugin` 等，在 NiuMa 中**明确不属于 shell**：

| 能力 | 归属 |
|------|------|
| 会话 / 接口白名单 / 签名校验 | `platform/` |
| 模块访问、数据权限 | `platform/` |
| 插件注册与策略 | `platform/` + `services/manifests/` |
| 工作台 UI | `web/`（Layer 4） |

## 构建产物

`build/shell/Release/niuma.exe` + CEF 运行时 dll + `resources/web/`

详见 [docs/02-shell-cpp-cef.md](../docs/02-shell-cpp-cef.md)。
