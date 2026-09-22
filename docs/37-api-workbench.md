# 37 — API 调试工作台（Web 模块）

> 版本：v0.1.13 · 日期：2026-09-18  
> 状态：**P1 已落地**（明文 `http://`、集合 v3、环境/变量关系表、历史）；P2 导入 / Mock、P3 HTTPS / WS 未做  
> 关联：[36 — L1 api-service](./36-api-module.md) · [38 — 压测与 Runner 预留](./38-api-run.md) · [39 — 本地 HTTP Mock](./39-api-mock.md) · [database-schema §5.5](./database-schema.md)

---

## 1. 定位

NiuMa API 模块是**本地桌面 HTTP 调试台**，与 Shell Tab、AI 助手、运维会话共用同一工作区。

**范围：单机桌面。** 数据落在本机 SQLite（`api.workspace` / `nm_api_history`）；集合通过 JSON 文件导入导出在机器间迁移。**团队协作、云端 Workspace、多人实时同步不在当前产品范围**，也不作为 API 模块的预留项。

**产品公式：**

```
NiuMa API = Postman 的「集合 + 环境 + 发送 + 本地 Mock」
          + Apifox 的「OpenAPI 导入 / 变量体系 / 示例 Mock」
          + Packet Sender 的「TCP / UDP 原始套接字」
          + 桌面一体（不进运维连接树、不走 Vault）
```

**不做（含远期也不纳入 API 模块）：**

- Apifox 式「API 设计台 + 在线文档 + 自动化测试平台」整体产品
- Postman / Apifox 式 **Cloud Workspace、团队项目、成员权限、云端同步**
- Apifox **云端 Mock**（公网 Mock URL、团队共享 Mock）
- JS Pre-request / Tests 脚本沙箱（远期单独评估）

**保留：本机 HTTP Mock Server**（见 [39 — 本地 HTTP Mock](./39-api-mock.md)）：侧栏启停、路由表、从请求/OpenAPI 生成；仅 `127.0.0.1` / 本机端口。

**单机协作替代：** 导出 `niuma.api-collection` v2 JSON → Git / 网盘 / IM 传文件 → 对方导入。无账号体系、无合并冲突 UI。

---

## 2. 与 Postman / Apifox 对照

### 2.1 能力矩阵

| 能力 | Postman | Apifox | NiuMa 目标 | 阶段 |
|------|---------|--------|------------|------|
| 集合 / 文件夹 | 多级 | 多级 + 项目 | 多级（≤3 层） | **P1** |
| 环境切换 | 多环境 | 多环境 + 前置 URL | 请求栏下拉；右键按需打开环境面板 | **P1** |
| 变量 `{{var}}` | 全局 / 环境 / 集合 | 模块 / 环境 / 全局 | 全局 → 文件夹链 → 环境 | **P1** |
| Authorization | Bearer / Basic / OAuth2 / API Key | 同上 | Bearer / Basic / API Key | **P1** |
| Body 类型 | raw / form / urlencoded / GraphQL | 同上 + Schema 联动 | raw / json / text / urlencoded / form | **P1** |
| 发送 / 响应 | 原生 HTTP | 原生 HTTP | 明文 HTTP/1.1 经 L1 TCP | **已落地（http://）** |
| HTTPS / TLS | 有 | 有 | L1 原生 HTTP | **P3** |
| WebSocket | 有 | 有 | kind 已登记，工作台占位；L1 真连 **P3** | **P3** |
| 发送历史 | 有 | 有 | `nm_api_history` + 侧栏历史 | **已落地** |
| cURL 导入导出 | 有 | 有 | 导出已有；导入 **P2** | P2 |
| Postman 导入 | 有 | 有 | v2.1 适配器 | **P2** |
| OpenAPI 导入 | 有 | **强项** | OpenAPI 3 适配器 | **P2** |
| 历史 → 保存请求 | 有 | 有 | 未建（P2） | **P2** |
| Collection Runner | 有 | 自动化测试 | `platform.api.run.*` + UI | **P4** |
| Mock（本地 HTTP） | 有（可云） | **核心** | 本机 Mock Server | **P2**（见 [39](./39-api-mock.md)） |
| API 设计台 | 弱 | **核心** | 不做；仅从 OpenAPI 导入 | — |
| 在线文档 | 有 | **核心** | 不做 | — |
| JS 脚本 | Pre-request / Tests | 断言 + 脚本 | 不做（P1） | P5 评估 |
| 团队云同步 | Workspace | 团队项目 | **不做**（桌面单机） | — |
| TCP / UDP 调试 | 无 | 无 | **差异化**：同模块 raw socket | **已落地** |

