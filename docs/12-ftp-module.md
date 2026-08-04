# 12 — FTP 管理模块（Layer 1 能力服务 + Web 模块）

> 版本：v0.2 · 日期：2026-07-04
> 状态：设计（Phase 0）——尚未实现；本文为落地契约与分阶段路线
> v0.2：锁定「壳层零业务 + platform-core 编排者」进程模型；补高并发/大数据评估（§7.3）

---

## 1. 目标与范围

面向服务器运维/建站的**专业 FTP 客户端**能力，纳入 NiuMa 的 `ops` 领域（与 SSH 同域）。

### 1.1 协议范围（本期锁定）

- **FTP**（明文）
- **FTPS**：显式 TLS（`AUTH TLS`，默认）与隐式 TLS
- **不含 SFTP**（SFTP 走 SSH 生态，列为未来单独模块，见 §11）

### 1.2 关键决策（已拍板）

| 维度 | 决策 | 理由 |
|------|------|------|
| 协议 | 仅 FTP / FTPS | 聚焦建站/主机场景，纯 Go 库成熟 |
| 能力服务落位 | **独立 Layer-1 进程 `ftp-service`** | 崩溃隔离、可独立升级，符合架构分层 |
| 进程拉起层 | **壳层只拉 platform-core；platform-core 拉起/守护 Layer-1 与插件服务** | 壳层零业务；对动态插件与后端多语言扩展最有利（见 §7.1） |
| 传输进度通道 | **事件流优先**（`niuma:event`） | 实时进度/速度，未来 SSH/DB 复用同一推送链路 |

### 1.3 专业能力清单（分期实现）

- 连接与站点管理：站点保存、FTP/FTPS、被动/主动模式、编码、匿名登录、TLS 校验（Phase 1–2）
- 浏览与导航：本地/远程双栏、目录列表、排序/过滤、刷新（Phase 2）
- 文件传输（核心）：上传/下载、队列、并发、断点续传、进度/速度、覆盖策略、限速（Phase 3）
- 远程文件操作：新建/重命名/删除/移动、权限、远程编辑（下载→本地编辑→回传）（Phase 4）
- 专业增强：同步浏览、目录比较与同步、协议日志、多会话标签（Phase 5）

---

## 2. 分层与进程模型

```
┌ Layer 4 ─ Web ────────────────────────────────────────────────┐
│ web/src/modules/ftp/  站点管理器 · 双栏浏览 · 传输队列          │
│   ↑ bridgeInvoke(method, params)      ↑ bridgeOnEvent(niuma:event)
└───┼───────────────────────────────────┼──────────────────────┘
    │ cefQuery (请求/响应)               │ PostMessage (事件推送)
┌ Layer 3 ─ C++ Shell ──────────────────┴──────────────────────┐
│ bridge_router  ·  platform_client  ·  【新增】事件回投 UI      │
└───┼───────────────────────────────────▲──────────────────────┘
    │ 4B 长度前缀 + JSON 帧（请求/响应）  │ 事件帧（Platform→Shell 主动推送）
┌ Layer 2 ─ platform-core（Go）─────────┴──────────────────────┐
│ handler 分发：platform.connection.* / platform.credential.*  │
│ + ftp.* 代理转发；nm_connection_profile / Vault 凭据            │
│ + 【新增】FtpServiceClient（拉起/管理 ftp-service，转发+聚合事件）
└───┼───────────────────────────────────▲──────────────────────┘
    │ 帧协议（请求/响应 + 事件）           │ 传输进度/目录事件
┌ Layer 1 ─ ftp-service（Go，独立进程）─┴──────────────────────┐
│ FTP/FTPS 连接池 · 会话 · 目录列举 · 传输队列（断点续传/限速）  │
└───────────────────────────────────────────────────────────────┘
```

要点：

