# 14 — 能力连接框架（Capability Connection Framework）

> 统一连接类模块（FTP / SSH / DB …）与插件后端的 Bridge 路由、会话契约与 manifest 注册。

## 1. 三层边界

| 层 | 契约 | 扩展方式 |
|----|------|----------|
| **A — Bridge 信封** | `{ method, params, id }` / `niuma:event` | 固定，不可改 |
| **B — 连接资源** | `platform.connection.*` / `platform.credential.*` | 新模块只注册 `connection_kind` |
| **C — 能力操作** | `{namespace}.*` | manifest `bridge.namespace` 注册 |

## 2. 壳层路由（已实现）

除 `shell.*`（窗口/对话框/本地 FS）在 C++ 本地处理外，**所有** Bridge 方法均由 `platform-core` 承载：

```
Web cefQuery
  → BridgeRouter（shell.* 本地）
  → ServiceManager.EnsureRunning → 仅拉起 platform-core
  → PlatformClient 透传完整请求 JSON
```

插件方法如 `com.niuma.db-pg.session.open` **无需改壳层**。

## 3. platform 通用代理（已实现）

`platform/internal/handler/capability_registry.go` 读取 `services/manifests/*.yaml` 的 `bridge.namespace`，按**最长前缀**匹配方法：

| Web method | namespace | service action |
|------------|-----------|----------------|
| `ftp.session.open` | `ftp` | `session.open` |
| `ftp.dir.list` | `ftp` | `dir.list` |
| `com.niuma.db-pg.query.exec` | `com.niuma.db-pg` | `query.exec` |

凭据注入：manifest `session.inject_credentials: true` 时，`session.open` / `session.test`（可配置）由 platform 从 Keychain 注入后转发。

## 4. manifest 字段

```yaml
id: com.niuma.ftp
bridge:
  namespace: ftp              # Web Bridge 前缀
  connection_kind: ftp        # 对应 platform.connection 的 kind
session:
  inject_credentials: true
  credential_methods:
    - session.open
    - session.test
runtime:
  executable: bin/ftp-service.exe
ipc:
  address: "\\.\\pipe\\niuma.ftp"
```

新增能力服务 checklist：

1. `services/<name>/` 独立工程 + `services/manifests/<name>.yaml`（含 `bridge.namespace`）
2. 实现 service 内方法（如 `session.open`、`dir.list`）
3. **无需**新增 `*_proxy.go`、**无需**改壳层

## 5. 统一会话契约

所有连接类能力应实现：

| Bridge 方法 | 入参 | 返回 |
|-------------|------|------|
| `{ns}.session.open` | `{ profileId }` | `{ sessionId }` |
| `{ns}.session.close` | `{ sessionId }` | `{ closed: true }` |
| `{ns}.session.test` | `{ profileId }` | `{ ok, message }` |

事件（`niuma:event`，待反向通道落地）：

```ts
{ type: `${namespace}.session.state`, sessionId, state, message? }
// state: connected | closed | lost
```

## 6. Web SDK

`web/src/api/capability.ts` 提供 `createCapabilityClient(namespace)` 工厂，避免散落 method 字符串。

## 7. 性能说明

- 路由为内存 map + 最长前缀扫描（manifest 数量极少，O(n) 可忽略）
- 不改变现有「每 RPC 独立管道连接」模型，**不引入额外锁或阻塞**
- 流式/事件通道见 [12-ftp-module §7.2](./12-ftp-module.md)（后续 Phase）

## 8. 相关文档

- [13 — 服务目录布局](./13-service-layout.md)
- [12 — FTP 模块](./12-ftp-module.md)
- [16 — SSH / SFTP 模块](./16-ssh-sftp-module.md)
- [04 — 插件体系](./04-plugin-system.md)
- [21 — 会话注册表](./21-session-registry.md)（Tab 四层架构、L4 生命周期；**新增协议必读 §0.6**）

## 9. `connection_options` 约定（跨协议）

站点非敏感配置统一存入 `nm_connection_profile.connection_options`（JSON）。Bridge 信封与嵌套 options 的命名约定如下。

### 9.1 命名分层