### 2.2 吸收 Postman 的优势

| Postman 优势 | NiuMa 落点 |
|--------------|------------|
| Collections 心智模型 | `ApiFolder` + `ApiCollectionPanel` 侧栏树 |
| Environment 一键切换 | `envId` + `ApiEnvironmentPanel` |
| Authorization Tab | `ApiRequest.auth` → `http/http-auth.ts` → Header |
| Body 模式切换 | `ApiRequest.bodyMode` + `ApiBodyEditor` |
| 变量插值 | `http/request-resolve.ts` 统一链路 |
| Import / Export JSON | `niuma.api-collection` v2 |
| History | `nm_api_history` + `ApiHistoryPane` |
| cURL 分享 | `format.buildCurl` |
| 本地 Mock Server | `mockServers` + [39](./39-api-mock.md) P2 |

### 2.3 吸收 Apifox 的优势

| Apifox 优势 | NiuMa 落点 |
|-------------|------------|
| OpenAPI 一键生成请求 | P2，文件未建 |
| OpenAPI 生成 Mock 路由 | P2，文件未建 |
| Postman 迁移友好 | P2，文件未建 |
| 环境变量表格式管理 | `ApiEnvironment.vars` + 环境 Panel KV 表 |
| 文件夹级变量 | `ApiFolder.vars` |
| 请求结构清晰（Method / URL / Params / Headers / Body） | `http/HttpWorkspace` + Auth Tab |
| 导入质量优先 | 适配器独立包 + vitest 金样例 |

### 2.4 明确不抄的能力

| 来源 | 能力 | 原因 |
|------|------|------|
| Apifox | **云端 Mock** / Mock 公网 URL | 桌面单机；仅本机 HTTP Mock（[39](./39-api-mock.md)） |
| Apifox | 设计模式 / 在线文档 | scope 过大；OpenAPI 导入 + 本地 Mock 即可 |
| Postman / Apifox | Cloud Sync / 团队项目 | 桌面单机；用 JSON 导入导出代替 |
| 两者 | JS 脚本引擎 | 安全 / 维护成本高；P5 再评估 |
| 两者 | OAuth2 授权码完整流 | P2 仅静态 Token；OAuth 流程 P3+ |

---

## 3. 架构约束（不可违背）

```
SideNav ApiSideNav             → 同一栏：API 管理树 + 可展开历史；环境配置开 Shell Tab
Pinia useApiTesterStore        → CRUD、发送、持久化
nm_app_setting.api.workspace   → 集合结构 + envId + runProfiles + mockServers（v3 JSON）
nm_api_environment             → 环境定义（baseUrl / 名称）
nm_api_variable                → 全局 / 环境 / 文件夹变量（typed rows）
nm_api_history                 → 发送历史（关系表，见 database-schema）
ApiHome + layout/pane-registry → HTTP / Socket 工作台分发
http/request-resolve + http/send · tcp/send → 拼包一次 + L1 执行
api-service (L1)               → TCP/UDP；HTTP/TLS 远期原生
```

| 约束 | 说明 |
|------|------|
| 集合 JSON + 变量关系表 | 集合树仍单文档；**环境/变量**走 `nm_api_environment` / `nm_api_variable`，不对齐 Postman JSON 块 |
| 发送走 L1 | UI / Runner 共用 `resolveRequest` + `executeRequest` / `sendResolved`。`buildHttpRequest` 只收已解析结果，禁止再插值 |
| 持久化防抖 | 结构立即落盘；当前请求字段 `useApiRequestPersist` 700ms；变量按 scope 500ms。禁止对整棵 `folders` 深 watch |
| 运行时与配置分离 | `exchanges` / `socketLogs` / `sending` 不写入 workspace |
| AI 上下文 | 仅 `@tab` nm-ref 注入当前请求摘要；**不**预灌整库 workspace |
| AI 不发 HTTP | 无 `host/*` 代发工具；Runner / 扩展 MCP 走登记入口 |
| 不进运维连接树 | API 套接字按请求打开，无 `connection_kind` |
| secret 变量 | `variable_kind=secret` 存关系表；不进 `nm_credential_ref`（后续可挂 credential_id） |
| 历史独立表 | 发送快照仅 `nm_api_history`；导入导出集合不含历史 |
| Web 不绕过 L1 | 桌面 Send 走 `api.session.*`；不用 Renderer `fetch` 偷跑 |
| 侧栏薄壳 | `ApiSideNav` 管 API 管理树 + 历史；环境配置走 `workbench.view.api-environments` 单例 Tab |
| 侧栏对齐运维 | 集合树常驻；历史同栏展开。RsTree：`virtual` / `show-line` / 拖拽 / 受控展开 |
| 新协议只改 registry | `layout/pane-catalog` + `{kind}/register.ts` + `layout/register-builtin-panes`；对齐运维 ensureConnKind。不改 `ApiHome` |

