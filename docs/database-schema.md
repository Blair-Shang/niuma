# NiuMa 本地数据库设计规范

> 版本：v1.1 · 更新：2026-07-17  
> 适用：**离线桌面客户端** · 数据存本机，无云端 SaaS 依赖  
> 参考实现：**SQLite 3**（唯一必选方言）  
> 可选扩展：PostgreSQL / MySQL（仅当用户连接「本地 Profile 同步库」或企业自建同步服务时）

---

## 1. 设计总则

### 1.1 与云端项目的差异

| 项 | 原云端规范 | NiuMa 本地规范 |
|----|------------|----------------|
| 部署 | PG/MySQL 集群 | **单机 SQLite 文件** |
| 租户 | 必备 `org_id` | **无多租户**；可选 `workspace_id` 做本地分组 |
| 删除 | 逻辑删 `is_deleted` | **仅物理删除** `DELETE` |
| 凭据 | 库内 hash | **明文不入库**；`nm_credential_ref.cipher_text` 存 AES-256-GCM 密文，OS Keychain **仅存主密钥** |
| ID 服务 | Redis / 分布式 Snowflake | **进程内 Snowflake** 或本地号段 |
| 向量 / 大文件 | pgvector / 对象存储 | 大文件走文件系统；向量后期独立文件或扩展表 |

### 1.2 强制约束

| # | 规范 | 说明 |
|---|------|------|
| 1 | **禁止裸字段 `id`** | 主键命名 `{entity}_id` |
| 2 | **禁止数据库自增** | 禁止 `AUTOINCREMENT` / `SERIAL` / `IDENTITY` 作为主键来源 |
| 3 | **主键应用层生成** | INSERT 前调用 **NmIdGenerator**；库表不设自增 DEFAULT |
| 4 | **字段语义明确** | 禁止裸 `name`/`status`/`type`；用 `profile_name`、`record_status` |
| 5 | **全英文 + 下划线** | 表名/字段名/索引名仅 `a-z`、数字、`_` |
| 6 | **禁止 SQL 关键字作列名** | 避开 `user`、`order`、`group`、`key`、裸 `role` |
| 7 | **禁止物理外键** | 不写 `REFERENCES`；逻辑关联 + 应用层校验 + 级联删除在代码中实现 |
| 8 | **表名 `nm_` 前缀** | 小写 + 下划线，≤ 30 字符 |
| 9 | **索引名 ≤ 30 字符** | `uk_` 唯一 / `idx_` 普通 |
| 10 | **仅物理删除** | **禁止** `is_deleted` / `deleted_at`；删除即 `DELETE`，关联数据在 Service 层级联 |

### 1.3 推荐约束

| # | 规范 | 说明 |
|----|------|------|
| 11 | **审计字段** | 主数据表：`created_at`、`updated_at`（本地时间存 UTC 文本或 INTEGER 毫秒） |
| 12 | **乐观锁** | 可编辑主数据加 `row_version INTEGER NOT NULL DEFAULT 0` |
| 13 | **字段注释** | SQLite 用 `--` 行注释；扩展方言用 `COMMENT ON` |
| 14 | **单表字段数** | ≤ 80，超出垂直拆分 |
| 15 | **大 payload** | 终端 scrollback、SQL 结果、视频文件 **不入库**；库只存元数据与路径 |

### 1.4 本地数据库文件

| 平台 | 默认路径 |
|------|----------|
| Windows | `%LOCALAPPDATA%\NiuMa\data\niuma.db` |
| macOS | `~/Library/Application Support/NiuMa/data/niuma.db` |
| Linux | `~/.local/share/NiuMa/data/niuma.db` |

- 单用户单库文件；WAL 模式开启：`PRAGMA journal_mode=WAL`
- 迁移版本表：`nm_schema_migration`（基础设施表，不计业务清单）
- 备份：用户可导出 `.db` 或平台提供「导出配置」JSON（**不含**凭据明文；密文导出亦无主密钥则不可用）

---

## 2. 主键与 ID 生成（NmIdGenerator）

### 2.1 原则

