# 16 — SSH / SFTP 管理模块（Layer 1 能力服务 + Web 模块）

> 版本：v0.1 · 日期：2026-07-07
> 状态：设计 + 骨架已落地；本文为 SSH / SFTP 模块开发约定与阶段路线

---

## 1. 目标与范围

面向主机运维场景，提供 **SSH 终端、远程命令执行、SFTP 文件浏览与编辑** 能力，归属 `ops` 域，与 FTP 侧栏连接树共用一套连接资料管理。

### 1.1 本期范围

- **SSH**：密码认证、会话建立、命令执行
- **SFTP**：目录浏览、文件读取、文件写回
- **连接管理**：复用 `platform.connection.*` 与凭据注入
- **文件工作台接入**：通过 `ssh.sftp.read` / `ssh.sftp.write` 对接 `ssh-sftp` Provider

### 1.2 暂不纳入

- SSH agent forwarding
- 端口转发、本地/远程隧道（Redis 侧 SSH 隧道见 [14 §9.2](./14-capability-connection-framework.md)）
- 交互式 OTP / 多轮 keyboard-interactive 弹窗（当前仅用已存口令回答 Password 提示）

### 1.2.1 已纳入（相对初版文档）

- 密码 / 内联私钥 / 私钥文件三种认证（`auth_type`）
- 密码失败后自动回退 keyboard-interactive（堡垒机常见）
- SFTP 文件浏览与在线编辑（不依赖 `sftp_enabled` 开关）
- `keepalive_seconds`、`verify_host_key`（对照 `~/.ssh/known_hosts`，可确认指纹后写入）
- 终端 PTY 以 base64 推送原始字节；`encoding`（utf-8 / gbk）在 Web 解码

### 1.3 关键决策

| 维度 | 决策 | 理由 |
|------|------|------|
| 能力服务落位 | **独立 Layer-1 进程 `ssh-service`** | SSH / SFTP 长连接、流式输出、崩溃隔离需求明显 |
| 服务语言 | **Rust** | 适合连接复用、并发 I/O、终端/SFTP 双通道 |
| 进程拉起层 | **platform-core 拉起并路由** | 与 FTP 一致，壳层零业务 |
| 文件协议 | **SSH 会话内 SFTP 仍属 ssh-service；无 shell 账号走独立 `sftp-service`** | 避免与 FTP 语义混淆；仅有 SFTP 权限的账号不申请 PTY/exec |
| 凭据边界 | **平台注入明文密码，能力服务进程内使用** | UI 不见明文，沿用现有凭据模型 |

---

## 2. 分层与进程模型

```
┌ Layer 4 ─ Web ─────────────────────────────────────────────────────┐
│ web/src/modules/ssh/  连接列表 · 终端 Tab · SFTP 文件浏览/编辑      │
│   ↑ bridgeInvoke(ssh.*)              ↑ bridgeOnEvent(niuma:event)   │
└───┼──────────────────────────────────┼──────────────────────────────┘
    │ cefQuery（请求/响应）             │ PostMessage（事件推送）
┌ Layer 3 ─ C++ Shell ──────────────────┴────────────────────────────┐
│ bridge_router · platform_client · 事件回投 UI                      │
└───┼──────────────────────────────────▲────────────────────────────┘
    │ 4B 长度前缀 + JSON 帧             │ 事件帧
┌ Layer 2 ─ platform-core（Go）─────────┴────────────────────────────┐
│ platform.connection.* / platform.credential.*                      │
│ + ssh.* 代理转发 + 凭据注入 + 鉴权 / 审计                           │
└───┼──────────────────────────────────▲────────────────────────────┘
    │ length-prefixed JSON             │ 会话状态 / 命令输出 / 传输事件
┌ Layer 1 ─ ssh-service（Rust）─────────┴────────────────────────────┐
│ SSH 会话池 · 命令执行 · SFTP 子系统 · 远程文件读写                 │
└────────────────────────────────────────────────────────────────────┘
```

