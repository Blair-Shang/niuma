package mysqlparser

import (
	"regexp"
	"strings"

	"niuma/pkg/sqllsp"
)

type builtinFn struct {
	Name   string
	Insert string // 空则 Name+"()"
	Detail string
	Doc    string
}

var snippetParamRe = regexp.MustCompile(`\$\{\d+:([^}]+)\}`)

func allBuiltinDefs() []builtinFn {
	return []builtinFn{
		{Name: "NOW", Insert: "NOW()", Detail: "datetime", Doc: "当前日期时间"},
		{Name: "CURDATE", Insert: "CURDATE()", Detail: "date", Doc: "当前日期"},
		{Name: "CURTIME", Insert: "CURTIME()", Detail: "time", Doc: "当前时间"},
		{Name: "SYSDATE", Insert: "SYSDATE()", Detail: "datetime", Doc: "当前日期时间（函数调用时取值）"},
		{Name: "UTC_DATE", Insert: "UTC_DATE()", Detail: "date", Doc: "UTC 日期"},
		{Name: "UTC_TIME", Insert: "UTC_TIME()", Detail: "time", Doc: "UTC 时间"},
		{Name: "UTC_TIMESTAMP", Insert: "UTC_TIMESTAMP()", Detail: "datetime", Doc: "UTC 时间戳"},
		{Name: "DATE", Insert: "DATE(${1:expr})", Detail: "date", Doc: "提取日期部分"},
		{Name: "TIME", Insert: "TIME(${1:expr})", Detail: "time", Doc: "提取时间部分"},
		{Name: "YEAR", Insert: "YEAR(${1:date})", Detail: "int", Doc: "年份"},
		{Name: "MONTH", Insert: "MONTH(${1:date})", Detail: "int", Doc: "月份"},
		{Name: "DAY", Insert: "DAY(${1:date})", Detail: "int", Doc: "日"},
		{Name: "HOUR", Insert: "HOUR(${1:time})", Detail: "int", Doc: "小时"},
		{Name: "MINUTE", Insert: "MINUTE(${1:time})", Detail: "int", Doc: "分钟"},
		{Name: "SECOND", Insert: "SECOND(${1:time})", Detail: "int", Doc: "秒"},
		{Name: "DAYOFWEEK", Insert: "DAYOFWEEK(${1:date})", Detail: "int", Doc: "星期（1=周日）"},
		{Name: "DAYOFMONTH", Insert: "DAYOFMONTH(${1:date})", Detail: "int", Doc: "月中第几天"},
		{Name: "DAYOFYEAR", Insert: "DAYOFYEAR(${1:date})", Detail: "int", Doc: "年中第几天"},
		{Name: "WEEK", Insert: "WEEK(${1:date})", Detail: "int", Doc: "周数"},
		{Name: "QUARTER", Insert: "QUARTER(${1:date})", Detail: "int", Doc: "季度"},
		{Name: "DATE_FORMAT", Insert: "DATE_FORMAT(${1:date}, ${2:format})", Detail: "string", Doc: "按格式输出日期"},
		{Name: "TIME_FORMAT", Insert: "TIME_FORMAT(${1:time}, ${2:format})", Detail: "string", Doc: "按格式输出时间"},
		{Name: "STR_TO_DATE", Insert: "STR_TO_DATE(${1:str}, ${2:format})", Detail: "datetime", Doc: "字符串转日期"},
		{Name: "DATE_ADD", Insert: "DATE_ADD(${1:date}, INTERVAL ${2:n} ${3:UNIT})", Detail: "datetime", Doc: "日期加法"},
		{Name: "DATE_SUB", Insert: "DATE_SUB(${1:date}, INTERVAL ${2:n} ${3:UNIT})", Detail: "datetime", Doc: "日期减法"},
		{Name: "ADDDATE", Insert: "ADDDATE(${1:date}, INTERVAL ${2:n} ${3:UNIT})", Detail: "datetime", Doc: "DATE_ADD 别名"},
		{Name: "SUBDATE", Insert: "SUBDATE(${1:date}, INTERVAL ${2:n} ${3:UNIT})", Detail: "datetime", Doc: "DATE_SUB 别名"},
		{Name: "DATEDIFF", Insert: "DATEDIFF(${1:date1}, ${2:date2})", Detail: "int", Doc: "日期间隔（天）"},
		{Name: "TIMEDIFF", Insert: "TIMEDIFF(${1:time1}, ${2:time2})", Detail: "time", Doc: "时间差"},
		{Name: "TIMESTAMPDIFF", Insert: "TIMESTAMPDIFF(${1:UNIT}, ${2:datetime1}, ${3:datetime2})", Detail: "int", Doc: "按单位求时间差"},
		{Name: "TIMESTAMPADD", Insert: "TIMESTAMPADD(${1:UNIT}, ${2:interval}, ${3:datetime})", Detail: "datetime", Doc: "按单位加时间"},
		{Name: "FROM_UNIXTIME", Insert: "FROM_UNIXTIME(${1:unix_ts})", Detail: "datetime", Doc: "Unix 时间戳转日期"},
		{Name: "UNIX_TIMESTAMP", Insert: "UNIX_TIMESTAMP(${1:datetime})", Detail: "int", Doc: "转 Unix 时间戳"},
		{Name: "LAST_DAY", Insert: "LAST_DAY(${1:date})", Detail: "date", Doc: "月末日期"},
		{Name: "EXTRACT", Insert: "EXTRACT(${1:UNIT} FROM ${2:date})", Detail: "int", Doc: "提取日期部分"},
		{Name: "CONVERT_TZ", Insert: "CONVERT_TZ(${1:dt}, ${2:from_tz}, ${3:to_tz})", Detail: "datetime", Doc: "时区转换"},
		{Name: "CONCAT", Insert: "CONCAT(${1:str1}, ${2:str2})", Detail: "string", Doc: "字符串连接"},
		{Name: "CONCAT_WS", Insert: "CONCAT_WS(${1:separator}, ${2:str1}, ${3:str2})", Detail: "string", Doc: "带分隔符连接"},
		{Name: "SUBSTRING", Insert: "SUBSTRING(${1:str}, ${2:pos}, ${3:len})", Detail: "string", Doc: "子串"},
		{Name: "SUBSTR", Insert: "SUBSTR(${1:str}, ${2:pos}, ${3:len})", Detail: "string", Doc: "SUBSTRING 别名"},
		{Name: "LEFT", Insert: "LEFT(${1:str}, ${2:len})", Detail: "string", Doc: "左侧子串"},
		{Name: "RIGHT", Insert: "RIGHT(${1:str}, ${2:len})", Detail: "string", Doc: "右侧子串"},
		{Name: "LENGTH", Insert: "LENGTH(${1:str})", Detail: "int", Doc: "字节长度"},
		{Name: "CHAR_LENGTH", Insert: "CHAR_LENGTH(${1:str})", Detail: "int", Doc: "字符长度"},
		{Name: "CHARACTER_LENGTH", Insert: "CHARACTER_LENGTH(${1:str})", Detail: "int", Doc: "CHAR_LENGTH 别名"},
		{Name: "LOWER", Insert: "LOWER(${1:str})", Detail: "string", Doc: "转小写"},
		{Name: "UPPER", Insert: "UPPER(${1:str})", Detail: "string", Doc: "转大写"},
		{Name: "LCASE", Insert: "LCASE(${1:str})", Detail: "string", Doc: "LOWER 别名"},
		{Name: "UCASE", Insert: "UCASE(${1:str})", Detail: "string", Doc: "UPPER 别名"},
		{Name: "TRIM", Insert: "TRIM(${1:str})", Detail: "string", Doc: "去两端空白"},
		{Name: "LTRIM", Insert: "LTRIM(${1:str})", Detail: "string", Doc: "去左空白"},
		{Name: "RTRIM", Insert: "RTRIM(${1:str})", Detail: "string", Doc: "去右空白"},
		{Name: "REPLACE", Insert: "REPLACE(${1:str}, ${2:from}, ${3:to})", Detail: "string", Doc: "替换子串"},
		{Name: "INSERT", Insert: "INSERT(${1:str}, ${2:pos}, ${3:len}, ${4:newstr})", Detail: "string", Doc: "插入替换子串"},
		{Name: "LOCATE", Insert: "LOCATE(${1:substr}, ${2:str})", Detail: "int", Doc: "子串位置"},
		{Name: "POSITION", Insert: "POSITION(${1:substr} IN ${2:str})", Detail: "int", Doc: "子串位置"},
		{Name: "INSTR", Insert: "INSTR(${1:str}, ${2:substr})", Detail: "int", Doc: "子串位置"},
		{Name: "LPAD", Insert: "LPAD(${1:str}, ${2:len}, ${3:pad})", Detail: "string", Doc: "左侧填充"},
		{Name: "RPAD", Insert: "RPAD(${1:str}, ${2:len}, ${3:pad})", Detail: "string", Doc: "右侧填充"},
		{Name: "REPEAT", Insert: "REPEAT(${1:str}, ${2:count})", Detail: "string", Doc: "重复字符串"},
		{Name: "REVERSE", Insert: "REVERSE(${1:str})", Detail: "string", Doc: "反转字符串"},
		{Name: "SPACE", Insert: "SPACE(${1:n})", Detail: "string", Doc: "空格串"},
		{Name: "SUBSTRING_INDEX", Insert: "SUBSTRING_INDEX(${1:str}, ${2:delim}, ${3:count})", Detail: "string", Doc: "按分隔符截取"},
		{Name: "FORMAT", Insert: "FORMAT(${1:num}, ${2:decimals})", Detail: "string", Doc: "千分位格式化"},
		{Name: "ELT", Insert: "ELT(${1:n}, ${2:str1}, ${3:str2})", Detail: "string", Doc: "按索引取串"},
		{Name: "FIELD", Insert: "FIELD(${1:str}, ${2:str1}, ${3:str2})", Detail: "int", Doc: "串在列表中的位置"},
		{Name: "FIND_IN_SET", Insert: "FIND_IN_SET(${1:str}, ${2:list})", Detail: "int", Doc: "在逗号列表中查找"},
		{Name: "GROUP_CONCAT", Insert: "GROUP_CONCAT(${1:expr})", Detail: "string", Doc: "组内连接"},
		{Name: "HEX", Insert: "HEX(${1:str})", Detail: "string", Doc: "十六进制"},
		{Name: "UNHEX", Insert: "UNHEX(${1:hex})", Detail: "string", Doc: "十六进制解码"},
		{Name: "ASCII", Insert: "ASCII(${1:str})", Detail: "int", Doc: "首字符 ASCII"},
		{Name: "ORD", Insert: "ORD(${1:str})", Detail: "int", Doc: "字符码点"},
		{Name: "CHAR", Insert: "CHAR(${1:n})", Detail: "string", Doc: "码点转字符"},
		{Name: "SOUNDEX", Insert: "SOUNDEX(${1:str})", Detail: "string", Doc: "语音编码"},
		{Name: "IFNULL", Insert: "IFNULL(${1:expr}, ${2:alt})", Detail: "any", Doc: "空则替换"},
		{Name: "COALESCE", Insert: "COALESCE(${1:expr1}, ${2:expr2})", Detail: "any", Doc: "首个非 NULL"},
		{Name: "NULLIF", Insert: "NULLIF(${1:a}, ${2:b})", Detail: "any", Doc: "相等则 NULL"},
		{Name: "IF", Insert: "IF(${1:cond}, ${2:true_val}, ${3:false_val})", Detail: "any", Doc: "条件表达式"},
		{Name: "ISNULL", Insert: "ISNULL(${1:expr})", Detail: "int", Doc: "是否为 NULL"},
		{Name: "GREATEST", Insert: "GREATEST(${1:a}, ${2:b})", Detail: "any", Doc: "最大值"},
		{Name: "LEAST", Insert: "LEAST(${1:a}, ${2:b})", Detail: "any", Doc: "最小值"},
		{Name: "ABS", Insert: "ABS(${1:n})", Detail: "number", Doc: "绝对值"},
		{Name: "CEIL", Insert: "CEIL(${1:n})", Detail: "number", Doc: "向上取整"},
		{Name: "CEILING", Insert: "CEILING(${1:n})", Detail: "number", Doc: "向上取整"},
		{Name: "FLOOR", Insert: "FLOOR(${1:n})", Detail: "number", Doc: "向下取整"},
		{Name: "ROUND", Insert: "ROUND(${1:n}, ${2:decimals})", Detail: "number", Doc: "四舍五入"},
		{Name: "TRUNCATE", Insert: "TRUNCATE(${1:n}, ${2:decimals})", Detail: "number", Doc: "截断小数"},
		{Name: "MOD", Insert: "MOD(${1:n}, ${2:m})", Detail: "number", Doc: "取模"},
		{Name: "POW", Insert: "POW(${1:x}, ${2:y})", Detail: "number", Doc: "幂"},
		{Name: "POWER", Insert: "POWER(${1:x}, ${2:y})", Detail: "number", Doc: "幂"},
		{Name: "SQRT", Insert: "SQRT(${1:n})", Detail: "number", Doc: "平方根"},
		{Name: "EXP", Insert: "EXP(${1:n})", Detail: "number", Doc: "e 的幂"},
		{Name: "LN", Insert: "LN(${1:n})", Detail: "number", Doc: "自然对数"},
		{Name: "LOG", Insert: "LOG(${1:n})", Detail: "number", Doc: "对数"},
		{Name: "LOG10", Insert: "LOG10(${1:n})", Detail: "number", Doc: "常用对数"},
		{Name: "LOG2", Insert: "LOG2(${1:n})", Detail: "number", Doc: "以 2 为底"},
		{Name: "SIGN", Insert: "SIGN(${1:n})", Detail: "int", Doc: "符号"},
		{Name: "RAND", Insert: "RAND()", Detail: "float", Doc: "随机数"},
		{Name: "PI", Insert: "PI()", Detail: "float", Doc: "圆周率"},
		{Name: "CONV", Insert: "CONV(${1:n}, ${2:from_base}, ${3:to_base})", Detail: "string", Doc: "进制转换"},
		{Name: "COUNT", Insert: "COUNT(${1:expr})", Detail: "aggregate", Doc: "计数"},
		{Name: "SUM", Insert: "SUM(${1:expr})", Detail: "aggregate", Doc: "求和"},
		{Name: "AVG", Insert: "AVG(${1:expr})", Detail: "aggregate", Doc: "平均值"},
		{Name: "MAX", Insert: "MAX(${1:expr})", Detail: "aggregate", Doc: "最大值"},
		{Name: "MIN", Insert: "MIN(${1:expr})", Detail: "aggregate", Doc: "最小值"},
		{Name: "STDDEV", Insert: "STDDEV(${1:expr})", Detail: "aggregate", Doc: "标准差"},
		{Name: "VARIANCE", Insert: "VARIANCE(${1:expr})", Detail: "aggregate", Doc: "方差"},
		{Name: "BIT_AND", Insert: "BIT_AND(${1:expr})", Detail: "aggregate", Doc: "按位与聚合"},
		{Name: "BIT_OR", Insert: "BIT_OR(${1:expr})", Detail: "aggregate", Doc: "按位或聚合"},
		{Name: "BIT_XOR", Insert: "BIT_XOR(${1:expr})", Detail: "aggregate", Doc: "按位异或聚合"},
		{Name: "CAST", Insert: "CAST(${1:expr} AS ${2:type})", Detail: "any", Doc: "类型转换"},
		{Name: "CONVERT", Insert: "CONVERT(${1:expr}, ${2:type})", Detail: "any", Doc: "类型转换"},
		{Name: "BINARY", Insert: "BINARY ${1:expr}", Detail: "binary", Doc: "按二进制比较"},
		{Name: "JSON_EXTRACT", Insert: "JSON_EXTRACT(${1:json}, ${2:path})", Detail: "json", Doc: "提取 JSON"},
		{Name: "JSON_UNQUOTE", Insert: "JSON_UNQUOTE(${1:json})", Detail: "string", Doc: "去除 JSON 引号"},
		{Name: "JSON_OBJECT", Insert: "JSON_OBJECT(${1:key}, ${2:val})", Detail: "json", Doc: "构造 JSON 对象"},
		{Name: "JSON_ARRAY", Insert: "JSON_ARRAY(${1:val})", Detail: "json", Doc: "构造 JSON 数组"},
		{Name: "JSON_SET", Insert: "JSON_SET(${1:json}, ${2:path}, ${3:val})", Detail: "json", Doc: "设置 JSON 路径"},
		{Name: "JSON_INSERT", Insert: "JSON_INSERT(${1:json}, ${2:path}, ${3:val})", Detail: "json", Doc: "插入 JSON 路径"},
		{Name: "JSON_REPLACE", Insert: "JSON_REPLACE(${1:json}, ${2:path}, ${3:val})", Detail: "json", Doc: "替换 JSON 路径"},
		{Name: "JSON_REMOVE", Insert: "JSON_REMOVE(${1:json}, ${2:path})", Detail: "json", Doc: "删除 JSON 路径"},
		{Name: "JSON_CONTAINS", Insert: "JSON_CONTAINS(${1:json}, ${2:candidate})", Detail: "int", Doc: "是否包含"},
		{Name: "JSON_KEYS", Insert: "JSON_KEYS(${1:json})", Detail: "json", Doc: "对象键列表"},
		{Name: "JSON_LENGTH", Insert: "JSON_LENGTH(${1:json})", Detail: "int", Doc: "JSON 长度"},
		{Name: "JSON_TYPE", Insert: "JSON_TYPE(${1:json})", Detail: "string", Doc: "JSON 类型"},
		{Name: "JSON_VALID", Insert: "JSON_VALID(${1:str})", Detail: "int", Doc: "是否合法 JSON"},
		{Name: "JSON_SEARCH", Insert: "JSON_SEARCH(${1:json}, ${2:one_or_all}, ${3:str})", Detail: "json", Doc: "搜索 JSON"},
		{Name: "JSON_PRETTY", Insert: "JSON_PRETTY(${1:json})", Detail: "string", Doc: "格式化 JSON"},
		{Name: "JSON_QUOTE", Insert: "JSON_QUOTE(${1:str})", Detail: "json", Doc: "加引号"},
		{Name: "ROW_NUMBER", Insert: "ROW_NUMBER() OVER (${1:ORDER BY col})", Detail: "window", Doc: "行号"},
		{Name: "RANK", Insert: "RANK() OVER (${1:ORDER BY col})", Detail: "window", Doc: "排名"},
		{Name: "DENSE_RANK", Insert: "DENSE_RANK() OVER (${1:ORDER BY col})", Detail: "window", Doc: "密集排名"},
		{Name: "NTILE", Insert: "NTILE(${1:n}) OVER (${2:ORDER BY col})", Detail: "window", Doc: "分桶"},
		{Name: "LAG", Insert: "LAG(${1:expr}, ${2:offset}) OVER (${3:ORDER BY col})", Detail: "window", Doc: "上一行"},
		{Name: "LEAD", Insert: "LEAD(${1:expr}, ${2:offset}) OVER (${3:ORDER BY col})", Detail: "window", Doc: "下一行"},
		{Name: "FIRST_VALUE", Insert: "FIRST_VALUE(${1:expr}) OVER (${2:ORDER BY col})", Detail: "window", Doc: "窗口首值"},
		{Name: "LAST_VALUE", Insert: "LAST_VALUE(${1:expr}) OVER (${2:ORDER BY col})", Detail: "window", Doc: "窗口末值"},
		{Name: "NTH_VALUE", Insert: "NTH_VALUE(${1:expr}, ${2:n}) OVER (${3:ORDER BY col})", Detail: "window", Doc: "窗口第 n 值"},
		{Name: "DATABASE", Insert: "DATABASE()", Detail: "string", Doc: "当前库名"},
		{Name: "SCHEMA", Insert: "SCHEMA()", Detail: "string", Doc: "当前 schema"},
		{Name: "USER", Insert: "USER()", Detail: "string", Doc: "当前用户"},
		{Name: "CURRENT_USER", Insert: "CURRENT_USER()", Detail: "string", Doc: "当前用户"},
		{Name: "SESSION_USER", Insert: "SESSION_USER()", Detail: "string", Doc: "会话用户"},
		{Name: "SYSTEM_USER", Insert: "SYSTEM_USER()", Detail: "string", Doc: "系统用户"},
		{Name: "VERSION", Insert: "VERSION()", Detail: "string", Doc: "服务器版本"},
		{Name: "CONNECTION_ID", Insert: "CONNECTION_ID()", Detail: "int", Doc: "连接 ID"},
		{Name: "LAST_INSERT_ID", Insert: "LAST_INSERT_ID()", Detail: "int", Doc: "最近自增 ID"},
		{Name: "ROW_COUNT", Insert: "ROW_COUNT()", Detail: "int", Doc: "影响行数"},
		{Name: "FOUND_ROWS", Insert: "FOUND_ROWS()", Detail: "int", Doc: "FOUND_ROWS"},
		{Name: "UUID", Insert: "UUID()", Detail: "string", Doc: "生成 UUID"},
		{Name: "UUID_SHORT", Insert: "UUID_SHORT()", Detail: "int", Doc: "短 UUID"},
		{Name: "MD5", Insert: "MD5(${1:str})", Detail: "string", Doc: "MD5 摘要"},
		{Name: "SHA1", Insert: "SHA1(${1:str})", Detail: "string", Doc: "SHA1 摘要"},
		{Name: "SHA2", Insert: "SHA2(${1:str}, ${2:bits})", Detail: "string", Doc: "SHA2 摘要"},
		{Name: "CRC32", Insert: "CRC32(${1:str})", Detail: "int", Doc: "CRC32"},
		{Name: "INET_ATON", Insert: "INET_ATON(${1:ip})", Detail: "int", Doc: "IP 转数值"},
		{Name: "INET_NTOA", Insert: "INET_NTOA(${1:n})", Detail: "string", Doc: "数值转 IP"},
		{Name: "SLEEP", Insert: "SLEEP(${1:seconds})", Detail: "int", Doc: "休眠秒数"},
		{Name: "BENCHMARK", Insert: "BENCHMARK(${1:count}, ${2:expr})", Detail: "int", Doc: "重复执行计时"},
	}
}

