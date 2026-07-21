-- 内置 Vastbase 只读 MCP 注册（外部进程；不编进 platform）
-- command_path 为可执行文件名；运行时相对 platform-core / PATH 解析
-- 工具列表需 refresh 后写入 nm_mcp_tool

INSERT OR IGNORE INTO nm_mcp_server (
    server_id, server_name, transport_kind, endpoint_url, command_path, launch_options,
    credential_id, record_status, sort_order, row_version, created_at, updated_at
) VALUES (
    'builtin_mcp_vastbase_readonly',
    'vastbase-readonly',
    'stdio',
    NULL,
    'mcp-vastbase-readonly',
    '{"args":[],"timeoutMs":30000}',
    NULL,
    'active',
    10,
    0,
    datetime('now'),
    datetime('now')
);
