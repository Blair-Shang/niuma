package clickhouseparser

// clickHouseKeywords 补全 / Monarch 单源。
// 以 ClickHouseLexer.g4 关键字为主，并补充常用类型名、引擎名与近年语法词（如 QUALIFY）。
var clickHouseKeywords = []string{
	// —— DML / 查询 ——
	"SELECT", "FROM", "WHERE", "PREWHERE", "HAVING", "QUALIFY",
	"INSERT", "INTO", "VALUES", "UPDATE", "DELETE", "TRUNCATE",
	"WITH", "RECURSIVE", "DISTINCT", "ALL", "ANY", "ASOF", "SEMI", "ANTI",
	"UNION", "INTERSECT", "EXCEPT", "LIMIT", "OFFSET", "TOP", "SAMPLE",
	"ORDER", "BY", "GROUP", "GROUPING", "SETS", "CUBE", "ROLLUP",
	"ASC", "DESC", "ASCENDING", "DESCENDING", "NULLS", "FIRST", "LAST", "COLLATE",
	"JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL", "CROSS", "GLOBAL", "LOCAL",
	"ON", "USING",
	"CASE", "WHEN", "THEN", "ELSE", "END",
	"AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "ILIKE", "IS", "NULL",
	"TRUE", "FALSE", "INF", "NAN",
	"AS", "CAST", "EXTRACT", "SUBSTRING", "TRIM", "INTERVAL",
	"SETTINGS", "SETTING", "FORMAT", "OUTFILE",
	"WINDOW", "OVER", "PARTITION", "ROWS", "RANGE", "UNBOUNDED", "PRECEDING",
	"FOLLOWING", "CURRENT", "ROW", "FILTER", "FILL", "INTERPOLATE", "STEP", "TIES",
	"TOTALS", "FINAL", "PARALLEL", "APPLY", "LAMBDA",

	// —— DDL / 对象 ——
	"CREATE", "DROP", "ALTER", "ATTACH", "DETACH", "RENAME", "EXCHANGE", "REPLACE",
	"TABLE", "TABLES", "VIEW", "MATERIALIZED", "DICTIONARY", "DICTIONARIES",
	"DATABASE", "DATABASES", "INDEX", "INDEXES", "INDICES", "PROJECTION",
	"COLUMN", "COLUMNS", "CONSTRAINT", "COMMENT", "TTL", "CODEC", "ENGINE", "ENGINES",
	"TEMPORARY", "TEMP", "IF", "EMPTY",
	"ADD", "MODIFY", "CLEAR", "REMOVE", "AFTER", "TYPE", "DEFAULT", "ALIAS", "MATERIALIZE",
	"PRIMARY", "KEY", "KEYS", "GRANULARITY", "POPULATE", "TO",
	"CLUSTER", "CLUSTERS",
	"FUNCTION", "FUNCTIONS", "USER", "USERS", "ROLE", "ROLES", "PROFILE", "PROFILES",
	"QUOTA", "QUOTAS", "POLICY", "POLICIES",
	"GRANT", "GRANTS", "REVOKE", "PRIVILEGES", "ACCESS", "ENABLED", "IMPLICIT",
	"UUID", "SOURCE", "LAYOUT", "LIFETIME", "INJECTIVE", "HIERARCHICAL",
	"EPHEMERAL", "OVERRIDE", "EXPRESSION", "IDENTIFIED", "HOST", "IP", "NAME", "NO",
	"CURRENT_USER",

	// —— 维护 / 系统 ——
	"OPTIMIZE", "DEDUPLICATE", "FREEZE", "MOVE", "LIGHTWEIGHT", "MUTATION",
	"ASYNC", "SYNC", "KILL", "QUERY", "WATCH", "LIVE",
	"SYSTEM", "RELOAD", "FLUSH", "STOP", "START", "FETCHES", "SENDS", "MERGES",
	"DISTRIBUTED", "REPLICATED", "REPLICA", "DISK", "VOLUME", "CACHES", "LOGS",
	"PROCESSLIST", "EVENTS", "CHECK", "CHECKS", "DELAY", "TIMEOUT", "TEST",

	// —— 元数据 / 展示 ——
	"SHOW", "DESCRIBE", "DESC", "EXPLAIN", "USE",
	"SYNTAX", "AST", "PLAN", "PIPELINE", "ESTIMATE", "TREE", "EXTENDED", "CHANGED",
	"FIELDS", "FOR", "BOTH", "LEADING", "TRAILING", "MIN", "MAX", "ID", "IS_OBJECT_ID",
	"TIMESTAMP",

	// —— 常用数据类型（高亮 CREATE / CAST）——
	"Array", "Map", "Tuple", "Nested", "JSON", "Dynamic", "Nullable", "LowCardinality",
	"String", "FixedString", "Date", "Date32", "DateTime", "DateTime64",
	"Bool", "Boolean", "Int8", "Int16", "Int32", "Int64", "Int128", "Int256",
	"UInt8", "UInt16", "UInt32", "UInt64", "UInt128", "UInt256",
	"Float32", "Float64", "Decimal", "Decimal32", "Decimal64", "Decimal128", "Decimal256",
	"Enum8", "Enum16", "IPv4", "IPv6", "Point", "Ring", "Polygon", "MultiPolygon",
	"AggregateFunction", "SimpleAggregateFunction", "Nothing", "Object",

	// —— 常用表引擎 ——
	"MergeTree", "ReplacingMergeTree", "SummingMergeTree", "AggregatingMergeTree",
	"CollapsingMergeTree", "VersionedCollapsingMergeTree", "GraphiteMergeTree",
	"ReplicatedMergeTree", "ReplicatedReplacingMergeTree", "ReplicatedSummingMergeTree",
	"ReplicatedAggregatingMergeTree", "ReplicatedCollapsingMergeTree",
	"ReplicatedVersionedCollapsingMergeTree", "SharedMergeTree",
	"Log", "TinyLog", "StripeLog", "Memory", "Buffer", "Distributed",
	"Merge", "Dictionary", "Null", "File", "URL", "S3", "HDFS", "Kafka",
	"MaterializedView", "GenerateRandom", "EmbeddedRocksDB",

	// —— 时间单位（INTERVAL / dateDiff）——
	"YEAR", "QUARTER", "MONTH", "WEEK", "DAY", "HOUR", "MINUTE", "SECOND",
	"MILLISECOND", "MICROSECOND", "NANOSECOND",
}
