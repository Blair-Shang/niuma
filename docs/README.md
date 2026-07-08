# NiuMa 设计文档

> 版本：v0.2 · 日期：2026-07-03

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [architecture.md](./architecture.md) | **总架构文档**（含 §2 整体架构图 Mermaid） |
| [01-architecture-overview.md](./01-architecture-overview.md) | 架构速览 |
| [02-shell-cpp-cef.md](./02-shell-cpp-cef.md) | C++ 壳层设计（CEF 封装、模块划分） |
| [04-plugin-system.md](./04-plugin-system.md) | 可插拔插件模型、manifest 规范 |
| [06-directory-structure.md](./06-directory-structure.md) | 仓库目录与 extensions/、plugins/ 规划 |
| [07-web-overview.md](./07-web-overview.md) | Web 层总览：Vue 3、Pinia、技术栈 |
| [08-web-design-system.md](./08-web-design-system.md) | UI 视觉与组件规范（**不含布局**） |
| [09-web-app-shell.md](./09-web-app-shell.md) | App Shell 布局（**不含视觉细节**） |
| [10-web-extension-system.md](./10-web-extension-system.md) | **Web 扩展 Registry、Contribution、API** |
| [12-ftp-module.md](./12-ftp-module.md) | FTP 管理模块（能力服务 + Web 模块） |
| [15-file-editor-window.md](./15-file-editor-window.md) | **文件工作台（多 Tab 查看/编辑窗口，全模块复用）** |
| [16-ssh-sftp-module.md](./16-ssh-sftp-module.md) | SSH / SFTP 管理模块（能力服务 + Web 模块） |
| [17-script-platform-layout.md](./17-script-platform-layout.md) | 脚本平台分层与重构方案 |
| [database-schema.md](./database-schema.md) | 本地离线 SQLite 规范、表结构 |

---

## 架构一图

```
Web UI (Vue 3)
    │ ① CEF IPC
    ▼
C++ Shell (CEF 宿主)
    │ ② 应用 IPC (gRPC / Named Pipe)
    ▼
Platform Core ──→ 多语言 Capability Services
```

---

## 核心决策摘要

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 桌面壳 | 自封装 CEF（非 Electron） | UI 一致、无 Node 包袱、企业主流 |
| 壳层语言 | **C++** | CEF 原生 API、微信/钉钉同款、长期稳定 |
| UI 层 | Vue 3 + `@niuma/ui`（自封装 Rs* 组件库） | 固定 Chromium 渲染，一套 token 走全平台 |
| 壳 ↔ 后端 | 应用 IPC（Named Pipe / UDS + gRPC） | 多语言解耦、流式、本机安全 |
| UI ↔ 壳 | CEF IPC（cefQuery / PostMessage） | Chromium 内置，无需 proto |
| 跨语言契约 | Protobuf + `proto/` | 协议先行，语言只是实现 |
| Platform Core | **Go** | 权限/SQLite/gRPC 中枢；迭代快、编排型逻辑为主 |
| 后端服务（L1） | 按模块选择 | Rust/Go/Python/C++/Java；与 Platform 仅通过 `proto/` 对齐 |
| 本地存储 | **SQLite**（离线单文件） | 无软删，凭据走 Keychain |

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.1 | 2026-07-03 | Platform Core 语言定为 Go |
| v0.2 | 2026-07-03 | 新增 04/06/10 扩展体系文档；web/extensions、plugins/ 目录 |
| v0.3 | 2026-07-06 | 15 升级为文件工作台（多 Tab + Provider + 跨模块复用） |
