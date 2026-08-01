// Package explainbuild 构造 ClickHouse 专业化 EXPLAIN 语句。
//
// 对齐官方语法：EXPLAIN [type] [setting = value, ...] query
// 默认 PLAN 并开启 indexes/header/description，便于读 MergeTree 裁剪效果。
package explainbuild

import (
	"fmt"
	"strings"
	"unicode"

	"niuma/services/clickhouse-service/internal/dialect"
)

// Mode 为 EXPLAIN 类型（不含前缀关键字）。
type Mode string

const (
	ModePlan      Mode = "plan"
	ModeEstimate  Mode = "estimate"
	ModePipeline  Mode = "pipeline"
	ModeAST       Mode = "ast"
	ModeSyntax    Mode = "syntax"
	ModeQueryTree Mode = "queryTree"
	ModeAnalyze   Mode = "analyze"
)

// Options 控制 EXPLAIN 包装。
type Options struct {
	Mode    Mode
	Analyze bool
	// 下列指针：nil 表示采用该 Mode 的专业默认；非 nil 显式覆盖。
	Indexes     *bool
	Header      *bool
	Description *bool
	Actions     *bool
	JSON        *bool
	Graph       *bool
}

// Result 为构造结果。
type Result struct {
	SQL     string
	Mode    Mode
	InnerSQL string
}

var modeToken = map[Mode]string{
	ModePlan:      "PLAN",
	ModeEstimate:  "ESTIMATE",
	ModePipeline:  "PIPELINE",
	ModeAST:       "AST",
	ModeSyntax:    "SYNTAX",
	ModeQueryTree: "QUERY TREE",
	ModeAnalyze:   "ANALYZE",
}

// NormalizeMode 解析前端/RPC mode 字符串；analyze=true 时强制 ANALYZE。
func NormalizeMode(raw string, analyze bool) Mode {
	if analyze {
		return ModeAnalyze
	}
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "plan", "default":
		return ModePlan
	case "estimate":
		return ModeEstimate
	case "pipeline":
		return ModePipeline
	case "ast":
		return ModeAST
	case "syntax":
		return ModeSyntax
	case "querytree", "query_tree", "query tree":
		return ModeQueryTree
	case "analyze":
		return ModeAnalyze
	default:
		return Mode(strings.TrimSpace(raw))
	}
}

// RequiredCapability 返回该 mode 所需能力；空串表示基线能力（始终可用）。
func RequiredCapability(mode Mode) string {
	switch mode {
	case ModeEstimate:
		return dialect.CapExplainEstimate
	case ModeAnalyze:
		return dialect.CapExplainAnalyze
	case ModeQueryTree:
		return dialect.CapExplainQueryTree
	default:
		return ""
	}
}

// ValidateMode 按方言能力校验 mode；不支持时返回可读错误。
func ValidateMode(mode Mode, profile *dialect.ServerProfile) error {
	capID := RequiredCapability(mode)
	if capID == "" {
		return nil
	}
	if dialect.Has(profile, capID) {
		return nil
	}
	switch mode {
	case ModeEstimate:
		return fmt.Errorf("EXPLAIN ESTIMATE requires ClickHouse >= 21.8 (capability %s)", capID)
	case ModeAnalyze:
		return fmt.Errorf("EXPLAIN ANALYZE requires ClickHouse >= 26.7 (capability %s)", capID)
	case ModeQueryTree:
		return fmt.Errorf("EXPLAIN QUERY TREE requires ClickHouse >= 23.3 (capability %s)", capID)
	default:
		return fmt.Errorf("EXPLAIN mode %q is not supported by this server", mode)
	}
}

// StripOuterExplain 去掉最外层 EXPLAIN [type] [settings...]，避免双重包装。
func StripOuterExplain(sql string) string {
	trimmed := strings.TrimSpace(sql)
	if trimmed == "" {
		return trimmed
	}
	upper := strings.ToUpper(trimmed)
	if !strings.HasPrefix(upper, "EXPLAIN") {
		return trimmed
	}
	// 必须是独立关键字（EXPLAIN 后空白或结束）。
	if len(trimmed) > len("EXPLAIN") {
		r := rune(trimmed[len("EXPLAIN")])
		if !unicode.IsSpace(r) {
			return trimmed
		}
	}
	rest := strings.TrimSpace(trimmed[len("EXPLAIN"):])
	rest = stripExplainType(rest)
	rest = stripExplainSettings(rest)
	if rest == "" {
		return trimmed
	}
	return rest
}

