# 24 — AI 助手（Orchestrator · MCP · AiPanel）

> 版本：v0.2.0 · 日期：2026-07-18  
> 状态：**P1 已落地**；P2→P3 按 §15 合规切片推进（禁止违建捷径，见 §15.6）  
> 对标：Cursor Agent Loop / Context `@` · Claude MCP · OpenAI/Claude tool calling  
> 关联：[architecture.md](./architecture.md) · [11 — Platform Core](./11-platform-core.md) · [09 — App Shell](./09-web-app-shell.md) · [database-schema.md](./database-schema.md) · [21 — Session Registry](./21-session-registry.md) · [22 — Vastbase](./22-vastbase-module.md) · [20 — 工具组件](./20-tool-components.md)

---

## 1. 决策摘要

| 决策项 | 选择 |
|--------|------|
| 产品形态 | **Shell 级右栏** `AiPanel`（`Ctrl+I`）；**不**注册为 Activity Bar 领域模块 |
| 编排位置 | **platform 内置 AI 领域服务**（`platform/internal/ai`；handler 仅 IPC 入口） |
| 工具执行 | **仅外部 MCP Server**；禁止编译进 platform / L1 业务服务 |
| Skills | DB/配置驱动的**提示词模板 + 参数**；无执行逻辑 |
| 模型 / MCP / Tool / Skill 配置 | **一律存 SQLite 表**（`000004` 已建）；密钥走统一 `SecretStore`（见下） |
| 配置 UI 入口 | **全局设置侧边栏**（`SettingsView` 左导航）；**不**塞进 AiPanel 当主配置面 |
| 智能核心 | **Context Pack**（工作区上下文）+ **Agent Loop** + 可靠 Tool 结果回灌 |
| 写操作 | **Policy Gate**：只读默认可跑；写/危险操作需用户确认 |
| 重 Agent 进程 | 初期**不拆** L1 `ai-agent`；编排变重后再按需拆（见 §9） |
| 与「工具组件」关系 | `components/*`（mongosh / pg_dump）≠ MCP Tools；两套注册表、设置里分栏 |
| 密钥存储 | 复用现有 **VaultStore**：密文进 SQLite，**不是**每条密钥单独进 OS Keychain |

一句话：

> **Platform 负责「怎么聊、怎么调、怎么审」；MCP 负责「工具本身干什么」；Web 只渲染与注入上下文。**

**密钥存储（与连接密码同一套，勿写成「只走 Keychain」）：**

| 层级 | 存什么 |
|------|--------|
| 业务表（`nm_ai_provider` / `nm_mcp_server`） | 仅 `credential_id` 引用，**无明文、无密文列** |
| `nm_credential_ref` + VaultStore | API Key / MCP Token 的 **AES-256-GCM 密文**（与 SSH/DB 密码同路径） |
| OS Keychain | **仅一条主密钥** `NiuMa/master-vault`（用于加解密 vault） |

生产装配见 `platform-core`：`Secrets: store.NewVaultStore(db, keychain)`。与连接密码共用同一套凭据链路。

---

## 2. 现状与缺口

| 已有 | 仍待加强 |
|------|----------|
| Provider / MCP / Skill 设置；流式对话；会话落库 | 对话摘要压缩（后期）；桌面审计 `nm_audit_log`（暂不做） |
| Context Pack 结构化入模 + `@` / 选区 / 诊断 | SSH 终端选区 + 连接/SFTP/终端诊断已接；其他域可继续加深 |
| Agent Loop + Policy Gate + 工具卡片 | MCP 生态仍薄（目前以 Vastbase 只读为主） |
| 内置 `vastbase-readonly` MCP 种子 + 路径解析 | 需构建 `mcp-vastbase-readonly` 到 bin 后 refresh |
| 多模态 / 文本附件 / 外置 prompts / Skill paramSchema | `tool.progress` 未推；对话摘要压缩（后期） |

---

## 3. 分层与职责

