// 对象脚本（视图 / 物化视图 / 字典）保存策略：按会话 Cap 裁决 OR REPLACE 或 DROP+CREATE。
// 调用方禁止在 handler / 前端散落版本分支；一律通过 PrepareObjectScript。
package ddl

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"
	"time"

	"niuma/services/clickhouse-service/internal/dialect"
)

// 对象种类（与前端 ClickHouseObjectKind 对齐）。
const (
	ObjectKindView             = "view"
	ObjectKindMaterializedView = "materializedView"
	ObjectKindDictionary       = "dictionary"
)

// 策略标识（预览 / 应用结果）。
const (
	ObjectScriptStrategyOrReplace  = "or_replace"
	ObjectScriptStrategyDropCreate = "drop_create"
	ObjectScriptStrategyRaw        = "raw"
)

// ObjectScriptParams 是对象脚本预览 / 应用入参。
type ObjectScriptParams struct {
	Kind          string `json:"kind"`
	SQL           string `json:"sql"`
	Database      string `json:"database,omitempty"`
	ExistingName  string `json:"existingName,omitempty"`
	Mode          string `json:"mode,omitempty"` // create | alter
	Cluster       string `json:"cluster,omitempty"`
	SelectionOnly bool   `json:"selectionOnly,omitempty"`
	// PreferFallback 强制 DROP+CREATE（Apply 遇 OR REPLACE 失败时使用）。
	PreferFallback bool `json:"preferFallback,omitempty"`
}

// ObjectScriptResult 是预览 / 应用结果。
type ObjectScriptResult struct {
	SQL        []string `json:"sql"`
	Strategy   string   `json:"strategy"`
	DurationMS int64    `json:"durationMs,omitempty"`
}

const (
	// bareIdent 允许中文等非 ASCII 标识符（SHOW CREATE / 用户脚本）。
	bareIdent = `[^\s."` + "`" + `;()]+`
	identCap  = "(?:`([^`]+)`|\"([^\"]+)\"|(" + bareIdent + "))"
	identTok  = "(?:`[^`]+`|\"[^\"]+\"|" + bareIdent + ")"
)

var (
	reOrReplacePrefix = regexp.MustCompile(`(?i)^create\s+or\s+replace\s+`)
	reIfNotExistsAny  = regexp.MustCompile(`(?i)^(create\s+(?:materialized\s+view|view|dictionary))\s+if\s+not\s+exists\s+`)
	reOnCluster       = regexp.MustCompile(`(?i)\bon\s+cluster\b`)
)

func normalizeObjectKind(kind string) (string, error) {
	switch strings.TrimSpace(kind) {
	case ObjectKindView, ObjectKindMaterializedView, ObjectKindDictionary:
		return strings.TrimSpace(kind), nil
	default:
		return "", fmt.Errorf("clickhouse: unsupported object kind %q", kind)
	}
}

func kindPattern(kind string) string {
	switch kind {
	case ObjectKindMaterializedView:
		return `materialized\s+view`
	case ObjectKindDictionary:
		return `dictionary`
	default:
		return `view`
	}
}

func orReplaceCapForKind(kind string) string {
	switch kind {
	case ObjectKindMaterializedView:
		return dialect.CapCreateOrReplaceMaterializedView
	case ObjectKindDictionary:
		return dialect.CapCreateOrReplaceDictionary
	default:
		return dialect.CapCreateOrReplaceView
	}
}

func supportsOrReplace(kind string, profile *dialect.ServerProfile) bool {
	return dialect.Has(profile, orReplaceCapForKind(kind))
}

// ParseObjectNameFromSQL 从 CREATE 正文解析对象短名。
func ParseObjectNameFromSQL(sql, kind string) string {
	kind, err := normalizeObjectKind(kind)
	if err != nil {
		return ""
	}
	re := regexp.MustCompile(`(?is)^\s*create\s+(?:or\s+replace\s+)?` + kindPattern(kind) +
		`\s+(?:if\s+not\s+exists\s+)?` + identCap + `(?:\s*\.\s*` + identCap + `)?`)
	m := re.FindStringSubmatch(strings.TrimSpace(sql))
	if m == nil {
		return ""
	}
	// 限定名时取第二段
	for _, g := range m[4:] {
		if s := strings.TrimSpace(g); s != "" {
			return s
		}
	}
	for _, g := range m[1:4] {
		if s := strings.TrimSpace(g); s != "" {
			return s
		}
	}
	return ""
}

