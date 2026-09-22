# 38 — API 压测与 Collection Runner（预留契约）

> 版本：v0.1 · 日期：2026-09-17  
> 状态：**契约预留**（P1 只落 schema + `sendResolved`；Runner UI / L1 并发在 P4）  
> 关联：[37 — API 调试工作台](./37-api-workbench.md) · [36 — L1 api-service](./36-api-module.md)

---

## 1. 目标

为 NiuMa API 模块预留**批量执行 / 压测**扩展口，对齐 Postman Collection Runner 与 Apifox 自动化测试的**执行面**；不引入脚本沙箱或云端调度（本地 Mock 见 [39](./39-api-mock.md)）。

**P1 只做：**

- `ApiRunProfile` 写入 `api.workspace`（默认 `[]`）
- Store `sendResolved(req, opts)` 可被非 UI 调用
- `run-registry.ts` 注册 `single` 模式
- 本文档契约

**P4 再做：**

- Runner UI、进度面板、`platform.api.run.*`
- L1 并发 HTTP（依赖 [36 §8](./36-api-module.md) 原生 HTTP/TLS）

---

## 2. 与 Postman / Apifox 对照

| 能力 | Postman | Apifox | NiuMa |
|------|---------|--------|-------|
| Collection Runner | 顺序 / 迭代 | 测试场景 / 步骤 | P4：`runProfiles` |
| 并发用户数 | Newman CLI | 性能测试 | P4：`concurrency` |
| 断言 | JS Tests | 可视化断言 | P5：硬断言（无 JS） |
| 测试报告 | HTML / CLI | 团队报告 | P4：**本机** JSON / CSV 导出（无云端报告台） |
| CI 集成 | Newman | CLI / API | 可选：本机 CLI 调 `platform.api.run.*`；无云端调度 |
| Mock | 有 | 核心（含云端） | 本机 Mock 见 [39](./39-api-mock.md) | P2 |

---

## 3. 数据模型（workspace 内嵌）

```typescript
/** 运行目标范围 */
type ApiRunTargetKind = 'collection' | 'folder' | 'request'

interface ApiRunProfile {
  id: string
  name: string
  /** 指向 folders / requests 的 id 列表；kind 决定如何展开 */
  kind: ApiRunTargetKind
  targetIds: string[]
  /** 使用的环境；空则用 workspace.envId */
  envId?: string
  /** 并发协程数（P4 L1 生效；P1 忽略） */
  concurrency: number
  /** 每 worker 迭代次数 */
  iterations: number
  /**  ramp-up 毫秒（可选） */
  rampUpMs?: number
  /** 请求间隔（可选） */
  thinkTimeMs?: number
  /** P1 固定 false；P4 启用 */
  enabled: boolean
}

interface ApiRunReport {
  runId: string
  profileId: string
  startedAt: string
  finishedAt?: string
  status: 'pending' | 'running' | 'done' | 'cancelled' | 'failed'
  totals: {
    requests: number
    success: number
    failed: number
    avgDurationMs: number
    p95DurationMs?: number
  }
  items: ApiRunItemResult[]
}

interface ApiRunItemResult {
  requestId: string
  requestName: string
  iteration: number
  workerId: number
  exchange: ApiExchange
}
```

**存储：**

| 键 | 内容 |
|----|------|
| `api.workspace` | `runProfiles[]`（配置） |
| `api.run.reports.{runId}` | 可选；大报告放单独 setting 或 `nm_background_task` 产物路径 |

P1 不实现 report 持久化；类型仅作文档与 TS 定义。

---

## 4. Web 运行注册表

对齐 `pane-registry`，Runner 模式可插拔：

```typescript
// web/src/modules/api-tester/run-registry.ts

export type ApiRunMode = 'single' | 'collection' | 'load'

export interface ApiRunModeDef {
  mode: ApiRunMode
  labelKey: string
  /** P4：是否允许 concurrency > 1 */
  allowsConcurrency: boolean
  execute(ctx: ApiRunContext): Promise<ApiRunReport>
}

export interface ApiRunContext {
  profile: ApiRunProfile
  resolveRequest: (req: ApiRequest) => ApiRequest
  sendResolved: (req: ApiRequest, opts: ApiSendOptions) => Promise<ApiExchange>
  signal: AbortSignal
}
```

**P1 注册：**

