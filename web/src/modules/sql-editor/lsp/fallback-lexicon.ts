/**
 * 后端 lsp.lexicon 不可用时的本地 fallback（与历史 Monarch 硬编码对齐的子集）。
 * 正常路径以服务端 Keywords()/Functions() 为准。
 */
import type { SqlLexicon } from './lexicon'

export const FALLBACK_MYSQL_LEXICON: SqlLexicon = {
  keywords: [
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP',
    'TABLE', 'VIEW', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AND', 'OR', 'NOT',
    'NULL', 'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'VALUES', 'SET', 'SHOW',
    'USE', 'EXPLAIN', 'DESC', 'DESCRIBE', 'DISTINCT', 'UNION', 'ALL', 'CASE', 'WHEN', 'THEN',
    'ELSE', 'ELSEIF', 'END', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'TRUE', 'FALSE', 'BEGIN',
    'DECLARE', 'RETURN', 'RETURNS', 'DETERMINISTIC', 'PROCEDURE', 'FUNCTION', 'WHILE', 'LOOP',
    'REPEAT', 'UNTIL', 'LEAVE', 'ITERATE', 'CALL', 'HANDLER', 'CURSOR', 'FETCH', 'OPEN', 'CLOSE',
    'OUT', 'INOUT', 'SIGNAL', 'RESIGNAL',
  ],
  functions: [
    'NOW', 'CURDATE', 'CURTIME', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_USER',
    'LOCALTIME', 'LOCALTIMESTAMP', 'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP', 'COALESCE', 'NULLIF',
    'IFNULL', 'IF', 'GREATEST', 'LEAST', 'CAST', 'CONVERT', 'CONCAT', 'CONCAT_WS', 'SUBSTRING',
    'SUBSTR', 'MID', 'TRIM', 'LTRIM', 'RTRIM', 'UPPER', 'LOWER', 'REPLACE', 'LPAD', 'RPAD',
    'LENGTH', 'CHAR_LENGTH', 'CHARACTER_LENGTH', 'INSTR', 'LOCATE', 'ABS', 'CEIL', 'CEILING',
    'FLOOR', 'ROUND', 'TRUNCATE', 'MOD', 'POWER', 'SQRT', 'SIGN', 'DATE_FORMAT', 'STR_TO_DATE',
    'DATE_ADD', 'DATE_SUB', 'DATEDIFF', 'TIMESTAMPDIFF', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE',
    'SECOND', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'GROUP_CONCAT', 'JSON_OBJECT', 'JSON_ARRAY',
    'JSON_EXTRACT', 'UUID', 'MD5', 'SHA1', 'SHA2', 'DATABASE', 'SCHEMA', 'USER', 'VERSION',
    'FOUND_ROWS', 'LAST_INSERT_ID', 'ROW_COUNT',
  ],
}

