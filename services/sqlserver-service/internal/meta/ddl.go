package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// GetDDL 返回表 / 视图 / 同义词的 CREATE 脚本。
func GetDDL(ctx context.Context, db *sql.DB, ref RelationRef) (*DDLResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	objectType, err := detectObjectType(ctx, db, ref)
	if err != nil {
		return nil, err
	}
	switch objectType {
	case "view":
		ddl, err := moduleDefinition(ctx, db, ref)
		if err != nil {
			return nil, err
		}
		return &DDLResult{ObjectType: objectType, DDL: ddl}, nil
	case "synonym":
		ddl, err := synonymDDL(ctx, db, ref)
		if err != nil {
			return nil, err
		}
		return &DDLResult{ObjectType: objectType, DDL: ddl}, nil
	case "table":
		ddl, err := tableDDL(ctx, db, ref)
		if err != nil {
			return nil, err
		}
		return &DDLResult{ObjectType: objectType, DDL: ddl}, nil
	default:
		ddl, err := moduleDefinition(ctx, db, ref)
		if err != nil || strings.TrimSpace(ddl) == "" {
			return &DDLResult{ObjectType: "unknown", DDL: ""}, err
		}
		return &DDLResult{ObjectType: "unknown", DDL: ddl}, nil
	}
}

func detectObjectType(ctx context.Context, db *sql.DB, ref RelationRef) (string, error) {
	const q = `SELECT type FROM sys.objects WHERE object_id = OBJECT_ID(@p1)`
	var typ sql.NullString
	if err := db.QueryRowContext(ctx, q, objectIDArg(ref.Schema, ref.Name)).Scan(&typ); err != nil {
		if err == sql.ErrNoRows {
			return "unknown", nil
		}
		return "", fmt.Errorf("sqlserver: object type: %w", err)
	}
	switch strings.TrimSpace(typ.String) {
	case "U":
		return "table", nil
	case "V":
		return "view", nil
	case "SN":
		return "synonym", nil
	default:
		return "unknown", nil
	}
}

func moduleDefinition(ctx context.Context, db *sql.DB, ref RelationRef) (string, error) {
	const q = `SELECT m.definition FROM sys.sql_modules m WHERE m.object_id = OBJECT_ID(@p1)`
	var def sql.NullString
	if err := db.QueryRowContext(ctx, q, objectIDArg(ref.Schema, ref.Name)).Scan(&def); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("sqlserver: module definition: %w", err)
	}
	return strings.TrimSpace(def.String), nil
}

func synonymDDL(ctx context.Context, db *sql.DB, ref RelationRef) (string, error) {
	const q = `
SELECT s.base_object_name
FROM sys.synonyms s
WHERE s.object_id = OBJECT_ID(@p1)`
	var base sql.NullString
	if err := db.QueryRowContext(ctx, q, objectIDArg(ref.Schema, ref.Name)).Scan(&base); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("sqlserver: synonym: %w", err)
	}
	target := strings.TrimSpace(base.String)
	if target == "" {
		target = "/* missing base object */"
	}
	return "CREATE SYNONYM " + qualifiedName(ref.Schema, ref.Name) + " FOR " + target + ";\n", nil
}

func tableDDL(ctx context.Context, db *sql.DB, ref RelationRef) (string, error) {
	cols, err := ListColumns(ctx, db, ref)
	if err != nil {
		return "", err
	}
	if len(cols.Columns) == 0 {
		return "", fmt.Errorf("sqlserver: table %s has no columns", objectIDArg(ref.Schema, ref.Name))
	}
	indexes, err := ListIndexes(ctx, db, ref)
	if err != nil {
		return "", err
	}
	return AssembleTableDDL(ref, cols.Columns, indexes.Indexes, cols.TableComment), nil
}

// AssembleTableDDL 由列 / 索引拼装 CREATE TABLE（供单测，不访问服务器）。
func AssembleTableDDL(ref RelationRef, columns []ColumnInfo, indexes []IndexInfo, comment string) string {
	var b strings.Builder
	b.WriteString("CREATE TABLE ")
	b.WriteString(qualifiedName(ref.Schema, ref.Name))
	b.WriteString(" (\n")
	for i, col := range columns {
		b.WriteString("  ")
		b.WriteString(formatColumnLine(col))
		if i < len(columns)-1 || hasInlineConstraints(indexes) {
			b.WriteString(",")
		}
		b.WriteByte('\n')
	}
	writeTableConstraints(&b, indexes)
	b.WriteString(");\n")
	writeSecondaryIndexes(&b, ref, indexes)
	if strings.TrimSpace(comment) != "" {
		b.WriteString("-- ")
		b.WriteString(strings.ReplaceAll(comment, "\n", " "))
		b.WriteByte('\n')
	}
	return b.String()
}

func formatColumnLine(col ColumnInfo) string {
	var b strings.Builder
	b.WriteString(mustQuote(col.Name))
	if col.Computed && col.ComputedDef != "" {
		b.WriteString(" AS ")
		b.WriteString(col.ComputedDef)
		return b.String()
	}
	b.WriteByte(' ')
	b.WriteString(col.DataType)
	if col.AutoIncrement {
		seed := col.IdentitySeed
		if seed == "" {
			seed = "1"
		}
		incr := col.IdentityIncr
		if incr == "" {
			incr = "1"
		}
		b.WriteString(" IDENTITY(")
		b.WriteString(seed)
		b.WriteString(", ")
		b.WriteString(incr)
		b.WriteByte(')')
	}
	if !col.Nullable {
		b.WriteString(" NOT NULL")
	} else {
		b.WriteString(" NULL")
	}
	if col.Default != nil && strings.TrimSpace(*col.Default) != "" {
		b.WriteString(" DEFAULT ")
		b.WriteString(strings.TrimSpace(*col.Default))
	}
	return b.String()
}

func hasInlineConstraints(indexes []IndexInfo) bool {
	for _, idx := range indexes {
		if idx.Primary || idx.Unique {
			return true
		}
	}
	return false
}

func writeTableConstraints(b *strings.Builder, indexes []IndexInfo) {
	first := true
	for _, idx := range indexes {
		if !idx.Primary && !idx.Unique {
			continue
		}
		if !first {
			b.WriteString(",\n")
		}
		first = false
		b.WriteString("  CONSTRAINT ")
		b.WriteString(mustQuote(idx.Name))
		if idx.Primary {
			b.WriteString(" PRIMARY KEY (")
		} else {
			b.WriteString(" UNIQUE (")
		}
		b.WriteString(strings.Join(quoteList(idx.Columns), ", "))
		b.WriteByte(')')
	}
	if !first {
		b.WriteByte('\n')
	}
}

func writeSecondaryIndexes(b *strings.Builder, ref RelationRef, indexes []IndexInfo) {
	for _, idx := range indexes {
		if idx.Primary || idx.Unique {
			continue
		}
		b.WriteString("CREATE ")
		if idx.Unique {
			b.WriteString("UNIQUE ")
		}
		b.WriteString("INDEX ")
		b.WriteString(mustQuote(idx.Name))
		b.WriteString(" ON ")
		b.WriteString(qualifiedName(ref.Schema, ref.Name))
		b.WriteString(" (")
		b.WriteString(strings.Join(quoteList(idx.Columns), ", "))
		b.WriteString(");\n")
	}
}
