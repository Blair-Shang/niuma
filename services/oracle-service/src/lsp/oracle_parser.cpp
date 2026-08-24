#include "lsp/oracle_parser.hpp"

#include "niuma/sqllsp/heuristic.hpp"
#include "util/ident.hpp"

#include <algorithm>
#include <cctype>
#include <string>

namespace niuma::oracle::lsp {
namespace {

struct BuiltinFn {
  const char* name;
  const char* insert;  // 空则 name+"()"
  const char* detail;
  const char* doc;
};

bool IsAsciiSpace(unsigned char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; }

std::string ToLowerAscii(std::string s) {
  for (char& c : s) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return s;
}

std::string TrimRight(std::string s) {
  while (!s.empty() && IsAsciiSpace(static_cast<unsigned char>(s.back()))) s.pop_back();
  return s;
}

/** 光标前文本（小写）是否落在给定子句尾部（半成品友好）。 */
bool TrailingClause(const std::string& lower, const std::vector<std::string>& markers) {
  const std::string trimmed = TrimRight(lower);
  for (const std::string& m : markers) {
    if (m.empty()) continue;
    const size_t idx = trimmed.rfind(m);
    if (idx == std::string::npos) continue;
    const std::string after = TrimRight(trimmed.substr(idx + m.size()));
    if (after.empty()) return true;
    bool ident_only = true;
    for (unsigned char c : after) {
      if (std::isalnum(c) || c == '_' || c == '$' || c == '#' || c == '"' || c == '.' ||
          IsAsciiSpace(c)) {
        continue;
      }
      ident_only = false;
      break;
    }
    if (ident_only) return true;
  }
  return false;
}

const std::vector<std::string>& KeywordList() {
  static const std::vector<std::string> k = {
      // DML / 查询
      "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "MERGE",
      "USING", "MATCHED", "WHEN", "THEN", "ELSE", "CASE", "END", "AS", "ON", "AND", "OR", "NOT",
      "NULL", "IS", "IN", "EXISTS", "BETWEEN", "LIKE", "ESCAPE", "DISTINCT", "ALL", "ANY", "SOME",
      "UNION", "INTERSECT", "MINUS", "ORDER", "BY", "ASC", "DESC", "NULLS", "FIRST", "LAST",
      "GROUP", "HAVING", "WITH", "RECURSIVE", "PIVOT", "UNPIVOT", "MODEL", "CROSS", "APPLY",
      "OUTER", "INNER", "LEFT", "RIGHT", "FULL", "JOIN", "NATURAL",
      // 层次 / 分析 / 分页
      "CONNECT", "START", "PRIOR", "NOCYCLE", "LEVEL", "CONNECT_BY_ROOT", "SYS_CONNECT_BY_PATH",
      "OVER", "PARTITION", "RANGE", "ROWS", "UNBOUNDED", "PRECEDING", "FOLLOWING", "CURRENT", "ROW",
      "FETCH", "NEXT", "ONLY", "PERCENT", "TIES", "OFFSET", "ROWNUM", "ROW_NUMBER",
      // DDL
      "CREATE", "OR", "REPLACE", "ALTER", "DROP", "TRUNCATE", "RENAME", "COMMENT", "TABLE", "VIEW",
      "MATERIALIZED", "INDEX", "SEQUENCE", "SYNONYM", "TRIGGER", "TYPE", "BODY", "PACKAGE",
      "PROCEDURE", "FUNCTION", "SCHEMA", "TABLESPACE", "CONSTRAINT", "PRIMARY", "KEY", "FOREIGN",
      "REFERENCES", "UNIQUE", "CHECK", "DEFAULT", "NULL", "NOT", "ENABLE", "DISABLE", "VALIDATE",
      "NOVALIDATE", "CASCADE", "RESTRICT", "FORCE", "EDITIONABLE", "NONEDITIONABLE", "GLOBAL",
      "TEMPORARY", "ON", "COMMIT", "PRESERVE", "DELETE", "ROWS",
      // PL/SQL
      "BEGIN", "DECLARE", "EXCEPTION", "RAISE", "PRAGMA", "AUTONOMOUS_TRANSACTION",
      "RETURN", "RETURNING", "INTO", "BULK", "COLLECT", "FORALL", "LOOP", "WHILE", "FOR", "IN",
      "REVERSE", "EXIT", "CONTINUE", "GOTO", "IF", "ELSIF", "ELSE", "THEN", "CASE", "WHEN",
      "CURSOR", "OPEN", "FETCH", "CLOSE", "REF", "RECORD", "VARRAY", "NESTED", "TABLE", "OF",
      "INDEX", "BY", "PLS_INTEGER", "BINARY_INTEGER", "BOOLEAN", "CONSTANT", "OUT", "INOUT",
      "NOCOPY", "DETERMINISTIC", "PIPELINED", "PARALLEL_ENABLE", "RESULT_CACHE", "AUTHID",
      "CURRENT_USER", "DEFINER", "EXECUTE", "IMMEDIATE", "CALL", "USING",
      // 事务 / 权限
      "COMMIT", "ROLLBACK", "SAVEPOINT", "SET", "TRANSACTION", "READ", "WRITE", "ONLY", "ISOLATION",
      "LEVEL", "SERIALIZABLE", "GRANT", "REVOKE", "TO", "FROM", "PUBLIC", "ROLE", "IDENTIFIED",
      "BY", "PASSWORD", "EXPIRE", "ACCOUNT", "LOCK", "UNLOCK",
      // 触发器
      "BEFORE", "AFTER", "INSTEAD", "OF", "EACH", "ROW", "REFERENCING", "OLD", "NEW", "FOLLOWS",
      "PRECEDES", "COMPOUND", "STATEMENT",
      // 类型 / 其他
      "VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR", "NUMBER", "FLOAT", "BINARY_FLOAT", "BINARY_DOUBLE",
      "DATE", "TIMESTAMP", "WITH", "LOCAL", "TIME", "ZONE", "INTERVAL", "YEAR", "MONTH", "DAY",
      "SECOND", "RAW", "LONG", "BLOB", "CLOB", "NCLOB", "BFILE", "ROWID", "UROWID", "XMLTYPE",
      "JSON", "BOOLEAN", "PLS_INTEGER", "DUAL", "TRUE", "FALSE", "EXPLAIN", "PLAN", "FOR",
      "ANALYZE", "VALIDATE", "STRUCTURE", "LIST", "AGG", "WITHIN", "GROUP", "KEEP", "DENSE_RANK",
      "FIRST", "LAST", "IGNORE", "NULLS", "RESPECT",
  };
  return k;
}

const BuiltinFn* BuiltinFns(size_t& count) {
  static const BuiltinFn k[] = {
      // 空值 / 条件
      {"NVL", "NVL(${1:expr}, ${2:alt})", "any", "空则替换"},
      {"NVL2", "NVL2(${1:expr}, ${2:not_null}, ${3:is_null})", "any", "按是否为空二选一"},
      {"DECODE", "DECODE(${1:expr}, ${2:search}, ${3:result})", "any", "等值映射"},
      {"COALESCE", "COALESCE(${1:expr1}, ${2:expr2})", "any", "首个非 NULL"},
      {"NULLIF", "NULLIF(${1:a}, ${2:b})", "any", "相等则 NULL"},
      {"GREATEST", "GREATEST(${1:a}, ${2:b})", "any", "最大值"},
      {"LEAST", "LEAST(${1:a}, ${2:b})", "any", "最小值"},
      // 转换
      {"TO_CHAR", "TO_CHAR(${1:expr}, ${2:fmt})", "string", "转字符串"},
      {"TO_DATE", "TO_DATE(${1:str}, ${2:fmt})", "date", "字符串转日期"},
      {"TO_NUMBER", "TO_NUMBER(${1:str})", "number", "转数值"},
      {"TO_TIMESTAMP", "TO_TIMESTAMP(${1:str}, ${2:fmt})", "timestamp", "转时间戳"},
      {"TO_TIMESTAMP_TZ", "TO_TIMESTAMP_TZ(${1:str}, ${2:fmt})", "timestamp", "转带时区时间戳"},
      {"CAST", "CAST(${1:expr} AS ${2:type})", "any", "类型转换"},
      {"CONVERT", "CONVERT(${1:dest_charset}, ${2:expr})", "string", "字符集转换"},
      {"ASCIISTR", "ASCIISTR(${1:str})", "string", "非 ASCII 转 \\XXXX"},
      {"UNISTR", "UNISTR(${1:str})", "string", "Unicode 转义还原"},
      {"CHARTOROWID", "CHARTOROWID(${1:str})", "rowid", "字符串转 ROWID"},
      {"ROWIDTOCHAR", "ROWIDTOCHAR(${1:rowid})", "string", "ROWID 转字符串"},
      {"RAWTOHEX", "RAWTOHEX(${1:raw})", "string", "RAW 转十六进制"},
      {"HEXTORAW", "HEXTORAW(${1:hex})", "raw", "十六进制转 RAW"},
      // 字符串
      {"SUBSTR", "SUBSTR(${1:str}, ${2:pos}, ${3:len})", "string", "子串"},
      {"SUBSTRB", "SUBSTRB(${1:str}, ${2:pos}, ${3:len})", "string", "按字节子串"},
      {"INSTR", "INSTR(${1:str}, ${2:substr})", "int", "子串位置"},
      {"INSTRB", "INSTRB(${1:str}, ${2:substr})", "int", "按字节子串位置"},
      {"LENGTH", "LENGTH(${1:str})", "int", "字符长度"},
      {"LENGTHB", "LENGTHB(${1:str})", "int", "字节长度"},
      {"LOWER", "LOWER(${1:str})", "string", "转小写"},
      {"UPPER", "UPPER(${1:str})", "string", "转大写"},
      {"INITCAP", "INITCAP(${1:str})", "string", "首字母大写"},
      {"TRIM", "TRIM(${1:str})", "string", "去两端空白"},
      {"LTRIM", "LTRIM(${1:str})", "string", "去左空白"},
      {"RTRIM", "RTRIM(${1:str})", "string", "去右空白"},
      {"REPLACE", "REPLACE(${1:str}, ${2:from}, ${3:to})", "string", "替换子串"},
      {"TRANSLATE", "TRANSLATE(${1:str}, ${2:from}, ${3:to})", "string", "逐字符映射"},
      {"LPAD", "LPAD(${1:str}, ${2:len}, ${3:pad})", "string", "左侧填充"},
      {"RPAD", "RPAD(${1:str}, ${2:len}, ${3:pad})", "string", "右侧填充"},
      {"CONCAT", "CONCAT(${1:str1}, ${2:str2})", "string", "字符串连接"},
      {"CHR", "CHR(${1:n})", "string", "码点转字符"},
      {"ASCII", "ASCII(${1:str})", "int", "首字符 ASCII"},
      {"SOUNDEX", "SOUNDEX(${1:str})", "string", "语音编码"},
      {"REGEXP_LIKE", "REGEXP_LIKE(${1:str}, ${2:pattern})", "boolean", "正则匹配"},
      {"REGEXP_SUBSTR", "REGEXP_SUBSTR(${1:str}, ${2:pattern})", "string", "正则提取"},
      {"REGEXP_REPLACE", "REGEXP_REPLACE(${1:str}, ${2:pattern}, ${3:repl})", "string", "正则替换"},
      {"REGEXP_INSTR", "REGEXP_INSTR(${1:str}, ${2:pattern})", "int", "正则位置"},
      {"REGEXP_COUNT", "REGEXP_COUNT(${1:str}, ${2:pattern})", "int", "正则匹配次数"},
      // 数值
      {"ABS", "ABS(${1:n})", "number", "绝对值"},
      {"CEIL", "CEIL(${1:n})", "number", "向上取整"},
      {"FLOOR", "FLOOR(${1:n})", "number", "向下取整"},
      {"ROUND", "ROUND(${1:n}, ${2:decimals})", "number", "四舍五入"},
      {"TRUNC", "TRUNC(${1:n}, ${2:decimals})", "number", "截断"},
      {"MOD", "MOD(${1:n}, ${2:m})", "number", "取模"},
      {"POWER", "POWER(${1:x}, ${2:y})", "number", "幂"},
      {"SQRT", "SQRT(${1:n})", "number", "平方根"},
      {"SIGN", "SIGN(${1:n})", "int", "符号"},
      {"EXP", "EXP(${1:n})", "number", "e 的幂"},
      {"LN", "LN(${1:n})", "number", "自然对数"},
      {"LOG", "LOG(${1:base}, ${2:n})", "number", "对数"},
      {"BITAND", "BITAND(${1:a}, ${2:b})", "number", "按位与"},
      {"WIDTH_BUCKET", "WIDTH_BUCKET(${1:expr}, ${2:min}, ${3:max}, ${4:buckets})", "int",
       "等宽分桶"},
      // 日期时间
      {"SYSDATE", "SYSDATE", "datetime", "当前日期时间"},
      {"SYSTIMESTAMP", "SYSTIMESTAMP", "timestamp", "当前时间戳"},
      {"CURRENT_DATE", "CURRENT_DATE", "date", "当前日期"},
      {"CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP", "timestamp", "当前时间戳"},
      {"LOCALTIMESTAMP", "LOCALTIMESTAMP", "timestamp", "本地时间戳"},
      {"DBTIMEZONE", "DBTIMEZONE", "string", "数据库时区"},
      {"SESSIONTIMEZONE", "SESSIONTIMEZONE", "string", "会话时区"},
      {"ADD_MONTHS", "ADD_MONTHS(${1:date}, ${2:n})", "date", "加月"},
      {"MONTHS_BETWEEN", "MONTHS_BETWEEN(${1:d1}, ${2:d2})", "number", "月差"},
      {"LAST_DAY", "LAST_DAY(${1:date})", "date", "月末"},
      {"NEXT_DAY", "NEXT_DAY(${1:date}, ${2:weekday})", "date", "下一指定星期"},
      {"EXTRACT", "EXTRACT(${1:UNIT} FROM ${2:date})", "int", "提取日期部分"},
      {"NUMTODSINTERVAL", "NUMTODSINTERVAL(${1:n}, ${2:unit})", "interval", "数值转日期间隔"},
      {"NUMTOYMINTERVAL", "NUMTOYMINTERVAL(${1:n}, ${2:unit})", "interval", "数值转年月间隔"},
      {"FROM_TZ", "FROM_TZ(${1:timestamp}, ${2:tz})", "timestamp", "附加时区"},
      {"TZ_OFFSET", "TZ_OFFSET(${1:tz})", "string", "时区偏移"},
      // 聚合 / 分析
      {"COUNT", "COUNT(${1:expr})", "aggregate", "计数"},
      {"SUM", "SUM(${1:expr})", "aggregate", "求和"},
      {"AVG", "AVG(${1:expr})", "aggregate", "平均值"},
      {"MAX", "MAX(${1:expr})", "aggregate", "最大值"},
      {"MIN", "MIN(${1:expr})", "aggregate", "最小值"},
      {"STDDEV", "STDDEV(${1:expr})", "aggregate", "标准差"},
      {"VARIANCE", "VARIANCE(${1:expr})", "aggregate", "方差"},
      {"MEDIAN", "MEDIAN(${1:expr})", "aggregate", "中位数"},
      {"LISTAGG", "LISTAGG(${1:expr}, ${2:sep}) WITHIN GROUP (ORDER BY ${3:col})", "aggregate",
       "字符串聚合"},
      {"XMLAGG", "XMLAGG(${1:expr})", "xml", "XML 聚合"},
      {"ROW_NUMBER", "ROW_NUMBER() OVER (${1:ORDER BY col})", "window", "行号"},
      {"RANK", "RANK() OVER (${1:ORDER BY col})", "window", "排名"},
      {"DENSE_RANK", "DENSE_RANK() OVER (${1:ORDER BY col})", "window", "密集排名"},
      {"NTILE", "NTILE(${1:n}) OVER (${2:ORDER BY col})", "window", "分桶排名"},
      {"LAG", "LAG(${1:expr}, ${2:offset}) OVER (${3:ORDER BY col})", "window", "上一行"},
      {"LEAD", "LEAD(${1:expr}, ${2:offset}) OVER (${3:ORDER BY col})", "window", "下一行"},
      {"FIRST_VALUE", "FIRST_VALUE(${1:expr}) OVER (${2:ORDER BY col})", "window", "窗口首值"},
      {"LAST_VALUE", "LAST_VALUE(${1:expr}) OVER (${2:ORDER BY col})", "window", "窗口末值"},
      {"NTH_VALUE", "NTH_VALUE(${1:expr}, ${2:n}) OVER (${3:ORDER BY col})", "window", "窗口第 N 值"},
      {"RATIO_TO_REPORT", "RATIO_TO_REPORT(${1:expr}) OVER (${2:})", "window", "占比"},
      {"CUME_DIST", "CUME_DIST() OVER (${1:ORDER BY col})", "window", "累积分布"},
      {"PERCENT_RANK", "PERCENT_RANK() OVER (${1:ORDER BY col})", "window", "百分比排名"},
      // 会话 / 环境
      {"USER", "USER", "string", "当前用户"},
      {"UID", "UID", "int", "当前用户 ID"},
      {"SYS_CONTEXT", "SYS_CONTEXT(${1:namespace}, ${2:param})", "string", "会话上下文"},
      {"USERENV", "USERENV(${1:param})", "string", "用户环境（旧）"},
      {"SYS_GUID", "SYS_GUID()", "raw", "全局唯一标识"},
      {"ORA_HASH", "ORA_HASH(${1:expr})", "number", "哈希"},
      // LOB / JSON / XML（常用）
      {"EMPTY_CLOB", "EMPTY_CLOB()", "clob", "空 CLOB"},
      {"EMPTY_BLOB", "EMPTY_BLOB()", "blob", "空 BLOB"},
      {"JSON_VALUE", "JSON_VALUE(${1:json}, ${2:path})", "string", "JSON 标量提取"},
      {"JSON_QUERY", "JSON_QUERY(${1:json}, ${2:path})", "json", "JSON 片段提取"},
      {"JSON_TABLE", "JSON_TABLE(${1:json}, ${2:path} COLUMNS (${3:}))", "table", "JSON 转关系"},
      {"JSON_OBJECT", "JSON_OBJECT(${1:key} VALUE ${2:val})", "json", "构造 JSON 对象"},
      {"JSON_ARRAY", "JSON_ARRAY(${1:expr})", "json", "构造 JSON 数组"},
      {"XMLTYPE", "XMLTYPE(${1:xml})", "xml", "构造 XMLType"},
      {"EXISTSNODE", "EXISTSNODE(${1:xml}, ${2:xpath})", "int", "XPath 存在性"},
      {"EXTRACTVALUE", "EXTRACTVALUE(${1:xml}, ${2:xpath})", "string", "XPath 取值"},
  };
  count = sizeof(k) / sizeof(k[0]);
  return k;
}

std::vector<niuma::sqllsp::CompletionItem> CreateSnippets() {
  using niuma::sqllsp::CompletionItem;
  using niuma::sqllsp::kLspSnippet;
  return {
      { "CREATE TABLE",
        kLspSnippet,
        "snippet",
        "CREATE TABLE ${1:table_name} (\n\t${2:id} NUMBER PRIMARY KEY,\n\t${3:name} VARCHAR2(100)\n);\n",
        "创建表",
        "2_CREATE TABLE" },
      { "CREATE OR REPLACE VIEW",
        kLspSnippet,
        "snippet",
        "CREATE OR REPLACE VIEW ${1:view_name} AS\nSELECT ${2:*}\nFROM ${3:table};\n",
        "创建视图",
        "2_CREATE VIEW" },
      { "CREATE OR REPLACE PROCEDURE",
        kLspSnippet,
        "snippet",
        "CREATE OR REPLACE PROCEDURE ${1:proc_name}(${2:})\nAS\nBEGIN\n\t${3:NULL;}\nEND;\n/\n",
        "创建存储过程（PL/SQL，以 / 结束）",
        "2_CREATE PROCEDURE" },
      { "CREATE OR REPLACE FUNCTION",
        kLspSnippet,
        "snippet",
        "CREATE OR REPLACE FUNCTION ${1:func_name}(${2:})\nRETURN ${3:NUMBER}\nAS\nBEGIN\n\t${4:RETURN 0;}\nEND;\n/\n",
        "创建函数（PL/SQL，以 / 结束）",
        "2_CREATE FUNCTION" },
      { "CREATE OR REPLACE PACKAGE",
        kLspSnippet,
        "snippet",
        "CREATE OR REPLACE PACKAGE ${1:pkg_name} AS\n\t${2:-- specs}\nEND ${1:pkg_name};\n/\n",
        "创建包规范",
        "2_CREATE PACKAGE" },
      { "CREATE OR REPLACE PACKAGE BODY",
        kLspSnippet,
        "snippet",
        "CREATE OR REPLACE PACKAGE BODY ${1:pkg_name} AS\n\t${2:-- body}\nEND ${1:pkg_name};\n/\n",
        "创建包体",
        "2_CREATE PACKAGE BODY" },
      { "CREATE SEQUENCE",
        kLspSnippet,
        "snippet",
        "CREATE SEQUENCE ${1:seq_name} START WITH ${2:1} INCREMENT BY ${3:1} NOCACHE;\n",
        "创建序列",
        "2_CREATE SEQUENCE" },
      { "MERGE INTO",
        kLspSnippet,
        "snippet",
        "MERGE INTO ${1:target} t\nUSING (${2:SELECT ...}) s\nON (${3:t.id = s.id})\nWHEN MATCHED THEN UPDATE SET ${4:t.col = s.col}\nWHEN NOT MATCHED THEN INSERT (${5:cols}) VALUES (${6:vals});\n",
        "MERGE 合并写入",
        "2_MERGE" },
  };
}

bool ContainsKind(const std::vector<niuma::sqllsp::CompletionKind>& expect,
                  niuma::sqllsp::CompletionKind kind) {
  return std::find(expect.begin(), expect.end(), kind) != expect.end();
}

void EnsureKinds(std::vector<niuma::sqllsp::CompletionKind>& expect,
                 std::initializer_list<niuma::sqllsp::CompletionKind> kinds) {
  for (auto k : kinds) {
    if (!ContainsKind(expect, k)) expect.push_back(k);
  }
}

}  // namespace

std::vector<std::string> OracleParser::Keywords() const { return KeywordList(); }

std::vector<std::string> OracleParser::Functions() const {
  size_t n = 0;
  const BuiltinFn* fns = BuiltinFns(n);
  std::vector<std::string> out;
  out.reserve(n);
  for (size_t i = 0; i < n; ++i) out.emplace_back(fns[i].name);
  return out;
}

niuma::sqllsp::CompletionContext OracleParser::CompletionContext(
    const std::string& text, niuma::sqllsp::Position pos) const {
  auto cc = niuma::sqllsp::HeuristicCompletionContext(text, pos, KeywordList());
  cc.snippets = CreateSnippets();

  size_t n = 0;
  const BuiltinFn* fns = BuiltinFns(n);
  cc.functions.clear();
  cc.functions.reserve(n);
  for (size_t i = 0; i < n; ++i) {
    niuma::sqllsp::CompletionItem item;
    item.label = fns[i].name;
    item.kind = niuma::sqllsp::kLspFunction;
    item.detail = fns[i].detail ? fns[i].detail : "function";
    item.documentation = fns[i].doc ? fns[i].doc : "";
    if (fns[i].insert && fns[i].insert[0] != '\0') {
      item.insert_text = fns[i].insert;
    } else {
      item.insert_text = std::string(fns[i].name) + "(${1})";
    }
    item.sort_text = std::string("0f_") + fns[i].name;
    cc.functions.push_back(std::move(item));
  }

  // Oracle 专用槽位：层次查询 / 窗口 / MERGE / MERGE
  const int offset = niuma::sqllsp::OffsetFromPosition(text, pos);
  const int from = offset > 4096 ? offset - 4096 : 0;
  const std::string before =
      ToLowerAscii(text.substr(static_cast<size_t>(from), static_cast<size_t>(offset - from)));

  if (TrailingClause(before, {" connect by ", " start with ", " prior "})) {
    cc.expect = {niuma::sqllsp::CompletionKind::Column, niuma::sqllsp::CompletionKind::Function,
                 niuma::sqllsp::CompletionKind::Routine, niuma::sqllsp::CompletionKind::Keyword,
                 niuma::sqllsp::CompletionKind::Schema};
    cc.routine_filter = "function";
  } else if (TrailingClause(before, {" over ", " over(", " partition by ", " order by ", " group by "})) {
    EnsureKinds(cc.expect, {niuma::sqllsp::CompletionKind::Column,
                            niuma::sqllsp::CompletionKind::Function,
                            niuma::sqllsp::CompletionKind::Keyword});
    cc.routine_filter = "function";
  } else if (TrailingClause(before, {" returning "})) {
    EnsureKinds(cc.expect, {niuma::sqllsp::CompletionKind::Column,
                            niuma::sqllsp::CompletionKind::Keyword,
                            niuma::sqllsp::CompletionKind::Function});
  } else if (TrailingClause(before, {" using ", " merge "})) {
    EnsureKinds(cc.expect, {niuma::sqllsp::CompletionKind::Table,
                            niuma::sqllsp::CompletionKind::Schema,
                            niuma::sqllsp::CompletionKind::Keyword});
  } else if (TrailingClause(before, {" fetch ", " fetch first ", " fetch next ", " offset "})) {
    EnsureKinds(cc.expect, {niuma::sqllsp::CompletionKind::Keyword});
  }

  return cc;
}

std::string OracleParser::QuoteIdent(const std::string& name) const {
  // 全大写安全标识符可裸名；否则双引号（Oracle 默认折叠大写）。
  if (name.empty()) return name;
  bool safe = true;
  bool all_upper_or_digit = true;
  for (size_t i = 0; i < name.size(); ++i) {
    const unsigned char c = static_cast<unsigned char>(name[i]);
    if (!(std::isalnum(c) || c == '_' || c == '$' || c == '#')) {
      safe = false;
      break;
    }
    if (std::islower(c)) all_upper_or_digit = false;
  }
  if (safe && all_upper_or_digit && std::isalpha(static_cast<unsigned char>(name[0]))) {
    return name;
  }
  if (safe && std::isalpha(static_cast<unsigned char>(name[0]))) {
    if (!all_upper_or_digit) return util::QuoteIdent(name);
    return name;
  }
  return util::QuoteIdent(name);
}

}  // namespace niuma::oracle::lsp
