package dmparser

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

// dmNativeBuiltins 达梦原生常用函数（各兼容模式均可用）。
func dmNativeBuiltins() []builtinFn {
	return []builtinFn{
		{Name: "NVL", Insert: "NVL(${1:expr}, ${2:alt})", Detail: "any", Doc: "空则替换"},
		{Name: "NVL2", Insert: "NVL2(${1:expr}, ${2:not_null}, ${3:is_null})", Detail: "any", Doc: "按是否为空二选一"},
		{Name: "DECODE", Insert: "DECODE(${1:expr}, ${2:search}, ${3:result})", Detail: "any", Doc: "条件等值映射"},
		{Name: "COALESCE", Insert: "COALESCE(${1:expr1}, ${2:expr2})", Detail: "any", Doc: "首个非 NULL"},
		{Name: "NULLIF", Insert: "NULLIF(${1:a}, ${2:b})", Detail: "any", Doc: "相等则 NULL"},
		{Name: "GREATEST", Insert: "GREATEST(${1:a}, ${2:b})", Detail: "any", Doc: "最大值"},
		{Name: "LEAST", Insert: "LEAST(${1:a}, ${2:b})", Detail: "any", Doc: "最小值"},
		{Name: "TO_CHAR", Insert: "TO_CHAR(${1:expr}, ${2:fmt})", Detail: "string", Doc: "转字符串"},
		{Name: "TO_DATE", Insert: "TO_DATE(${1:str}, ${2:fmt})", Detail: "date", Doc: "字符串转日期"},
		{Name: "TO_NUMBER", Insert: "TO_NUMBER(${1:str})", Detail: "number", Doc: "转数值"},
		{Name: "TO_TIMESTAMP", Insert: "TO_TIMESTAMP(${1:str}, ${2:fmt})", Detail: "timestamp", Doc: "转时间戳"},
		{Name: "CAST", Insert: "CAST(${1:expr} AS ${2:type})", Detail: "any", Doc: "类型转换"},
		{Name: "SUBSTR", Insert: "SUBSTR(${1:str}, ${2:pos}, ${3:len})", Detail: "string", Doc: "子串"},
		{Name: "SUBSTRING", Insert: "SUBSTRING(${1:str}, ${2:pos}, ${3:len})", Detail: "string", Doc: "子串"},
		{Name: "INSTR", Insert: "INSTR(${1:str}, ${2:substr})", Detail: "int", Doc: "子串位置"},
		{Name: "LENGTH", Insert: "LENGTH(${1:str})", Detail: "int", Doc: "字符长度"},
		{Name: "LENGTHB", Insert: "LENGTHB(${1:str})", Detail: "int", Doc: "字节长度"},
		{Name: "LOWER", Insert: "LOWER(${1:str})", Detail: "string", Doc: "转小写"},
		{Name: "UPPER", Insert: "UPPER(${1:str})", Detail: "string", Doc: "转大写"},
		{Name: "TRIM", Insert: "TRIM(${1:str})", Detail: "string", Doc: "去两端空白"},
		{Name: "LTRIM", Insert: "LTRIM(${1:str})", Detail: "string", Doc: "去左空白"},
		{Name: "RTRIM", Insert: "RTRIM(${1:str})", Detail: "string", Doc: "去右空白"},
		{Name: "REPLACE", Insert: "REPLACE(${1:str}, ${2:from}, ${3:to})", Detail: "string", Doc: "替换子串"},
		{Name: "LPAD", Insert: "LPAD(${1:str}, ${2:len}, ${3:pad})", Detail: "string", Doc: "左侧填充"},
		{Name: "RPAD", Insert: "RPAD(${1:str}, ${2:len}, ${3:pad})", Detail: "string", Doc: "右侧填充"},
		{Name: "CONCAT", Insert: "CONCAT(${1:str1}, ${2:str2})", Detail: "string", Doc: "字符串连接"},
		{Name: "ABS", Insert: "ABS(${1:n})", Detail: "number", Doc: "绝对值"},
		{Name: "CEIL", Insert: "CEIL(${1:n})", Detail: "number", Doc: "向上取整"},
		{Name: "FLOOR", Insert: "FLOOR(${1:n})", Detail: "number", Doc: "向下取整"},
		{Name: "ROUND", Insert: "ROUND(${1:n}, ${2:decimals})", Detail: "number", Doc: "四舍五入"},
		{Name: "TRUNC", Insert: "TRUNC(${1:n}, ${2:decimals})", Detail: "number", Doc: "截断"},
		{Name: "MOD", Insert: "MOD(${1:n}, ${2:m})", Detail: "number", Doc: "取模"},
		{Name: "POWER", Insert: "POWER(${1:x}, ${2:y})", Detail: "number", Doc: "幂"},
		{Name: "SQRT", Insert: "SQRT(${1:n})", Detail: "number", Doc: "平方根"},
		{Name: "SIGN", Insert: "SIGN(${1:n})", Detail: "int", Doc: "符号"},
		{Name: "SYSDATE", Insert: "SYSDATE", Detail: "datetime", Doc: "当前日期时间"},
		{Name: "SYSTIMESTAMP", Insert: "SYSTIMESTAMP", Detail: "timestamp", Doc: "当前时间戳"},
		{Name: "CURRENT_DATE", Insert: "CURRENT_DATE", Detail: "date", Doc: "当前日期"},
		{Name: "CURRENT_TIMESTAMP", Insert: "CURRENT_TIMESTAMP", Detail: "timestamp", Doc: "当前时间戳"},
		{Name: "ADD_MONTHS", Insert: "ADD_MONTHS(${1:date}, ${2:n})", Detail: "date", Doc: "加月"},
		{Name: "MONTHS_BETWEEN", Insert: "MONTHS_BETWEEN(${1:d1}, ${2:d2})", Detail: "number", Doc: "月差"},
		{Name: "LAST_DAY", Insert: "LAST_DAY(${1:date})", Detail: "date", Doc: "月末"},
		{Name: "EXTRACT", Insert: "EXTRACT(${1:UNIT} FROM ${2:date})", Detail: "int", Doc: "提取日期部分"},
		{Name: "COUNT", Insert: "COUNT(${1:expr})", Detail: "aggregate", Doc: "计数"},
		{Name: "SUM", Insert: "SUM(${1:expr})", Detail: "aggregate", Doc: "求和"},
		{Name: "AVG", Insert: "AVG(${1:expr})", Detail: "aggregate", Doc: "平均值"},
		{Name: "MAX", Insert: "MAX(${1:expr})", Detail: "aggregate", Doc: "最大值"},
		{Name: "MIN", Insert: "MIN(${1:expr})", Detail: "aggregate", Doc: "最小值"},
		{Name: "ROW_NUMBER", Insert: "ROW_NUMBER() OVER (${1:ORDER BY col})", Detail: "window", Doc: "行号"},
		{Name: "RANK", Insert: "RANK() OVER (${1:ORDER BY col})", Detail: "window", Doc: "排名"},
		{Name: "DENSE_RANK", Insert: "DENSE_RANK() OVER (${1:ORDER BY col})", Detail: "window", Doc: "密集排名"},
		{Name: "LAG", Insert: "LAG(${1:expr}, ${2:offset}) OVER (${3:ORDER BY col})", Detail: "window", Doc: "上一行"},
		{Name: "LEAD", Insert: "LEAD(${1:expr}, ${2:offset}) OVER (${3:ORDER BY col})", Detail: "window", Doc: "下一行"},
		{Name: "USER", Insert: "USER", Detail: "string", Doc: "当前用户"},
		{Name: "UID", Insert: "UID", Detail: "int", Doc: "当前用户 ID"},
	}
}