- **两级进程模型（已定）**：壳层**只拉起 platform-core 这一个根进程**、只做字节透传（壳层零业务）；`ftp-service`、未来 `ssh-service` 及插件后端一律由 **platform-core 作为编排者**拉起/守护/路由。服务 manifest（`services/manifests/*.yaml`）的**消费方从 C++ 壳层上移到 platform-core**（壳层仅保留 platform-core 自身那条）。理由与权衡见 §7.1。
- **platform-core 是编排者**：负责拉起/守护 `ftp-service`、注入凭据、鉴权，并在 `ftp.*` 方法上做代理转发。Web 永远只跟壳层对话，不直连 `ftp-service`。
- **两段事件链路**（本期需新建，见 §7.2）：`ftp-service → platform-core → C++ Shell → Web(niuma:event)`。
- **凭据边界**：明文密码只在 platform-core 从 Vault 解密后、注入给 `ftp-service` 的一次性调用中出现，**绝不回传 Web**；库内仅存 AES-256-GCM 密文。
- **大数据不过桥**：GB 级文件字节只在 `ftp-service ↔ 本地磁盘 / 远端` 之间流动，**绝不经过 IPC 帧 / cefQuery**；桥上只走控制指令与进度事件。高并发/大数据评估见 §7.3。

---

## 3. 数据模型（复用既有 schema，不新增表）

连接配置复用 `000002_connection`（`scripts/sql/sqlite/000002_connection.up.sql`）：

| 表 | 用途 | FTP 用法 |
|----|------|----------|
| `nm_connection_profile` | 连接站点 | `connection_kind = 'ftp'`；FTPS 通过 `connection_options` 区分 |
| `nm_credential_ref` | 凭据（不含明文） | `credential_kind = 'password'`；`cipher_text` = Vault 密文 |
| `nm_profile_credential` | 站点↔凭据 多对多 | 一个 FTP 站点关联一条 password 凭据 |

### 3.1 `connection_options`（JSON，FTP 专用字段）

```json
{
  "protocol": "ftp",
  "tls_mode": "none",
  "passive": true,
  "encoding": "utf-8",
  "transfer_type": "binary",
  "tls_verify": true,
  "timeout_seconds": 30,
  "keepalive_seconds": 60,
  "anonymous": false,
  "proxy": { "type": "none" },
  "accentColor": "blue"
}
```

字段实现状态（v0.1）：

| 字段 | 状态 |
|------|------|
| `protocol`, `tls_mode`, `passive`, `encoding`, `transfer_type`, `tls_verify`, `timeout_seconds`, `anonymous` | **ftp-service 已生效** |
| `proxy` | **已生效**（TCP 拨号） |
| `keepalive_seconds` | **仅存储**；建连后保活未实现 |
| `accentColor` | Web UI 标签色 |
| `tunnel` | **未实现**；若历史数据中存在则原样保留，不影响 FTP 拨号 |

公共字段命名与跨协议约定见 [14 — 能力连接框架 §9](./14-capability-connection-framework.md)。

约束：`connection_kind` 恒为 `'ftp'`；是否加密看 `protocol`/`tls_mode`。凭据信息（密码）**不在** `connection_options` 内。表单「测试连接」超时见 [14 §9.4](./14-capability-connection-framework.md)（≤12s，与保存值取较小者）。

### 3.2 迁移

本期**无需新增迁移**——三张表已在权威源 `scripts/sql/sqlite/000002_connection.*.sql` 就位。若后续需要 FTP 专属字段，新增 `000003_*` 域文件并 `go generate ./...` 同步内嵌副本（见 [11-platform-core §4.1](./11-platform-core.md)）。

---

## 4. IPC 方法契约

沿用 [11-platform-core §2](./11-platform-core.md) 的帧协议与「`result` 为再编码字符串」约定。方法名分两个命名空间：

- `platform.connection.*` / `platform.credential.*`：由 **platform-core 直接**处理（DB + VaultStore）。
- `ftp.*`：platform-core **代理转发**给 `ftp-service`。

### 4.1 连接与凭据（platform-core，Phase 1）

| method | 入参 | 结果对象（result 内层） |
|--------|------|--------------------------|
| `platform.connection.list` | `{ workspaceId?, kind? }` | `{ profiles: ConnectionProfile[] }` |
| `platform.connection.get` | `{ profileId }` | `{ profile: ConnectionProfile \| null }` |
| `platform.connection.create` | `{ profile: ConnectionProfileInput, credential?: CredentialInput }` | `{ profileId }` |
| `platform.connection.update` | `{ profileId, profile: ConnectionProfileInput, rowVersion }` | `{ updated: true, rowVersion }` |
| `platform.connection.delete` | `{ profileId }` | `{ deleted: true }` |
| `platform.credential.set` | `{ credentialId?, label, kind, secret }` | `{ credentialId }` |
| `platform.credential.delete` | `{ credentialId }` | `{ deleted: true }` |