func stripExplainType(rest string) string {
	upper := strings.ToUpper(strings.TrimSpace(rest))
	types := []string{
		"QUERY TREE",
		"TABLE OVERRIDE",
		"PIPELINE",
		"ESTIMATE",
		"SYNTAX",
		"ANALYZE",
		"PLAN",
		"AST",
		"WHATIF",
	}
	for _, t := range types {
		if strings.HasPrefix(upper, t) {
			after := strings.TrimSpace(rest[len(t):])
			if after == "" {
				return ""
			}
			// type 后须空白或 settings；避免误吃查询里的同名标识。
			r := rune(rest[len(t)])
			if unicode.IsSpace(r) || after[0] == ',' {
				return strings.TrimSpace(rest[len(t):])
			}
		}
	}
	return strings.TrimSpace(rest)
}

func stripExplainSettings(rest string) string {
	s := strings.TrimSpace(rest)
	for {
		_, next, ok := readIdent(s)
		if !ok {
			return s
		}
		next = strings.TrimSpace(next)
		if !strings.HasPrefix(next, "=") {
			return s
		}
		next = strings.TrimSpace(next[1:])
		_, next, ok = readSettingValue(next)
		if !ok {
			return s
		}
		s = strings.TrimSpace(next)
		if strings.HasPrefix(s, ",") {
			s = strings.TrimSpace(s[1:])
			continue
		}
		return s
	}
}

func readIdent(s string) (name, rest string, ok bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", s, false
	}
	i := 0
	for i < len(s) {
		r := rune(s[i])
		if i == 0 {
			if !unicode.IsLetter(r) && r != '_' {
				return "", s, false
			}
		} else if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' {
			break
		}
		i++
	}
	if i == 0 {
		return "", s, false
	}
	return s[:i], s[i:], true
}

func readSettingValue(s string) (value, rest string, ok bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", s, false
	}
	// 数字 / 标识 / 简单字面量（不含逗号空白）。
	i := 0
	for i < len(s) {
		r := rune(s[i])
		if unicode.IsSpace(r) || r == ',' {
			break
		}
		i++
	}
	if i == 0 {
		return "", s, false
	}
	return s[:i], s[i:], true
}

// Build 生成可执行的 EXPLAIN SQL。
func Build(userSQL string, opts Options) (Result, error) {
	inner := StripOuterExplain(userSQL)
	if strings.TrimSpace(inner) == "" {
		return Result{}, fmt.Errorf("sql required")
	}
	mode := NormalizeMode(string(opts.Mode), opts.Analyze)
	token, ok := modeToken[mode]
	if !ok {
		return Result{}, fmt.Errorf("unsupported EXPLAIN mode %q", mode)
	}

	var b strings.Builder
	b.WriteString("EXPLAIN ")
	b.WriteString(token)
	if settings := buildSettings(mode, opts); settings != "" {
		b.WriteByte(' ')
		b.WriteString(settings)
	}
	b.WriteByte('\n')
	b.WriteString(inner)
	return Result{SQL: b.String(), Mode: mode, InnerSQL: inner}, nil
}

func buildSettings(mode Mode, opts Options) string {
	switch mode {
	case ModePlan:
		return joinSettings(
			setting("indexes", boolOr(opts.Indexes, true)),
			setting("header", boolOr(opts.Header, true)),
			setting("description", boolOr(opts.Description, true)),
			optionalSetting("actions", opts.Actions),
			optionalSetting("json", opts.JSON),
		)
	case ModePipeline, ModeAnalyze:
		return joinSettings(
			optionalSetting("header", opts.Header),
			optionalSetting("graph", opts.Graph),
			optionalSetting("json", opts.JSON),
		)
	case ModeQueryTree:
		return joinSettings(
			optionalSetting("json", opts.JSON),
		)
	default:
		return joinSettings(optionalSetting("json", opts.JSON))
	}
}

func boolOr(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}

func setting(name string, on bool) string {
	if on {
		return name + " = 1"
	}
	return name + " = 0"
}

func optionalSetting(name string, p *bool) string {
	if p == nil {
		return ""
	}
	return setting(name, *p)
}

func joinSettings(parts ...string) string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, ", ")
}
