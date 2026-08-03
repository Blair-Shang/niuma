package sqliteparser

import "niuma/pkg/sqllsp"

type builtinFn struct {
	Name   string
	Insert string
	Detail string
	Doc    string
	Kind   int // LSP CompletionItemKind；0 表示 Function(3)
}

func sqliteBuiltins() []builtinFn {
	return []builtinFn{
		{Name: "abs", Insert: "abs(${1:x})", Detail: "numeric", Doc: "绝对值"},
		{Name: "changes", Insert: "changes()", Detail: "integer", Doc: "最近变更行数"},
		{Name: "char", Insert: "char(${1:x1}, ${2:x2})", Detail: "text", Doc: "码点转字符"},
		{Name: "coalesce", Insert: "coalesce(${1:x}, ${2:y})", Detail: "any", Doc: "首个非 NULL"},
		{Name: "concat", Insert: "concat(${1:x}, ${2:y})", Detail: "text", Doc: "字符串拼接"},
		{Name: "concat_ws", Insert: "concat_ws(${1:sep}, ${2:x}, ${3:y})", Detail: "text", Doc: "带分隔符拼接"},
		{Name: "glob", Insert: "glob(${1:pattern}, ${2:x})", Detail: "integer", Doc: "GLOB 匹配"},
		{Name: "hex", Insert: "hex(${1:x})", Detail: "text", Doc: "十六进制"},
		{Name: "unhex", Insert: "unhex(${1:hex})", Detail: "blob", Doc: "十六进制解码"},
		{Name: "ifnull", Insert: "ifnull(${1:x}, ${2:y})", Detail: "any", Doc: "NULL 替换"},
		{Name: "iif", Insert: "iif(${1:cond}, ${2:a}, ${3:b})", Detail: "any", Doc: "条件表达式"},
		{Name: "instr", Insert: "instr(${1:hay}, ${2:needle})", Detail: "integer", Doc: "子串位置"},
		{Name: "length", Insert: "length(${1:x})", Detail: "integer", Doc: "长度"},
		{Name: "like", Insert: "like(${1:pattern}, ${2:x})", Detail: "integer", Doc: "LIKE 匹配"},
		{Name: "likelihood", Insert: "likelihood(${1:x}, ${2:p})", Detail: "any", Doc: "查询规划提示"},
		{Name: "likely", Insert: "likely(${1:x})", Detail: "any", Doc: "查询规划提示（真）"},
		{Name: "unlikely", Insert: "unlikely(${1:x})", Detail: "any", Doc: "查询规划提示（假）"},
		{Name: "lower", Insert: "lower(${1:x})", Detail: "text", Doc: "小写"},
		{Name: "ltrim", Insert: "ltrim(${1:x})", Detail: "text", Doc: "去左空白"},
		{Name: "max", Insert: "max(${1:x}, ${2:y})", Detail: "any", Doc: "最大（标量）"},
		{Name: "min", Insert: "min(${1:x}, ${2:y})", Detail: "any", Doc: "最小（标量）"},
		{Name: "nullif", Insert: "nullif(${1:x}, ${2:y})", Detail: "any", Doc: "相等则 NULL"},
		{Name: "printf", Insert: "printf(${1:fmt}, ${2:x})", Detail: "text", Doc: "格式化"},
		{Name: "quote", Insert: "quote(${1:x})", Detail: "text", Doc: "SQL 字面量"},
		{Name: "random", Insert: "random()", Detail: "integer", Doc: "随机整数"},
		{Name: "randomblob", Insert: "randomblob(${1:n})", Detail: "blob", Doc: "随机 BLOB"},
		{Name: "replace", Insert: "replace(${1:x}, ${2:from}, ${3:to})", Detail: "text", Doc: "替换"},
		{Name: "round", Insert: "round(${1:x}, ${2:n})", Detail: "real", Doc: "四舍五入"},
		{Name: "rtrim", Insert: "rtrim(${1:x})", Detail: "text", Doc: "去右空白"},
		{Name: "soundex", Insert: "soundex(${1:x})", Detail: "text", Doc: "Soundex 编码"},
		{Name: "sqlite_version", Insert: "sqlite_version()", Detail: "text", Doc: "版本"},
		{Name: "substr", Insert: "substr(${1:x}, ${2:start}, ${3:len})", Detail: "text", Doc: "子串"},
		{Name: "substring", Insert: "substring(${1:x}, ${2:start}, ${3:len})", Detail: "text", Doc: "子串（substr 别名）"},
		{Name: "total_changes", Insert: "total_changes()", Detail: "integer", Doc: "累计变更行数"},
		{Name: "trim", Insert: "trim(${1:x})", Detail: "text", Doc: "去两端空白"},
		{Name: "typeof", Insert: "typeof(${1:x})", Detail: "text", Doc: "存储类型"},
		{Name: "unicode", Insert: "unicode(${1:x})", Detail: "integer", Doc: "首字符码点"},
		{Name: "upper", Insert: "upper(${1:x})", Detail: "text", Doc: "大写"},
		{Name: "zeroblob", Insert: "zeroblob(${1:n})", Detail: "blob", Doc: "零填充 BLOB"},

		{Name: "avg", Insert: "avg(${1:x})", Detail: "aggregate", Doc: "平均"},
		{Name: "count", Insert: "count(${1:*})", Detail: "aggregate", Doc: "计数"},
		{Name: "group_concat", Insert: "group_concat(${1:x}, ${2:sep})", Detail: "aggregate", Doc: "拼接"},
		{Name: "sum", Insert: "sum(${1:x})", Detail: "aggregate", Doc: "求和"},
		{Name: "total", Insert: "total(${1:x})", Detail: "aggregate", Doc: "求和（NULL→0）"},

		{Name: "json", Insert: "json(${1:x})", Detail: "json", Doc: "校验并规范化 JSON"},
		{Name: "json_array", Insert: "json_array(${1:x})", Detail: "json", Doc: "JSON 数组"},
		{Name: "json_array_length", Insert: "json_array_length(${1:json})", Detail: "integer", Doc: "JSON 数组长度"},
		{Name: "json_object", Insert: "json_object(${1:k}, ${2:v})", Detail: "json", Doc: "JSON 对象"},
		{Name: "json_extract", Insert: "json_extract(${1:json}, ${2:path})", Detail: "any", Doc: "提取"},
		{Name: "json_insert", Insert: "json_insert(${1:json}, ${2:path}, ${3:val})", Detail: "json", Doc: "插入（路径不存在时）"},
		{Name: "json_replace", Insert: "json_replace(${1:json}, ${2:path}, ${3:val})", Detail: "json", Doc: "替换（路径存在时）"},
		{Name: "json_set", Insert: "json_set(${1:json}, ${2:path}, ${3:val})", Detail: "json", Doc: "设置路径值"},
		{Name: "json_remove", Insert: "json_remove(${1:json}, ${2:path})", Detail: "json", Doc: "删除路径"},
		{Name: "json_patch", Insert: "json_patch(${1:target}, ${2:patch})", Detail: "json", Doc: "JSON Patch 合并"},
		{Name: "json_quote", Insert: "json_quote(${1:x})", Detail: "json", Doc: "值转 JSON 字面量"},
		{Name: "json_type", Insert: "json_type(${1:json}, ${2:path})", Detail: "text", Doc: "JSON 类型"},
		{Name: "json_valid", Insert: "json_valid(${1:x})", Detail: "integer", Doc: "是否合法 JSON"},
		{Name: "json_group_array", Insert: "json_group_array(${1:x})", Detail: "aggregate", Doc: "聚合为 JSON 数组"},
		{Name: "json_group_object", Insert: "json_group_object(${1:name}, ${2:value})", Detail: "aggregate", Doc: "聚合为 JSON 对象"},
		{Name: "json_each", Insert: "json_each(${1:json})", Detail: "table-valued", Doc: "展开 JSON（表值函数）"},
		{Name: "json_tree", Insert: "json_tree(${1:json})", Detail: "table-valued", Doc: "递归展开 JSON（表值函数）"},

		// 'now' 为 UTC；需要本地时区时加 ,'localtime'
		{Name: "date", Insert: "date('${1:now}'${2:, 'localtime'})", Detail: "text", Doc: "日期（默认 UTC；加 ,'localtime' 转本地）"},
		{Name: "time", Insert: "time('${1:now}'${2:, 'localtime'})", Detail: "text", Doc: "时间（默认 UTC；加 ,'localtime' 转本地）"},
		{Name: "datetime", Insert: "datetime('${1:now}'${2:, 'localtime'})", Detail: "text", Doc: "日期时间（默认 UTC；加 ,'localtime' 转本地）"},
		{Name: "julianday", Insert: "julianday('${1:now}'${2:, 'localtime'})", Detail: "real", Doc: "儒略日"},
		{Name: "unixepoch", Insert: "unixepoch('${1:now}'${2:, 'localtime'})", Detail: "integer", Doc: "Unix 时间戳"},
		{Name: "strftime", Insert: "strftime('${1:%Y-%m-%d %H:%M:%S}', '${2:now}'${3:, 'localtime'})", Detail: "text", Doc: "格式化时间（默认 UTC）"},
		{Name: "timediff", Insert: "timediff(${1:A}, ${2:B})", Detail: "text", Doc: "时间差"},

		// 标准时间关键字：无括号，UTC
		{Name: "CURRENT_DATE", Insert: "CURRENT_DATE", Detail: "keyword", Doc: "当前 UTC 日期", Kind: 14},
		{Name: "CURRENT_TIME", Insert: "CURRENT_TIME", Detail: "keyword", Doc: "当前 UTC 时间", Kind: 14},
		{Name: "CURRENT_TIMESTAMP", Insert: "CURRENT_TIMESTAMP", Detail: "keyword", Doc: "当前 UTC 时间戳", Kind: 14},
	}
}