主键 **不由 SQLite 生成**，在 INSERT 前由 Platform Core 分配。

| 项 | 规范 |
|----|------|
| 类型 | `TEXT NOT NULL`（十进制字符串，Snowflake int64 转 string） |
| 命名 | `{entity}_id`，如 `profile_id`、`conversation_id` |
| 禁止 | 裸 `id`、依赖 `AUTOINCREMENT` |
| 逻辑外键 | 同名 `{entity}_id TEXT`，无 FK 约束 |

### 2.2 离线部署模式

| 模式 | 说明 |
|------|------|
| **嵌入 Snowflake**（推荐） | Platform Core 进程内生成，`worker_id` 固定为 0（单实例桌面） |
| **UUID v7**（备选） | 外部互通场景；内部 Join 仍推荐 Snowflake 字符串 |

```rust
// 伪代码 — platform-core
let profile_id = idgen.next_id_string()?;
repo.insert_profile(&Profile { profile_id, .. })?;
```

### 2.3 物理删除与 ID

- 删除行后 **ID 不回收**（Snowflake 一次性）
- 关联表在事务内 **先删子表、再删父表**，或由 Service 按 `profile_id` 等级联 `DELETE`

---

## 3. 标准字段模板

### 3.1 主数据表（审计 + 乐观锁，无逻辑删）

```sql
{entity}_id     TEXT NOT NULL PRIMARY KEY,  -- NmIdGenerator 生成
-- 业务字段 ...
row_version     INTEGER NOT NULL DEFAULT 0,
created_at      TEXT NOT NULL,              -- ISO8601 UTC，如 2026-07-03T03:00:00Z
updated_at      TEXT NOT NULL
```

可选：`creator_label TEXT`（本地用户名/设备名，非账号体系时可省略 `creator_id`）

### 3.2 流水 / 审计 / 日志表

```sql
{entity}_id     TEXT NOT NULL PRIMARY KEY,
-- 业务字段 ...
created_at      TEXT NOT NULL
```

审计日志 **只追加**；清理策略：按时间物理删除旧分区或 `DELETE WHERE created_at < ?`。

### 3.3 关联表

```sql
parent_id       TEXT NOT NULL,
child_id        TEXT NOT NULL,
-- 业务字段 ...
created_at      TEXT NOT NULL,
PRIMARY KEY (parent_id, child_id)
```

---

## 4. 索引规范

```
唯一索引：  uk_{表名核心}_{列名}     例：uk_nm_conn_profile_name
普通索引：  idx_{表名核心}_{列名}    例：idx_nm_audit_log_created
```

- **无** `WHERE is_deleted = ...` 过滤唯一索引（不做软删）
- 单表业务索引 ≤ 5（日志表除外）
- 禁止对低选择性标志位单独建索引

---

## 5. 业务域与表清单

前缀 **`nm_`**（NiuMa）。下表为 v1 规划，实现时可按阶段增减。

### 5.1 基础与配置

| 表名 | 说明 | 主键 |
|------|------|------|
| `nm_workspace` | **预留未用**：多工作区/分组占位；当前 Tab 工作区不读此表 | `workspace_id` |
| `nm_app_setting` | 全局 KV 配置（含 Tab：`workspace.tabs`） | `setting_key`（天然主键）或 `setting_id` |
| `nm_schema_migration` | 迁移版本（工具用） | `version` |

### 5.2 连接与凭据（运维核心）

| 表名 | 说明 | 主键 |
|------|------|------|
| `nm_connection_profile` | SSH / DB / FTP 连接配置（无密码明文） | `profile_id` |
| `nm_connection_organization` | 连接树文件夹组织层（每工作区一份 JSON） | `workspace_id` |
| `nm_credential_ref` | 凭据（标签/类型 + Vault 密文） | `credential_id` |
| `nm_profile_credential` | Profile 与凭据多对多 | `(profile_id, credential_id)` |
| `nm_recent_access` | 最近打开的连接/文件 | `recent_id` |
| `nm_sql_snippet` | 保存的 SQL 片段 | `snippet_id` |
| `nm_sql_history` | SQL 执行历史（元数据） | `history_id` |