```
┌─────────────────────────────────────────────────────────────────┐
│  Web · AiPanel + Context Pack + useAiStore                      │
│  · 对话 / 流式 / Tool 调用卡片 / Approve·Reject                   │
│  · @连接 / @SQL / @报错 / @Explain（对齐 Cursor @）               │
└────────────────────────────┬────────────────────────────────────┘
                             │ platform.ai.* + niuma:event
┌────────────────────────────▼────────────────────────────────────┐
│  Platform · Orchestrator（薄）                                   │
│  · Agent Loop · LLM Gateway · MCP Client · Skill 装配            │
│  · Policy Gate · 审计 · 会话落库 · Provider/MCP 配置 CRUD         │
└───────┬────────────────────┬────────────────────┬───────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
   LLM API            外部 MCP Servers      SQLite + Vault
   (OpenAI/Claude/…)  (DB 只读 / Ops …)     (配置·会话·加密凭据)
        │                    │
        │                    ▼
        │              L1 Capability Services
        │              (vastbase / mongo / ssh … 经既有会话边界)
        └────────────────────────────────────────────────────────
```

| 层 | 做 | 不做 |
|----|----|------|
| Web AiPanel | UX、上下文采集、确认交互、订阅流式事件 | 直连 LLM、持有 API Key、执行工具 |
| Orchestrator | 消息组装、调模型、路由 MCP、审批门闩、落库 | `case "query_sql"` 硬编码业务工具 |
| MCP Server | 具体工具实现（查库、诊断…） | 替代 platform 的权限/凭据裁决 |
| L1 服务 | 既有运维 API / session | 充当 LLM Tool 宿主或内置 Agent |
| C++ Shell | IPC 透传 + 事件推送 | 任何 AI 业务 |

### 3.1 两类「工具」勿混用

| 概念 | 用途 | 权威源 |
|------|------|--------|
| **工具组件** | 本机 CLI（mongosh、pg_dump…）路径探测与配置 | `platform.components.*` · [20](./20-tool-components.md) |
| **MCP Tools** | 给模型调用的能力 | `nm_mcp_server` / `nm_mcp_tool` · 本文 |

---

## 4. Agent Loop（对标 Cursor / Claude）

```
用户消息 + Context Pack
        │
        ▼
┌─ Assemble ─────────────────────────────────────────┐
│ System + Skill 模板 + Context Pack + 已启用 Tools   │
└───────────────────────────┬────────────────────────┘
                            ▼
┌─ Call Model（流式）────────────────────────────────┐
│ LLM Gateway → token 事件 → AiPanel                   │
│ 结束：纯文本完成 或 tool_calls                       │
└───────────────────────────┬────────────────────────┘
                            ▼
              ┌─────────────┴─────────────┐
              │ 无 tool_calls？            │
              └─────────────┬─────────────┘
                    是 │              │ 否
                       ▼              ▼
                   落库结束    ┌─ Policy Gate ──────────┐
                               │ 只读 → 直接 invoke      │
                               │ 写/危险 → 等用户确认    │
                               └───────────┬────────────┘
                                           ▼
                               MCP Client.invoke
                                           │
                                           ▼
                               工具结果写入消息历史
                                           │
                                           └──► 回到 Call Model
```

约束：

1. **工具轮次**：不设硬上限；由模型结束 tool_calls，或用户 `cancel` 中止。  
2. **取消**：`platform.ai.chat.cancel` 中止当前 run 与未确认的 pending tool。  
3. **幂等**：每个 `run_id` / `invocation_id` 唯一；确认只消费一次。

---

## 5. Context Pack（智能的关键）

对齐 Cursor 的 `@` 引用：模型质量优先依赖**上下文质量**，而非把编排写厚。

| 槽位 | 来源 | 说明 |
|------|------|------|
| `workspace` | 当前 Tab / `profileId` / `sessionId` | 限定工具作用域；与 [21](./21-session-registry.md) 对齐 |
| `selection` | 编辑器选中 SQL / 文档片段 | 解释、改写、优化 |
| `schema_hint` | 树焦点 / 最近打开对象 | 定向查库，避免盲扫 |
| `diagnostics` | 报错、Explain、慢查询摘要 | 诊断问答 |
| `attachments` | 用户显式 `@` 附加 | 可多选；有体积上限 |
| `skills` | 匹配的 Skill 模板 | 运维剧本 |
| `history` | 本会话近 N 轮 + tool 结果 | 多轮连贯；超窗截断/摘要（后期） |

约定：

- Context 由 **Web 组装草稿**，Orchestrator **校验、脱敏、截断**（禁止密钥、过大结果集原文）。  
- 默认不把整表 dump 塞进 prompt；大结果只传摘要 + 引用 `invocation_id`。

