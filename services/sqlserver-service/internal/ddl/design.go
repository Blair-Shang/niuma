package ddl

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	DesignAddColumn        = "add_column"
	DesignDropColumn       = "drop_column"
	DesignRenameColumn     = "rename_column"
	DesignAlterType        = "alter_type"
	DesignSetNull          = "set_null"
	DesignSetNotNull       = "set_not_null"
	DesignSetDefault       = "set_default"
	DesignDropDefault      = "drop_default"
	DesignSetColumnComment = "set_column_comment"
	DesignAddPrimaryKey    = "add_primary_key"
	DesignDropPrimaryKey   = "drop_primary_key"
	DesignAddIndex         = "add_index"
	DesignDropIndex        = "drop_index"
	DesignRenameIndex      = "rename_index"
	DesignAddForeignKey    = "add_foreign_key"
	DesignAddCheck         = "add_check"
	DesignDropConstraint   = "drop_constraint"
	DesignSetTableComment  = "set_table_comment"
)

var allowedFKActions = map[string]string{
	"":            "",
	"NO ACTION":   "NO ACTION",
	"RESTRICT":    "NO ACTION",
	"CASCADE":     "CASCADE",
	"SET NULL":    "SET NULL",
	"SET DEFAULT": "SET DEFAULT",
}

// DesignOp 是一条受控 ALTER 操作，JSON 结构与 MySQL / 达梦对齐。
type DesignOp struct {
	Op            string   `json:"op"`
	Name          string   `json:"name"`
	NewName       string   `json:"newName,omitempty"`
	DataType      string   `json:"dataType,omitempty"`
	Default       *string  `json:"default,omitempty"`
	Nullable      *bool    `json:"nullable,omitempty"`
	Comment       string   `json:"comment,omitempty"`
	Columns       []string `json:"columns,omitempty"`
	Unique        *bool    `json:"unique,omitempty"`
	Method        string   `json:"method,omitempty"`
	Expression    string   `json:"expression,omitempty"`
	RefDatabase   string   `json:"refDatabase,omitempty"`
	RefSchema     string   `json:"refSchema,omitempty"`
	RefTable      string   `json:"refTable,omitempty"`
	RefColumns    []string `json:"refColumns,omitempty"`
	OnDelete      string   `json:"onDelete,omitempty"`
	OnUpdate      string   `json:"onUpdate,omitempty"`
	AutoIncrement bool     `json:"autoIncrement,omitempty"`
}

// DesignPreviewParams 预览 ALTER SQL 的入参。
type DesignPreviewParams struct {
	Schema   string     `json:"schema"`
	Database string     `json:"database"`
	Name     string     `json:"name"`
	Ops      []DesignOp `json:"ops"`
}

func (p DesignPreviewParams) schema() string {
	s := strings.TrimSpace(p.Schema)
	if s == "" {
		s = "dbo"
	}
	return s
}

// DesignPreviewResult 预览结果。
type DesignPreviewResult struct {
	SQL []string `json:"sql"`
}

// DesignApplyParams 应用设计变更的入参。
type DesignApplyParams struct {
	Schema   string     `json:"schema"`
	Database string     `json:"database"`
	Name     string     `json:"name"`
	Ops      []DesignOp `json:"ops"`
}

func (p DesignApplyParams) schema() string {
	s := strings.TrimSpace(p.Schema)
	if s == "" {
		s = "dbo"
	}
	return s
}

// DesignApplyResult 应用结果。
type DesignApplyResult struct {
	SQL        []string `json:"sql"`
	DurationMS int64    `json:"durationMs"`
}

func normalizeFKAction(raw string) (string, error) {
	a := strings.ToUpper(strings.TrimSpace(raw))
	if v, ok := allowedFKActions[a]; ok {
		return v, nil
	}
	return "", fmt.Errorf("sqlserver: unsupported FK action %q", raw)
}