---

## 4. 目录与职责

```
web/src/modules/api-tester/
├── layout/                       # 只留壳：侧栏 / 环境 / 历史 + 协议登记（对齐 ops）
│   ├── register-builtin-panes.ts
│   ├── pane-kind-loaders.ts
│   ├── pane-catalog.ts
│   ├── pane-registry.ts
│   ├── ApiSideNav.vue            # API 管理 / 环境配置（开 Tab）/ 历史记录
│   ├── ApiEnvironmentView.vue    # 环境配置 Shell Tab（左列表 + 右详情）
│   ├── ApiEnvironmentPanel.vue   # 环境 / 全局变量详情
│   ├── ApiCollectionPanel.vue
│   └── useApiCollectionPanel.ts / useApiSideNav.ts
├── http/                         # HTTP 工作台 + 私有 utils（对齐 mysql 自包含）
│   ├── register.ts + defaults.ts + send.ts
│   ├── HttpWorkspace.vue + RequestBar/Editor/Auth/Body/Response
│   └── request-resolve.ts / http-wire.ts / http-auth.ts
├── tcp/                          # TCP 工作台 + 套接字私有 utils
│   ├── register.ts + defaults.ts + send.ts
│   ├── Client/Server Workspace + Compose/Stream
│   └── useApiSocketSession.ts / socket-payload.ts
├── udp/                          # register + defaults；工作台复用 tcp/ 收发壳
├── websocket/                    # register + 占位工作台（P3）
├── composables/
│   └── useApiRequestPersist.ts   # HTTP / 套接字工作台共用标脏
├── stores/api-tester.ts
├── utils/                        # 跨协议公用：集合 / 落盘 / 地址 / socket-hub / 展示
├── run-registry.ts
└── types.ts
```

P2 未建（不要占空文件）：`import-openapi.ts`、`import-postman.ts`、`ApiMockPanel.vue`。WebSocket 已占 kind / loader，不进 HTTP 方法栏；真连 P3。

---

## 5. 数据模型 v3

### 5.1 存储分层

| 数据 | 存储 | 说明 |
|------|------|------|
| 文件夹 / 请求 / auth / body | `api.workspace` v3 JSON | 保留 id，重启 Tab 可还原 |
| 当前 envId / runProfiles / mockServers | 同上 | `envId` 指向关系表 |
| 环境名称 / baseUrl | `nm_api_environment` | Platform `platform.api.environment.*` |
| globals / env / folder 变量 | `nm_api_variable` | scope + `variable_kind`；Platform `platform.api.variable.*` |
| 发送历史 | `nm_api_history` | 与集合导入导出无关 |

### 5.2 信封

| kind | version | 存储位置 | 用途 |
|------|---------|----------|------|
| `niuma.api-workspace` | **3** | `nm_app_setting.api.workspace` | 本机工作区（**不含** environments/globals） |
| `niuma.api-collection` | **2** | 导入导出文件 | 分享 / 备份（仍含 folder.vars） |

### 5.3 核心类型

```typescript
interface ApiVariableBag {
  vars: Record<string, string>                 // 插值仍用字符串
  kinds?: Record<string, ApiVariableKind>      // 与 vars 同 key，写入 nm_api_variable.variable_kind
}

type ApiVariableKind =
  | 'string' | 'secret' | 'number' | 'boolean' | 'json'
  | 'uuid' | 'counter' | 'datetime' | 'file_ref'

interface ApiEnvironment extends ApiVariableBag {
  id: string
  name: string
  baseUrl: string
}

interface ApiFolder extends ApiVariableBag {
  id: string
  name: string
  parentId: string | null   // null = 根；链深 ≤ 3
  requests: ApiRequest[]
}

// 插值只用 vars 字符串；kind 随 catalog replaceScope 落盘，供后端按类型处理

interface ApiWorkspaceState {
  kind: 'niuma.api-workspace'
  version: 3
  folders: ApiFolder[]          // 持久化时 vars 为空；内存态由 catalog 填充
  envId: string
  runProfiles?: ApiRunProfile[]
  mockServers?: ApiMockServer[]
}
```

### 5.4 变量插值优先级

从低到高覆盖：

```
globals  →  folder 链（根到叶）  →  environment.vars + baseUrl
```

语法：`{{tokenName}}`，名称 `[a-zA-Z0-9_]+`。  
`environment.baseUrl` 存 `nm_api_environment.base_url`；解析时注入变量 Map。