---

## 6. Bridge 契约（`platform.ai.*`）

命名与现有 `platform.settings.*` / `platform.components.*` 同构。  
契约源规划：`web/src/api/ai.ts` + `web/src/api/types/ai.ts`。

### 6.1 对话

| method | 入参（核心） | 结果 / 行为 |
|--------|--------------|-------------|
| `platform.ai.conversation.list` | `{ limit?, cursor? }` | 会话列表 |
| `platform.ai.conversation.get` | `{ conversationId }` | 会话 + 消息摘要 |
| `platform.ai.conversation.create` | `{ title?, providerId?, modelCode? }` | `{ conversationId }` |
| `platform.ai.conversation.delete` | `{ conversationId }` | 级联删 message / invocation |
| `platform.ai.chat.stream` | `{ conversationId, content, context?, skillCode?, modelCode? }` | 启动 run；正文走事件 |
| `platform.ai.chat.cancel` | `{ runId }` | 取消进行中的 run |

### 6.2 Provider / Model

| method | 行为 |
|--------|------|
| `platform.ai.provider.list/get/upsert/delete` | CRUD；`credential_id` → VaultStore（密文入库） |
| `platform.ai.model.list/upsert/delete` | 挂在 provider 下 |
| `platform.ai.provider.test` | 探测连通（OpenAI 兼容 `GET /models`，不落敏感响应） |
| `platform.ai.provider.listRemoteModels` | 从上游拉取可用模型 id 列表，供设置页选择 |
| `platform.ai.provider.getApiKey` | 编辑回填：解密读取 API Key（仅本地 IPC；列表仍只返回 `hasApiKey`） |

### 6.3 MCP / Skill

| method | 行为 |
|--------|------|
| `platform.ai.mcp.list/upsert/delete` | 注册外部 MCP Server |
| `platform.ai.mcp.refresh` | 发现工具 → 重建 `nm_mcp_tool` 缓存 |
| `platform.ai.mcp.setToolEnabled` | `{ toolId, enabled }` |
| `platform.ai.mcp.setToolRisk` | `{ toolId, riskLevel: read\|write\|dangerous }` |
| `platform.ai.skill.list/get/upsert/delete` | 模板 CRUD |

### 6.4 Policy

| method | 行为 |
|--------|------|
| `platform.ai.policy.confirm` | `{ invocationId, decision: approve\|reject }` |
| `platform.ai.policy.listPending` | 当前 run 待确认工具 |

### 6.5 事件（`niuma:event`）

复用现有 eventhub 批量帧。建议类型：

| type | payload 要点 |
|------|----------------|
| `platform.ai.token` | `{ runId, conversationId, delta }` |
| `platform.ai.message` | `{ runId, messageId, role, content? }` 完整消息落定 |
| `platform.ai.tool.start` | `{ runId, invocationId, toolName, argsSummary }` |
| `platform.ai.tool.progress` | 可选进度 |
| `platform.ai.tool.result` | `{ invocationId, ok, resultSummary }` |
| `platform.ai.tool.pending` | 需确认：`{ invocationId, risk, args }` |
| `platform.ai.run.status` | `{ runId, status: running\|done\|cancelled\|error, error? }` |

---

## 7. 数据模型

### 7.1 已落地（迁移 `000004`）

见 [database-schema.md §6.4](./database-schema.md)：`nm_ai_provider`、`nm_ai_model`、`nm_mcp_server`、`nm_mcp_tool`、`nm_ai_skill`。

### 7.2 已落地（迁移 `000005_ai_conversation`）

`nm_ai_conversation` / `nm_ai_message` / `nm_ai_tool_invocation` 已建（见 `scripts/sql/sqlite/000005_ai_conversation.up.sql`）。  
P3 起 Orchestrator 写入 invocation 流水；级联删除见 database-schema §7。

---

## 8. 前端落位

