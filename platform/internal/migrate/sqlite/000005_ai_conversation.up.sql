-- 000005_ai_conversation.up.sql
-- AI 对话会话、消息与 Tool 调用流水（配置表见 000004）

CREATE TABLE IF NOT EXISTS nm_ai_conversation (
    conversation_id     TEXT NOT NULL PRIMARY KEY,
    workspace_id        TEXT,
    conversation_title  TEXT,
    provider_id         TEXT,                       -- 逻辑关联 nm_ai_provider
    model_code          TEXT,
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nm_ai_conv_updated ON nm_ai_conversation (updated_at DESC);

CREATE TABLE IF NOT EXISTS nm_ai_message (
    message_id          TEXT NOT NULL PRIMARY KEY,
    conversation_id     TEXT NOT NULL,              -- 逻辑关联 nm_ai_conversation
    message_role        TEXT NOT NULL,              -- user | assistant | system | tool
    message_content     TEXT,
    tool_call_id        TEXT,                       -- 关联 tool 往返（可空）
    token_count         INTEGER,
    created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nm_ai_msg_conv ON nm_ai_message (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS nm_ai_tool_invocation (
    invocation_id       TEXT NOT NULL PRIMARY KEY,
    conversation_id     TEXT NOT NULL,
    run_id              TEXT NOT NULL,
    message_id          TEXT,
    server_id           TEXT,                       -- 逻辑关联 nm_mcp_server
    tool_name           TEXT NOT NULL,
    arguments_json      TEXT NOT NULL DEFAULT '{}',
    risk_level          TEXT NOT NULL DEFAULT 'read', -- read | write | dangerous
    invoke_status       TEXT NOT NULL,                -- pending | approved | rejected | running | done | error
    result_summary      TEXT,
    error_message       TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nm_ai_inv_conv ON nm_ai_tool_invocation (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_nm_ai_inv_run ON nm_ai_tool_invocation (run_id);