### 5.5 版本策略

- **工作区只读写 v3**：`parseWorkspace` 要求 `version === 3`；JSON 不含 environments / globals。
- **v2 一次性迁移**：启动时 `parseLegacyWorkspaceV2` → 导入 `nm_api_*` → 回写 v3 workspace。
- **v1 不兼容**：解析失败走空种子。
- **集合文件仍 v2**：`niuma.api-collection` 导出含 folder.vars；导入后 vars 写入 `nm_api_variable`。
- **历史记录**：`nm_api_history.request_json` 仍宽松还原，与工作区 schema 无关。

---

## 6. 发送管线

### 6.1 分层

```
resolveRequest(req, env, scope)     → ResolvedRequest（URL / headers / body 一次算完）
parseTarget(resolved.url)           → host / path
buildHttpRequest(method, path, …, resolved)  → HTTP/1.1 字节（不再插值）
executeRequest / sendResolved       → ApiExchange
```

UI 与 Runner **必须**共用这一条。禁止再包一层 `interpolateEnv`；组件内不准拼 Header。curl 与历史 URL 读 `resolveRequest().url`。

### 6.2 发送选项（压测预留）

```typescript
interface ApiSendOptions {
  mode?: 'interactive' | 'batch'
  envId?: string
  signal?: AbortSignal
  skipHistory?: boolean
  meta?: { runId?: string; iteration?: number; workerId?: number }
}
```

| mode | 行为 |
|------|------|
| `interactive` | 默认；写 Tab `exchanges`；append history |
| `batch` | P1 与 interactive 相同；P4 Runner 不写 Tab、可 skipHistory |

Store 暴露：

- `send(requestId, opts?)` — UI 入口
- `sendResolved(req, opts?)` — Runner / vitest 批量入口（不绑 Tab）

---

## 7. 分阶段路线图

### P1 — 专业基线（第一步，~2 周）

**目标：** 对齐 Postman 第一天体验。

| 交付 | 验收 |
|------|------|
| Schema v3 工作区 + v2 集合文件 | 打开/导入；v2 workspace 一次性迁 catalog；v1 回退空种子 |
| 环境 Panel + 变量 | 切环境后 `{{token}}` 生效 |
| Auth Bearer / Basic / API Key | Authorization 自动写 Header |
| Body urlencoded / form（文本字段） | POST 编码正确 |
| 嵌套文件夹（≤3 层） | 子文件夹 CRUD + 树展示 |
| `sendResolved` + `runProfiles: []` | vitest 可批量调用 |
| 文档 37 / 38 | 本稿 + 压测契约 |

**不做：** HTTPS、OpenAPI 导入、Runner UI、Mock UI（P1 仅 `mockServers: []` 预留）。

### P2 — 互操作 + 本地 Mock（~2 周）

| 交付 | 来源优势 |
|------|----------|
| OpenAPI 3 导入 | Apifox |
| OpenAPI → Mock 路由（可选） | Apifox |
| **本机 HTTP Mock 启停** | Postman + Apifox（见 [39](./39-api-mock.md)） |
| 请求「保存为 Mock 路由」 | Postman |
| Postman Collection v2.1 导入 | Postman + Apifox |
| cURL 导入单请求 | Postman |
| 历史 → 保存到集合 | Postman |
| 完善 `buildCurl`（auth + bodyMode） | 已随 `resolveRequest` 落地 |

### P3 — L1 传输（依赖 api-service）

| 交付 | 说明 |
|------|------|
| 原生 HTTP / HTTPS | 替换 TCP 拼包路径 |
| TLS 证书选项 | L1 配置 |
| Chunked 响应 | `parseHttpResponse` 或 L1 解析 |
| WebSocket | `websocket/` kind + 占位工作台；L1 真连 |
| Cookie Jar | workspace JSON |

详见 [36 §8](./36-api-module.md)。

### P4 — Runner / 压测 UI

见 [38 — 压测与 Runner](./38-api-run.md)。

### P5 — 可选增强

| 能力 | 说明 |
|------|------|
| GraphQL body 模式 | 低优 |
| 硬断言（status / time） | 无 JS 沙箱 |
| OAuth2 授权码 | 需浏览器 / 回调 |
| JS 脚本 | 单独安全评审 |

---

## 8. P1 已落地（对照）