| 路径 | 职责 |
|------|------|
| `web/src/shell/panels/AiPanel.vue` | **使用面**：会话、流式、Tool 卡片、确认条；仅快捷选模型 / 链到设置 |
| `web/src/stores/ai.ts`（`useAiStore`） | 会话状态、流式缓冲、pending 确认、与 shell 面板开关协作 |
| `web/src/api/ai.ts` + `types/ai.ts` | Bridge 封装 |
| `web/src/shell/panels/ai/context-pack.ts` | 从 Tab / 编辑器 / 树采集 Context Pack 草稿 |
| `web/src/shell/views/SettingsView.vue` | **配置面**：左导航增加 AI 相关分区（见 §8.1） |
| `web/src/shell/views/ai-settings/` | 模型接入 / MCP / Skills 面板组件（对齐 `components-settings/`） |

**禁止**：把 AI 加进 `builtinModules` / Activity Bar；禁止把 Provider/MCP/Skill 的完整 CRUD 主界面做在 AiPanel 里。

### 8.1 全局设置侧边栏（推荐 UX）

与现有「外观 / 插件 / 工具组件 / 运行时」同一模式：左导航 + 右内容。AI 配置作为**独立分区**挂入，数据读写全部走 `platform.ai.*` → 表。

```
SettingsView 左导航（规划）
├── 外观
├── 插件
├── 工具组件          ← CLI（mongosh / pg_dump…）· 见 [20]
├── ── AI ──          ← 视觉分隔或分组标题（可选）
├── 模型接入          ← nm_ai_provider + nm_ai_model
├── MCP 服务          ← nm_mcp_server + 发现后的 nm_mcp_tool 开关
├── AI Skills         ← nm_ai_skill
└── 运行时
```

| 设置分区 `id` | 表 | 页面能力 |
|---------------|-----|----------|
| `ai-providers` | `nm_ai_provider` / `nm_ai_model` | 增删改 Provider；base_url、默认模型；API Key 经 Vault 加密存储；连通测试 |
| `ai-mcp` | `nm_mcp_server` / `nm_mcp_tool` | 注册 Server（stdio / sse / http）；刷新发现；按工具启用/禁用 |
| `ai-skills` | `nm_ai_skill` | 模板编辑、scope、参数 schema、启用状态 |

**为何放设置侧边栏而不是 AiPanel：**

1. 与 VS Code / Cursor「Settings vs Chat」一致：聊天是使用，接入是配置。  
2. MCP / Skill 表单字段多（命令路径、env、schema），不适合挤在右栏。  
3. 和「工具组件」并列但分栏，避免 CLI 与 MCP 概念混淆。  
4. 配置低频、对话高频；入口分离后 AiPanel 保持轻。

**AiPanel 内仅保留轻量入口：**

- 下拉切换「当前会话模型」（读已配置的 provider/model，不负责 CRUD）  
- 「打开模型设置 / MCP 设置」→ `openSettings({ section: 'ai-providers' | 'ai-mcp' })`（实现时扩展 `tabStore.openSettings` 支持初始分区）

贡献点（可选 P2+）：

- 命令：`workbench.ai.toggle`（已有）、`workbench.ai.askSelection`、`workbench.settings.aiProviders`  
- 编辑器右键：「询问 AI」→ 打开面板并填入 `selection`

---

## 9. 可选 L1 `ai-agent`

[architecture.md](./architecture.md) 曾规划 Python `ai-agent`（stdio JSON-RPC）。本设计约定：

| 阶段 | 策略 |
|------|------|
| P1–P4 | Orchestrator **内嵌** platform：直调 LLM HTTP API + MCP Client |
| P5+ | 若出现多 Agent、重 runtime、语言生态依赖 → 再拆 L1 进程；platform 仍保留配置/权限/审计裁决 |

拆分时 Web **不感知**进程边界，仍只调 `platform.ai.*`。

---

## 10. 实现规划（分阶段）

### 总览

| 阶段 | 目标 | 对标体验 | 预估产出 |
|------|------|----------|----------|
| **P0** | 文档与契约冻结 | — | 本文 + types 草案 |
| **P1** | 能聊起来 | ChatGPT 纯聊天 | Provider CRUD + 流式对话 + 会话落库 |
| **P2** | 有工作区感知 | Cursor `@file` | Context Pack + `@` UI |
| **P3** | 能调工具 | Claude MCP | MCP Client + 只读 DB MCP |
| **P4** | 安全可写 | Cursor Apply/Reject | Policy Gate + 写确认 UX |
| **P5** | 场景化 / 可演进 | Cursor Rules | Skills、审计增强；可选拆 ai-agent |

### P0 — 契约与脚手架（当前文档即交付物）

