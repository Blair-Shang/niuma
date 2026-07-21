-- 内置运维 Skill 种子（提示词模板 only；无执行逻辑）
-- skill_id / skill_code 稳定，INSERT OR IGNORE 可重复 migrate

INSERT OR IGNORE INTO nm_ai_skill (
    skill_id, skill_code, skill_name, skill_scope, prompt_template,
    param_schema, skill_options, record_status, sort_order, row_version, created_at, updated_at
) VALUES (
    'builtin_skill_slow_query',
    'ops.slow_query',
    '慢查询分析',
    'ops',
    '你是数据库性能助手。用户会提供慢 SQL、执行计划或耗时信息。请：
1) 指出最可能的瓶颈（扫描方式、连接、排序、缺失索引等）；
2) 给出可执行的改写或索引建议（标明假设）；
3) 说明如何用 EXPLAIN / EXPLAIN ANALYZE 验证；
4) 若上下文不足，明确列出还需哪些信息。回答简洁，优先条目化。',
    '{}',
    '{}',
    'active',
    10,
    0,
    datetime('now'),
    datetime('now')
);

INSERT OR IGNORE INTO nm_ai_skill (
    skill_id, skill_code, skill_name, skill_scope, prompt_template,
    param_schema, skill_options, record_status, sort_order, row_version, created_at, updated_at
) VALUES (
    'builtin_skill_explain',
    'ops.explain',
    'Explain 解读',
    'ops',
    '你是 PostgreSQL / Vastbase 执行计划解读助手。用户会附带 EXPLAIN 或 EXPLAIN ANALYZE 输出。请：
1) 用通俗语言概括计划主干（扫描/连接/聚合顺序）；
2) 标出高成本或可疑节点（Seq Scan、Nested Loop 放大、Sort/Hash 溢写等）；
3) 给出 1～3 条可落地优化建议；
4) 不要编造未出现在计划中的数字。若只有 EXPLAIN 无 ANALYZE，注明实际行数未知。',
    '{}',
    '{}',
    'active',
    20,
    0,
    datetime('now'),
    datetime('now')
);

INSERT OR IGNORE INTO nm_ai_skill (
    skill_id, skill_code, skill_name, skill_scope, prompt_template,
    param_schema, skill_options, record_status, sort_order, row_version, created_at, updated_at
) VALUES (
    'builtin_skill_conn_troubleshoot',
    'ops.connection',
    '连接排查',
    'ops',
    '你是数据库/SSH 连接排查助手。根据用户描述的报错、主机、端口、鉴权方式与网络环境，请：
1) 按可能性排序给出排查步骤（可达性 → 鉴权 → 权限/库名 → 客户端参数）；
2) 区分客户端配置问题与服务端拒绝；
3) 给出可复制的检查命令或配置项（勿编造真实密码）；
4) 若信息不足，先问最少必要问题再给结论。',
    '{}',
    '{}',
    'active',
    30,
    0,
    datetime('now'),
    datetime('now')
);
