-- 000004_ai.up.sql
-- AI 域：LLM Provider / 模型 / MCP Server / MCP 工具缓存 / Skill 模板
-- 约定：明文不入业务表；以 credential_id 关联 nm_credential_ref，密文由 VaultStore 写入 cipher_text
-- 约定：工具与 MCP 的“执行”在外部进程，本域仅存配置与发现缓存

-- LLM Provider（服务商/接入点）
CREATE TABLE IF NOT EXISTS nm_ai_provider (
    provider_id         TEXT NOT NULL PRIMARY KEY,
    provider_name       TEXT NOT NULL,                  -- 展示名，如 "OpenAI 官方"
    provider_kind       TEXT NOT NULL,                  -- openai | anthropic | azure_openai | ollama | custom
    base_url            TEXT,                           -- 接入地址；官方默认可空
    credential_id       TEXT,                           -- 逻辑关联 nm_credential_ref（Vault 密文）
    default_model_code  TEXT,                           -- 默认模型的 model_code
    provider_options    TEXT NOT NULL DEFAULT '{}',     -- JSON：api_version、organization、extra_headers 等
    record_status       TEXT NOT NULL DEFAULT 'active', -- active | disabled
    sort_order          INTEGER NOT NULL DEFAULT 0,
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_nm_ai_provider_name ON nm_ai_provider (provider_name);
CREATE INDEX IF NOT EXISTS idx_nm_ai_provider_status ON nm_ai_provider (record_status, sort_order);

-- 模型（一个 Provider 下可注册多个模型）
CREATE TABLE IF NOT EXISTS nm_ai_model (
    model_id            TEXT NOT NULL PRIMARY KEY,
    provider_id         TEXT NOT NULL,                  -- 逻辑关联 nm_ai_provider.provider_id
    model_code          TEXT NOT NULL,                  -- API 模型标识，如 gpt-4o、claude-sonnet
    model_label         TEXT NOT NULL,                  -- 展示名
    context_window      INTEGER,                        -- 上下文 token 上限（可空）
    max_output_tokens   INTEGER,                        -- 最大输出 token（可空）
    model_options       TEXT NOT NULL DEFAULT '{}',     -- JSON：vision、tools、reasoning、temperature 默认等能力标记
    record_status       TEXT NOT NULL DEFAULT 'active', -- active | disabled
    sort_order          INTEGER NOT NULL DEFAULT 0,
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nm_ai_model_provider ON nm_ai_model (provider_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uk_nm_ai_model_prov_code ON nm_ai_model (provider_id, model_code);

-- MCP Server 注册（工具能力来源；真正执行在外部进程）
CREATE TABLE IF NOT EXISTS nm_mcp_server (
    server_id           TEXT NOT NULL PRIMARY KEY,
    server_name         TEXT NOT NULL,                  -- 展示名
    transport_kind      TEXT NOT NULL,                  -- stdio | sse | streamable_http
    endpoint_url        TEXT,                           -- 远程传输的 URL；stdio 时可空
    command_path        TEXT,                           -- stdio 时的可执行文件路径；远程时可空
    launch_options      TEXT NOT NULL DEFAULT '{}',     -- JSON：args、env、headers、timeout 等
    credential_id       TEXT,                           -- 逻辑关联 nm_credential_ref（Bearer Token 等，可空）
    record_status       TEXT NOT NULL DEFAULT 'active', -- active | disabled
    sort_order          INTEGER NOT NULL DEFAULT 0,
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_nm_mcp_server_name ON nm_mcp_server (server_name);
CREATE INDEX IF NOT EXISTS idx_nm_mcp_server_status ON nm_mcp_server (record_status, sort_order);

-- MCP 工具发现缓存（从 MCP Server 拉取的 tool 列表 + 启用开关；非工具实现）
CREATE TABLE IF NOT EXISTS nm_mcp_tool (
    tool_id             TEXT NOT NULL PRIMARY KEY,
    server_id           TEXT NOT NULL,                  -- 逻辑关联 nm_mcp_server.server_id
    tool_name           TEXT NOT NULL,                  -- MCP 协议内的工具名（^[a-zA-Z0-9_-]+$）
    tool_title          TEXT,                           -- 展示标题
    tool_description    TEXT,                           -- 工具说明（缓存）
    input_schema        TEXT NOT NULL DEFAULT '{}',     -- JSON Schema（缓存）
    enabled             INTEGER NOT NULL DEFAULT 1,     -- 0/1：是否允许暴露给模型
    discovered_at       TEXT NOT NULL,                  -- 最近一次发现时间
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nm_mcp_tool_server ON nm_mcp_tool (server_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_nm_mcp_tool_srv_name ON nm_mcp_tool (server_id, tool_name);

-- Skill 模板（提示词模板 + 参数 schema；执行逻辑不入库、不编译进服务）
CREATE TABLE IF NOT EXISTS nm_ai_skill (
    skill_id            TEXT NOT NULL PRIMARY KEY,
    skill_code          TEXT NOT NULL,                  -- 稳定标识，如 summarize.zh
    skill_name          TEXT NOT NULL,                  -- 展示名
    skill_scope         TEXT,                           -- 可选分类，如 ops | writing | code
    prompt_template     TEXT NOT NULL,                  -- 提示词模板（可含占位符）
    param_schema        TEXT NOT NULL DEFAULT '{}',     -- JSON Schema：模板参数定义
    skill_options       TEXT NOT NULL DEFAULT '{}',     -- JSON：默认模型、温度、附加元数据
    record_status       TEXT NOT NULL DEFAULT 'active', -- active | disabled
    sort_order          INTEGER NOT NULL DEFAULT 0,
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_nm_ai_skill_code ON nm_ai_skill (skill_code);
CREATE INDEX IF NOT EXISTS idx_nm_ai_skill_status ON nm_ai_skill (record_status, sort_order);