`ConnectionProfile`（出参，**不含密码**）：

```jsonc
{
  "profileId": "…", "workspaceId": "default", "profileName": "站点A",
  "connectionKind": "ftp", "hostAddress": "10.0.0.1", "portNumber": 21,
  "loginAccount": "deploy", "connectionOptions": { /* §3.1 */ },
  "recordStatus": "active", "rowVersion": 3,
  "createdAt": "2026-07-04T12:00:00Z", "updatedAt": "…",
  "credentialIds": ["…"]
}
```

规则：`profile_id`/`credential_id` 由 platform-core 应用层生成（TEXT，见 database-schema.mdc）；`create` 时若带 `credential`，先建 `nm_credential_ref` → Vault 写入密文 → 建 `nm_profile_credential`；`update` 校验 `rowVersion` 乐观锁；`delete` 在 Service 层级联删 `nm_profile_credential` 与孤立凭据。

### 4.2 会话与浏览（ftp-service，Phase 2）

| method | 入参 | 结果对象 |
|--------|------|----------|
| `ftp.session.open` | `{ profileId }` | `{ sessionId }` |
| `ftp.session.close` | `{ sessionId }` | `{ closed: true }` |
| `ftp.session.test` | `{ profileId }` | `{ ok, message }` |
| `ftp.dir.list` | `{ sessionId, path }` | `{ path, entries: FtpEntry[] }` |
| `ftp.dir.make` | `{ sessionId, path }` | `{ created: true }` |

`FtpEntry`：`{ name, kind: "file"|"dir"|"link", size, modifiedAt, permissions }`。
`ftp.session.open` 由 platform-core 取 profile + 从 Vault 解密密码，注入 `ftp-service` 建连；`sessionId` 仅 `ftp-service` 内有效，Web 后续操作携带它。

### 4.3 文件操作与传输（ftp-service，Phase 3–4）

| method | 入参 | 结果对象 |
|--------|------|----------|
| `ftp.entry.rename` | `{ sessionId, fromPath, toPath }` | `{ renamed: true }` |
| `ftp.entry.delete` | `{ sessionId, path, recursive }` | `{ deleted: true }` |
| `ftp.entry.chmod` | `{ sessionId, path, mode }` | `{ updated: true }` |
| `ftp.transfer.enqueue` | `{ sessionId, direction: "upload"\|"download", localPath, remotePath, overwrite: "overwrite"\|"skip"\|"rename"\|"resume", limitBps? }` | `{ taskId }` |
| `ftp.transfer.pause` | `{ taskId }` | `{ ok }` |
| `ftp.transfer.resume` | `{ taskId }` | `{ ok }` |
| `ftp.transfer.cancel` | `{ taskId }` | `{ ok }` |
| `ftp.transfer.list` | `{ sessionId? }` | `{ tasks: TransferTask[] }` |

`TransferTask`：`{ taskId, direction, localPath, remotePath, state, total, transferred, speedBps, error? }`；`state ∈ queued|running|paused|done|failed|canceled`。

---

## 5. 事件契约（`niuma:event`）

`ftp-service` 主动上报，经 platform-core → 壳层 → Web 的 `bridgeOnEvent`。载荷统一 `{ type, ... }`：

| type | 载荷 | 触发 |
|------|------|------|
| `ftp.transfer.progress` | `{ taskId, transferred, total, speedBps }` | 传输中周期上报（节流，如 ≤4 次/秒/任务） |
| `ftp.transfer.state` | `{ taskId, state, error? }` | 状态迁移（running/paused/done/failed/canceled） |
| `ftp.session.state` | `{ sessionId, state, message? }` | 连接建立/断开/重连 |

前端订阅示例：

