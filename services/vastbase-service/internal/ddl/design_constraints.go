package ddl

import (
	"fmt"
	"strings"
)

// 约束 / 索引类设计操作（ALTER 白名单）。
const (
	DesignAddPrimaryKey   = "add_primary_key"
	DesignDropPrimaryKey  = "drop_primary_key"
	DesignAddUnique       = "add_unique"
	DesignAddIndex        = "add_index"
	DesignDropIndex       = "drop_index"
	DesignRenameIndex     = "rename_index"
	DesignDropConstraint  = "drop_constraint"
	DesignAddForeignKey   = "add_foreign_key"
	DesignAddCheck        = "add_check"
	DesignSetTableComment = "set_table_comment"
)

var allowedFKActions = map[string]string{
	"":            "",
	"NO ACTION":   "NO ACTION",
	"RESTRICT":    "RESTRICT",
	"CASCADE":     "CASCADE",
	"SET NULL":    "SET NULL",
	"SET DEFAULT": "SET DEFAULT",
}

var allowedIndexMethods = map[string]string{
	"":      "btree",
	"btree": "btree",
	"hash":  "hash",
	"gin":   "gin",
	"gist":  "gist",
	"brin":  "brin",
	"spgist": "spgist",
}

func designOpNeedsColumnName(op string) bool {
	switch op {
	case DesignAddPrimaryKey, DesignDropPrimaryKey, DesignAddUnique, DesignAddIndex,
		DesignDropIndex, DesignRenameIndex, DesignDropConstraint, DesignAddForeignKey,
		DesignAddCheck, DesignSetTableComment:
		return false
	default:
		return true
	}
}

func quoteIdentList(names []string) (string, error) {
	if len(names) == 0 {
		return "", fmt.Errorf("vastbase: columns required")
	}
	parts := make([]string, 0, len(names))
	for i, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			return "", fmt.Errorf("vastbase: columns[%d] empty", i)
		}
		parts = append(parts, quoteIdent(n))
	}
	return strings.Join(parts, ", "), nil
}

func validateSQLFragment(expr, field string) error {
	e := strings.TrimSpace(expr)
	if e == "" {
		return fmt.Errorf("vastbase: %s required", field)
	}
	lower := strings.ToLower(e)
	for _, bad := range []string{";", "--", "/*", "*/"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("vastbase: %s contains forbidden characters", field)
		}
	}
	return nil
}

func normalizeFKAction(raw string) (string, error) {
	a := strings.ToUpper(strings.TrimSpace(raw))
	if a == "" {
		return "", nil
	}
	if v, ok := allowedFKActions[a]; ok {
		return v, nil
	}
	return "", fmt.Errorf("vastbase: unsupported FK action %q", raw)
}

func normalizeIndexMethod(raw string) (string, error) {
	m := strings.ToLower(strings.TrimSpace(raw))
	if v, ok := allowedIndexMethods[m]; ok {
		return v, nil
	}
	return "", fmt.Errorf("vastbase: unsupported index method %q", raw)
}

func formatIndexKeys(op DesignOp) (string, error) {
	if expr := strings.TrimSpace(op.Expression); expr != "" {
		if err := validateSQLFragment(expr, "expression"); err != nil {
			return "", err
		}
		return expr, nil
	}
	return quoteIdentList(op.Columns)
}