要点：

- 壳层只负责桥接与进程承载，**不处理 SSH/SFTP 业务**。
- `ssh-service`、`sftp-service` 与 `ftp-service` 平级，均由 `platform-core` 按 manifest 懒拉起。
- SFTP 大文件内容不经过 UI 常规 RPC 传输；在线编辑仅支持受限大小文本，超大文件未来走下载/上传链路。

---

## 3. 工程布局

### 3.1 目录

```
packages/rust/
├── Cargo.toml                 # Rust workspace
├── niuma-logutil/             # 日志公共 crate
└── niuma-serviceipc/          # 应用 IPC 公共 crate

services/
├── manifests/ssh-service.yaml
├── manifests/sftp-service.yaml
├── ssh-service/               # 终端 / exec / 会话内 SFTP
│   ├── Cargo.toml
│   └── src/
└── sftp-service/              # 仅 SFTP 子系统，不申请 shell
    ├── Cargo.toml
    └── src/
        ├── main.rs
        ├── idgen.rs
        ├── handler/
        └── session/
```

### 3.2 公共 Rust 包约定

| crate | 作用 | 对齐现有实现 |
|------|------|-------------|
| `niuma-logutil` | 统一日志目录策略与滚动落盘 | 对齐 `packages/go/logutil` |
| `niuma-serviceipc` | 4 字节小端长度前缀 + UTF-8 JSON 帧协议 | 对齐 `packages/go/serviceipc` |

约束：

- 新的 Rust 公共能力优先放 `packages/rust/`
- 服务私有逻辑放 `services/ssh-service/src/`
- 不在 `platform-core` 内硬编码 SSH 业务逻辑

---

## 4. 数据模型与连接配置

SSH 连接配置复用现有三张表：

| 表 | 用途 | SSH 用法 |
|----|------|----------|
| `nm_connection_profile` | 连接配置 | `connection_kind = 'ssh'` |
| `nm_credential_ref` | 凭据引用 | `password` 或 `ssh_private_key`（由 `auth_type` 决定） |
| `nm_profile_credential` | 站点与凭据绑定 | 一个 SSH 站点至少绑定一份认证材料 |

### 4.1 `connection_options`（JSON）

```json
{
  "timeout_seconds": 30,
  "keepalive_seconds": 60,
  "term_type": "xterm-256color",
  "encoding": "utf-8",
  "sftp_enabled": true,
  "verify_host_key": false,
  "auth_type": "password",
  "private_key_path": "",
  "passphrase": "",
  "proxy": { "type": "none" },
  "accentColor": "blue"
}
```

字段实现状态（v0.1）：

| 字段 | 状态 |
|------|------|
| `timeout_seconds` | **ssh-service 已生效**（建连 + 认证总超时） |
| `auth_type`, `private_key_path`, `passphrase` | **已生效**；私钥内容经 Vault 加密存储，经 platform `password` 字段注入 |
| `proxy` | **已生效** |
| `term_type` | **Web 终端**打开时使用（`ssh.terminal.open` 参数 `termType`），非 ConnectOptions |
| `keepalive_seconds` | **ssh-service / sftp-service 已生效**（russh `keepalive_interval`；0 禁用） |
| `verify_host_key` | **已生效**；`true` 时对照 `~/.ssh/known_hosts`。未知或变更则拒绝，Web 可确认指纹后调用 `*.hostkey.remember` |
| `encoding` | **Web 终端已生效**；L1 推送原始字节（`encoding=base64`），前端按 utf-8 / gbk 解码 |
| `sftp_enabled` | **仅存储**；UI 始终展示 SFTP 入口 |
| `accentColor` | Web UI 标签色 |
| `tunnel` | **未实现**（SSH 服务不消费；历史数据原样保留） |

说明：

