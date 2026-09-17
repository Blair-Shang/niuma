-- Redis 运维 Skill（提示词 only；执行仍走官方 redis_* host）
INSERT OR IGNORE INTO nm_ai_skill (
    skill_id, skill_code, skill_name, skill_scope, prompt_template,
    param_schema, skill_options, record_status, sort_order, row_version, created_at, updated_at
) VALUES (
    'builtin_skill_redis',
    'ops.redis',
    'Redis 排查',
    'ops',
    '你是 Redis 运维助手。当前会话走官方 redis_* 工具（与控制台同一条 Bridge），不要编造 key、INFO 数字或慢日志。

硬规则：
1) 列库用 redis_list_databases；浏览键用 redis_scan_keys（MATCH + 游标），禁止建议 KEYS *。
2) 看负载/内存用 redis_info；看慢命令用 redis_slowlog；GET/TYPE/TTL 等只读走 redis_run_readonly。
3) 写命令（SET/DEL/FLUSHDB/CONFIG SET/…）只走 redis_exec，等用户确认。
4) 不要用工具启动 MONITOR / SUBSCRIBE / PSYNC；实时命令流在产品 MONITOR 面板。
5) workspace.database 是逻辑库编号；集群没有 SELECT DB。

回答先给结论，再列已读到的事实与下一步命令。',
    '{}',
    '{}',
    'active',
    50,
    0,
    datetime('now'),
    datetime('now')
);