### 5.3 插件

| 表名 | 说明 | 主键 |
|------|------|------|
| `nm_plugin_install` | 已安装插件 | `install_id` |
| `nm_plugin_config` | 插件配置 JSON | `(install_id, config_key)` |

### 5.4 AI

| 表名 | 说明 | 主键 | 迁移 |
|------|------|------|------|
| `nm_ai_provider` | LLM Provider（服务商/接入点）配置 | `provider_id` | 000004 |
| `nm_ai_model` | Provider 下的模型条目 | `model_id` | 000004 |
| `nm_mcp_server` | MCP Server 注册 | `server_id` | 000004 |
| `nm_mcp_tool` | MCP 工具发现缓存 + 启用开关 + `risk_level` | `tool_id` | 000004 / 000006 |
| `nm_ai_skill` | Skill 提示词模板 + 参数 schema | `skill_id` | 000004 |
| `nm_ai_conversation` | AI 对话 | `conversation_id` | 000005 |
| `nm_ai_message` | 对话消息 | `message_id` | 000005 |
| `nm_ai_tool_invocation` | Tool 调用流水 | `invocation_id` | 000005 |

> **架构约束**（见 `.cursor/rules/external-tools-mcp-skills.mdc`）：MCP / Tool / Skill 的**执行**一律在外部进程（外部 MCP Server），本域仅存**配置与发现缓存**，不把工具实现编译进 Platform Core。`nm_mcp_tool` 是从 MCP Server 拉取的工具清单缓存，可随时按 `server_id` 重建。完整 AI 助手设计与分阶段实现见 **[24 — AI 助手](./24-ai-assistant.md)**。
>
> **密钥不落明文**：Provider 的 API Key、MCP Server 的 Token 等只以 `credential_id` 逻辑关联 `nm_credential_ref`；密文由 **VaultStore**（AES-256-GCM）写入 `cipher_text`，OS Keychain 仅保留主密钥。业务表不存明文或密文。

### 5.5 API 测试

| 表名 | 说明 | 主键 |
|------|------|------|
| `nm_api_collection` | 接口集合 | `collection_id` |
| `nm_api_folder` | 集合内目录 | `folder_id` |
| `nm_api_request` | 请求定义 | `request_id` |
| `nm_api_environment` | 环境变量集 | `environment_id` |

### 5.6 任务与审计

| 表名 | 说明 | 主键 |
|------|------|------|
| `nm_background_task` | 后台任务（FFmpeg 等） | `task_id` |
| `nm_audit_log` | 本地操作审计 | `audit_id` |

---

## 6. DDL 示例（SQLite 参考实现）

### 6.1 nm_workspace

> **状态：预留未用。** 迁移会建表并插入 Default 行，但 Platform / Web **尚未**用其管理编辑区 Tab。  
> 当前 Tab 持久化在 `nm_app_setting.setting_key = 'workspace.tabs'`（见 [09-web-app-shell](./09-web-app-shell.md) §6）。

```sql
-- 本地工作区（预留：多工作区；与 workspace.tabs 无关）
CREATE TABLE nm_workspace (
    workspace_id    TEXT NOT NULL PRIMARY KEY,
    workspace_name  TEXT NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    row_version     INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX uk_nm_workspace_name ON nm_workspace (workspace_name);
```

### 6.2 nm_connection_profile

```sql
-- 连接配置：SSH / database / ftp；密码经 Vault 加密存 nm_credential_ref
CREATE TABLE nm_connection_profile (
    profile_id        TEXT NOT NULL PRIMARY KEY,
    workspace_id      TEXT NOT NULL,           -- 逻辑关联 nm_workspace.workspace_id
    profile_name      TEXT NOT NULL,
    connection_kind   TEXT NOT NULL,           -- ssh | mysql | postgres | oracle | ftp | sftp
    host_address      TEXT,
    port_number       INTEGER,
    login_account     TEXT,
    connection_options TEXT NOT NULL DEFAULT '{}',  -- JSON：密钥路径、DB 名、编码等
    record_status     TEXT NOT NULL DEFAULT 'active',  -- active | archived
    row_version       INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE INDEX idx_nm_conn_profile_ws ON nm_connection_profile (workspace_id);
CREATE UNIQUE INDEX uk_nm_conn_profile_name ON nm_connection_profile (workspace_id, profile_name);
```