- 密码 / 私钥 PEM **不进入** `connection_options`；`private_key_file` 模式仅保存路径。
- `verify_host_key: false` 为类型默认值（兼容旧资料）。开启后未知主机可在连接失败弹窗中信任并写入 known_hosts。
- 公共字段与测试超时约定见 [14 §9](./14-capability-connection-framework.md)。

---

## 5. IPC 方法契约

沿用现有 Bridge 信封与 service 内部 action 映射规则：

- Web 方法：`ssh.*`
- service 内部方法：剥离 namespace 后的 action

例如：

| Web method | namespace | service action |
|-----------|-----------|----------------|
| `ssh.session.open` | `ssh` | `session.open` |
| `ssh.exec.run` | `ssh` | `exec.run` |
| `ssh.sftp.file.read` | `ssh` | `sftp.file.read` |

### 5.1 会话类

| method | 入参 | 结果对象 |
|--------|------|----------|
| `ssh.session.open` | `{ profileId }` 或内联连接参数 | `{ sessionId }` |
| `ssh.session.close` | `{ sessionId }` | `{ closed: true }` |
| `ssh.session.test` | `{ profileId }` 或内联连接参数 | `{ ok, message }` |
| `ssh.hostkey.remember` | `{ host, port }` | `{ remembered, host, port, fingerprint, algorithm }` |

### 5.2 命令执行

| method | 入参 | 结果对象 |
|--------|------|----------|
| `ssh.exec.run` | `{ sessionId, command }` | `{ stdout, stderr, exitCode }` |

MVP 先返回一次性结果；后续可升级为流式事件：

```json
{ "type": "ssh.exec.output", "sessionId": "...", "stream": "stdout", "data": "..." }
```

### 5.3 SFTP 浏览与文件读写

| method | 入参 | 结果对象 |
|--------|------|----------|
| `ssh.sftp.dir.list` | `{ sessionId, path }` | `{ path, entries }` |
| `ssh.sftp.file.read` | `{ sessionId, path }` | `{ path, content, size }` |
| `ssh.sftp.file.write` | `{ sessionId, path, content }` | `{ written: true, path }` |

目录项建议统一结构：

```json
{
  "name": "nginx.conf",
  "kind": "file",
  "size": 2048,
  "modifiedAt": "1710000000",
  "permissions": "0644"
}
```

---

## 6. manifest 契约

`services/manifests/ssh-service.yaml`：

```yaml
id: com.niuma.ssh
name: SSH Service
version: 0.1.0
bridge:
  namespace: ssh
  connection_kind: ssh
session:
  inject_credentials: true
  credential_methods:
    - session.open
    - session.test
runtime:
  executable: bin/niuma-ssh-service.exe
  lang: rust
ipc:
  transport: named_pipe
  address: '\\.\pipe\niuma.ssh'
  protocol: length_prefixed_json
lifecycle:
  startup: lazy
permissions: []
```

约束：

- `bridge.namespace` 固定为 `ssh`
- `connection_kind` 固定为 `ssh`
- 凭据注入仅作用于建连与测试方法

---

## 7. Rust 实现约定

### 7.1 服务入口

- `main.rs` 只做日志初始化、信号处理、Dispatcher 装配、IPC 启动
- 监听地址与 manifest 保持一致：Windows `\\.\pipe\niuma.ssh`

### 7.2 会话管理

- 一个 `sessionId` 对应一条已认证 SSH 连接
- SFTP 子会话按需创建并挂在同一 SSH 会话上
- `session.close` 负责释放 SSH 与 SFTP 资源

### 7.3 日志与错误

- 使用 `niuma-logutil` 初始化 `ssh-service.log`
- 结构化日志字段至少包含：`session`、`host`、`port`、`path`、`method`
- 错误字符串返回给 platform 时应可读，但避免泄露敏感信息

### 7.4 文件大小约束

- 在线读取文本默认上限：`10 MiB`
- 超限返回明确错误，提示改用下载/上传模式

---

## 8. Web 集成约定

### 8.1 连接树

