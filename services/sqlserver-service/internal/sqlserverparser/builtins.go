package sqlserverparser

import (
	"regexp"
	"strings"

	"niuma/pkg/sqllsp"
)

type builtinFn struct {
	Name   string
	Insert string
	Detail string
	Doc    string
}

var snippetParamRe = regexp.MustCompile(`\$\{\d+:([^}]+)\}`)

func allBuiltinDefs() []builtinFn {
	return []builtinFn{
		// —— 聚合 ——
		{Name: "COUNT", Insert: "COUNT(${1:*})", Detail: "aggregate", Doc: "计数"},
		{Name: "COUNT_BIG", Insert: "COUNT_BIG(${1:*})", Detail: "aggregate", Doc: "大计数"},
		{Name: "SUM", Insert: "SUM(${1:expr})", Detail: "aggregate", Doc: "求和"},
		{Name: "AVG", Insert: "AVG(${1:expr})", Detail: "aggregate", Doc: "平均"},
		{Name: "MIN", Insert: "MIN(${1:expr})", Detail: "aggregate", Doc: "最小"},
		{Name: "MAX", Insert: "MAX(${1:expr})", Detail: "aggregate", Doc: "最大"},
		{Name: "STDEV", Insert: "STDEV(${1:expr})", Detail: "aggregate", Doc: "样本标准差"},
		{Name: "STDEVP", Insert: "STDEVP(${1:expr})", Detail: "aggregate", Doc: "总体标准差"},
		{Name: "VAR", Insert: "VAR(${1:expr})", Detail: "aggregate", Doc: "样本方差"},
		{Name: "VARP", Insert: "VARP(${1:expr})", Detail: "aggregate", Doc: "总体方差"},
		{Name: "CHECKSUM_AGG", Insert: "CHECKSUM_AGG(${1:expr})", Detail: "aggregate", Doc: "校验和聚合"},
		{Name: "GROUPING", Insert: "GROUPING(${1:expr})", Detail: "aggregate", Doc: "GROUPING"},
		{Name: "GROUPING_ID", Insert: "GROUPING_ID(${1:cols})", Detail: "aggregate", Doc: "GROUPING_ID"},
		{Name: "STRING_AGG", Insert: "STRING_AGG(${1:expr}, '${2:,}')", Detail: "aggregate", Doc: "字符串聚合"},
		{Name: "APPROX_COUNT_DISTINCT", Insert: "APPROX_COUNT_DISTINCT(${1:expr})", Detail: "aggregate", Doc: "近似去重计数"},

		// —— 窗口 ——
		{Name: "ROW_NUMBER", Insert: "ROW_NUMBER() OVER (${1:ORDER BY col})", Detail: "window", Doc: "行号"},
		{Name: "RANK", Insert: "RANK() OVER (${1:ORDER BY col})", Detail: "window", Doc: "排名"},
		{Name: "DENSE_RANK", Insert: "DENSE_RANK() OVER (${1:ORDER BY col})", Detail: "window", Doc: "密集排名"},
		{Name: "NTILE", Insert: "NTILE(${1:n}) OVER (${2:ORDER BY col})", Detail: "window", Doc: "分桶"},
		{Name: "LAG", Insert: "LAG(${1:expr}, ${2:1}) OVER (${3:ORDER BY col})", Detail: "window", Doc: "上一行"},
		{Name: "LEAD", Insert: "LEAD(${1:expr}, ${2:1}) OVER (${3:ORDER BY col})", Detail: "window", Doc: "下一行"},
		{Name: "FIRST_VALUE", Insert: "FIRST_VALUE(${1:expr}) OVER (${2:ORDER BY col})", Detail: "window", Doc: "窗口首值"},
		{Name: "LAST_VALUE", Insert: "LAST_VALUE(${1:expr}) OVER (${2:ORDER BY col})", Detail: "window", Doc: "窗口末值"},
		{Name: "NTH_VALUE", Insert: "NTH_VALUE(${1:expr}, ${2:n}) OVER (${3:ORDER BY col})", Detail: "window", Doc: "窗口第 n 值"},
		{Name: "CUME_DIST", Insert: "CUME_DIST() OVER (${1:ORDER BY col})", Detail: "window", Doc: "累积分布"},
		{Name: "PERCENT_RANK", Insert: "PERCENT_RANK() OVER (${1:ORDER BY col})", Detail: "window", Doc: "百分位排名"},
		{Name: "PERCENTILE_CONT", Insert: "PERCENTILE_CONT(${1:0.5}) WITHIN GROUP (ORDER BY ${2:col})", Detail: "window", Doc: "连续百分位"},
		{Name: "PERCENTILE_DISC", Insert: "PERCENTILE_DISC(${1:0.5}) WITHIN GROUP (ORDER BY ${2:col})", Detail: "window", Doc: "离散百分位"},

		// —— 字符串 ——
		{Name: "LEN", Insert: "LEN(${1:str})", Detail: "int", Doc: "字符长度"},
		{Name: "DATALENGTH", Insert: "DATALENGTH(${1:expr})", Detail: "int", Doc: "字节长度"},
		{Name: "LEFT", Insert: "LEFT(${1:str}, ${2:n})", Detail: "string", Doc: "左截取"},
		{Name: "RIGHT", Insert: "RIGHT(${1:str}, ${2:n})", Detail: "string", Doc: "右截取"},
		{Name: "SUBSTRING", Insert: "SUBSTRING(${1:str}, ${2:start}, ${3:len})", Detail: "string", Doc: "子串"},
		{Name: "CHARINDEX", Insert: "CHARINDEX(${1:substr}, ${2:str})", Detail: "int", Doc: "子串位置"},
		{Name: "PATINDEX", Insert: "PATINDEX('${1:%pattern%}', ${2:str})", Detail: "int", Doc: "模式位置"},
		{Name: "REPLACE", Insert: "REPLACE(${1:str}, ${2:old}, ${3:new})", Detail: "string", Doc: "替换"},
		{Name: "STUFF", Insert: "STUFF(${1:str}, ${2:start}, ${3:len}, ${4:replace})", Detail: "string", Doc: "插入/删除"},
		{Name: "CONCAT", Insert: "CONCAT(${1:a}, ${2:b})", Detail: "string", Doc: "连接"},
		{Name: "CONCAT_WS", Insert: "CONCAT_WS('${1:,}', ${2:a}, ${3:b})", Detail: "string", Doc: "分隔连接"},
		{Name: "UPPER", Insert: "UPPER(${1:str})", Detail: "string", Doc: "大写"},
		{Name: "LOWER", Insert: "LOWER(${1:str})", Detail: "string", Doc: "小写"},
		{Name: "LTRIM", Insert: "LTRIM(${1:str})", Detail: "string", Doc: "去左空白"},
		{Name: "RTRIM", Insert: "RTRIM(${1:str})", Detail: "string", Doc: "去右空白"},
		{Name: "TRIM", Insert: "TRIM(${1:str})", Detail: "string", Doc: "去两端空白"},
		{Name: "REVERSE", Insert: "REVERSE(${1:str})", Detail: "string", Doc: "反转"},
		{Name: "REPLICATE", Insert: "REPLICATE(${1:str}, ${2:n})", Detail: "string", Doc: "重复"},
		{Name: "SPACE", Insert: "SPACE(${1:n})", Detail: "string", Doc: "空格串"},
		{Name: "CHAR", Insert: "CHAR(${1:n})", Detail: "string", Doc: "ASCII 字符"},
		{Name: "NCHAR", Insert: "NCHAR(${1:n})", Detail: "string", Doc: "Unicode 字符"},
		{Name: "ASCII", Insert: "ASCII(${1:ch})", Detail: "int", Doc: "ASCII 码"},
		{Name: "UNICODE", Insert: "UNICODE(${1:ch})", Detail: "int", Doc: "Unicode 码"},
		{Name: "SOUNDEX", Insert: "SOUNDEX(${1:str})", Detail: "string", Doc: "语音码"},
		{Name: "DIFFERENCE", Insert: "DIFFERENCE(${1:a}, ${2:b})", Detail: "int", Doc: "SOUNDEX 差异"},
		{Name: "FORMAT", Insert: "FORMAT(${1:value}, '${2:format}')", Detail: "string", Doc: "格式化"},
		{Name: "QUOTENAME", Insert: "QUOTENAME(${1:str})", Detail: "string", Doc: "方括号引用"},
		{Name: "STR", Insert: "STR(${1:num}, ${2:len}, ${3:dec})", Detail: "string", Doc: "数值转串"},
		{Name: "STRING_SPLIT", Insert: "STRING_SPLIT(${1:str}, '${2:,}')", Detail: "table", Doc: "拆分字符串"},
		{Name: "STRING_ESCAPE", Insert: "STRING_ESCAPE(${1:str}, 'json')", Detail: "string", Doc: "转义"},
		{Name: "TRANSLATE", Insert: "TRANSLATE(${1:str}, ${2:from}, ${3:to})", Detail: "string", Doc: "字符映射"},

		// —— 日期时间 ——
		{Name: "GETDATE", Insert: "GETDATE()", Detail: "datetime", Doc: "当前本地时间"},
		{Name: "GETUTCDATE", Insert: "GETUTCDATE()", Detail: "datetime", Doc: "当前 UTC"},
		{Name: "SYSDATETIME", Insert: "SYSDATETIME()", Detail: "datetime2", Doc: "高精度本地时间"},
		{Name: "SYSUTCDATETIME", Insert: "SYSUTCDATETIME()", Detail: "datetime2", Doc: "高精度 UTC"},
		{Name: "SYSDATETIMEOFFSET", Insert: "SYSDATETIMEOFFSET()", Detail: "datetimeoffset", Doc: "带时区当前时间"},
		{Name: "CURRENT_TIMESTAMP", Insert: "CURRENT_TIMESTAMP", Detail: "datetime", Doc: "当前时间戳"},
		{Name: "DATEADD", Insert: "DATEADD(${1:day}, ${2:n}, ${3:date})", Detail: "datetime", Doc: "日期加"},
		{Name: "DATEDIFF", Insert: "DATEDIFF(${1:day}, ${2:start}, ${3:end})", Detail: "int", Doc: "日期差"},
		{Name: "DATEDIFF_BIG", Insert: "DATEDIFF_BIG(${1:second}, ${2:start}, ${3:end})", Detail: "bigint", Doc: "大日期差"},
		{Name: "DATEPART", Insert: "DATEPART(${1:year}, ${2:date})", Detail: "int", Doc: "日期部分"},
		{Name: "DATENAME", Insert: "DATENAME(${1:month}, ${2:date})", Detail: "string", Doc: "日期部分名"},
		{Name: "YEAR", Insert: "YEAR(${1:date})", Detail: "int", Doc: "年"},
		{Name: "MONTH", Insert: "MONTH(${1:date})", Detail: "int", Doc: "月"},
		{Name: "DAY", Insert: "DAY(${1:date})", Detail: "int", Doc: "日"},
		{Name: "EOMONTH", Insert: "EOMONTH(${1:date})", Detail: "date", Doc: "月末"},
		{Name: "DATEFROMPARTS", Insert: "DATEFROMPARTS(${1:y}, ${2:m}, ${3:d})", Detail: "date", Doc: "组合日期"},
		{Name: "DATETIMEFROMPARTS", Insert: "DATETIMEFROMPARTS(${1:y}, ${2:m}, ${3:d}, ${4:h}, ${5:mi}, ${6:s}, ${7:ms})", Detail: "datetime", Doc: "组合 datetime"},
		{Name: "DATETIME2FROMPARTS", Insert: "DATETIME2FROMPARTS(${1:y}, ${2:m}, ${3:d}, ${4:h}, ${5:mi}, ${6:s}, ${7:f}, ${8:p})", Detail: "datetime2", Doc: "组合 datetime2"},
		{Name: "TIMEFROMPARTS", Insert: "TIMEFROMPARTS(${1:h}, ${2:mi}, ${3:s}, ${4:f}, ${5:p})", Detail: "time", Doc: "组合 time"},
		{Name: "SWITCHOFFSET", Insert: "SWITCHOFFSET(${1:dto}, '${2:+00:00}')", Detail: "datetimeoffset", Doc: "切换时区偏移"},
		{Name: "TODATETIMEOFFSET", Insert: "TODATETIMEOFFSET(${1:dt}, '${2:+00:00}')", Detail: "datetimeoffset", Doc: "附加偏移"},
		{Name: "ISDATE", Insert: "ISDATE(${1:expr})", Detail: "int", Doc: "是否合法日期"},

		// —— 数学 ——
		{Name: "ABS", Insert: "ABS(${1:n})", Detail: "number", Doc: "绝对值"},
		{Name: "CEILING", Insert: "CEILING(${1:n})", Detail: "number", Doc: "向上取整"},
		{Name: "FLOOR", Insert: "FLOOR(${1:n})", Detail: "number", Doc: "向下取整"},
		{Name: "ROUND", Insert: "ROUND(${1:n}, ${2:digits})", Detail: "number", Doc: "四舍五入"},
		{Name: "POWER", Insert: "POWER(${1:n}, ${2:p})", Detail: "number", Doc: "幂"},
		{Name: "SQRT", Insert: "SQRT(${1:n})", Detail: "float", Doc: "平方根"},
		{Name: "SQUARE", Insert: "SQUARE(${1:n})", Detail: "number", Doc: "平方"},
		{Name: "EXP", Insert: "EXP(${1:n})", Detail: "float", Doc: "e 的幂"},
		{Name: "LOG", Insert: "LOG(${1:n})", Detail: "float", Doc: "自然对数"},
		{Name: "LOG10", Insert: "LOG10(${1:n})", Detail: "float", Doc: "常用对数"},
		{Name: "SIGN", Insert: "SIGN(${1:n})", Detail: "int", Doc: "符号"},
		{Name: "RAND", Insert: "RAND()", Detail: "float", Doc: "随机数"},
		{Name: "PI", Insert: "PI()", Detail: "float", Doc: "圆周率"},
		{Name: "DEGREES", Insert: "DEGREES(${1:rad})", Detail: "float", Doc: "弧度转角度"},
		{Name: "RADIANS", Insert: "RADIANS(${1:deg})", Detail: "float", Doc: "角度转弧度"},
		{Name: "SIN", Insert: "SIN(${1:n})", Detail: "float", Doc: "正弦"},
		{Name: "COS", Insert: "COS(${1:n})", Detail: "float", Doc: "余弦"},
		{Name: "TAN", Insert: "TAN(${1:n})", Detail: "float", Doc: "正切"},
		{Name: "ASIN", Insert: "ASIN(${1:n})", Detail: "float", Doc: "反正弦"},
		{Name: "ACOS", Insert: "ACOS(${1:n})", Detail: "float", Doc: "反余弦"},
		{Name: "ATAN", Insert: "ATAN(${1:n})", Detail: "float", Doc: "反正切"},
		{Name: "ATN2", Insert: "ATN2(${1:y}, ${2:x})", Detail: "float", Doc: "反正切 2"},
		{Name: "COT", Insert: "COT(${1:n})", Detail: "float", Doc: "余切"},

		// —— 转换 / 类型 ——
		{Name: "CAST", Insert: "CAST(${1:expr} AS ${2:type})", Detail: "any", Doc: "类型转换"},
		{Name: "CONVERT", Insert: "CONVERT(${1:type}, ${2:expr})", Detail: "any", Doc: "类型转换"},
		{Name: "TRY_CAST", Insert: "TRY_CAST(${1:expr} AS ${2:type})", Detail: "any", Doc: "安全转换"},
		{Name: "TRY_CONVERT", Insert: "TRY_CONVERT(${1:type}, ${2:expr})", Detail: "any", Doc: "安全转换"},
		{Name: "PARSE", Insert: "PARSE(${1:str} AS ${2:type})", Detail: "any", Doc: "解析"},
		{Name: "TRY_PARSE", Insert: "TRY_PARSE(${1:str} AS ${2:type})", Detail: "any", Doc: "安全解析"},
		{Name: "COALESCE", Insert: "COALESCE(${1:a}, ${2:b})", Detail: "any", Doc: "首个非 NULL"},
		{Name: "NULLIF", Insert: "NULLIF(${1:a}, ${2:b})", Detail: "any", Doc: "相等则 NULL"},
		{Name: "IIF", Insert: "IIF(${1:cond}, ${2:true}, ${3:false})", Detail: "any", Doc: "内联 IF"},
		{Name: "CHOOSE", Insert: "CHOOSE(${1:index}, ${2:a}, ${3:b})", Detail: "any", Doc: "按索引选取"},
		{Name: "ISNULL", Insert: "ISNULL(${1:expr}, ${2:replacement})", Detail: "any", Doc: "NULL 替换"},
		{Name: "ISNUMERIC", Insert: "ISNUMERIC(${1:expr})", Detail: "int", Doc: "是否数值"},
		{Name: "ISJSON", Insert: "ISJSON(${1:expr})", Detail: "int", Doc: "是否 JSON"},

		// —— JSON ——
		{Name: "JSON_VALUE", Insert: "JSON_VALUE(${1:json}, '$.${2:path}')", Detail: "string", Doc: "取标量"},
		{Name: "JSON_QUERY", Insert: "JSON_QUERY(${1:json}, '$.${2:path}')", Detail: "json", Doc: "取对象/数组"},
		{Name: "JSON_MODIFY", Insert: "JSON_MODIFY(${1:json}, '$.${2:path}', ${3:value})", Detail: "json", Doc: "修改 JSON"},
		{Name: "JSON_PATH_EXISTS", Insert: "JSON_PATH_EXISTS(${1:json}, '$.${2:path}')", Detail: "bit", Doc: "路径是否存在"},
		{Name: "OPENJSON", Insert: "OPENJSON(${1:json})", Detail: "table", Doc: "展开 JSON"},

		// —— 系统 / 会话 ——
		{Name: "DB_NAME", Insert: "DB_NAME()", Detail: "string", Doc: "当前库名"},
		{Name: "DB_ID", Insert: "DB_ID()", Detail: "int", Doc: "当前库 ID"},
		{Name: "SCHEMA_NAME", Insert: "SCHEMA_NAME()", Detail: "string", Doc: "当前 schema"},
		{Name: "SCHEMA_ID", Insert: "SCHEMA_ID()", Detail: "int", Doc: "当前 schema ID"},
		{Name: "OBJECT_ID", Insert: "OBJECT_ID('${1:schema.object}')", Detail: "int", Doc: "对象 ID"},
		{Name: "OBJECT_NAME", Insert: "OBJECT_NAME(${1:object_id})", Detail: "string", Doc: "对象名"},
		{Name: "OBJECT_SCHEMA_NAME", Insert: "OBJECT_SCHEMA_NAME(${1:object_id})", Detail: "string", Doc: "对象 schema"},
		{Name: "COL_NAME", Insert: "COL_NAME(${1:table_id}, ${2:column_id})", Detail: "string", Doc: "列名"},
		{Name: "COL_LENGTH", Insert: "COL_LENGTH('${1:table}', '${2:column}')", Detail: "int", Doc: "列长度"},
		{Name: "TYPE_NAME", Insert: "TYPE_NAME(${1:type_id})", Detail: "string", Doc: "类型名"},
		{Name: "TYPE_ID", Insert: "TYPE_ID('${1:type}')", Detail: "int", Doc: "类型 ID"},
		{Name: "USER_NAME", Insert: "USER_NAME()", Detail: "string", Doc: "数据库用户"},
		{Name: "SUSER_SNAME", Insert: "SUSER_SNAME()", Detail: "string", Doc: "登录名"},
		{Name: "SUSER_SID", Insert: "SUSER_SID()", Detail: "varbinary", Doc: "登录 SID"},
		{Name: "SYSTEM_USER", Insert: "SYSTEM_USER", Detail: "string", Doc: "系统用户"},
		{Name: "SESSION_USER", Insert: "SESSION_USER", Detail: "string", Doc: "会话用户"},
		{Name: "CURRENT_USER", Insert: "CURRENT_USER", Detail: "string", Doc: "当前用户"},
		{Name: "ORIGINAL_LOGIN", Insert: "ORIGINAL_LOGIN()", Detail: "string", Doc: "原始登录"},
		{Name: "HOST_NAME", Insert: "HOST_NAME()", Detail: "string", Doc: "客户端主机"},
		{Name: "APP_NAME", Insert: "APP_NAME()", Detail: "string", Doc: "应用程序名"},
		{Name: "@@VERSION", Insert: "@@VERSION", Detail: "string", Doc: "服务器版本"},
		{Name: "@@SERVERNAME", Insert: "@@SERVERNAME", Detail: "string", Doc: "服务器名"},
		{Name: "@@SERVICENAME", Insert: "@@SERVICENAME", Detail: "string", Doc: "实例服务名"},
		{Name: "@@SPID", Insert: "@@SPID", Detail: "int", Doc: "会话 ID"},
		{Name: "@@ROWCOUNT", Insert: "@@ROWCOUNT", Detail: "int", Doc: "影响行数"},
		{Name: "@@IDENTITY", Insert: "@@IDENTITY", Detail: "numeric", Doc: "最近标识值"},
		{Name: "SCOPE_IDENTITY", Insert: "SCOPE_IDENTITY()", Detail: "numeric", Doc: "作用域标识值"},
		{Name: "IDENT_CURRENT", Insert: "IDENT_CURRENT('${1:table}')", Detail: "numeric", Doc: "表当前标识"},
		{Name: "NEWID", Insert: "NEWID()", Detail: "uniqueidentifier", Doc: "新 GUID"},
		{Name: "NEWSEQUENTIALID", Insert: "NEWSEQUENTIALID()", Detail: "uniqueidentifier", Doc: "顺序 GUID"},
		{Name: "ERROR_NUMBER", Insert: "ERROR_NUMBER()", Detail: "int", Doc: "错误号"},
		{Name: "ERROR_MESSAGE", Insert: "ERROR_MESSAGE()", Detail: "string", Doc: "错误消息"},
		{Name: "ERROR_SEVERITY", Insert: "ERROR_SEVERITY()", Detail: "int", Doc: "错误严重级别"},
		{Name: "ERROR_STATE", Insert: "ERROR_STATE()", Detail: "int", Doc: "错误状态"},
		{Name: "ERROR_LINE", Insert: "ERROR_LINE()", Detail: "int", Doc: "错误行"},
		{Name: "ERROR_PROCEDURE", Insert: "ERROR_PROCEDURE()", Detail: "string", Doc: "错误过程"},
		{Name: "XACT_STATE", Insert: "XACT_STATE()", Detail: "int", Doc: "事务状态"},
		{Name: "HAS_PERMS_BY_NAME", Insert: "HAS_PERMS_BY_NAME('${1:securable}', '${2:securable_class}', '${3:permission}')", Detail: "int", Doc: "权限检查"},

		// —— 校验 / 哈希 ——
		{Name: "CHECKSUM", Insert: "CHECKSUM(${1:expr})", Detail: "int", Doc: "校验和"},
		{Name: "BINARY_CHECKSUM", Insert: "BINARY_CHECKSUM(${1:expr})", Detail: "int", Doc: "二进制校验和"},
		{Name: "HASHBYTES", Insert: "HASHBYTES('${1:SHA2_256}', ${2:expr})", Detail: "varbinary", Doc: "哈希"},
		{Name: "COMPRESS", Insert: "COMPRESS(${1:expr})", Detail: "varbinary", Doc: "压缩"},
		{Name: "DECOMPRESS", Insert: "DECOMPRESS(${1:expr})", Detail: "varbinary", Doc: "解压"},
	}
}

func sqlServerBuiltinFunctionNames() []string {
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

func sqlServerBuiltinFunctions() []sqllsp.CompletionItem {
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