### 6.3 nm_credential_ref

```sql
-- 凭据：明文永不落库；cipher_text 为 VaultStore AES-256-GCM 密文
-- OS Keychain 仅存主密钥 NiuMa/master-vault（见 platform/internal/store/vault.go）
CREATE TABLE nm_credential_ref (
    credential_id     TEXT NOT NULL PRIMARY KEY,
    credential_label  TEXT NOT NULL,
    credential_kind   TEXT NOT NULL,           -- password | private_key | api_key | db_password
    cipher_text       TEXT NOT NULL DEFAULT '', -- AES-256-GCM 密文
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX uk_nm_cred_ref_label ON nm_credential_ref (credential_label);
```

### 6.4 AI 配置：Provider / 模型 / MCP / Skill（迁移 000004）

```sql
-- LLM Provider（服务商/接入点）；API Key 走 credential_id
CREATE TABLE nm_ai_provider (
    provider_id         TEXT NOT NULL PRIMARY KEY,
    provider_name       TEXT NOT NULL,                  -- 展示名
    provider_kind       TEXT NOT NULL,                  -- openai | anthropic | azure_openai | ollama | custom
    base_url            TEXT,
    credential_id       TEXT,                           -- 逻辑关联 nm_credential_ref
    default_model_code  TEXT,
    provider_options    TEXT NOT NULL DEFAULT '{}',     -- JSON：api_version、organization、extra_headers
    record_status       TEXT NOT NULL DEFAULT 'active', -- active | disabled
    sort_order          INTEGER NOT NULL DEFAULT 0,
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE UNIQUE INDEX uk_nm_ai_provider_name ON nm_ai_provider (provider_name);
CREATE INDEX idx_nm_ai_provider_status ON nm_ai_provider (record_status, sort_order);

-- 模型（一个 Provider 下可注册多个）
CREATE TABLE nm_ai_model (
    model_id            TEXT NOT NULL PRIMARY KEY,
    provider_id         TEXT NOT NULL,                  -- 逻辑关联 nm_ai_provider
    model_code          TEXT NOT NULL,                  -- API 模型标识
    model_label         TEXT NOT NULL,
    context_window      INTEGER,
    max_output_tokens   INTEGER,
    model_options       TEXT NOT NULL DEFAULT '{}',     -- JSON：能力标记（vision/tools/reasoning）
    record_status       TEXT NOT NULL DEFAULT 'active',
    sort_order          INTEGER NOT NULL DEFAULT 0,
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX idx_nm_ai_model_provider ON nm_ai_model (provider_id, sort_order);
CREATE UNIQUE INDEX uk_nm_ai_model_prov_code ON nm_ai_model (provider_id, model_code);

-- MCP Server 注册（执行在外部进程）
CREATE TABLE nm_mcp_server (
    server_id           TEXT NOT NULL PRIMARY KEY,
    server_name         TEXT NOT NULL,
    transport_kind      TEXT NOT NULL,                  -- stdio | sse | streamable_http
    endpoint_url        TEXT,
    command_path        TEXT,
    launch_options      TEXT NOT NULL DEFAULT '{}',     -- JSON：args、env、headers、timeout
    credential_id       TEXT,                           -- 逻辑关联 nm_credential_ref
    record_status       TEXT NOT NULL DEFAULT 'active',
    sort_order          INTEGER NOT NULL DEFAULT 0,
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE UNIQUE INDEX uk_nm_mcp_server_name ON nm_mcp_server (server_name);
CREATE INDEX idx_nm_mcp_server_status ON nm_mcp_server (record_status, sort_order);

-- MCP 工具发现缓存 + 启用开关（非工具实现）
CREATE TABLE nm_mcp_tool (
    tool_id             TEXT NOT NULL PRIMARY KEY,
    server_id           TEXT NOT NULL,                  -- 逻辑关联 nm_mcp_server
    tool_name           TEXT NOT NULL,                  -- ^[a-zA-Z0-9_-]+$
    tool_title          TEXT,
    tool_description    TEXT,
    input_schema        TEXT NOT NULL DEFAULT '{}',     -- JSON Schema 缓存
    enabled             INTEGER NOT NULL DEFAULT 1,     -- 0/1
    risk_level          TEXT NOT NULL DEFAULT 'read',   -- read | write | dangerous（000006）
    discovered_at       TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX idx_nm_mcp_tool_server ON nm_mcp_tool (server_id);
CREATE UNIQUE INDEX uk_nm_mcp_tool_srv_name ON nm_mcp_tool (server_id, tool_name);

-- Skill 模板（提示词 + 参数；执行逻辑不入库）
CREATE TABLE nm_ai_skill (
    skill_id            TEXT NOT NULL PRIMARY KEY,
    skill_code          TEXT NOT NULL,                  -- 稳定标识
    skill_name          TEXT NOT NULL,
    skill_scope         TEXT,                           -- ops | writing | code ...
    prompt_template     TEXT NOT NULL,
    param_schema        TEXT NOT NULL DEFAULT '{}',     -- JSON Schema
    skill_options       TEXT NOT NULL DEFAULT '{}',     -- JSON：默认模型/温度等
    record_status       TEXT NOT NULL DEFAULT 'active',
    sort_order          INTEGER NOT NULL DEFAULT 0,
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE UNIQUE INDEX uk_nm_ai_skill_code ON nm_ai_skill (skill_code);
CREATE INDEX idx_nm_ai_skill_status ON nm_ai_skill (record_status, sort_order);
```

