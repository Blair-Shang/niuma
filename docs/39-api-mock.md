# 39 — API 本地 HTTP Mock（预留与 P2 契约）

> 版本：v0.1 · 日期：2026-09-17  
> 状态：**契约 + P2 计划**（P1 仅 schema 空槽；实现随 OpenAPI 导入后启动）  
> 关联：[37 — API 调试工作台](./37-api-workbench.md) · [36 — L1 api-service](./36-api-module.md)

---

## 1. 定位

NiuMa **保留本机 HTTP Mock Server**，对齐 Postman Mock Server 与 Apifox 本地 Mock 的**调试用途**，但：

| 做 | 不做 |
|----|------|
| 本机 `127.0.0.1` / `0.0.0.0` 监听 | Apifox **云端 Mock** / 公网 URL |
| 路由 + 固定响应（status / headers / body） | Mock 脚本 / 动态 JS |
| 从集合请求「保存为 Mock 路由」 | Schema 自动推断复杂规则（P3+） |
| OpenAPI 导入时生成示例路由（P2） | 在线文档 / Mock 分享链接 |
| 与 `{{baseUrl}}` 环境联动 | 团队共享 Mock 配置 |

Mock 是**桌面单机能力**：配置写入 `api.workspace`，随 JSON 导入导出迁移。

---

## 2. 与 Postman / Apifox 对照

| 能力 | Postman | Apifox | NiuMa |
|------|---------|--------|-------|
| 本地 Mock | Mock Server（需账号时可云） | 本地 + 云端 | **仅本地** P2 |
| 按 path/method 匹配 | 有 | 有 | 有 |
| 多示例响应 | 有 | 有 | P2：单响应；P3：多 example |
| 从请求保存 Mock | 有 | 有 | P2 |
| OpenAPI → Mock | 弱 | **强** | P2 随 OpenAPI 导入 |
| 延迟 / 随机 | 部分 | 有 | P3：`delayMs` 字段 |

---

## 3. 架构

```
SideNav Mock Tab / 请求右键「保存为 Mock」
  → useApiTesterStore.startMock / stopMock
    → platform.api.mock.*
      → api-service（tcp-server + HTTP 请求匹配 + 写回响应）
        → 127.0.0.1:port
```

| 层 | 职责 |
|----|------|
| Web | 路由 CRUD、启停 UI、日志（命中 / 未命中） |
| Platform | 转发 `api.mock.*`；可选在 Go 侧做路由表 |
| L1 api-service | `tcp-server` 监听；收 HTTP/1.1 请求 → 查表 → 发响应 |

**约束（与 37 一致）：**

- Mock 监听**不进**运维连接树；无 `connection_kind`。
- 不走 Vault；Mock 响应体在 workspace JSON。
- Web Send 仍走 L1；Mock 被调时用普通 HTTP 客户端打 `http://127.0.0.1:{port}/...`（明文 TCP 或 P3 原生 HTTP）。

---

## 4. 数据模型（workspace 内嵌）

```typescript
interface ApiMockRoute {
  id: string
  name: string
  method: ApiMethod          // GET POST ...；* 表示任意
  path: string               // 如 /api/users/:id 或前缀 /api/
  match: 'exact' | 'prefix' | 'param'   // P2：exact + prefix；P3：param
  status: number
  statusText?: string
  headers: ApiKvRow[]
  body: string
  bodyMode?: ApiBodyMode
  delayMs?: number           // P3
  /** 来源请求 id，便于从集合同步更新 */
  sourceRequestId?: string
}

interface ApiMockServer {
  id: string
  name: string
  enabled: boolean
  host: string               // 默认 127.0.0.1
  port: number               // 0 = 自动选可用端口
  routes: ApiMockRoute[]
  startedAt?: string         // 运行时快照，不持久化或持久化 lastPort
}

interface ApiWorkspaceState {
  // ... 37 §5.2
  mockServers?: ApiMockServer[]   // P1 默认 []；P2 启用编辑
}
```

**环境联动：** 环境 `baseUrl` 可设为 `http://127.0.0.1:{{mockPort}}` 或 Mock 启动后 toast 提示复制 URL。

---

## 5. Platform 方法（P2）

Web bridge = `platform.api.mock.*`。

| 方法 | 入参 | 返回 | 说明 |
|------|------|------|------|
| `platform.api.mock.start` | `{ serverId, host?, port?, routes }` | `{ serverId, listenAddr, sessionId }` | 启动监听 |
| `platform.api.mock.stop` | `{ serverId }` | `{ stopped: true }` | 停止 |
| `platform.api.mock.update` | `{ serverId, routes }` | `{ ok: true }` | 热更新路由（运行中） |
| `platform.api.mock.status` | `{ serverId? }` | `{ servers: [...] }` | 运行态 |
| `platform.api.mock.log` | `{ serverId, limit? }` | `{ hits: [...] }` | 最近命中（内存环形缓冲） |

L1 内部可复用 `session.open` `kind=tcp-server` + HTTP 解析器；**不**另开 mock 进程。

### 5.1 事件（可选 P2）

| type | 含义 |
|------|------|
| `api.mock.hit` | 命中路由：method、path、routeId、remoteAddr |
| `api.mock.miss` | 404 默认响应 |

---

## 6. Web UI（P2）

| 入口 | 行为 |
|------|------|
| 侧栏第四 Tab **Mock** | 服务器列表、启停、端口、路由表 |
| 请求右键 | 「保存为 Mock 路由」→ 写入默认 server |
| OpenAPI 导入 | 可选勾选「同时生成 Mock 路由」 |
| Mock 日志面板 | 最近请求 / 响应摘要 |

组件规划：

```
ApiMockPanel.vue          # 侧栏 Tab
ApiMockRouteEditor.vue    # 单条路由编辑
useApiMockPanel.ts        # 启停 + CRUD
utils/mock-match.ts       # 纯函数：匹配 path/method
```

---

## 7. 分阶段

| 阶段 | 交付 |
|------|------|
| **P1** | `mockServers: []` 写入 schema；文档 39；无 UI |
| **P2** | Mock Tab + start/stop + exact/prefix 路由 + 从请求保存 |
| **P2** | OpenAPI 导入 → 可选生成 Mock 路由（Apifox 优势） |
| **P3** | `delayMs`、path 参数、多 example、HTTPS mock（随 L1 TLS） |
| **P4** | Runner 打 Mock URL 做回归（与 38 联动） |

---

## 8. 默认行为

| 项 | 值 |
|----|-----|
| 默认 bind | `127.0.0.1`（仅本机）；高级用户可选 `0.0.0.0` |
| 未命中路由 | `404` + JSON `{ "error": "mock not found" }` |
| 最大路由数 | 512 / server |
| 最大 body | 1 MiB（与 L1 单帧一致） |
| 同时 Mock 服务 | 4 |

---

## 9. P1 检查清单（仅预留）

- [ ] `types.ts` 含 `ApiMockServer` · `ApiMockRoute`（可选类型）
- [ ] `parseWorkspace` 默认 `mockServers: []`
- [ ] 37 / 39 交叉链接
- [ ] 36 §8 列出 Mock

---

## 10. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-09-17 | 初稿：本地 HTTP Mock、schema、platform 契约、P2 计划 |