| mode | 说明 |
|------|------|
| `single` | 等价于现有 Send；供 vitest 与 Runner 骨架共用 |

**P4 注册：**

| mode | 说明 |
|------|------|
| `collection` | 顺序执行 target 展开后的请求列表 |
| `load` | `concurrency` × `iterations`；需 L1 并发 |

---

## 5. 请求展开规则

```typescript
// utils/run-plan.ts（P1 纯函数 + 单测）

function materializeTargets(
  folders: ApiFolder[],
  profile: ApiRunProfile,
): ApiRequest[]

function validateRunProfile(profile: ApiRunProfile): string | null
```

| kind | 展开 |
|------|------|
| `request` | `targetIds` 直接查 `requestById` |
| `folder` | 该文件夹及子文件夹下所有请求（深度优先） |
| `collection` | 所有根文件夹下的全部请求 |

校验：

- `concurrency >= 1`，`iterations >= 1`
- `targetIds` 非空
- 文件夹链深 ≤ 3（与 37 一致）

---

## 6. Platform 方法（P4 实现）

命名空间：`platform.api.run.*`（Web bridge 方法名同 Platform handler）。

| 方法 | 入参 | 返回 | 说明 |
|------|------|------|------|
| `platform.api.run.start` | `{ profile, envId?, workspaceId? }` | `{ runId }` | 启动后台 Run |
| `platform.api.run.progress` | `{ runId }` | `ApiRunReport` 快照 | 轮询或 SSE |
| `platform.api.run.cancel` | `{ runId }` | `{ cancelled: true }` | 取消 |
| `platform.api.run.list` | `{ limit? }` | `{ runs }` | 最近 Run 列表 |

**执行位置（P4 决策）：**

```
方案 A（推荐）：Platform 编排 + Web sendResolved 回调（P1 已预留）
  → 并发仍在 Renderer 进程，适合 collection 顺序跑

方案 B：api-run-service 或 api-service 扩展
  → 真压测 / 高并发；L1 原生 HTTP 后启用
```

P1 文档锁定 **方案 A 接口形状**；B 作为 P4+ 性能路径，方法名不变。

---

## 7. 与 `nm_background_task` 的关系

长时间 Run 可登记后台任务（见 [database-schema §5.6](./database-schema.md)）：

| 字段 | 值 |
|------|-----|
| `task_kind` | `api.run` |
| `payload_json` | `{ runId, profileId }` |
| 产物 | `{LocalAppData}/runs/{runId}.json` |

Task Dock 展示进度；与 FFmpeg 任务共用壳，不新开模块页。

---

## 8. Exchange 扩展字段

```typescript
interface ApiExchange {
  // 现有字段 ...
  meta?: {
    runId?: string
    iteration?: number
    workerId?: number
  }
}
```

`mode: 'batch'` 时写入 `meta`；history append 可选携带 `runId` 过滤。

---

## 9. 安全与限额

| 项 | 值 |
|----|-----|
| 单 Run 最大请求数 | 10_000（可配置） |
| 最大 concurrency | 64（与 L1 会话上限对齐，见 36 §5） |
| 目标 host | 仅用户 workspace 内显式 URL；Runner **不**自动扫内网 |
| 凭据 | 仍来自环境变量；不进 Vault |

---

## 10. P1 / P4 检查清单

### P1（文档 + 类型 + 口子）

- [ ] `types.ts` 含 `ApiRunProfile` · `ApiSendOptions`
- [ ] `parseWorkspace` 默认 `runProfiles: []`
- [ ] `run-registry.ts` 导出 `single`
- [ ] `run-plan.ts` + vitest
- [ ] `sendResolved` 实现
- [ ] 本文档 + [37](./37-api-workbench.md) 交叉链接

### P4（Runner 产品化）

- [ ] `ApiRunPanel.vue` 或 SideNav 第四 Tab
- [ ] `platform.api.run.*` handler
- [ ] `collection` / `load` 模式注册
- [ ] L1 原生 HTTP + 可选方案 B
- [ ] 报告导出 JSON / CSV

---

## 11. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-09-17 | 初稿：RunProfile、run-registry、platform 契约、P1/P4 边界 |
| v0.1.1 | 2026-09-17 | 报告 / CI 限定本机；不含团队云端调度 |
| v0.1.2 | 2026-09-17 | Mock 改链 39（本机 HTTP Mock 保留） |