### 6.5 nm_ai_conversation / nm_ai_message

```sql
CREATE TABLE nm_ai_conversation (
    conversation_id     TEXT NOT NULL PRIMARY KEY,
    workspace_id        TEXT,
    conversation_title  TEXT,
    provider_id         TEXT,                  -- 逻辑关联 nm_ai_provider
    model_code          TEXT,
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX idx_nm_ai_conv_updated ON nm_ai_conversation (updated_at DESC);

CREATE TABLE nm_ai_message (
    message_id        TEXT NOT NULL PRIMARY KEY,
    conversation_id   TEXT NOT NULL,
    message_role        TEXT NOT NULL,           -- user | assistant | system | tool
    message_content     TEXT,
    token_count         INTEGER,
    created_at          TEXT NOT NULL
);

CREATE INDEX idx_nm_ai_msg_conv ON nm_ai_message (conversation_id, created_at);
```

### 6.6 nm_audit_log

```sql
CREATE TABLE nm_audit_log (
    audit_id          TEXT NOT NULL PRIMARY KEY,
    action_kind       TEXT NOT NULL,             -- ssh.exec | db.query | credential.use
    resource_type     TEXT,
    resource_id       TEXT,
    action_detail     TEXT NOT NULL DEFAULT '{}', -- JSON
    action_result     TEXT NOT NULL,             -- success | failure | denied
    client_ip         TEXT,                      -- 本地可为空
    created_at        TEXT NOT NULL
);

CREATE INDEX idx_nm_audit_log_created ON nm_audit_log (created_at DESC);
CREATE INDEX idx_nm_audit_log_kind ON nm_audit_log (action_kind, created_at DESC);
```

---

## 7. 物理删除与级联约定

应用层（Platform Core）在 `DELETE` 前负责：

| 父表 | 级联删除（示例） |
|------|------------------|
| `nm_workspace` | 删其下 `nm_connection_profile`、`nm_ai_conversation`（或禁止删，提示先迁移） |
| `nm_connection_profile` | 删 `nm_profile_credential`、`nm_recent_access` 引用 |
| `nm_ai_provider` | 删其下 `nm_ai_model`；清 `credential_id` 指向的凭据（密文行） |
| `nm_mcp_server` | 删其下 `nm_mcp_tool` 缓存；清 `credential_id` 指向的凭据（密文行） |
| `nm_ai_conversation` | 删 `nm_ai_message`、`nm_ai_tool_invocation` |
| `nm_api_collection` | 删 `nm_api_folder`、`nm_api_request` |
| `nm_credential_ref` | 删 `nm_profile_credential` 关联；密文随行删除（主密钥仍留在 Keychain）；**无软删恢复** |