func buildConstraintDesignSQL(schema, table string, op DesignOp) (string, error) {
	if err := requireSchemaName(schema, table); err != nil {
		return "", err
	}
	rel := qualified(schema, table)

	switch op.Op {
	case DesignAddPrimaryKey:
		cols, err := quoteIdentList(op.Columns)
		if err != nil {
			return "", err
		}
		name := strings.TrimSpace(op.Name)
		if name != "" {
			return fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT %s PRIMARY KEY (%s)", rel, quoteIdent(name), cols), nil
		}
		return fmt.Sprintf("ALTER TABLE %s ADD PRIMARY KEY (%s)", rel, cols), nil

	case DesignDropPrimaryKey:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("vastbase: drop_primary_key requires constraint name")
		}
		return fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s", rel, quoteIdent(name)), nil

	case DesignAddUnique:
		cols, err := quoteIdentList(op.Columns)
		if err != nil {
			return "", err
		}
		name := strings.TrimSpace(op.Name)
		if name == "" {
			name = table + "_" + strings.Join(op.Columns, "_") + "_key"
		}
		return fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT %s UNIQUE (%s)", rel, quoteIdent(name), cols), nil

	case DesignAddIndex:
		keys, err := formatIndexKeys(op)
		if err != nil {
			return "", err
		}
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("vastbase: add_index requires name")
		}
		unique := ""
		if op.Unique != nil && *op.Unique {
			unique = "UNIQUE "
		}
		method, err := normalizeIndexMethod(op.Method)
		if err != nil {
			return "", err
		}
		sql := fmt.Sprintf("CREATE %sINDEX %s ON %s", unique, quoteIdent(name), rel)
		if method != "" && method != "btree" {
			sql += " USING " + method
		}
		sql += " (" + keys + ")"
		if w := strings.TrimSpace(op.Where); w != "" {
			if err := validateSQLFragment(w, "where"); err != nil {
				return "", err
			}
			sql += " WHERE " + w
		}
		return sql, nil

	case DesignDropIndex:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("vastbase: drop_index requires name")
		}
		return fmt.Sprintf("DROP INDEX IF EXISTS %s.%s", quoteIdent(schema), quoteIdent(name)), nil

	case DesignRenameIndex:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("vastbase: rename_index requires name")
		}
		if err := requireNewName(op.NewName); err != nil {
			return "", err
		}
		return fmt.Sprintf(
			"ALTER INDEX %s.%s RENAME TO %s",
			quoteIdent(schema),
			quoteIdent(name),
			quoteIdent(op.NewName),
		), nil

	case DesignDropConstraint:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("vastbase: drop_constraint requires name")
		}
		return fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s", rel, quoteIdent(name)), nil

	case DesignAddCheck:
		expr := strings.TrimSpace(op.Expression)
		if err := validateSQLFragment(expr, "check expression"); err != nil {
			return "", err
		}
		name := strings.TrimSpace(op.Name)
		if name == "" {
			name = table + "_check"
		}
		return fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s)", rel, quoteIdent(name), expr), nil

	case DesignAddForeignKey:
		cols, err := quoteIdentList(op.Columns)
		if err != nil {
			return "", err
		}
		refCols, err := quoteIdentList(op.RefColumns)
		if err != nil {
			return "", fmt.Errorf("vastbase: refColumns: %w", err)
		}
		refSchema := strings.TrimSpace(op.RefSchema)
		refTable := strings.TrimSpace(op.RefTable)
		if refSchema == "" {
			refSchema = schema
		}
		if refTable == "" {
			return "", fmt.Errorf("vastbase: add_foreign_key requires refTable")
		}
		name := strings.TrimSpace(op.Name)
		if name == "" {
			name = table + "_" + strings.Join(op.Columns, "_") + "_fkey"
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
			rel,
			quoteIdent(name),
			cols,
			qualified(refSchema, refTable),
			refCols,
		)
		if onDelete != "" && onDelete != "NO ACTION" {
			sql += " ON DELETE " + onDelete
		}
		if onUpdate != "" && onUpdate != "NO ACTION" {
			sql += " ON UPDATE " + onUpdate
		}
		return sql, nil

	case DesignSetTableComment:
		lit := "NULL"
		if c := strings.TrimSpace(op.Comment); c != "" {
			lit = "'" + strings.ReplaceAll(c, "'", "''") + "'"
		}
		return fmt.Sprintf("COMMENT ON TABLE %s IS %s", rel, lit), nil

	default:
		return "", fmt.Errorf("vastbase: unsupported design op %q", op.Op)
	}
}