- `web/src/modules/ops/types.ts` 已定义 `kind: 'ssh'`
- 侧栏树复用 `useConnectionProfiles`、`useConnFolders`、`useConnTree`
- 站点资料由 `platform.connection.*` 统一维护

### 8.2 模块 UI

建议目录：

```
web/src/modules/ssh/
├── api/
├── components/
├── composables/
└── views/
```

建议分层：

- `api/ssh.ts`：`createCapabilityClient('ssh')` 封装
- `views/SshHome.vue`：入口页 / 新会话入口
- `views/SshSession.vue`：终端 + SFTP 侧栏 / 文件面板

### 8.3 文件工作台

按 [15-file-editor-window.md](./15-file-editor-window.md) 约定，后续注册：

- Provider: `ssh-sftp`
- Read: `ssh.sftp.file.read`
- Write: `ssh.sftp.file.write`

这样文件工作台可零侵入复用 SSH 远程文件编辑能力。

---

## 9. 构建与运行

### 9.1 环境

| 工具 | 版本 |
|------|------|
| Rustup | stable |
| Rust | `stable`（仓库根 `rust-toolchain.toml`） |
| Go | 1.25.x |
| PowerShell | 5.1+ |

### 9.2 构建

```powershell
.\scripts\build-services.ps1
```

输出：

- `services/bin/niuma-platform-core.exe`
- `services/bin/niuma-ftp-service.exe`
- `services/bin/niuma-ssh-service.exe`

也可单独构建：

```powershell
cd services/ssh-service
cargo build --release
```

---

## 10. 分阶段路线

| 阶段 | 目标 | 产出 |
|------|------|------|
| P0 | 打通 Rust 服务骨架 + IPC + manifest | `ssh-service` 能启动并响应 `session.*` |
| P1 | 密码建连 + `exec.run` + `sftp.file.read/write` | 最小可用 SSH / SFTP 能力 |
| P2 | Web 终端页 + 远程文件浏览 | 可在桌面中操作服务器 |
| P3 | 流式输出、PTY、事件推送 | 真正终端交互体验 |
| P4 | 公钥认证 / known_hosts / 跳板机 | 专业运维增强 |

---

## 11. 与 FTP、独立 SFTP 服务的边界

| 能力 | SSH（含会话内 SFTP） | 独立 SFTP | FTP |
|------|----------------------|-----------|-----|
| 远程命令执行 / 终端 | 是 | 否 | 否 |
| 远程文件系统 | `ssh.sftp.*`（挂在同一 SSH 会话） | `sftp.*`（只开 SFTP 子系统） | FTP / FTPS |
| 安全通道 | SSH 加密 | SSH 传输 + SFTP 子系统 | FTP 明文 / FTPS |
| 文件工作台 Provider | `ssh-sftp` | `sftp` | `ftp` |
| 适用场景 | 有 shell 权限的主机运维 | 仅有 SFTP 权限、没有 SSH 终端 | 建站上传、站点资源管理 |
| Layer-1 进程 | `ssh-service` | `sftp-service` | `ftp-service` |

结论：

- **独立 SFTP 不并入 FTP 模块**，也不替代 SSH 会话内的 SFTP 侧栏
- 账号只有 `ForceCommand internal-sftp` / 无 PTY / 无 exec 时，应建 `connection_kind = sftp` 站点，由 `sftp-service` 建连并立刻打开 SFTP 子系统
- `sftp.session.test` 会校验 SFTP 子系统可用，不只做 SSH 认证
- 三者共享连接树、平台凭据与文件工作台抽象
- 协议实现、UI 语义、错误模型仍各自独立

---

## 12. 相关文档

- [12 — FTP 管理模块](./12-ftp-module.md)
- [13 — 服务目录布局](./13-service-layout.md)
- [14 — 能力连接框架](./14-capability-connection-framework.md)
- [15 — 文件工作台](./15-file-editor-window.md)
- [architecture.md](./architecture.md)