export const FALLBACK_DAMENG_LEXICON: SqlLexicon = {
  keywords: [
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'CREATE', 'OR', 'REPLACE',
    'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL',
    'ON', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
    'VALUES', 'SET', 'EXPLAIN', 'DESC', 'DISTINCT', 'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE',
    'ELSIF', 'IF', 'END', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'TRUE', 'FALSE', 'BEGIN',
    'DECLARE', 'RETURN', 'RETURNING', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'BODY', 'WHILE', 'LOOP',
    'EXIT', 'CONTINUE', 'EXCEPTION', 'RAISE', 'CURSOR', 'FETCH', 'OPEN', 'CLOSE', 'COMMIT',
    'ROLLBACK', 'SAVEPOINT', 'SEQUENCE', 'IDENTITY', 'MERGE', 'MINUS', 'INTERSECT', 'ROWNUM',
    'CONNECT', 'GRANT', 'REVOKE', 'SCHEMA', 'SYNONYM', 'TRIGGER', 'BEFORE', 'AFTER', 'INSTEAD',
    'FOR', 'EACH', 'ROW', 'ROWS', 'ONLY', 'FIRST', 'REFERENCING', 'OLD', 'NEW', 'OF', 'ENABLE',
    'DISABLE', 'OUT', 'INOUT', 'CALL', 'EXECUTE', 'IMMEDIATE', 'TYPE', 'PRAGMA', 'INCREMENT',
    'START', 'WITH', 'CACHE', 'NOCACHE', 'CYCLE', 'NOCYCLE',
  ],
  functions: [
    'SYSDATE', 'SYSTIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIMESTAMP', 'CURRENT_USER', 'USER', 'UID',
    'COALESCE', 'NULLIF', 'NVL', 'NVL2', 'DECODE', 'GREATEST', 'LEAST', 'TO_CHAR', 'TO_DATE',
    'TO_NUMBER', 'TO_TIMESTAMP', 'CAST', 'CONVERT', 'SUBSTR', 'SUBSTRING', 'INSTR', 'LENGTH',
    'LENGTHB', 'LOWER', 'UPPER', 'TRIM', 'LTRIM', 'RTRIM', 'REPLACE', 'LPAD', 'RPAD', 'CONCAT',
    'ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'TRUNC', 'MOD', 'POWER', 'SQRT', 'SIGN',
    'ADD_MONTHS', 'MONTHS_BETWEEN', 'LAST_DAY', 'NEXT_DAY', 'EXTRACT', 'COUNT', 'SUM', 'AVG',
    'MAX', 'MIN', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'IFNULL', 'NOW',
    'SYS_CONTEXT', 'USERENV', 'RAWTOHEX', 'HEXTORAW', 'EMPTY_CLOB', 'EMPTY_BLOB', 'SEQ_CURRVAL',
    'SEQ_NEXTVAL',
  ],
}

export const FALLBACK_KINGBASE_LEXICON: SqlLexicon = {
  keywords: [
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'CREATE', 'OR', 'REPLACE',
    'ALTER', 'DROP', 'TABLE', 'VIEW', 'MATERIALIZED', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
    'OUTER', 'FULL', 'CROSS', 'ON', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'ORDER', 'BY', 'GROUP',
    'HAVING', 'LIMIT', 'OFFSET', 'VALUES', 'SET', 'EXPLAIN', 'ANALYZE', 'DESC', 'DISTINCT',
    'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'ELSIF', 'IF', 'END', 'IN', 'EXISTS',
    'BETWEEN', 'LIKE', 'ILIKE', 'IS', 'TRUE', 'FALSE', 'BEGIN', 'DECLARE', 'RETURN', 'RETURNING',
    'PROCEDURE', 'FUNCTION', 'LANGUAGE', 'PLPGSQL', 'WHILE', 'LOOP', 'EXIT', 'CONTINUE',
    'EXCEPTION', 'RAISE', 'CURSOR', 'FETCH', 'OPEN', 'CLOSE', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
    'SEQUENCE', 'SERIAL', 'BIGSERIAL', 'MERGE', 'INTERSECT', 'EXCEPT', 'GRANT', 'REVOKE',
    'SCHEMA', 'TRIGGER', 'BEFORE', 'AFTER', 'INSTEAD', 'FOR', 'EACH', 'ROW', 'ROWS', 'ONLY',
    'FIRST', 'OUT', 'INOUT', 'CALL', 'EXECUTE', 'WITH', 'RECURSIVE', 'WINDOW', 'OVER',
    'PARTITION', 'FILTER', 'LATERAL', 'CASCADE', 'RESTRICT', 'PRIMARY', 'KEY', 'FOREIGN',
    'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT', 'CONSTRAINT', 'TEMPORARY', 'TEMP', 'UNLOGGED',
  ],
  functions: [
    'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_USER', 'CURRENT_SCHEMA',
    'SESSION_USER', 'SYSDATE', 'SYSTIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP', 'NOW', 'COALESCE',
    'NULLIF', 'NVL', 'NVL2', 'DECODE', 'GREATEST', 'LEAST', 'TO_CHAR', 'TO_DATE', 'TO_NUMBER',
    'TO_TIMESTAMP', 'CAST', 'CONVERT', 'SUBSTR', 'SUBSTRING', 'INSTR', 'LENGTH', 'LENGTHB',
    'CHAR_LENGTH', 'CHARACTER_LENGTH', 'LOWER', 'UPPER', 'INITCAP', 'TRIM', 'LTRIM', 'RTRIM',
    'REPLACE', 'LPAD', 'RPAD', 'CONCAT', 'CONCAT_WS', 'ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND',
    'TRUNC', 'TRUNCATE', 'MOD', 'POWER', 'SQRT', 'SIGN', 'ADD_MONTHS', 'MONTHS_BETWEEN',
    'LAST_DAY', 'NEXT_DAY', 'EXTRACT', 'DATE_PART', 'DATE_TRUNC', 'AGE', 'COUNT', 'SUM', 'AVG',
    'MAX', 'MIN', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE',
    'LAST_VALUE', 'IFNULL', 'IF', 'DATE_FORMAT', 'STR_TO_DATE', 'DATE_ADD', 'DATE_SUB',
    'DATEDIFF', 'GROUP_CONCAT', 'STRING_AGG', 'ARRAY_AGG', 'JSON_AGG', 'JSONB_AGG', 'TO_JSON',
    'TO_JSONB', 'JSONB_BUILD_OBJECT', 'JSONB_BUILD_ARRAY', 'DATABASE', 'UUID', 'MD5', 'SHA256',
    'USER', 'UID', 'VERSION', 'PG_TYPEOF', 'NEXTVAL', 'CURRVAL', 'SETVAL', 'GENERATE_SERIES',
    'SYS_CONTEXT', 'USERENV', 'RAWTOHEX', 'HEXTORAW',
  ],
}