| 层级 | 命名风格 | 示例 |
|------|----------|------|
| Bridge 入参 / `platform.connection.*` 响应 | camelCase | `profileId`、`connectionOptions`、`hostAddress` |
| 公共子对象（各协议共用） | camelCase | `proxy`、`tunnel`、`accentColor` |
| 协议专属字段（FTP / SSH / Redis） | **snake_case** | `timeout_seconds`、`auth_type`、`sentinel_master_name` |

历史数据若含 camelCase 协议字段（如 Redis `timeoutSeconds`），各服务 **读取时双兼容**；Web 新保存统一写 snake_case。

能力服务收到的 `options` 为 **SQLite 中 JSON 原样透传**（platform 仅做隧道 `sshProfile` 运行时注入，不改写字段名）。

### 9.2 公共字段

```json
{
  "accentColor": "blue",
  "proxy": { "type": "none" },
  "tunnel": { "type": "none" }
}
```

| 字段 | 消费方 | 说明 |
|------|--------|------|
| `accentColor` | Web UI | 侧栏/列表标签色；能力服务不读取 |
| `proxy` | FTP / SSH / Redis | HTTP/SOCKS 代理；`proxy.password` 可存库，编辑时留空表示不修改 |
| `tunnel` | **Redis（v0.1）** | SSH 跳板隧道；platform 将 `sshProfileId` 展开为 `sshProfile` 后转发。**FTP/SSH 服务尚未消费 tunnel**，表单仅 Redis 展示隧道 Tab |

### 9.3 凭据注入信封（`session.open` / `session.test`）

manifest `session.inject_credentials: true` 时，Web 通常只传 `{ profileId }`。platform 查库后向能力服务转发：

```json
{
  "hostAddress": "...",
  "portNumber": 22,
  "loginAccount": "...",
  "password": "...",
  "options": { /* connection_options 全文 */ }
}
```

- `password`：密码认证时为密码；`auth_type=private_key` 时为 **Keychain 中的私钥 PEM 内容**（历史字段名，非 FTP 语义）。
- 内联测试（新建站点未保存）可传 `hostAddress` + `options` / `connectionOptions`（二者等价，`options` 优先）。
- 内联 `portNumber <= 0` 时 platform **不**强行默认 21，由各服务按 `connection_kind` 回退（FTP 21、SSH 22、Redis 6379）。

### 9.4 测试连接 vs 正式会话

| 场景 | 超时 | 凭据 |
|------|------|------|
| 正式 `session.open` | 使用站点 `connection_options` 中的配置 | platform 从 Keychain 注入 |
| 表单「测试连接」 | Web 取站点配置与 **12 秒上限** 的较小值（尽快失败反馈） | 新建用表单密码；编辑密码留空则用 `profileId` 注入 |

### 9.5 Redis `connection_options`（摘要）

```json
{
  "database": 0,
  "topology": "standalone",
  "timeout_seconds": 10,
  "sentinel_master_name": "",
  "nodes": [],
  "proxy": { "type": "none" },
  "tunnel": { "type": "none" }
}
```

历史数据若含 `timeoutSeconds` / `sentinelMasterName`（camelCase），`redis-service` 在**读取时**双兼容；Web 新保存已统一写 snake_case。详见 `web/src/api/types/redis.ts`。

### 9.6 字段实现状态

协议专属字段的 **已生效 / 仅存储** 状态以各模块文档为准（[12](./12-ftp-module.md) §3.1、[16](./16-ssh-sftp-module.md) §4.1、[19](./19-mongodb-module.md) §4.1）。**禁止**在能力服务未实现前将字段标为「已强制生效」。

### 9.7 MongoDB `connection_options`（摘要）

```json
{
  "topology": "standalone",
  "auth_mechanism": "default",
  "auth_database": "admin",
  "replica_set": "",
  "read_preference": "primary",
  "srv_record": false,
  "timeout_seconds": 10,
  "client_driver": "default",
  "default_database": "",
  "tool_paths": {
    "mongosh": "",
    "mongodump": "",
    "mongorestore": "",
    "mongoexport": "",
    "mongoimport": ""
  },
  "proxy": { "type": "none" },
  "tunnel": { "type": "none" }
}
```

Shell 与导入导出走**用户本机外部工具**（mongosh、mongo-tools），在 [20 — 工具组件](./20-tool-components.md) 中配置全局路径；连接级 `tool_paths` 可覆盖。
