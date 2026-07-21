# 01 — 总体架构概览

> 版本：v0.1 · 日期：2026-07-03

---

## 1. 项目定位

NiuMa 是一个**全能型 AI 运维桌面平台**，目标能力包括：

| 域 | 能力 |
|----|------|
| 主机运维 | SSH、SFTP、FTP |
| 数据库运维 | MySQL、PostgreSQL、Oracle 等 |
| 扩展工具 | API 测试、数据格式化、视频生成/拼接 |
| AI | 统一对话、Tool 调用、自然语言操作（设计见 [24](./24-ai-assistant.md)） |

**形态**：桌面 App · 模块可插拔 · 自封装 CEF · UI 跨平台一致。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| **壳薄后端厚** | C++ 壳只负责 CEF、窗口、桥接、服务管理；不含业务逻辑 |
| **协议先行** | 跨语言通信以 Protobuf/gRPC 契约为准，语言只是实现细节 |
| **两层 IPC** | CEF IPC 管 UI↔宿主；应用 IPC 管宿主↔多语言后端 |
| **进程隔离** | 重模块独立进程，单模块崩溃不拖垮 UI |
| **壳层语言固定** | 壳长期稳定用 C++；后端按模块自由选型 |
| **UI 统一** | 固定 Chromium（CEF），强制统一 Design System |

---

## 3. 四层架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4 — Web UI                                           │
│  Vue 3 / TypeScript · @niuma/ui · xterm · RsCodeEditor      │
│  插件 UI 以路由/动态组件加载                                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ ① CEF IPC
                           │    cefQuery / PostMessage
┌──────────────────────────▼──────────────────────────────────┐
│  Layer 3 — Shell 壳层（C++ + CEF Official SDK）              │
│  CEF 多进程 · 窗口/Tab · Message Router · app:// 协议        │
│  Service Manager · IPC Client · StreamProxy（流式代理）       │
└──────────────────────────┬──────────────────────────────────┘
                           │ ② 应用 IPC
                           │    gRPC over Named Pipe / UDS
┌──────────────────────────▼──────────────────────────────────┐
│  Layer 2 — Platform Core（Go，独立进程）                      │
│  插件注册 · 凭据/权限 · 配置中心 · AI Orchestrator            │
└──────────────────────────┬──────────────────────────────────┘
                           │ ② 应用 IPC
┌──────────────────────────▼──────────────────────────────────┐
│  Layer 1 — Capability Services（多语言，独立进程）            │
│  ssh(Rust) · db-mysql(Go) · db-oracle(C++/Java) · ai(Python)│
└─────────────────────────────────────────────────────────────┘
```

### 各层职责边界

| 层 | 做什么 | 不做什么 |
|----|--------|----------|
| Web UI | 渲染、交互、调用 Bridge SDK | 不直连后端、不持有密钥 |
| Shell | CEF 宿主、IPC 转发、服务启停 | 不写 SSH/SQL/AI 业务 |
| Platform | 插件路由、凭据、AI Tool 注册 | 不替代具体能力实现 |
| Services | 具体能力（SSH、DB、媒体等） | 不感知 CEF、不渲染 UI |

---

## 4. 技术选型

### 4.1 为什么自封装 CEF，而非 Electron / Tauri

| super | Electron | Tauri | 自封装 CEF |
|------|----------|-------|------------|
| UI 一致性 | 强 | 弱（系统 WebView） | **强** |
| 运行时 | Chromium + Node.js | 系统 WebView + Rust | **仅 Chromium** |
| 安装包 | 120–180MB | 5–15MB | 60–100MB（可裁剪） |
| 企业可控 | 中 | 中 | **高** |
| 多语言后端 | 需 Sidecar | 需 Sidecar | **原生 Sidecar 模式** |

参考：微信、钉钉、飞书均采用 **CEF/Chromium 自研壳 + Native 能力层**。

### 4.2 为什么壳层选 C++（而非 Rust cef-rs）

| 维度 | C++ | Rust (cef-rs) |
|------|-----|---------------|
| CEF API 贴合度 | 原生，文档/示例最全 | 封装层，生态较新 |
| 企业参考 | 微信 mmmojo、大量 CEF 产品 | Tauri 团队在推进 |
| 壳层代码量 | 1–3 万行，可控 | 相当 |
| 开发环境 | VS 2022 + CEF 手动下载 | rustup + CEF 下载 |
| 推荐场景 | **企业级、长期维护** | 小团队、Rust 全栈 |

**结论**：壳层固定 **C++ + CEF Official SDK**；后端语言不受限。

### 4.3 端到端技术栈

```
壳层:       C++17 + CEF Binary Distribution + CMake
前端:       Vue 3 + TypeScript + Vite + @niuma/ui + Pinia
Platform:   **Go**（独立进程，权限/SQLite/gRPC 中枢）
后端服务:   按模块 — Rust / Go / Python / C++ / Java
契约:       Protobuf 3 + gRPC
轻量插件:   JSON-RPC 2.0 over stdio
构建:       CMake（壳）+ pnpm（前端）+ 各语言原生构建
打包:       安装包内嵌 CEF runtime + 各 service 二进制
```

---

## 5. 与微信架构的对照

微信客户端做法与 NiuMa 设计高度同构：

| 微信 | NiuMa |
|------|-------|
| C++ 跨端逻辑层 | C++ Shell + Platform Core |
| mmmojo（Mojo IPC + Protobuf） | 应用 IPC（gRPC + Protobuf） |
| MessagePipe / DataPipe / SharedBuffer | gRPC stream / 共享内存 |
| XPlugin 子进程 | 多语言 Capability Services |
| 父进程 broker | Shell / Platform 路由 |
| MMProto 契约 | `proto/` 目录 |
| 模块 SDK 边界 | 插件 manifest + proto |

核心启示：**不是统一语言，是统一协议 + IPC 总线**。

---

## 6. 安全设计要点

| 项 | 方案 |
|----|------|
| 凭据存储 | **VaultStore**：AES-256-GCM 密文存 `nm_credential_ref`；OS Keychain 仅主密钥 |
| 凭据流转 | 仅在 Platform Core 解密后注入 L1；UI 进程不可见明文 |
| IPC 授权 | Named Pipe ACL 限当前用户；可选 one-time token |
| 插件权限 | manifest 声明 + 用户授权弹窗 |
| 危险操作 | SSH 执行、删库、FFmpeg 等需二次确认（Human-in-the-loop） |
| 审计 | 操作日志全记录 |

---

## 7. 非目标（初版不做）

- 不做 Electron / Node 运行时
- 不做云端 SaaS（初版纯本地桌面）
- 不做插件在线市场（P4 再考虑）
- 不做壳层业务逻辑

---

## 8. 相关文档

- [02 — C++ 壳层设计](./02-shell-cpp-cef.md)
- [03 — IPC 协议设计](./03-ipc-protocol.md)
- [04 — 插件系统设计](./04-plugin-system.md)
- [05 — 后端服务设计](./05-backend-services.md)
- [06 — 目录结构与路线图](./06-directory-structure.md)
- [本地数据库规范](./database-schema.md)
- [07 — Web 总览](./07-web-overview.md)
- [08 — UI 设计规范](./08-web-design-system.md)
- [09 — App Shell 布局](./09-web-app-shell.md)
- [12 — FTP 管理模块](./12-ftp-module.md)
- [16 — SSH / SFTP 管理模块](./16-ssh-sftp-module.md)
- [17 — 脚本平台分层方案](./17-script-platform-layout.md)