| 项 | 现状 |
|----|------|
| workspace v3 / collection v2 | `collection-io.ts`；导入 remint 并重写 `parentId`，环掰回根 |
| 环境 + 全局变量 | `nm_api_*` + `useApiEnvironmentPanel` |
| Auth / Body / Params | `http/request-resolve` 一次算出；`http/http-wire` 只组字节 |
| 嵌套文件夹 ≤3 | `folder-tree.ts` |
| 发送 | `send` / `sendResolved`；明文 HTTP 经 L1 TCP |
| curl | `format.buildCurl` ← `resolveRequest` |
| Runner / Mock / OpenAPI / WS | 未做；不要预占空文件 |

人工冒烟仍有效：`{{baseUrl}}` + Bearer、urlencoded POST、子文件夹变量、导出再导入、`sendResolved` batch。

---

## 9. 性能与 AI 扩展边界

### 9.1 性能约定（桌面单机）

| 点 | 策略 |
|----|------|
| workspace 持久化 | 结构立即 `persistStructureNow`；当前请求字段由 `useApiRequestPersist` 标脏 **700ms**。禁止对整棵 `folders` 深 watch |
| 运行时状态 | `exchanges` / `sockets` / `socketLogs` / `sending` **不**触发持久化；套接字日志封顶 400 帧 |
| 集合树 | 对齐运维：`virtual` + `show-line` + 拖拽 + 受控展开；节点/拖放在 `collection-tree.ts`。环境 / 历史对话框按需挂载 |
| 环境变量 Panel | KV 行 **稳定 id** + 400ms 写回 `replace*Vars`，只 queue 变化的 scope |
| 发送 | `resolveRequest` 一套；大批量走 `sendResolved` + `skipHistory` |
| 规模预期 | 单用户数百请求、数千 history；超出再考虑分片 workspace 或懒加载树 |

### 9.2 AI 助手边界

| 场景 | 行为 | 后续扩展 |
|------|------|----------|
| 引用 API Tab | `@tab` / nm-ref 注入 **当前 Tab** 的 method、URL、名称 | 可增 last exchange 摘要，仍不含 env 密码 |
| 读整库集合 | **不做**默认 Context Pack | 用户导出 JSON 或 @ 单条请求 |
| 代发 HTTP | **无** platform `host/*` 工具 | P4+ 若做：仅 **扩展 MCP** 调 `sendResolved`，须 Policy 确认 |
| 改变量/改请求 | **无** host 写 workspace | 用户在工作台改；AI 给 curl/步骤说明 |
| Runner / 压测 | `sendResolved` + `run-plan.ts` 纯函数 | AI 批量测走 MCP 登记，不塞进 L1 |
| 运维 Redis / MySQL | 独立模块 | API 模块不替代 |

**原则：** API 模块对 AI 是 **可读摘要 + 人工 Send**；可执行自动化只通过已登记的 **扩展 MCP** 或 Runner，不新增 platform 官方 host 工具，避免与 L1 发送链、凭据 Policy 漂移。

---

## 10. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-09-17 | 初稿：Postman/Apifox 对照、P1 基线、schema v2、实施计划 |
| v0.1.1 | 2026-09-17 | 明确桌面单机范围；团队协作 / 云同步标为不做 |
| v0.1.3 | 2026-09-17 | P1 实施；性能防抖与 AI 扩展边界 §9 |
| v0.1.4 | 2026-09-18 | 对照实现：去掉未建文件与过期 Sprint；发送管线只 resolve 一次 |
| v0.1.5 | 2026-09-18 | 侧栏对齐运维连接树：树常驻，环境/历史按需，RsTree 拖拽与虚拟滚动 |
| v0.1.6 | 2026-09-18 | 工作台壳抽出 ApiWorkspaceLayout；HTTP/TCP/UDP 分模块懒加载 |
| v0.1.7 | 2026-09-18 | 去掉 ApiWorkspaceLayout；layout/http/tcp/udp/websocket + ops register/ensure 加载 |
| v0.1.8 | 2026-09-18 | 协议登记与面板 composable 收进 layout/；协议目录只留 register / 工作台 |
| v0.1.9 | 2026-09-18 | layout 只留壳；HTTP / TCP 实现与私有 utils 进各自目录（对齐 ops/mysql） |
| v0.1.10 | 2026-09-18 | ApiSideNav：接口管理 / 环境配置 / 历史记录；集合树 v-show 常驻 |
| v0.1.11 | 2026-09-18 | 环境配置改为 Shell 单例 Tab；侧栏「API 管理」+ 分区图标与颜色 |
| v0.1.12 | 2026-09-18 | 环境 Tab 对齐设置「模型接入」：左列表 + 右详情；浏览与设为当前分离 |
| v0.1.13 | 2026-09-18 | 环境变量表增加类型列；kind 写入 catalog，后端按 string/secret/number 等处理 |