func sqliteBuiltinFunctionNames() []string {
	fns := sqliteBuiltins()
	out := make([]string, 0, len(fns))
	for _, f := range fns {
		out = append(out, f.Name)
	}
	return out
}

func sqliteBuiltinFunctions() []sqllsp.CompletionItem {
	fns := sqliteBuiltins()
	out := make([]sqllsp.CompletionItem, 0, len(fns))
	for _, f := range fns {
		insert := f.Insert
		if insert == "" {
			insert = f.Name + "()"
		}
		kind := f.Kind
		if kind == 0 {
			kind = 3 // Function
		}
		out = append(out, sqllsp.CompletionItem{
			Label:         f.Name,
			Kind:          kind,
			Detail:        f.Detail,
			InsertText:    insert,
			Documentation: f.Doc,
			SortText:      "2_" + f.Name,
		})
	}
	return out
}

func sqliteCreateSnippets() []sqllsp.CompletionItem {
	return []sqllsp.CompletionItem{
		{
			Label:      "CREATE TABLE",
			Kind:       15,
			Detail:     "snippet",
			InsertText: "CREATE TABLE ${1:name} (\n  ${2:id} INTEGER PRIMARY KEY,\n  ${3:col} TEXT\n);",
			SortText:   "0_create_table",
		},
		{
			Label:      "CREATE VIEW",
			Kind:       15,
			Detail:     "snippet",
			InsertText: "CREATE VIEW ${1:name} AS\nSELECT ${2:*} FROM ${3:table};",
			SortText:   "0_create_view",
		},
		{
			Label:      "CREATE INDEX",
			Kind:       15,
			Detail:     "snippet",
			InsertText: "CREATE INDEX ${1:idx} ON ${2:table} (${3:col});",
			SortText:   "0_create_index",
		},
		{
			Label:      "CREATE TRIGGER",
			Kind:       15,
			Detail:     "snippet",
			InsertText: "CREATE TRIGGER ${1:trg} AFTER INSERT ON ${2:table}\nBEGIN\n  ${3:SELECT 1;}\nEND;",
			SortText:   "0_create_trigger",
		},
	}
}