// mysqlBuiltinFunctionNames 内置函数名列表（去重，供 Monarch / lexicon）。
func mysqlBuiltinFunctionNames() []string {
	defs := allBuiltinDefs()
	out := make([]string, 0, len(defs))
	seen := map[string]struct{}{}
	for _, d := range defs {
		key := strings.ToUpper(d.Name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, d.Name)
	}
	return out
}

// mysqlBuiltinFunctions 常用内置函数补全（带参数占位片段）。
func mysqlBuiltinFunctions() []sqllsp.CompletionItem {
	defs := allBuiltinDefs()
	out := make([]sqllsp.CompletionItem, 0, len(defs))
	seen := map[string]struct{}{}
	for _, d := range defs {
		if _, ok := seen[d.Name]; ok {
			continue
		}
		seen[d.Name] = struct{}{}
		insert := d.Insert
		if insert == "" {
			insert = d.Name + "()"
		}
		detail := d.Detail
		if detail == "" {
			detail = "function"
		}
		out = append(out, sqllsp.CompletionItem{
			Label:         d.Name,
			Kind:          sqllsp.LSPKindFunction,
			Detail:        detail,
			Documentation: d.Doc,
			InsertText:    insert,
			SortText:      "0f_" + d.Name,
		})
	}
	return out
}