```ts
import { bridgeOnEvent } from '@/api'
const off = bridgeOnEvent((detail) => {
  const e = detail as { type: string; taskId?: string }
  if (e.type === 'ftp.transfer.progress') { /* 更新队列进度条 */ }
})
```

---

## 6. 会话与传输队列模型（ftp-service 内部）

- **连接池**：每个 `sessionId` 维护 1 条控制连接 + N 条数据连接（并发传输）；`connection_options.passive` 决定数据连接方向。
- **传输队列**：全局队列 + 每会话并发上限（默认 2，可配）；任务状态机 `queued→running→(paused)→done|failed|canceled`。
- **断点续传**：下载用本地已存在字节数 + `REST` 指令续传；上传用 `APPE`/`REST`（服务器支持时），`overwrite:"resume"` 触发。
- **限速**：令牌桶按 `limitBps` 限流数据连接读写。
- **编码**：按 `connection_options.encoding` 对远程文件名做 UTF-8 ↔ GBK 转换（服务器多为非 UTF-8 时）。
- **生命周期**：platform-core 拉起并守护单个 `ftp-service` 进程；进程崩溃则重启并向前端广播 `ftp.session.state{state:"lost"}`，由前端提示重连。

---

## 7. 进程编排与传输通道（过渡协议）

沿用 platform-core 现有帧协议（4B 小端长度 + UTF-8 JSON）。

### 7.1 进程编排（壳层零业务 + platform-core 编排者）

**决策**：壳层只拉起 platform-core 一个根进程；`ftp-service` 及未来所有 Layer-1 / 插件服务由 platform-core 拉起、守护、路由。

为何不由壳层（`shell/src/core/runtime/service_manager.cpp`）直接拉起，尽管其机制现成：

1. **壳层零业务不变量**：「哪些服务存在、何时拉起、注入什么凭据、插件贡献了什么服务」是业务/策略，壳层应保持字节透传 + 单根进程启停。
2. **迭代速度与风险**：新增服务或安装带后端的插件**不应重编译/分发原生壳层**；放在 Go 侧仅需加 manifest + 路由分支。
3. **多语言契约归属**：「如何成为一个服务」的协议（帧 / 未来 gRPC + 瘦 service SDK）定义在 platform↔service（Go）边界最优，任意语言实现、Go 统一监督；若归 C++ 则演进最慢。
4. **数据/事件通路一致**：事件本就走 `ftp-service → platform-core → 壳层 → Web`，platform-core 已在通路上，应拥有其所监督的进程，避免所有权撕裂。
5. **凭据与权限**：manifest 的 `permissions`、凭据注入是 platform-core 专属职责，壳层不得触碰凭据。
6. **动态插件**：运行时安装带 Python/Node 后端的插件，由 platform-core 热读插件 manifest 按需拉起，壳层无需重启或改动。

落地要点：

- **manifest 消费方上移**：`services/manifests/*.yaml`（schema 已含 `runtime.executable`/`ipc`/`lifecycle`/`permissions`）改由 platform-core 读取与监督；壳层 `ServiceManifestLoader` 仅保留 platform-core 自身那条。
- **按命名空间路由**：`handler.dispatch` 前缀分发——`platform.*` 进程内处理，`ftp.*` → ftp-service，`<pluginId>.*` → 对应插件服务。
- **地址自分配**：platform-core 给每个子服务分配独立管道/socket 地址（经参数/env 下发），消除「三处常量必须一致」的脆弱点（仅 platform-core 自身地址仍与壳层共享）。
- **supervisor 职责**：懒启动、健康检查、失败退避重启、崩溃→广播 `ftp.session.state{state:"lost"}`、优雅关闭。
- **孤儿回收**：子服务挂在 Windows **Job Object**（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）下，platform-core 退出即级联终止；壳层仍用现有 `TerminateProcess` 杀 platform-core，级联生效。POSIX 用进程组 + `PDEATHSIG`。

### 7.2 请求转发与反向事件通道

在帧协议上**新增两处能力**：

