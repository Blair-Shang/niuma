// Package ddl 的对象脚本：视图 / 触发器 / 索引保存策略。
package ddl

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"
	"time"

	"niuma/services/sqlite-service/internal/dialect"
)

const (
	ObjectKindView    = "view"
	ObjectKindTrigger = "trigger"
	ObjectKindIndex   = "index"
)

const (
	ObjectScriptStrategyOrReplace  = "or_replace"
	ObjectScriptStrategyDropCreate = "drop_create"
	ObjectScriptStrategyRaw        = "raw"
)

// ObjectScriptParams 是对象脚本预览 / 应用入参。
type ObjectScriptParams struct {
	Kind         string `json:"kind"`
	SQL          string `json:"sql"`
	Schema       string `json:"schema,omitempty"`
	Database     string `json:"database,omitempty"` // 兼容：当作 schema
	ExistingName string `json:"existingName,omitempty"`
	Mode         string `json:"mode,omitempty"` // create | alter
	SelectionOnly bool  `json:"selectionOnly,omitempty"`
	PreferFallback bool `json:"preferFallback,omitempty"`
}

// ObjectScriptResult 是预览 / 应用结果。
type ObjectScriptResult struct {
	SQL        []string `json:"sql"`
	Strategy   string   `json:"strategy"`
	DurationMS int64    `json:"durationMs,omitempty"`
}

func (p ObjectScriptParams) schemaName() string {
	if s := strings.TrimSpace(p.Schema); s != "" {
		return s
	}
	if s := strings.TrimSpace(p.Database); s != "" {
		return s
	}
	return "main"
}

func normalizeObjectKind(kind string) (string, error) {
	switch strings.TrimSpace(kind) {
	case ObjectKindView, ObjectKindTrigger, ObjectKindIndex:
		return strings.TrimSpace(kind), nil
	default:
		return "", fmt.Errorf("sqlite: unsupported object kind %q", kind)
	}
}

func kindPattern(kind string) string {
	switch kind {
	case ObjectKindTrigger:
		return `trigger`
	case ObjectKindIndex:
		return `(?:unique\s+)?index`
	default:
		return `view`
	}
}

var (
	reOrReplacePrefix = regexp.MustCompile(`(?i)^create\s+or\s+replace\s+`)
	reIfNotExistsAny  = regexp.MustCompile(`(?i)^(create\s+(?:unique\s+)?(?:view|trigger|index))\s+if\s+not\s+exists\s+`)
	identCap          = `(?:"([^"]+)"|\[([^\]]+)\]|([^\s."\[\];()]+))`
	identTok          = `(?:"[^"]+"|\[[^\]]+\]|[^\s."\[\];()]+)`
)

// ParseObjectNameFromSQL 从 CREATE 正文解析对象短名。
func ParseObjectNameFromSQL(sql, kind string) string {
	kind, err := normalizeObjectKind(kind)
	if err != nil {
		return ""
	}
	re := regexp.MustCompile(`(?is)^\s*create\s+(?:or\s+replace\s+)?` + kindPattern(kind) +
		`\s+(?:if\s+not\s+exists\s+)?(?:` + identCap + `\s*\.\s*)?` + identCap)
	m := re.FindStringSubmatch(strings.TrimSpace(sql))
	if m == nil {
		return ""
	}
	// 最后一组非空即短名
	for i := len(m) - 1; i >= 1; i-- {
		if s := strings.TrimSpace(m[i]); s != "" {
			return s
		}
	}
	return ""
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

func dropStatement(kind, schema, name string) string {
	qn := quoteIdent(schema) + "." + quoteIdent(name)
	switch kind {
	case ObjectKindTrigger:
		return "DROP TRIGGER IF EXISTS " + qn
	case ObjectKindIndex:
		return "DROP INDEX IF EXISTS " + qn
	default:
		return "DROP VIEW IF EXISTS " + qn
	}
}

func supportsOrReplaceView(profile *dialect.ServerProfile) bool {
	return dialect.Has(profile, dialect.CapCreateOrReplaceView)
}

// PrepareObjectScript 按 Cap 生成将执行的语句列表（不碰库）。
func PrepareObjectScript(p ObjectScriptParams, profile *dialect.ServerProfile) (*ObjectScriptResult, error) {
	kind, err := normalizeObjectKind(p.Kind)
	if err != nil {
		return nil, err
	}
	raw := strings.TrimSpace(p.SQL)
	if raw == "" {
		return nil, fmt.Errorf("sqlite: sql required")
	}
	if p.SelectionOnly {
		return &ObjectScriptResult{SQL: []string{raw}, Strategy: ObjectScriptStrategyRaw}, nil
	}

	schema := p.schemaName()
	var out []string
	existing := strings.TrimSpace(p.ExistingName)
	mode := strings.TrimSpace(p.Mode)
	if mode == "" {
		mode = "alter"
	}
	appliedName := ParseObjectNameFromSQL(raw, kind)
	if existing != "" && appliedName != "" && !strings.EqualFold(existing, appliedName) && mode != "create" {
		out = append(out, dropStatement(kind, schema, existing))
	}

	useOrReplace := kind == ObjectKindView && !p.PreferFallback && supportsOrReplaceView(profile)
	strategy := ObjectScriptStrategyDropCreate
	if useOrReplace {
		strategy = ObjectScriptStrategyOrReplace
		out = append(out, toReplaceSQL(raw))
	} else {
		name := appliedName
		if name == "" {
			name = existing
		}
		if name != "" {
			out = append(out, dropStatement(kind, schema, name))
		}
		out = append(out, toPlainCreateSQL(raw))
	}
	return &ObjectScriptResult{SQL: out, Strategy: strategy}, nil
}

// PreviewObjectScript 预览对象脚本。
func PreviewObjectScript(p ObjectScriptParams, profile *dialect.ServerProfile) (*ObjectScriptResult, error) {
	return PrepareObjectScript(p, profile)
}

// ApplyObjectScript 在事务中执行对象脚本。
func ApplyObjectScript(ctx context.Context, db *sql.DB, p ObjectScriptParams, profile *dialect.ServerProfile) (*ObjectScriptResult, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: nil db")
	}
	start := time.Now()
	prepared, err := PrepareObjectScript(p, profile)
	if err != nil {
		return nil, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("sqlite: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, stmt := range prepared.SQL {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return nil, fmt.Errorf("sqlite: exec object script: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("sqlite: commit: %w", err)
	}
	prepared.DurationMS = time.Since(start).Milliseconds()
	return prepared, nil
}
