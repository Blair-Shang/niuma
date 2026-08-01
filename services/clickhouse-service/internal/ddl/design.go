package ddl

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	DesignAddColumn       = "add_column"
	DesignDropColumn      = "drop_column"
	DesignRenameColumn    = "rename_column"
	DesignModifyColumn    = "modify_column"
	DesignSetTableComment = "set_table_comment"
	// DesignSetOrderBy 对应 ALTER TABLE … MODIFY ORDER BY（含主键前缀语义）。
	DesignSetOrderBy = "set_order_by"
	// DesignAddIndex 对应 ALTER TABLE … ADD INDEX（数据跳过索引）。
	DesignAddIndex = "add_index"
	// DesignDropIndex 对应 ALTER TABLE … DROP INDEX。
	DesignDropIndex = "drop_index"
)

// DesignOp 是一条受控 ALTER 操作。
type DesignOp struct {
	Op          string  `json:"op"`
	Name        string  `json:"name,omitempty"`
	NewName     string  `json:"newName,omitempty"`
	DataType    string  `json:"dataType,omitempty"`
	Default     *string `json:"default,omitempty"`
	Comment     string  `json:"comment,omitempty"`
	Expression  string  `json:"expression,omitempty"`
	Type        string  `json:"type,omitempty"`        // 跳数索引类型（minmax / set / …）
	Granularity int     `json:"granularity,omitempty"` // 跳数索引 GRANULARITY
}

// DesignPreviewParams 预览 ALTER SQL。
type DesignPreviewParams struct {
	Database string     `json:"database"`
	Name     string     `json:"name"`
	Ops      []DesignOp `json:"ops"`
	Cluster  string     `json:"cluster,omitempty"`
}

// DesignPreviewResult 预览结果。
type DesignPreviewResult struct {
	SQL []string `json:"sql"`
}

// DesignApplyParams 应用设计变更。
type DesignApplyParams struct {
	Database string     `json:"database"`
	Name     string     `json:"name"`
	Ops      []DesignOp `json:"ops"`
	Cluster  string     `json:"cluster,omitempty"`
}

// DesignApplyResult 应用结果。
type DesignApplyResult struct {
	SQL        []string `json:"sql"`
	DurationMS int64    `json:"durationMs"`
}

func validateKeyExpression(expr string) error {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return fmt.Errorf("clickhouse: expression required")
	}
	if strings.ContainsAny(expr, ";\x00") {
		return fmt.Errorf("clickhouse: invalid expression")
	}
	return nil
}

