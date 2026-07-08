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
- [04 — 插件体系](./04-plugin-system.md)
