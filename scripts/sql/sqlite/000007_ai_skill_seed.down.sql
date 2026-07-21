DELETE FROM nm_ai_skill WHERE skill_id IN (
    'builtin_skill_slow_query',
    'builtin_skill_explain',
    'builtin_skill_conn_troubleshoot'
);