// oracleCompatOnlyBuiltins 仅 Oracle 兼容模式额外提示（与原生有重叠的不重复）。
func oracleCompatOnlyBuiltins() []builtinFn {
	return []builtinFn{
		{Name: "SYS_CONTEXT", Insert: "SYS_CONTEXT(${1:namespace}, ${2:param})", Detail: "string", Doc: "会话上下文"},
		{Name: "USERENV", Insert: "USERENV(${1:param})", Detail: "string", Doc: "用户环境（旧）"},
		{Name: "RAWTOHEX", Insert: "RAWTOHEX(${1:raw})", Detail: "string", Doc: "RAW 转十六进制"},
		{Name: "HEXTORAW", Insert: "HEXTORAW(${1:hex})", Detail: "raw", Doc: "十六进制转 RAW"},
	}
}

// mysqlCompatOnlyBuiltins 仅 MySQL 兼容模式额外提示；禁止在 native/oracle 下混推。
func mysqlCompatOnlyBuiltins() []builtinFn {
	return []builtinFn{
		{Name: "NOW", Insert: "NOW()", Detail: "datetime", Doc: "当前日期时间"},
		{Name: "IFNULL", Insert: "IFNULL(${1:expr}, ${2:alt})", Detail: "any", Doc: "空则替换"},
		{Name: "IF", Insert: "IF(${1:cond}, ${2:true_val}, ${3:false_val})", Detail: "any", Doc: "条件表达式"},
		{Name: "DATE_FORMAT", Insert: "DATE_FORMAT(${1:date}, ${2:format})", Detail: "string", Doc: "按格式输出日期"},
		{Name: "STR_TO_DATE", Insert: "STR_TO_DATE(${1:str}, ${2:format})", Detail: "datetime", Doc: "字符串转日期"},
		{Name: "DATE_ADD", Insert: "DATE_ADD(${1:date}, INTERVAL ${2:n} ${3:UNIT})", Detail: "datetime", Doc: "日期加法"},
		{Name: "DATE_SUB", Insert: "DATE_SUB(${1:date}, INTERVAL ${2:n} ${3:UNIT})", Detail: "datetime", Doc: "日期减法"},
		{Name: "DATEDIFF", Insert: "DATEDIFF(${1:date1}, ${2:date2})", Detail: "int", Doc: "日期间隔（天）"},
		{Name: "GROUP_CONCAT", Insert: "GROUP_CONCAT(${1:expr})", Detail: "string", Doc: "组内连接"},
		{Name: "DATABASE", Insert: "DATABASE()", Detail: "string", Doc: "当前库名"},
		{Name: "UUID", Insert: "UUID()", Detail: "string", Doc: "生成 UUID"},
		{Name: "MD5", Insert: "MD5(${1:str})", Detail: "string", Doc: "MD5 摘要"},
	}
}