1. **子进程管理 + 请求转发**：platform-core 新增 `FtpServiceClient`，在首个 `ftp.*` 请求时按 `ftp-service` 的 manifest 地址（独立命名管道 `\\.\pipe\niuma.ftp` / UDS）建连；`handler.dispatch` 对 `ftp.*` 前缀方法转发，密码从 Vault 解密后随 `ftp.session.open` 下发。
2. **反向事件帧**：`ftp-service` 在传输过程中主动写「事件帧」给 platform-core；platform-core 再推给壳层。**这是本期新链路的核心**：
   - platform-core → 壳层：需壳层在 `platform_client.cpp` 的连接上支持接收**非请求响应**的推送帧，并 `PostMessage`/`ExecuteJavaScript` 触发 Web 的 `niuma:event`（`web/src/api/client.ts` 已在监听）。
   - **事件与 RPC 分离**：事件帧走独立方向/独立连接，不与请求响应复用同一顺序流，互不阻塞。
   - 该链路建成后，SSH/DB/AI 流式输出可复用。

> 与 gRPC 升级路径一致（[11-platform-core §8](./11-platform-core.md)）：未来 `Invoke`/`InvokeStream` 落地后，`ftp.*` 代理与事件帧无缝替换为 gRPC stream + `StreamProxy`，方法契约与事件契约不变。

### 7.3 高并发与大数据瓶颈评估

**结论：本架构无架构级瓶颈；真实上限是网络带宽与磁盘 IO（FTP 固有），而非桥接/IPC。** 前提是守住下列不变量。

核心：**大文件字节永不经过 IPC 帧 / cefQuery**——`ftp-service` 直接在「远端数据连接 ↔ 本地磁盘」间流式搬运，桥上只走小 JSON 的控制指令与进度事件；故 IPC 单帧上限、JSON 编码、cefQuery 均不在大数据通路上。

| 关注点 | 评估 | 约束/做法 |
|--------|------|-----------|
| 传输吞吐（大数据） | 无瓶颈 | `io.CopyBuffer` 定长缓冲，内存 O(缓冲区×并发连接)，不随文件大小增长 |
| 高并发任务/会话 | 无瓶颈 | goroutine 轻量；全局队列 + 每会话并发上限；受限于带宽非架构 |
| 进度事件风暴 | 需治理 | 每任务节流（≤4/s）+ platform-core 按固定节拍（如 10 Hz）**合并批量**成单帧，帧数与任务数解耦 |
| 事件可靠性 | 分级 | `progress` **有损可丢**（只保留最新）；`state` **可靠不丢**（小队列）；两类队列分离 |
| 请求队头阻塞 | 需治理 | 耗时操作全异步——`enqueue` 立即返回 taskId，传输走事件；RPC 短平快；超大 `dir.list` 后续可分页 |
| 事件/响应互扰 | 已规避 | 反向事件独立通道（§7.2），不与 RPC 复用顺序流 |
| SQLite 单连接 | 非瓶颈 | 仅低频站点 CRUD 命中；**传输过程绝不逐块写库**，进度只在 ftp-service 内存 |
| 背压 | 有界 | 各级队列有界；拥塞时丢 `progress` 保 `state` |
| gRPC 迁移 | 前向兼容 | stream + `StreamProxy` 提供原生流控，以上约束天然满足 |

---

## 8. Web 模块结构

新增 `web/src/modules/ftp/`（对齐 SSH 模块与 [10-web-extension-system](./10-web-extension-system.md) 注册模式）：

```
web/src/modules/ftp/
  views/FtpHome.vue          # 站点管理器入口（Phase 1）
  views/FtpSession.vue       # 双栏浏览 + 传输队列（Phase 2+，Tab 内每会话一实例）
  components/SiteManager.vue  # 站点增删改查（Phase 1）
  components/DualPane.vue     # 本地/远程双栏（Phase 2）
  components/TransferQueue.vue# 传输队列面板（Phase 3）
  stores/ftp.ts              # 会话/队列/进度事件订阅（Phase 2+）
web/src/api/ftp.ts           # bridgeInvoke 封装：platform.connection.* / ftp.*
web/src/api/types/ftp.ts     # ConnectionProfile / FtpEntry / TransferTask 类型
```

