# 02 — C++ 壳层设计（CEF 封装）

> 版本：v0.2 · 日期：2026-07-03  
> 状态：骨架已实现（CEF + app:// + cefQuery 透传）

---

## 1. 壳层定位

Shell 是 **Layer 3**，扮演 **CEF 宿主 + 桌面管理 + IPC 透传 + 后端进程管家** 四个角色：

```
Web UI  ──① CEF IPC──>  Shell  ──② 应用 IPC──>  Platform / Services
```

**壳层必须稳定、尽量薄、极少变更**。业务迭代发生在 Web UI（Layer 4）和 Platform / Services（Layer 1–2）。

### 1.1 壳层零业务（硬约束）

> **外层 C++ CEF 不与业务逻辑交互**：不读 SQLite、不做权限、不解析连接/凭据/模块策略。

| 壳层做 | 壳层**禁止**做 |
|--------|----------------|
| CEF 多进程、窗口、`app://` 加载 Web | 模块访问裁决、数据权限 |
| `cefQuery` 收发包、事件推送 | 凭据存储、审计落库 |
| 按 manifest **启停**后端进程 | 插件策略、签名校验、会话管理 |
| gRPC/Pipe **原样透传**至 Platform | SSH/DB/AI 等业务实现 |

权限、凭据、插件注册等 **唯一裁决点在 Layer 2 Platform（Go）**。  
参考其他桌面项目的 `core/security`、`core/plugin` **不进入 shell/**。

---

## 2. 壳层职责清单

| 模块 | 目录 | 职责 | 不做 |
|------|------|------|------|
| CEF 生命周期 | `core/cef/` | 多进程启动、Renderer 注册 | — |
| 窗口管理 | `core/window/` | 主窗口、启动 URL | Tab/托盘（后续扩展） |
| ① CEF IPC | `browser/handlers/` | cefQuery 收/推事件 | 不解析业务、**不做权限** |
| Browser 实例 | `browser/` | CefClient、生命周期回调 | — |
| 请求路由 | `bridge/` | method 解析、透传分发 | 不鉴权 |
| 流代理 | `bridge/stream_proxy` | stream → Web 分片 + 背压 | — |
| 资源协议 | `protocol/` | `app://niuma/*` → `resources/web/` | — |
| 进程管家 | `core/runtime/` | manifest、启停子进程 | 不裁决权限 |
| ② 应用 IPC | `ipc/` | gRPC client **透传** | 不读 SQLite、不见凭据 |

---

## 3. CEF 多进程模型

```
NiuMa.exe (Browser Process)          ← 主进程，壳层核心逻辑
├── NiuMa.exe --type=renderer         ← Web UI 渲染（Vue）
├── NiuMa.exe --type=gpu-process
└── NiuMa.exe --type=utility
```

### 进程入口（main.cpp）

```
wWinMain / main
  ├── CefExecuteProcess()     → Renderer / GPU / Utility 子进程
  └── Browser Process
        ├── CefInitialize()
        ├── ServiceManager::Init()    // core/runtime
        ├── RegisterAppScheme()       // protocol
        ├── CreateMainBrowser()       // core/window + browser
        └── CefRunMessageLoop()
```

---

## 4. 壳层内部模块划分

吸收业界 CEF 桌面项目的 **core / browser / net(ipc)** 分法，并按 NiuMa **零业务** 原则裁剪：

```
shell/
├── src/
│   ├── main.cpp
│   │
│   ├── core/                       # 壳层内核（无业务）
│   │   ├── cef/                    # CefApp、Settings、RenderProcessHandler
│   │   ├── window/                 # 主窗口、NIUMMA_DEV_URL、托盘（规划）
│   │   └── runtime/                # ServiceManager、manifest 加载
│   │
│   ├── browser/                    # CEF Browser 实例
│   │   ├── main_browser.*          # 主工作台 CefClient
│   │   └── handlers/
│   │       └── message_router_handler   # ① cefQuery
│   │
│   ├── bridge/                     # 透传路由（不鉴权）
│   │   ├── bridge_router.*
│   │   └── stream_proxy.*
│   │
│   ├── ipc/                        # ② Shell → Platform/Services
│   │   └── platform_client.*       # gRPC 透传（非 CEF IPC）
│   │
│   ├── protocol/                   # app:// 静态资源
│   └── util/
│
├── include/niuma/types.h           # BridgeRequest / BridgeResponse
└── CMakeLists.txt
```

### 与其他项目的差异（刻意为之）

| 常见桌面壳目录 | NiuMa 处理 |
|----------------|------------|
| `core/security` | ❌ 不放 shell → `platform/` |
| `core/plugin`（业务插件管理） | ❌ → `platform/` + manifests |
| `core/ipc`（含权限拦截） | ✅ 拆为 `browser/handlers`（①）+ `ipc/`（②），**无权限拦截** |
| `resources/core` 嵌工作台 HTML | ❌ → `web/dist`（Layer 4 独立构建） |

---

## 5. 核心类设计

### 5.1 NiuMaApp（`core/cef/`）

- CEF 全局配置、自定义 scheme 注册
- `OnContextInitialized` → 注册 `app://`、创建主 Browser

### 5.2 MainBrowser / NiuMaClient（`browser/`）

- 绑定 MessageRouterHandler
- 页面加载完成注入 `window.niuma`
- 窗口关闭时清理 router / stream

### 5.3 MessageRouterHandler（`browser/handlers/`）

- ① CEF IPC：`OnQuery` 解析 JSON → `BridgeRouter`
- `PushEvent`：Native → `niuma:event` CustomEvent

### 5.4 BridgeRouter（`bridge/`）

- 解析 `com.niuma.platform.ping` → service + action
- 本地仅处理 `ping`、`shell.version`、`shell.info`（运行时元数据，非业务）
- `ServiceManager::EnsureRunning` → `PlatformClient::Invoke`（透传）

### 5.5 ServiceManager（`core/runtime/`）

- 扫描 `services/manifests/`
- `startup: always | on_demand`、健康检查、崩溃重启（规划）
- **不**解析 YAML 里的业务字段、**不**裁决谁能调谁

### 5.6 PlatformClient（`ipc/`）

- gRPC over Named Pipe / UDS
- `Invoke` / `InvokeStream` 原样转发
- 连接失败重试；**不**缓存凭据、**不**读 `niuma.db`

### 5.7 StreamProxy（`bridge/`）

- gRPC stream 分片 → `PushEvent`
- 背压与合并（规划）

### 5.8 AppSchemeHandler（`protocol/`）

- `app://niuma/*` → `resources/web/`

---

## 6. 请求时序

```
Renderer                Browser (Shell)                    Platform
   │                         │                                │
   │── cefQuery(JSON) ──────>│ message_router_handler         │
   │                         │── bridge_router.Dispatch ─────>│
   │                         │   (EnsureRunning + Invoke)     │
   │                         │<──────── gRPC response ──────────│
   │<── callback Success ────│                                │
```

壳层在 `bridge_router` 处**止步于透传**；Platform 内完成权限与业务。

---

## 7. App Shell 布局约定

工作台 UI 在 **Layer 4 Web**（`web/`），壳层只加载 `app://niuma/index.html` 或开发服 URL。

```
┌──────────────────────────────────────────┐
│ 顶栏 / 侧栏 / Tab / 状态栏  ← Vue App Shell │
├──────────────────────────────────────────┤
│ 模块工作区（SSH / DB / AI …）              │
└──────────────────────────────────────────┘
```

---

## 8. 开发环境

| 组件 | 要求 |
|------|------|
| Visual Studio 2022 | C++ 桌面开发 或 Build Tools |
| CMake | ≥ 3.20 |
| CEF | `pnpm setup:desktop` 自动下载 |
| 前端 | Node 20+ / pnpm（构建 `web/dist`） |

详见根目录 [README.md](../README.md) 环境准备章节。

---

## 9. 打包产物结构

```
NiuMa/
├── NiuMa.exe
├── libcef.dll …
├── resources/web/          # web/dist
├── services/bin/           # platform-core、各 service
└── services/manifests/
```

---

## 10. 相关文档

- [总体架构 — 壳层零业务](./architecture.md#31-业务边界壳层零业务)
- [03 — IPC 协议设计](./03-ipc-protocol.md)
- [05 — 后端服务设计](./05-backend-services.md)