// ParseObjectRefFromSQL 解析 CREATE 中的对象引用（保留原文引号），用于 DROP。
func ParseObjectRefFromSQL(sql, kind string) string {
	kind, err := normalizeObjectKind(kind)
	if err != nil {
		return ""
	}
	re := regexp.MustCompile(`(?is)^\s*create\s+(?:or\s+replace\s+)?` + kindPattern(kind) +
		`\s+(?:if\s+not\s+exists\s+)?((?:` + identTok + `)(?:\s*\.\s*(?:` + identTok + `))?)`)
	m := re.FindStringSubmatch(strings.TrimSpace(sql))
	if m == nil || strings.TrimSpace(m[1]) == "" {
		return ""
	}
	return regexp.MustCompile(`\s*\.\s*`).ReplaceAllString(m[1], ".")
}

func toPlainCreateSQL(sql string) string {
	s := strings.TrimSpace(sql)
	s = reOrReplacePrefix.ReplaceAllString(s, "CREATE ")
	s = reIfNotExistsAny.ReplaceAllString(s, "$1 ")
	return s
}

func toReplaceSQL(sql string) string {
	trimmed := strings.TrimSpace(sql)
	if reOrReplacePrefix.MatchString(trimmed) {
		return trimmed
	}
	return regexp.MustCompile(`(?i)^create\s+`).ReplaceAllString(trimmed, "CREATE OR REPLACE ")
}

// EnsureOnClusterClause 若尚无 ON CLUSTER，则在对象名后插入。
func EnsureOnClusterClause(sql, cluster string) (string, error) {
	c := strings.TrimSpace(cluster)
	trimmed := strings.TrimSpace(sql)
	if c == "" || trimmed == "" || reOnCluster.MatchString(trimmed) {
		return trimmed, nil
	}
	oc, err := onClusterClause(c)
	if err != nil {
		return "", err
	}
	qname := identTok + `(?:\s*\.\s*` + identTok + `)?`
	re := regexp.MustCompile(`(?is)^((?:create\s+(?:or\s+replace\s+)?(?:materialized\s+view|view|dictionary|table|database)|` +
		`drop\s+(?:table|view|dictionary|database)|` +
		`truncate\s+table|` +
		`rename\s+table|` +
		`optimize\s+table|` +
		`detach\s+table|` +
		`attach\s+table)` +
		`(?:\s+if\s+(?:not\s+)?exists)?\s+` + qname + `)`)
	m := re.FindStringSubmatch(trimmed)
	if m == nil {
		return trimmed, nil
	}
	at := len(m[1])
	return trimmed[:at] + oc + trimmed[at:], nil
}

func dropStatement(kind, ref, cluster string) (string, error) {
	oc, err := onClusterClause(cluster)
	if err != nil {
		return "", err
	}
	switch kind {
	case ObjectKindDictionary:
		return "DROP DICTIONARY IF EXISTS " + ref + oc, nil
	case ObjectKindMaterializedView:
		return "DROP TABLE IF EXISTS " + ref + oc, nil
	default:
		return "DROP VIEW IF EXISTS " + ref + oc, nil
	}
}

func dropExistingByName(kind, database, name, cluster string) (string, error) {
	rel, err := qualified(database, name)
	if err != nil {
		return "", err
	}
	return dropStatement(kind, rel, cluster)
}

func buildDropCreate(sql, kind, cluster string) ([]string, error) {
	createSQL, err := EnsureOnClusterClause(toPlainCreateSQL(sql), cluster)
	if err != nil {
		return nil, err
	}
	ref := ParseObjectRefFromSQL(sql, kind)
	if ref == "" {
		return []string{createSQL}, nil
	}
	dropSQL, err := dropStatement(kind, ref, cluster)
	if err != nil {
		return nil, err
	}
	return []string{dropSQL, createSQL}, nil
}

