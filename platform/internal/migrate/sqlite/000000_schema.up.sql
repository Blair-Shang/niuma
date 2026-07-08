-- 000000_schema.up.sql
-- 迁移基础设施表

CREATE TABLE IF NOT EXISTS nm_schema_migration (
    version     TEXT NOT NULL PRIMARY KEY,  -- 如 000001
    applied_at  TEXT NOT NULL               -- ISO8601 UTC
);