注册（三处，见 §9 清单）：`builtin-modules.ts` 追加 `{ id:'ftp', category:'ops', icon:'folder-tree', routePath:'/ftp', order:15 }` + i18n `nav.ftp` / `modules.ftp.*`。领域图标沿用 `ops` 的 `server`（activity-bar-config 无需改）。

多会话经 Tab 系统承载：`FtpHome` 里"连接站点"调用 `tabStore.openTab({ moduleId:'ftp', title: 站点名, props:{ profileId } })`，`ModuleWorkspace` 的每组 `<keep-alive>` 保活多个会话。

---

## 9. 分阶段里程碑

| Phase | 目标 | 后端 | 前端 | 事件链路 |
|-------|------|------|------|----------|
| **0** | 设计对齐 | 本文 | — | — |
| **1** | 连接与凭据数据层 + 站点管理器 | `platform.connection.*` / `platform.credential.*`（store + handler + VaultStore） | 模块注册 + `SiteManager` CRUD | 不需要 |
| **2** | 连接与只读浏览 | `ftp-service` 进程 + `ftp.session.*` / `ftp.dir.list`；platform-core 代理转发 | 双栏浏览、导航、刷新 | `ftp.session.state` |
| **3** | 文件传输（核心） | `ftp.transfer.*`、队列、断点续传、限速 | 传输队列面板、拖拽、覆盖策略 | **建成 progress/state 推送**（§7.2 反向事件帧 + 壳层改造） |
| **4** | 远程文件操作 | `ftp.entry.*`（rename/delete/chmod）、远程编辑回传 | 右键菜单、编辑器联动 | 复用 |
| **5** | 专业增强 | 目录比较/同步、协议日志 | 同步浏览、日志面板、多会话打磨 | 复用 |

关键依赖：**Phase 3 的进度实时性依赖 §7.2 的反向事件帧链路（含 C++ 壳层改造）**——需与壳层同步排期；在此之前 Phase 2 的只读浏览可先用请求/响应跑通。

---

## 10. 安全

- 密码/密钥经 Vault 加密存 `nm_credential_ref.cipher_text`（主密钥在 OS Keychain）；DB 业务字段与 `connection_options` 无明文（database-schema.mdc）。
- 明文密码生命周期：platform-core 取出 → 随 `ftp.session.open` 一次性注入 `ftp-service` → 建连后即释放；不回传 Web、不写日志。
- FTPS 默认校验证书（`tls_verify:true`）；明文 FTP 在 UI 上明确风险提示。
- 协议日志（Phase 5）对 `PASS`/`ACCT` 等命令做脱敏。
- 本地进程间管道仅本机可达（命名管道 ACL / UDS 权限）。

---

## 11. 技术选型与未决事项

**Go 依赖（ftp-service）**：
- FTP/FTPS 客户端：`github.com/jlaffaye/ftp`（纯 Go，支持显式 FTPS）。隐式 FTPS 若该库支持不足，则在其 `DialWithTLS` 之上自行封装 TLS 拨号。
- VaultStore（platform-core）：AES-256-GCM 密文 + `go-keyring` 存主密钥（Windows Credential Manager）。
- 保持纯 Go / 无 cgo，与 `modernc.org/sqlite` 基线一致（Go 1.22）。

**已决**：
- 进程拉起层 = **platform-core 编排者模型**，壳层只拉 platform-core（壳层零业务）；服务 manifest 消费方上移到 platform-core（见 §2 要点、§7.1）。
- 高并发/大数据经评估**无架构级瓶颈**（不变量见 §7.3）。

**未决**：
1. 反向事件帧的壳层实现细节（`ExecuteJavaScript` vs CEF `PostMessage`）需与 C++ 侧确认。
2. 隐式 FTPS 覆盖面视目标服务器而定。
3. 未来 SFTP 模块是否复用 `ftp-service` 还是并入 SSH 模块——本期不决策。

---

## 12. 相关文档

- [总体架构](./architecture.md)
- [09 — Web App Shell（Tab/分屏）](./09-web-app-shell.md)
- [10 — Web 扩展系统（模块注册）](./10-web-extension-system.md)
- [11 — Platform Core（IPC/帧协议/迁移）](./11-platform-core.md)
- [数据库规范](./database-schema.md)