func builtinsForCompat(mode CompatMode) []builtinFn {
	out := append([]builtinFn(nil), dmNativeBuiltins()...)
	switch mode {
	case CompatOracle:
		out = append(out, oracleCompatOnlyBuiltins()...)
	case CompatMysql:
		out = append(out, mysqlCompatOnlyBuiltins()...)
	}
	return out
}

// damengBuiltinFunctionNames 内置函数名列表（去重，供 Monarch / lexicon）。
func damengBuiltinFunctionNames(mode CompatMode) []string {
	defs := builtinsForCompat(mode)
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

func damengBuiltinFunctions(mode CompatMode) []sqllsp.CompletionItem {
	defs := builtinsForCompat(mode)
	out := make([]sqllsp.CompletionItem, 0, len(defs))
	seen := map[string]struct{}{}
	for _, d := range defs {
		key := strings.ToUpper(d.Name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
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
	return lookupBuiltinSignature(name, p.compat)
}

func lookupBuiltinSignature(name string, mode CompatMode) *sqllsp.SignatureInformation {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	for _, d := range builtinsForCompat(mode) {
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

// QuoteIdent 实现 sqllsp.IdentifierQuoter（达梦双引号）。
func (p *Parser) QuoteIdent(name string) string {
	return quoteDamengIdent(name)
}

func quoteDamengIdent(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return name
	}
	if !identNeedsQuote(name) {
		return name
	}
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func identNeedsQuote(name string) bool {
	if name == "" {
		return false
	}
	for i, r := range name {
		if i == 0 {
			if !(r == '_' || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z')) {
				return true
			}
			continue
		}
		if r == '_' || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '$' {
			continue
		}
		return true
	}
	// 全小写/全大写无空格的简单名可不引号；混合大小写在达梦默认折叠，保留不强制引号
	return false
}