// PrepareObjectScript 按 Cap 生成将执行的语句列表（不碰库）。
func PrepareObjectScript(p ObjectScriptParams, profile *dialect.ServerProfile) (*ObjectScriptResult, error) {
	kind, err := normalizeObjectKind(p.Kind)
	if err != nil {
		return nil, err
	}
	raw := strings.TrimSpace(p.SQL)
	if raw == "" {
		return nil, fmt.Errorf("clickhouse: sql required")
	}

	if p.SelectionOnly {
		return &ObjectScriptResult{
			SQL:      []string{raw},
			Strategy: ObjectScriptStrategyRaw,
		}, nil
	}

	var out []string
	existing := strings.TrimSpace(p.ExistingName)
	mode := strings.TrimSpace(p.Mode)
	if mode == "" {
		mode = "alter"
	}
	appliedName := ParseObjectNameFromSQL(raw, kind)
	if existing != "" && appliedName != "" && existing != appliedName && mode != "create" {
		db := strings.TrimSpace(p.Database)
		if db == "" {
			return nil, fmt.Errorf("clickhouse: database required for rename")
		}
		dropOld, err := dropExistingByName(kind, db, existing, p.Cluster)
		if err != nil {
			return nil, err
		}
		out = append(out, dropOld)
	}

	useOrReplace := !p.PreferFallback && supportsOrReplace(kind, profile)
	strategy := ObjectScriptStrategyDropCreate
	if useOrReplace {
		strategy = ObjectScriptStrategyOrReplace
		replaced := toReplaceSQL(raw)
		withCluster, err := EnsureOnClusterClause(replaced, p.Cluster)
		if err != nil {
			return nil, err
		}
		out = append(out, withCluster)
	} else {
		stmts, err := buildDropCreate(raw, kind, p.Cluster)
		if err != nil {
			return nil, err
		}
		out = append(out, stmts...)
	}

	return &ObjectScriptResult{SQL: out, Strategy: strategy}, nil
}

// ShouldFallbackObjectScript 识别 OR REPLACE 失败后应改走 DROP+CREATE 的错误。
func ShouldFallbackObjectScript(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if msg == "" {
		return false
	}
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "rename exchange") || strings.Contains(lower, "renameat2") {
		return true
	}
	if strings.Contains(lower, "exchanging files is not supported") {
		return true
	}
	if regexp.MustCompile(`(?i)\bcode:\s*48\b`).MatchString(msg) &&
		(strings.Contains(lower, "not supported") || strings.Contains(lower, "not_implemented") || strings.Contains(lower, "unsupported")) {
		return true
	}
	if regexp.MustCompile(`(?i)\bcode:\s*387\b`).MatchString(msg) {
		return true
	}
	if regexp.MustCompile(`(?i)dictionary\b[\s\S]{0,120}\balready exists`).MatchString(msg) {
		return true
	}
	// 语法不支持 OR REPLACE MATERIALIZED VIEW（code 62）
	if regexp.MustCompile(`(?i)\bcode:\s*62\b`).MatchString(msg) &&
		strings.Contains(lower, "materialized") {
		return true
	}
	return false
}

func execStatements(ctx context.Context, db *sql.DB, sqls []string) error {
	for _, q := range sqls {
		q = strings.TrimSpace(q)
		if q == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	return nil
}

// PreviewObjectScript 生成将执行的 SQL（纯拼装）。
func PreviewObjectScript(p ObjectScriptParams, profile *dialect.ServerProfile) (*ObjectScriptResult, error) {
	return PrepareObjectScript(p, profile)
}

// ApplyObjectScript 预览并执行；OR REPLACE 失败时按错误启发式回退 DROP+CREATE。
func ApplyObjectScript(ctx context.Context, db *sql.DB, p ObjectScriptParams, profile *dialect.ServerProfile) (*ObjectScriptResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: objectScriptApply: nil db")
	}
	start := time.Now()
	primary, err := PrepareObjectScript(p, profile)
	if err != nil {
		return nil, err
	}
	if err := execStatements(ctx, db, primary.SQL); err != nil {
		if primary.Strategy == ObjectScriptStrategyOrReplace && ShouldFallbackObjectScript(err) {
			fallbackParams := p
			fallbackParams.PreferFallback = true
			fallback, ferr := PrepareObjectScript(fallbackParams, profile)
			if ferr != nil {
				return nil, fmt.Errorf("clickhouse: objectScriptApply: %w", err)
			}
			if ferr := execStatements(ctx, db, fallback.SQL); ferr != nil {
				return nil, fmt.Errorf("clickhouse: objectScriptApply: %w", ferr)
			}
			fallback.DurationMS = time.Since(start).Milliseconds()
			return fallback, nil
		}
		return nil, fmt.Errorf("clickhouse: objectScriptApply: %w", err)
	}
	primary.DurationMS = time.Since(start).Milliseconds()
	return primary, nil
}