// BuiltinSignature 实现 sqllsp.BuiltinSignatureProvider。
func (p *Parser) BuiltinSignature(name string) *sqllsp.SignatureInformation {
	return lookupBuiltinSignature(name)
}

// QuoteIdent 实现 sqllsp.IdentifierQuoter（MySQL 反引号）。
func (p *Parser) QuoteIdent(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return name
	}
	needs := false
	for i, r := range name {
		if i == 0 {
			if !(r == '_' || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z')) {
				needs = true
				break
			}
			continue
		}
		if r == '_' || r == '$' || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			continue
		}
		needs = true
		break
	}
	if !needs {
		return name
	}
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}

func lookupBuiltinSignature(name string) *sqllsp.SignatureInformation {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	for _, d := range allBuiltinDefs() {
		if !strings.EqualFold(d.Name, name) {
			continue
		}
		insert := d.Insert
		if insert == "" {
			insert = d.Name + "()"
		}
		params := paramsFromInsert(insert)
		parts := make([]string, 0, len(params))
		infos := make([]sqllsp.ParameterInformation, 0, len(params))
		for _, label := range params {
			parts = append(parts, label)
			infos = append(infos, sqllsp.ParameterInformation{Label: label})
		}
		label := d.Name + "(" + strings.Join(parts, ", ") + ")"
		doc := d.Doc
		if d.Detail != "" {
			if doc != "" {
				doc = d.Detail + " — " + doc
			} else {
				doc = d.Detail
			}
		}
		return &sqllsp.SignatureInformation{
			Label:         label,
			Documentation: doc,
			Parameters:    infos,
		}
	}
	return nil
}

func paramsFromInsert(insert string) []string {
	matches := snippetParamRe.FindAllStringSubmatch(insert, -1)
	if len(matches) == 0 {
		return nil
	}
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		label := strings.TrimSpace(m[1])
		if label == "" {
			continue
		}
		out = append(out, label)
	}
	return out
}
