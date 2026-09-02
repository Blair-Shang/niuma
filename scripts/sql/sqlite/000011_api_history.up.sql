-- API 发送历史：每次 Send 一条不可变快照。集合文档仍在 nm_app_setting（api.workspace）。
-- 流水表：只追加，超限由应用层物理删除最旧行。导入导出集合不含本表。

CREATE TABLE IF NOT EXISTS nm_api_history (
    history_id          TEXT NOT NULL PRIMARY KEY,
    workspace_id        TEXT NOT NULL,
    request_id          TEXT,
    request_name        TEXT NOT NULL DEFAULT '',
    http_method         TEXT NOT NULL,
    request_url         TEXT NOT NULL DEFAULT '',
    environment_id      TEXT,
    environment_name    TEXT NOT NULL DEFAULT '',
    request_json        TEXT NOT NULL DEFAULT '{}',
    exchange_json       TEXT NOT NULL DEFAULT '{}',
    duration_ms         INTEGER NOT NULL DEFAULT 0,
    http_status         INTEGER,
    created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nm_api_hist_created
    ON nm_api_history (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_nm_api_hist_request
    ON nm_api_history (request_id, created_at);