func buildDesignSQL(database, table, cluster string, op DesignOp) (string, error) {
	if err := requireDatabaseName(database, table); err != nil {
		return "", err
	}
	rel, err := qualified(database, table)
	if err != nil {
		return "", err
	}
	onCluster, err := onClusterClause(cluster)
	if err != nil {
		return "", err
	}

	switch op.Op {
	case DesignAddColumn:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("clickhouse: add_column requires name")
		}
		dt := strings.TrimSpace(op.DataType)
		if err := validateDataType(dt); err != nil {
			return "", err
		}
		qn, err := quoteIdent(name)
		if err != nil {
			return "", err
		}
		var b strings.Builder
		b.WriteString("ALTER TABLE ")
		b.WriteString(rel)
		b.WriteString(onCluster)
		b.WriteString(" ADD COLUMN ")
		b.WriteString(qn)
		b.WriteByte(' ')
		b.WriteString(dt)
		if op.Default != nil {
			if def := strings.TrimSpace(*op.Default); def != "" {
				b.WriteString(" DEFAULT ")
				b.WriteString(def)
			}
		}
		if c := strings.TrimSpace(op.Comment); c != "" {
			b.WriteString(" COMMENT '")
			b.WriteString(escapeStringLiteral(c))
			b.WriteByte('\'')
		}
		return b.String(), nil

	case DesignDropColumn:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("clickhouse: drop_column requires name")
		}
		qn, err := quoteIdent(name)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("ALTER TABLE %s%s DROP COLUMN %s", rel, onCluster, qn), nil

	case DesignRenameColumn:
		name := strings.TrimSpace(op.Name)
		newName := strings.TrimSpace(op.NewName)
		if name == "" || newName == "" {
			return "", fmt.Errorf("clickhouse: rename_column requires name and newName")
		}
		from, err := quoteIdent(name)
		if err != nil {
			return "", err
		}
		to, err := quoteIdent(newName)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("ALTER TABLE %s%s RENAME COLUMN %s TO %s", rel, onCluster, from, to), nil

	case DesignModifyColumn:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("clickhouse: modify_column requires name")
		}
		dt := strings.TrimSpace(op.DataType)
		if err := validateDataType(dt); err != nil {
			return "", err
		}
		qn, err := quoteIdent(name)
		if err != nil {
			return "", err
		}
		var b strings.Builder
		b.WriteString("ALTER TABLE ")
		b.WriteString(rel)
		b.WriteString(onCluster)
		b.WriteString(" MODIFY COLUMN ")
		b.WriteString(qn)
		b.WriteByte(' ')
		b.WriteString(dt)
		if op.Default != nil {
			if def := strings.TrimSpace(*op.Default); def != "" {
				b.WriteString(" DEFAULT ")
				b.WriteString(def)
			}
		}
		if c := strings.TrimSpace(op.Comment); c != "" {
			b.WriteString(" COMMENT '")
			b.WriteString(escapeStringLiteral(c))
			b.WriteByte('\'')
		}
		return b.String(), nil

	case DesignSetTableComment:
		c := strings.TrimSpace(op.Comment)
		return fmt.Sprintf("ALTER TABLE %s%s MODIFY COMMENT '%s'", rel, onCluster, escapeStringLiteral(c)), nil

	case DesignSetOrderBy:
		expr := strings.TrimSpace(op.Expression)
		if err := validateKeyExpression(expr); err != nil {
			return "", fmt.Errorf("clickhouse: set_order_by: %w", err)
		}
		return fmt.Sprintf("ALTER TABLE %s%s MODIFY ORDER BY %s", rel, onCluster, expr), nil

	case DesignAddIndex:
		name := strings.TrimSpace(op.Name)
		expr := strings.TrimSpace(op.Expression)
		typ := strings.TrimSpace(op.Type)
		if typ == "" {
			typ = strings.TrimSpace(op.DataType)
		}
		if name == "" {
			return "", fmt.Errorf("clickhouse: add_index requires name")
		}
		if err := validateKeyExpression(expr); err != nil {
			return "", fmt.Errorf("clickhouse: add_index: %w", err)
		}
		if typ == "" || strings.ContainsAny(typ, ";\x00 ") {
			return "", fmt.Errorf("clickhouse: add_index requires type")
		}
		qn, err := quoteIdent(name)
		if err != nil {
			return "", err
		}
		var b strings.Builder
		b.WriteString("ALTER TABLE ")
		b.WriteString(rel)
		b.WriteString(onCluster)
		b.WriteString(" ADD INDEX ")
		b.WriteString(qn)
		b.WriteByte(' ')
		b.WriteString(expr)
		b.WriteString(" TYPE ")
		b.WriteString(typ)
		if op.Granularity > 0 {
			b.WriteString(fmt.Sprintf(" GRANULARITY %d", op.Granularity))
		}
		return b.String(), nil

	case DesignDropIndex:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("clickhouse: drop_index requires name")
		}
		qn, err := quoteIdent(name)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("ALTER TABLE %s%s DROP INDEX %s", rel, onCluster, qn), nil

	default:
		return "", fmt.Errorf("clickhouse: unsupported design op %q", op.Op)
	}
}

// PreviewDesign 生成 ALTER SQL 列表。
func PreviewDesign(p DesignPreviewParams) (*DesignPreviewResult, error) {
	if err := requireDatabaseName(p.Database, p.Name); err != nil {
		return nil, err
	}
	if len(p.Ops) == 0 {
		return nil, fmt.Errorf("clickhouse: no design ops")
	}
	sqls := make([]string, 0, len(p.Ops))
	for i, op := range p.Ops {
		q, err := buildDesignSQL(p.Database, p.Name, p.Cluster, op)
		if err != nil {
			return nil, fmt.Errorf("clickhouse: ops[%d]: %w", i, err)
		}
		sqls = append(sqls, q)
	}
	return &DesignPreviewResult{SQL: sqls}, nil
}

// ApplyDesign 预览并执行 ALTER。
func ApplyDesign(ctx context.Context, db *sql.DB, p DesignApplyParams) (*DesignApplyResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: designApply: nil db")
	}
	preview, err := PreviewDesign(DesignPreviewParams{
		Database: p.Database,
		Name:     p.Name,
		Ops:      p.Ops,
		Cluster:  p.Cluster,
	})
	if err != nil {
		return nil, err
	}
	start := time.Now()
	for _, q := range preview.SQL {
		if _, err := db.ExecContext(ctx, q); err != nil {
			return nil, fmt.Errorf("clickhouse: designApply: %w", err)
		}
	}
	return &DesignApplyResult{
		SQL:        preview.SQL,
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}