func buildDesignSQL(schema, table string, op DesignOp) ([]string, error) {
	if err := requireSchemaName(schema, table); err != nil {
		return nil, err
	}
	rel := qualified(schema, table)

	switch op.Op {
	case DesignAddColumn:
		sql, err := buildAddColumn(rel, op)
		if err != nil {
			return nil, err
		}
		out := []string{sql}
		if c := strings.TrimSpace(op.Comment); c != "" {
			out = append(out, columnCommentSQL(schema, table, op.Name, c))
		}
		return out, nil

	case DesignDropColumn:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: drop_column requires name")
		}
		return []string{fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", rel, quoteIdent(name))}, nil

	case DesignRenameColumn:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: rename_column requires name")
		}
		if err := requireNewName(op.NewName); err != nil {
			return nil, err
		}
		newName := strings.TrimSpace(op.NewName)
		out := make([]string, 0, 2)
		if name != newName {
			src := schema + "." + table + "." + name
			out = append(out, fmt.Sprintf(
				"EXEC sys.sp_rename %s, %s, N'COLUMN'",
				quoteNString(src), quoteNString(newName),
			))
		}
		dt := strings.TrimSpace(op.DataType)
		if dt != "" {
			if err := validateDataType(dt); err != nil {
				return nil, err
			}
			nullSuffix := ""
			if op.Nullable != nil {
				if *op.Nullable {
					nullSuffix = " NULL"
				} else {
					nullSuffix = " NOT NULL"
				}
			}
			out = append(out, fmt.Sprintf(
				"ALTER TABLE %s ALTER COLUMN %s %s%s",
				rel, quoteIdent(newName), dt, nullSuffix,
			))
		} else if name == newName {
			return nil, fmt.Errorf("sqlserver: rename_column to the same name is a no-op")
		}
		return out, nil

	case DesignAlterType:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: alter_type requires name")
		}
		dt := strings.TrimSpace(op.DataType)
		if err := validateDataType(dt); err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s %s", rel, quoteIdent(name), dt)}, nil

	case DesignSetNull:
		return buildAlterNullability(rel, op, true)

	case DesignSetNotNull:
		return buildAlterNullability(rel, op, false)

	case DesignSetDefault:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: set_default requires name")
		}
		if op.Default == nil || strings.TrimSpace(*op.Default) == "" {
			return nil, fmt.Errorf("sqlserver: set_default requires default expression")
		}
		dfName := "DF_" + table + "_" + name
		return []string{
			dropDefaultSQL(schema, table, name),
			fmt.Sprintf(
				"ALTER TABLE %s ADD CONSTRAINT %s DEFAULT %s FOR %s",
				rel, quoteIdent(dfName), FormatDefaultExpr(strings.TrimSpace(*op.Default)), quoteIdent(name),
			),
		}, nil

	case DesignDropDefault:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: drop_default requires name")
		}
		return []string{dropDefaultSQL(schema, table, name)}, nil

	case DesignSetColumnComment:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: set_column_comment requires name")
		}
		return []string{columnCommentSQL(schema, table, name, op.Comment)}, nil

	case DesignAddPrimaryKey:
		cols, err := quoteIdentList(op.Columns)
		if err != nil {
			return nil, err
		}
		name := strings.TrimSpace(op.Name)
		if name == "" {
			name = "PK_" + table
		}
		return []string{fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT %s PRIMARY KEY (%s)", rel, quoteIdent(name), cols)}, nil

	case DesignDropPrimaryKey:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: drop_primary_key requires constraint name")
		}
		return []string{fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT %s", rel, quoteIdent(name))}, nil

	case DesignAddIndex:
		sql, err := buildAddIndex(schema, table, op)
		if err != nil {
			return nil, err
		}
		return []string{sql}, nil

	case DesignDropIndex:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: drop_index requires name")
		}
		return []string{fmt.Sprintf("DROP INDEX %s ON %s", quoteIdent(name), rel)}, nil

	case DesignRenameIndex:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: rename_index requires name")
		}
		if err := requireNewName(op.NewName); err != nil {
			return nil, err
		}
		src := schema + "." + table + "." + name
		return []string{fmt.Sprintf(
			"EXEC sys.sp_rename %s, %s, N'INDEX'",
			quoteNString(src), quoteNString(strings.TrimSpace(op.NewName)),
		)}, nil

	case DesignAddForeignKey:
		sql, err := buildAddForeignKey(rel, schema, op)
		if err != nil {
			return nil, err
		}
		return []string{sql}, nil

	case DesignAddCheck:
		sql, err := buildAddCheck(rel, table, op)
		if err != nil {
			return nil, err
		}
		return []string{sql}, nil

	case DesignDropConstraint:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: drop_constraint requires constraint name")
		}
		return []string{fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT %s", rel, quoteIdent(name))}, nil

	case DesignSetTableComment:
		return []string{tableCommentSQL(schema, table, op.Comment)}, nil

	default:
		return nil, fmt.Errorf("sqlserver: unsupported design op %q", op.Op)
	}
}

func buildAddColumn(rel string, op DesignOp) (string, error) {
	name := strings.TrimSpace(op.Name)
	dt := strings.TrimSpace(op.DataType)
	if name == "" || dt == "" {
		return "", fmt.Errorf("sqlserver: add_column requires name and dataType")
	}
	if err := validateDataType(dt); err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "ALTER TABLE %s ADD %s %s", rel, quoteIdent(name), dt)
	if op.AutoIncrement && !strings.Contains(strings.ToUpper(dt), "IDENTITY") {
		b.WriteString(" IDENTITY(1,1)")
	}
	if op.Nullable != nil && !*op.Nullable {
		b.WriteString(" NOT NULL")
	} else if !op.AutoIncrement {
		b.WriteString(" NULL")
	} else {
		b.WriteString(" NOT NULL")
	}
	if op.Default != nil && !op.AutoIncrement {
		if def := FormatDefaultExpr(*op.Default); def != "" {
			b.WriteString(" CONSTRAINT ")
			b.WriteString(quoteIdent("DF_add_" + name))
			b.WriteString(" DEFAULT ")
			b.WriteString(def)
		}
	}
	return b.String(), nil
}