/** ClickHouse：服务端不可用时的着色兜底（子集；完整词表见 clickhouseparser）。 */
export const FALLBACK_CLICKHOUSE_LEXICON: SqlLexicon = {
  keywords: [
    'SELECT', 'FROM', 'WHERE', 'PREWHERE', 'HAVING', 'QUALIFY', 'INSERT', 'INTO', 'UPDATE', 'DELETE',
    'ALTER', 'CREATE', 'DROP', 'ATTACH', 'DETACH', 'TRUNCATE', 'OPTIMIZE', 'SYSTEM', 'KILL',
    'TABLE', 'VIEW', 'MATERIALIZED', 'DICTIONARY', 'DATABASE', 'INDEX', 'PROJECTION',
    'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ANY', 'ALL', 'ASOF', 'GLOBAL',
    'SEMI', 'ANTI', 'ON', 'USING', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'ORDER', 'BY', 'GROUP',
    'LIMIT', 'OFFSET', 'VALUES', 'SETTINGS', 'FORMAT', 'EXPLAIN', 'DESCRIBE', 'SHOW', 'USE',
    'WITH', 'RECURSIVE', 'DISTINCT', 'UNION', 'INTERSECT', 'EXCEPT', 'CASE', 'WHEN', 'THEN',
    'ELSE', 'END', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'IS', 'TRUE', 'FALSE',
    'ENGINE', 'PARTITION', 'PRIMARY', 'KEY', 'FINAL', 'SAMPLE', 'CLUSTER', 'TTL', 'CODEC',
    'DEFAULT', 'Nullable', 'LowCardinality', 'Array', 'Map', 'Tuple', 'Nested', 'JSON',
    'IF', 'REPLACE', 'RENAME', 'EXCHANGE', 'LIGHTWEIGHT', 'ASYNC', 'SYNC', 'WINDOW', 'OVER',
    'ROWS', 'RANGE', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'FILTER', 'FILL', 'INTERPOLATE',
    'String', 'FixedString', 'UUID', 'Date', 'Date32', 'DateTime', 'DateTime64',
    'UInt8', 'UInt16', 'UInt32', 'UInt64', 'Int8', 'Int16', 'Int32', 'Int64',
    'Float32', 'Float64', 'Decimal', 'Bool', 'Boolean', 'IPv4', 'IPv6',
    'MergeTree', 'ReplacingMergeTree', 'SummingMergeTree', 'AggregatingMergeTree',
    'CollapsingMergeTree', 'VersionedCollapsingMergeTree', 'ReplicatedMergeTree',
    'Distributed', 'Memory', 'Log', 'TinyLog', 'Buffer', 'Null', 'Kafka', 'S3',
  ],
  functions: [
    'now', 'today', 'yesterday', 'toDate', 'toDateTime', 'toDateTime64', 'toString', 'toInt64',
    'toUInt64', 'toFloat64', 'toUUID', 'toYYYYMM', 'toStartOfDay', 'toStartOfMonth', 'cast',
    'if', 'multiIf', 'coalesce', 'ifNull', 'nullIf', 'isNull', 'isNotNull',
    'count', 'countIf', 'sum', 'sumIf', 'avg', 'min', 'max', 'any', 'argMin', 'argMax',
    'uniq', 'uniqExact', 'groupArray', 'groupUniqArray', 'quantile', 'median', 'topK',
    'arrayJoin', 'arrayMap', 'arrayFilter', 'arraySum', 'has', 'indexOf', 'map', 'mapKeys',
    'tuple', 'length', 'lower', 'upper', 'substring', 'concat', 'replaceAll', 'trim',
    'splitByChar', 'match', 'position', 'startsWith', 'endsWith',
    'formatDateTime', 'dateDiff', 'dateAdd', 'parseDateTimeBestEffort',
    'abs', 'round', 'floor', 'ceil', 'greatest', 'least', 'pow', 'sqrt',
    'cityHash64', 'sipHash64', 'xxHash64', 'generateUUIDv4', 'generateUUIDv7', 'rand',
    'JSONExtract', 'JSONExtractString', 'JSONHas', 'isValidJSON',
    'dictGet', 'dictHas', 'numbers', 'remote', 'cluster', 'file', 's3', 'url',
    'version', 'currentDatabase', 'currentUser', 'hostName',
    'row_number', 'rank', 'dense_rank', 'lagInFrame', 'leadInFrame',
  ],
}