- [x] 本设计文档落地  
- [x] `web/src/api/types/ai.ts` / `api/ai.ts` 类型与 Bridge 封装  
- [x] `platform/internal/ai` 领域服务（会话 + OpenAI 兼容流式；handler 仅入口）  

### P1 — Provider + 流式对话

**后端**

- [x] 迁移 `000005_ai_conversation`（conversation / message / invocation）  
- [x] `platform.ai.provider.*` / `platform.ai.model.*` + VaultStore（复用现有凭据链路）  
- [x] `platform.ai.conversation.*`  
- [x] `platform.ai.chat.stream` / `cancel`：OpenAI 兼容流式优先（覆盖多数中转）  
- [x] 推送 `platform.ai.token` / `platform.ai.run.status` / `platform.ai.message`  

**前端**

- [x] `api/ai.ts`（Provider/Model + Conversation/Chat）  
- [x] `useAiStore`  
- [x] AiPanel：消息列表、输入框、当前模型下拉（只读切换）、停止生成  
- [x] Settings 左导航 `ai-providers`：模型接入 CRUD（表驱动）  

**验收**：设置里配 Key → 开面板 → 多轮对话流式显示 → 刷新后历史仍在。

### P2 — Context Pack

- [x] `context-pack.ts`：Tab / profile / 选区候选项与 `@` UI（草稿）  
- [x] **结构化 `context` 入 `chat.stream`**（不再仅依赖 prompt 附录）  
- [x] Orchestrator：`NormalizeContext` 截断与脱敏（长度上限、剥离密钥样式字段）  
- [x] Assemble：system + context 摘要 + user 正文分轨（用户消息库表仍存可见正文）  
- [x] 诊断槽位浅接入（查询 lastError）+ schema_hint（Tab props）+ 编辑器「询问 AI」命令  

**验收**：选中一段 SQL → `@` 附加 → 回复明确引用该片段；刷新后用户消息不丢 chip；后端日志可见截断生效。

### P3 — MCP + 只读工具

- [x] MCP Client（stdio `tools/list`；invoke 待 Slice C）  
- [x] `platform.ai.mcp.*` + `refresh` 写入 `nm_mcp_tool`  
- [x] Settings 左导航 `ai-mcp`：Server 注册 + 工具启用开关  
- [x] 第一个外部 MCP：**Vastbase/PG 只读查库**（经 Platform Bridge 调 `vastbase.*`；凭据由 platform 注入）  
- [x] Agent Loop：`tool_calls` →（只读）invoke → 结果回灌 → 再调模型；无轮次上限（用户 cancel）  
- [x] 写入 `nm_ai_tool_invocation` + 推送 `platform.ai.tool.*`（面板卡片接线）  

**验收**：问「当前库有哪些表」→ 模型调 MCP → 面板展示工具结果 → 自然语言总结。  
**本阶段不做**：写操作 Policy（P4）、Skill 装配（P5）、拆 L1 ai-agent。  
**已知缺口**：SSE 传输（旧版）未做；HTTP MCP 以 Streamable HTTP（JSON / SSE 响应）为主。

#### Vastbase 只读 MCP 验收闭环（操作步骤）

1. **构建外部二进制**（不进 platform）：`pnpm build:services` 或单独  
   `go build -o services/bin/mcp-vastbase-readonly.exe ./services/mcp-vastbase-readonly`  
2. **重启 platform-core**（跑迁移 `000008`；启动日志可出现 `builtin vastbase MCP tools discovered`）  
3. **Settings → MCP**：应有 `vastbase-readonly`；若工具数为 0，点「内置 Vastbase」或「刷新工具」  
4. **打开 Vastbase 已连接会话**（保证 Context Pack 带 `profileId`/`sessionId`）  
5. **AiPanel** 提问：「当前库 public schema 有哪些表？」  
6. **期望**：工具卡片出现 `list_tables`（或 `run_readonly_sql`）→ 结果回灌 → 自然语言总结  

路径查找：`NIUMA_SERVICES_BIN` → `services/bin` / `services/bin/<os-arch>` → platform-core 旁 → PATH。

---

## 15. P2→P3 合规落地设计（v0.2）

> 目标：在不违背 §1 / §3 / §11 / §12 与 `external-tools-mcp-skills` 规则的前提下，把「能聊」推进到「有工作区感知 + 能调只读工具」。

