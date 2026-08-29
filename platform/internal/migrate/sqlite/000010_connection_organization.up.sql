-- 连接树组织层：每个工作区一份 JSON（文件夹、归属、根排序）。
-- 与 nm_connection_profile 分开；删除站点时由应用层从 JSON 中摘掉 profileId。
CREATE TABLE IF NOT EXISTS nm_connection_organization (
    workspace_id        TEXT NOT NULL PRIMARY KEY,
    organization_json   TEXT NOT NULL DEFAULT '{}',
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