/** SQLite：服务端不可用时的着色兜底（子集；完整词表见 sqliteparser）。 */
export const FALLBACK_SQLITE_LEXICON: SqlLexicon = {
  keywords: [
    'SELECT', 'FROM', 'WHERE', 'HAVING', 'GROUP', 'ORDER', 'BY', 'LIMIT', 'OFFSET',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'REPLACE',
    'WITH', 'RECURSIVE', 'DISTINCT', 'ALL', 'AS', 'UNION', 'INTERSECT', 'EXCEPT',
    'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'NATURAL', 'ON', 'USING',
    'CREATE', 'DROP', 'ALTER', 'TABLE', 'VIEW', 'INDEX', 'TRIGGER', 'TEMP', 'TEMPORARY',
    'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT', 'AUTOINCREMENT',
    'BEGIN', 'COMMIT', 'ROLLBACK', 'ATTACH', 'DETACH', 'DATABASE', 'PRAGMA', 'VACUUM',
    'ANALYZE', 'EXPLAIN', 'QUERY', 'PLAN', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'EXISTS',
    'BETWEEN', 'LIKE', 'GLOB', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'INTEGER', 'TEXT',
    'REAL', 'BLOB', 'NUMERIC', 'WITHOUT', 'ROWID', 'STRICT', 'GENERATED', 'ALWAYS', 'STORED',
    'VIRTUAL', 'BEFORE', 'AFTER', 'INSTEAD', 'OF', 'EACH', 'ROW', 'RETURNING',
  ],
  functions: [
    'abs', 'changes', 'coalesce', 'hex', 'ifnull', 'iif', 'instr', 'length', 'lower', 'upper',
    'ltrim', 'rtrim', 'trim', 'max', 'min', 'nullif', 'printf', 'quote', 'random', 'replace',
    'round', 'sqlite_version', 'substr', 'typeof', 'avg', 'count', 'group_concat', 'sum', 'total',
    'json', 'json_extract', 'json_valid', 'date', 'time', 'datetime', 'julianday', 'strftime',
    'unixepoch',
  ],
}