### 15.1 切片顺序（可并行的边界）

```
Slice A（P2 最小闭环）          Slice B（P3 配置面）
  context 结构化 + Normalize       mcp CRUD + refresh + Settings
           \                     /
            \                   /
             v                 v
            Slice C（P3 Agent Loop + 只读 MCP）
              tools 暴露 → tool_calls → invoke → 回灌
```

| Slice | 交付 | 依赖 | 明确不做 |
|-------|------|------|----------|
| **A** | `StreamParams.Context` → Normalize → Assemble | P1 | 诊断深度、Skill |
| **B** | MCP 表 CRUD / 发现缓存 / Settings `ai-mcp` | `000004` 表 | 真正 invoke |
| **C** | Client.invoke + Loop + 外部只读 MCP | A 的 workspace 作用域 + B | 写确认（P4） |

推荐实现顺序：**A → B → C**。C 启动前至少要有 `workspace.profileId`（可空则工具拒绝「需连接」）。

### 15.2 Context Pack 契约（Slice A）

**Web 草稿**（`buildContextPack`）与 Bridge 入参对齐；用户可见正文仍是 `content`（可含 `⟦nm-ref:…⟧` chip 标记）。  
**禁止**把大段 selection 只塞进 `content` 却不进 `context`——模型与截断必须以 `context` 为准。

```ts
// web/src/api/types/ai.ts — AiChatStreamParams.context 形状（冻结）
interface AiContextDraft {
  workspace?: {
    tabId?: string
    moduleId?: string
    profileId?: string
    sessionId?: string   // 有则优先；与 Session Registry 对齐
    title?: string
  }
  attachments?: Array<{
    id: string
    kind: 'tab' | 'selection' | 'connection' | 'diagnostic'
    label: string
    detail?: string
    payload?: Record<string, unknown>  // selection.text / profileId / …
  }>
}
```

**Orchestrator `NormalizeContext`（platform/internal/ai/context.go）**

| 规则 | 默认 |
|------|------|
| 单次 context 序列化上限 | 32 KiB（UTF-8） |
| 单条 selection 上限 | 8 KiB；超出截断并标注 `…[truncated]` |
| 脱敏 | 剥离 key 名匹配 `(?i)password|secret|api[_-]?key|token|authorization` 的字段；连接串中的 userinfo |
| 作用域 | 保留 `profileId`/`sessionId`/`moduleId` 供 Tool 绑定；不信任前端伪造的「已授权」断言——invoke 时再校验会话存在 |
| 方言硬规则 | 优先 `workspace.capabilities` / `dialectRules`（前端会话探测）；缺省时 `module=vastbase` 回退 `dialect_vastbase.txt` |
| 落库 | `nm_ai_message` 的 user 行存**可见 content**（含 ref 标记，不含完整 appendix 亦可）；规范化后的 context **不单独建表**（首版），仅进当轮 Assemble |

**Assemble 分轨**

1. `system` = 默认人设（可后续 + Skill）  
2. `system` 或独立 `user` 前缀消息：`[Context Pack]\n…`（Normalize 后的摘要，**不**回显到面板第二气泡）  
3. `user` = 用户正文（去掉仅用于渲染的标记亦可，由实现二选一，需与 regenerate 一致）

前端改造：`send` 时传 `context: pack`（去掉仅用于本地的 `promptAppendix` 拼装，或保留 appendix 作兼容但后端以 `context` 为准）。

### 15.3 MCP 配置面（Slice B）

| method | 行为 |
|--------|------|
| `platform.ai.mcp.list/get/upsert/delete` | CRUD `nm_mcp_server`；Token → Vault `credential_id` |
| `platform.ai.mcp.refresh` | 启 Client → `tools/list` → upsert `nm_mcp_tool` |
| `platform.ai.mcp.setToolEnabled` | 更新 `enabled` |

Settings：`SettingsSection` 增加 `ai-mcp`（与 `ai-providers` 并列；**不**与「工具组件」合并）。

传输首版：

1. **stdio**（本机 MCP 进程：`command_path` + `launch_options.args/env`）  
2. **streamable_http**（可选第二）  
3. SSE 可后置  