func buildAlterNullability(rel string, op DesignOp, nullable bool) ([]string, error) {
	name := strings.TrimSpace(op.Name)
	if name == "" {
		return nil, fmt.Errorf("sqlserver: %s requires name", op.Op)
	}
	dt := strings.TrimSpace(op.DataType)
	if err := validateDataType(dt); err != nil {
		return nil, err
	}
	suffix := " NULL"
	if !nullable {
		suffix = " NOT NULL"
	}
	return []string{fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s %s%s", rel, quoteIdent(name), dt, suffix)}, nil
}

func buildAddIndex(schema, table string, op DesignOp) (string, error) {
	name := strings.TrimSpace(op.Name)
	if name == "" {
		return "", fmt.Errorf("sqlserver: add_index requires name")
	}
	cols, err := quoteIdentList(op.Columns)
	if err != nil {
		return "", err
	}
	method, err := normalizeIndexMethod(op.Method)
	if err != nil {
		return "", err
	}
	unique := op.Unique != nil && *op.Unique
	return formatCreateIndexSQL(unique, method, name, qualified(schema, table), cols), nil
}

func buildAddCheck(rel, table string, op DesignOp) (string, error) {
	expr := strings.TrimSpace(op.Expression)
	if err := validateSQLFragment(expr, "check expression"); err != nil {
		return "", err
	}
	name := strings.TrimSpace(op.Name)
	if name == "" {
		name = table + "_check"
	}
	return fmt.Sprintf(
		"ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s)",
		rel, quoteIdent(name), expr,
	), nil
}

func buildAddForeignKey(rel, schema string, op DesignOp) (string, error) {
	cols, err := quoteIdentList(op.Columns)
	if err != nil {
		return "", err
	}
	refCols, err := quoteIdentList(op.RefColumns)
	if err != nil {
		return "", fmt.Errorf("sqlserver: refColumns: %w", err)
	}
	refSchema := strings.TrimSpace(op.RefSchema)
	if refSchema == "" {
		refSchema = strings.TrimSpace(op.RefDatabase)
	}
	if refSchema == "" {
		refSchema = schema
	}
	refTable := strings.TrimSpace(op.RefTable)
	if refTable == "" {
		return "", fmt.Errorf("sqlserver: add_foreign_key requires refTable")
	}
	name := strings.TrimSpace(op.Name)
	if name == "" {
		name = strings.Join(op.Columns, "_") + "_fk"
	}
	onDelete, err := normalizeFKAction(op.OnDelete)
	if err != nil {
		return "", err
	}
	onUpdate, err := normalizeFKAction(op.OnUpdate)
	if err != nil {
		return "", err
	}
	sql := fmt.Sprintf(
		"ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
		rel, quoteIdent(name), cols, qualified(refSchema, refTable), refCols,
	)
	if onDelete != "" && onDelete != "NO ACTION" {
		sql += " ON DELETE " + onDelete
	}
	if onUpdate != "" && onUpdate != "NO ACTION" {
		sql += " ON UPDATE " + onUpdate
	}
	return sql, nil
}

// PreviewDesign 根据参数生成 ALTER 脚本（不执行）。
func PreviewDesign(params DesignPreviewParams) (*DesignPreviewResult, error) {
	schema := params.schema()
	if len(params.Ops) == 0 {
		return &DesignPreviewResult{SQL: []string{}}, nil
	}
	out := make([]string, 0, len(params.Ops))
	for _, op := range params.Ops {
		stmts, err := buildDesignSQL(schema, params.Name, op)
		if err != nil {
			return nil, err
		}
		out = append(out, stmts...)
	}
	return &DesignPreviewResult{SQL: out}, nil
}

// ApplyDesign 在事务中执行白名单 ALTER；任一步失败整批回滚。
func ApplyDesign(ctx context.Context, db *sql.DB, params DesignApplyParams) (*DesignApplyResult, error) {
	preview, err := PreviewDesign(DesignPreviewParams{
		Schema: params.schema(),
		Name:   params.Name,
		Ops:    params.Ops,
	})
	if err != nil {
		return nil, err
	}
	if len(preview.SQL) == 0 {
		return nil, fmt.Errorf("sqlserver: no design ops")
	}

	start := time.Now()
	if err := execSQLBatchInTx(ctx, db, preview.SQL, "design apply"); err != nil {
		return nil, err
	}
	return &DesignApplyResult{
		SQL:        preview.SQL,
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}
