package ddl

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DesignOpKind 是表设计白名单操作。
const (
	DesignAddColumn    = "add_column"
	DesignDropColumn   = "drop_column"
	DesignRenameColumn = "rename_column"
	DesignAlterType    = "alter_type"
	DesignSetNull      = "set_null"
	DesignSetNotNull   = "set_not_null"
	DesignSetDefault   = "set_default"
	DesignDropDefault  = "drop_default"
	DesignSetColumnComment = "set_column_comment"
)

// DesignOp 是一条受控 ALTER 操作。
type DesignOp struct {
	Op       string  `json:"op"`
	Name     string  `json:"name"`
	NewName  string  `json:"newName,omitempty"`
	DataType string  `json:"dataType,omitempty"`
	Default  *string `json:"default,omitempty"`
	// Nullable 仅 add_column：false 时内联 NOT NULL；nil 表示不指定。
	Nullable *bool `json:"nullable,omitempty"`
	// Comment 列/表注释。
	Comment string `json:"comment,omitempty"`
	// Columns 主键 / 唯一 / 索引 / 外键本地列。
	Columns []string `json:"columns,omitempty"`
	// Unique 仅 add_index。
	Unique *bool `json:"unique,omitempty"`
	// Expression 表达式索引键 / CHECK 表达式。
	Expression string `json:"expression,omitempty"`
	// Where 部分索引谓词（不含 WHERE 关键字）。
	Where string `json:"where,omitempty"`
	// Method 索引访问方法：btree/hash/gin/gist/brin/spgist。
	Method string `json:"method,omitempty"`
	// 外键引用目标。
	RefSchema  string   `json:"refSchema,omitempty"`
	RefTable   string   `json:"refTable,omitempty"`
	RefColumns []string `json:"refColumns,omitempty"`
	OnDelete   string   `json:"onDelete,omitempty"`
	OnUpdate   string   `json:"onUpdate,omitempty"`
}

// DesignApplyParams 应用设计变更。
type DesignApplyParams struct {
	Schema string     `json:"schema"`
	Name   string     `json:"name"`
	Ops    []DesignOp `json:"ops"`
}

// DesignApplyResult 应用结果。
type DesignApplyResult struct {
	SQL        []string `json:"sql"`
	CommandTags []string `json:"commandTags,omitempty"`
	DurationMS int64    `json:"durationMs"`
}

// DesignPreviewParams 预览 SQL。
type DesignPreviewParams struct {
	Schema string     `json:"schema"`
	Name   string     `json:"name"`
	Ops    []DesignOp `json:"ops"`
}

// DesignPreviewResult 预览结果。
type DesignPreviewResult struct {
	SQL []string `json:"sql"`
}