```sql
-- ✅ 物理删除
DELETE FROM nm_ai_message WHERE conversation_id = ?;
DELETE FROM nm_ai_conversation WHERE conversation_id = ?;

-- ❌ 禁止（本项目不使用）
-- UPDATE nm_connection_profile SET is_deleted = 1 WHERE profile_id = ?;
```

---

## 8. 迁移目录与命名

```
scripts/sql/
  sqlite/                    # 必选，本地离线库（源脚本）
    000001_core.up.sql
    000001_core.down.sql
    ...
  postgres/                  # 可选
  mysql/                     # 可选
```

- 文件命名：`{6位版本}_{域}.up.sql` / `.down.sql`
- 一域一文件：core、connection、plugin、ai、api_test、audit
- `down` 与 `up` 对称
- **打包**：`scripts/platforms/windows/pack/bundle-windows.ps1` 复制到 `pack/win-x64/platform/migrations/sqlite/`

---

## 9. 多方言映射（SQLite 优先）

| 逻辑类型 | SQLite（标准） | PostgreSQL（可选） | MySQL 8.0+（可选） |
|----------|----------------|--------------------|--------------------|
| 主键/逻辑外键 | `TEXT` | `VARCHAR(20)` | `VARCHAR(20)` |
| 布尔语义 | `INTEGER` 0/1 | `SMALLINT` | `TINYINT` |
| 字符串 | `TEXT` + `-- VARCHAR(n)` 注释 | `VARCHAR(n)` | `VARCHAR(n)` |
| 时间 | `TEXT` ISO8601 UTC | `TIMESTAMPTZ` | `DATETIME(3)` |
| JSON | `TEXT` + JSON1 | `JSONB` | `JSON` |
| 金额 | `TEXT` 或 `INTEGER` 分 | `DECIMAL` | `DECIMAL` |

**开发默认只保证 SQLite**；PG/MySQL 脚本在后端 Service 需要时再同步维护。

---

## 10. 正例 / 反例

```sql
-- ✅ GOOD — 物理删、语义字段、nm_ 前缀、无自增
CREATE TABLE nm_connection_profile (
    profile_id       TEXT NOT NULL PRIMARY KEY,
    workspace_id     TEXT NOT NULL,
    profile_name     TEXT NOT NULL,
    connection_kind  TEXT NOT NULL,
    record_status    TEXT NOT NULL DEFAULT 'active',
    row_version      INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX uk_nm_conn_profile_name ON nm_connection_profile (workspace_id, profile_name);

-- ❌ BAD — 裸 id、自增、软删、物理外键
CREATE TABLE connection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    is_deleted INTEGER DEFAULT 0,
    workspace_id INTEGER REFERENCES nm_workspace(id)
);
```

---

## 11. 检查清单

1. 主键是否为 `{entity}_id` TEXT，且无 `AUTOINCREMENT`？
2. 是否 **无** `is_deleted` / `deleted_at`？
3. 删除路径是否为物理 `DELETE` + 应用层级联？
4. 密码/密钥是否经 Vault 加密（`cipher_text`），业务表仅 `credential_id`、无明文？
5. 业务状态是否为 TEXT 字符串枚举（如 `record_status`）？
6. 表名/索引是否符合 `nm_` / `uk_` / `idx_` 且 ≤ 30 字符？
7. 是否无 `REFERENCES` 物理外键？
8. SQLite 迁移是否在 `scripts/sql/sqlite/` 且含对称 `down`？

---

## 12. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-07-03 | 自云端规范适配：离线 SQLite、物理删除、nm_ 前缀、NiuMa 业务域 |
| v1.1 | 2026-07-17 | 凭据对齐实现：VaultStore 密文存 `cipher_text`，OS Keychain 仅主密钥 |