密钥：远程 Bearer 走 Vault；stdio 子进程 env 中的 token 同样经 Vault 注入，禁止明文进 `launch_options` 持久化。

### 15.4 Agent Loop（Slice C）

落点：`platform/internal/ai`（**不**拆 L1；handler 薄封装）。

```
StartStream
  → NormalizeContext + Assemble(messages, enabledTools)
  → loop（无轮次上限）:
       StreamOpenAICompatible(…, tools)
       if no tool_calls → 落库 assistant → done
       for each tool_call:
         resolve tool → server_id
         risk := tool.risk_level 默认 read（P3 全部当 read）
         if risk != read → pending 事件并暂停（P4；P3 可直接拒绝 write）
         publish tool.start
         MCP.Client.CallTool
         截断 result（建议 ≤16 KiB 摘要进模型）
         落库 role=tool + invocation 行
         publish tool.result
       continue loop
  → cancel 时：取消 HTTP + 终止未决 MCP 调用
```

**OpenAI 兼容**：请求带 `tools: [{type:function, function:{name,description,parameters}}]`；名称用 MCP `tool_name`（已满足 `^[a-zA-Z0-9_-]+$`）。多 Server 重名时：`{serverName}__{toolName}` 映射表，回调用时拆回。

**作用域注入（硬约束）**：CallTool 前把 `profileId`/`sessionId` 写入工具参数或 MCP `_meta`（实现二选一，文档化）；MCP Server **禁止**自带密码新建连接，只能拿 platform 侧已授权会话句柄（见首个 MCP 设计）。

### 15.5 首个外部 MCP：Vastbase 只读

| 项 | 约定 |
|----|------|
| 位置 | `services/mcp-vastbase-readonly/` 或独立扩展目录；**不**编进 platform / vastbase-service |
| 工具示例 | `list_schemas` / `list_tables` / `describe_table` / `run_readonly_sql`（仅 SELECT/WITH；拒绝 DDL/DML） |
| 鉴权 | 启动参数或 stdio 握手接收 `sessionId`；内部经既有 L1 `vastbase.*` 能力代理，与 UI 查库同边界 |
| 风险 | 全部 `read`；`run_readonly_sql` 再加语句白名单 |

禁止：在 `vastbase-service` 增加 `ai.*` 方法当 Tool；禁止 Orchestrator `case "list_tables"`。

### 15.6 红线清单（Code Review 必查）

| # | 禁止 | 正确 |
|---|------|------|
| 1 | L1 业务服务内嵌 LLM Tool | 外部 MCP |
| 2 | platform 硬编码 `query_sql` 业务 | MCP.invoke |
| 3 | Web 直连 LLM / 执行工具 | 只调 `platform.ai.*` |
| 4 | 跳过 Normalize 只信前端附录 | Orchestrator 校验截断 |
| 5 | MCP 自管 DB 密码 | session / Vault 既有链路 |
| 6 | P3 开放写库无确认 | 只读；写走 P4 |
| 7 | MCP CRUD 主 UI 塞进 AiPanel | Settings `ai-mcp` |
| 8 | 合并「工具组件」与 MCP 注册表 | 两套表、两套设置分区 |

### 15.7 源码落位（相对 §13 增量）

```
platform/internal/ai/
  context.go          # NormalizeContext / 脱敏截断
  assemble.go         # 消息 + tools 装配
  agent_loop.go       # tool_calls 循环
  mcp/
    client.go         # stdio / http 客户端
    registry.go       # 读 nm_mcp_* 、enabled 列表
platform/internal/handler/
  ai_mcp.go           # platform.ai.mcp.*
web/src/shell/views/ai-settings/
  AiMcpSettingsPanel.vue
services/mcp-vastbase-readonly/   # 外部进程（独立 go.mod）
```

### 15.8 验收矩阵

| ID | 场景 | 期望 |
|----|------|------|
| A1 | 带 `@` selection 提问 | 模型引用选区内容；超长被截断提示 |
| A2 | context 含伪 password 字段 | 入模前已剥离 |
| B1 | Settings 注册 stdio MCP → refresh | `nm_mcp_tool` 有行；可禁用 |
| C1 | 「当前库有哪些表」+ 已连接 profile | tool.start/result 事件 + 自然语言 |
| C2 | 无 profileId 问查库 | 工具失败信息友好，不盲连 |
| C3 | cancel 中途 | run cancelled；无孤儿 MCP 子进程（尽力） |