func buildDesignSQL(schema, table string, op DesignOp) (string, error) {
	switch op.Op {
	case DesignAddPrimaryKey, DesignDropPrimaryKey, DesignAddUnique, DesignAddIndex,
		DesignDropIndex, DesignRenameIndex, DesignDropConstraint, DesignAddForeignKey,
		DesignAddCheck, DesignSetTableComment:
		return buildConstraintDesignSQL(schema, table, op)
	}

	if err := requireSchemaName(schema, table); err != nil {
		return "", err
	}
	rel := qualified(schema, table)
	name := strings.TrimSpace(op.Name)
	if name == "" && designOpNeedsColumnName(op.Op) {
		return "", fmt.Errorf("vastbase: column name required")
	}
	col := quoteIdent(name)

	switch op.Op {
	case DesignAddColumn:
		if name == "" || strings.TrimSpace(op.DataType) == "" {
			return "", fmt.Errorf("vastbase: add_column requires name and dataType")
		}
		sql := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", rel, quoteIdent(name), strings.TrimSpace(op.DataType))
		if op.Nullable != nil && !*op.Nullable {
			sql += " NOT NULL"
		}
		if op.Default != nil && strings.TrimSpace(*op.Default) != "" {
			sql += " DEFAULT " + strings.TrimSpace(*op.Default)
		}
		return sql, nil
	case DesignDropColumn:
		return fmt.Sprintf("ALTER TABLE %s DROP COLUMN IF EXISTS %s CASCADE", rel, col), nil
	case DesignRenameColumn:
		if err := requireNewName(op.NewName); err != nil {
			return "", err
		}
		return fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s", rel, col, quoteIdent(op.NewName)), nil
	case DesignAlterType:
		if strings.TrimSpace(op.DataType) == "" {
			return "", fmt.Errorf("vastbase: alter_type requires dataType")
		}
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s TYPE %s", rel, col, strings.TrimSpace(op.DataType)), nil
	case DesignSetNull:
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP NOT NULL", rel, col), nil
	case DesignSetNotNull:
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET NOT NULL", rel, col), nil
	case DesignSetDefault:
		if op.Default == nil || strings.TrimSpace(*op.Default) == "" {
			return "", fmt.Errorf("vastbase: set_default requires default expression")
		}
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET DEFAULT %s", rel, col, strings.TrimSpace(*op.Default)), nil
	case DesignDropDefault:
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP DEFAULT", rel, col), nil
	case DesignSetColumnComment:
		lit := "NULL"
		if c := strings.TrimSpace(op.Comment); c != "" {
			lit = "'" + strings.ReplaceAll(c, "'", "''") + "'"
		}
		return fmt.Sprintf("COMMENT ON COLUMN %s.%s IS %s", rel, col, lit), nil
	default:
		return "", fmt.Errorf("vastbase: unsupported design op %q", op.Op)
	}
}

// PreviewDesign 生成 ALTER 脚本（不执行）。
func PreviewDesign(params DesignPreviewParams) (*DesignPreviewResult, error) {
	if len(params.Ops) == 0 {
		return &DesignPreviewResult{SQL: []string{}}, nil
	}
	out := make([]string, 0, len(params.Ops))
	for _, op := range params.Ops {
		sql, err := buildDesignSQL(params.Schema, params.Name, op)
		if err != nil {
			return nil, err
		}
		out = append(out, sql)
		// add_column 可附带列注释（同批追加 COMMENT）
		if op.Op == DesignAddColumn {
			if c := strings.TrimSpace(op.Comment); c != "" {
				commentOp := DesignOp{Op: DesignSetColumnComment, Name: op.Name, Comment: c}
				csql, err := buildDesignSQL(params.Schema, params.Name, commentOp)
				if err != nil {
					return nil, err
				}
				out = append(out, csql)
			}
		}
	}
	return &DesignPreviewResult{SQL: out}, nil
}

// ApplyDesign 在单事务中顺序执行白名单 ALTER；任一步失败则整批回滚。
func ApplyDesign(ctx context.Context, pool *pgxpool.Pool, params DesignApplyParams) (*DesignApplyResult, error) {
	preview, err := PreviewDesign(DesignPreviewParams{
		Schema: params.Schema,
		Name:   params.Name,
		Ops:    params.Ops,
	})
	if err != nil {
		return nil, err
	}
	if len(preview.SQL) == 0 {
		return nil, fmt.Errorf("vastbase: no design ops")
	}

	start := time.Now()
	tags, err := execSQLBatchInTx(ctx, pool, preview.SQL, "design apply")
	if err != nil {
		return nil, err
	}
	return &DesignApplyResult{
		SQL:         preview.SQL,
		CommandTags: tags,
		DurationMS:  time.Since(start).Milliseconds(),
	}, nil
}

func execSQLBatchInTx(ctx context.Context, pool *pgxpool.Pool, statements []string, label string) ([]string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("vastbase: %s begin: %w", label, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tags := make([]string, 0, len(statements))
	for i, sql := range statements {
		tag, err := tx.Exec(ctx, sql)
		if err != nil {
			return nil, fmt.Errorf(
				"vastbase: %s failed at statement %d/%d (rolled back): %w\nSQL: %s",
				label, i+1, len(statements), err, sql,
			)
		}
		tags = append(tags, tag.String())
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("vastbase: %s commit: %w", label, err)
	}
	return tags, nil
}
