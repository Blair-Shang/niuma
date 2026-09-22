-- API 环境与变量：关系型存储，对齐 Postman 能力而非 Postman JSON 形态。
-- 集合树仍在 nm_app_setting（api.workspace v3）；工作区 JSON 只保留 envId 与结构槽位。

CREATE TABLE IF NOT EXISTS nm_api_environment (
    environment_id   TEXT NOT NULL PRIMARY KEY,
    workspace_id     TEXT NOT NULL,
    environment_name TEXT NOT NULL,
    base_url         TEXT NOT NULL DEFAULT '',
    row_version      INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_nm_api_env_name
    ON nm_api_environment (workspace_id, environment_name);

CREATE TABLE IF NOT EXISTS nm_api_variable (
    variable_id      TEXT NOT NULL PRIMARY KEY,
    workspace_id     TEXT NOT NULL,
    variable_scope   TEXT NOT NULL,
    scope_ref_id     TEXT NOT NULL DEFAULT '',
    variable_name    TEXT NOT NULL,
    variable_kind    TEXT NOT NULL DEFAULT 'string',
    initial_value    TEXT NOT NULL DEFAULT '',
    current_value    TEXT NOT NULL DEFAULT '',
    meta_json        TEXT NOT NULL DEFAULT '{}',
    sort_order       INTEGER NOT NULL DEFAULT 0,
    row_version      INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_nm_api_var_scope
    ON nm_api_variable (workspace_id, variable_scope, scope_ref_id, variable_name);

CREATE INDEX IF NOT EXISTS idx_nm_api_var_scope
    ON nm_api_variable (workspace_id, variable_scope, scope_ref_id);