### P4 — Policy Gate

- [x] `risk_level` 分类与默认策略（read 自动 / write|dangerous 确认；迁移 `000006`）  
- [x] `platform.ai.policy.confirm` + `tool.pending` 事件  
- [x] AiPanel Approve / Reject UI  
- [ ] 审计：`nm_audit_log`（**桌面端暂不做**；invocation 表已记 risk/status）  

**验收**：把工具标为 write → 面板 `tool.pending` 等确认 → Reject 不执行。

### P5 — Skills 与演进

- [x] Settings 左导航 `ai-skills`：Skill CRUD UI + Composer 触发装配  
- [x] 内置若干运维 Skill（慢查询分析、Explain 解读、连接排查；`000007_ai_skill_seed`）  
- [x] 多模态最小闭环：粘贴/拖入截图 → `⟦nm-img:…⟧` 落库 → Vision content parts 入模（需模型支持视觉）  
- [x] 通用附件：`paperclip` 支持图片 + 文本（`⟦nm-txt:…⟧` 展开为 Attached file 入模）  
- [x] 入模提示词外置：`platform/internal/ai/prompts/*.txt`（`go:embed`）  
- [x] 内置 Vastbase 只读 MCP 种子（`000008`）+ 相对 bin 路径解析 + Settings 一键注册/发现  
- [x] Agent Loop 工具轮次不设硬上限；由用户 cancel 中止  
- [ ] 评估是否拆 L1 `ai-agent`  
- [ ] 可选：对话摘要压缩（后期）  

---

## 11. 安全与合规

1. **密钥**：API Key / MCP Token 走 **VaultStore**（AES-256-GCM 密文 + Keychain 主密钥）；业务表仅 `credential_id`，禁止明文列。  
2. **作用域**：Tool 调用必须绑定用户已授权的 `profileId`/`sessionId`；禁止 MCP 私自新建绕过凭据的连接。  
3. **默认只读优先**：首发 MCP 以 read 为主；写路径必须过 Policy Gate。  
4. **脱敏**：Context / 工具结果入模前去掉密码、连接串中的 secret。  
5. **审计**：至少记录 tool 名、风险级、approve/reject、session 引用（不含明文密钥）。  
6. **配额**：单次 prompt / 工具结果字节上限；防把百万行结果塞进上下文。

---

## 12. 非目标（本阶段明确不做）

- 不在 `vastbase-service` / `mongodb-service` 内嵌 `ai.*` 业务方法当 Tool  
- 不把 AI 注册为 `builtinModules`  
- Web 不直连公网 LLM  
- 不把 `components/*` CLI 管理与 MCP 注册表合并  
- 不做多 Agent 协作编排（P5 再评估）  
- 不做云端同步对话（本地 SQLite 优先）

---

## 13. 源码落位（实现时）

```
platform/
  internal/
    ai/                    # 会话、流式、Context Normalize、Agent Loop、MCP Client
    handler/               # Bridge 入口 platform.ai.*（薄适配）
    migrate/sqlite/
      000004_ai.up.sql
      000005_ai_conversation.up.sql

web/src/
  api/ai.ts
  api/types/ai.ts
  stores/ai.ts
  shell/panels/AiPanel.vue
  shell/panels/ai/         # context-pack、消息/工具卡片等
  shell/views/ai-settings/ # Provider /（规划）MCP / Skills

# 外部（独立模块，不进 platform 二进制）
services/mcp-vastbase-readonly/
```

`scripts/sql/sqlite/` 与 embed 副本保持同步（与现有迁移惯例一致）。

---

## 14. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-17 | 首版：决策、分层、契约、Context Pack、分阶段实现规划 |
| v0.1.1 | 2026-07-17 | 明确：配置一律表驱动；模型/MCP/Skill 挂全局设置侧边栏（§8.1） |
| v0.1.2 | 2026-07-17 | 密钥表述对齐实现：VaultStore 密文入库，OS Keychain 仅主密钥 |
| v0.1.3 | 2026-07-17 | 领域逻辑落 `internal/ai`，handler 仅作 Bridge 入口 |
| v0.2.0 | 2026-07-18 | 同步 P1 现状；新增 §15 P2→P3 合规落地设计（切片、契约、红线、验收） |
