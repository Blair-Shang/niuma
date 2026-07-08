-- 000001_core.up.sql
-- 核心：工作区、应用配置

CREATE TABLE IF NOT EXISTS nm_workspace (
    workspace_id    TEXT NOT NULL PRIMARY KEY,
    workspace_name  TEXT NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    row_version     INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_nm_workspace_name ON nm_workspace (workspace_name);

CREATE TABLE IF NOT EXISTS nm_app_setting (
    setting_key     TEXT NOT NULL PRIMARY KEY,
    setting_value   TEXT NOT NULL DEFAULT '{}',  -- JSON
    updated_at      TEXT NOT NULL
);

-- 默认工作区（ID 由 Platform 首次 migrate 时替换为 NmIdGenerator 产出）
INSERT OR IGNORE INTO nm_workspace (
    workspace_id, workspace_name, sort_order, row_version, created_at, updated_at
) VALUES (
    '1', 'Default', 0, 0, datetime('now'), datetime('now')
);
