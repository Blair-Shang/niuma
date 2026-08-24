package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
)

// FormatDataType 把 sys.columns 的类型字段拼成 T-SQL 类型字面量。
func FormatDataType(typeName string, maxLen, precision, scale int32) string {
	name := strings.TrimSpace(typeName)
	if name == "" {
		return "nvarchar(max)"
	}
	switch strings.ToLower(name) {
	case "nvarchar", "nchar":
		if maxLen < 0 {
			return name + "(max)"
		}
		chars := maxLen / 2
		if chars < 1 {
			chars = 1
		}
		return name + "(" + strconv.Itoa(int(chars)) + ")"
	case "varchar", "char", "varbinary", "binary":
		if maxLen < 0 {
			return name + "(max)"
		}
		return name + "(" + strconv.Itoa(int(maxLen)) + ")"
	case "decimal", "numeric":
		return fmt.Sprintf("%s(%d,%d)", name, precision, scale)
	case "datetime2", "datetimeoffset", "time":
		return fmt.Sprintf("%s(%d)", name, scale)
	case "float":
		if precision > 0 && precision != 53 {
			return fmt.Sprintf("%s(%d)", name, precision)
		}
	}
	return name
}

// ListColumns 列出表 / 视图列；同义词解析到 base_object_name。
func ListColumns(ctx context.Context, db *sql.DB, ref RelationRef) (*ColumnsResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT
  c.column_id,
  c.name,
  TYPE_NAME(c.user_type_id),
  c.max_length,
  c.precision,
  c.scale,
  c.is_nullable,
  OBJECT_DEFINITION(c.default_object_id),
  CAST(ep.value AS nvarchar(4000)),
  c.is_identity,
  CONVERT(nvarchar(32), idc.seed_value),
  CONVERT(nvarchar(32), idc.increment_value),
  c.is_computed,
  cc.definition
FROM sys.columns c
LEFT JOIN sys.identity_columns idc
  ON idc.object_id = c.object_id AND idc.column_id = c.column_id
LEFT JOIN sys.computed_columns cc
  ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.extended_properties ep
  ON ep.major_id = c.object_id AND ep.minor_id = c.column_id
 AND ep.class = 1 AND ep.name = N'MS_Description'
WHERE c.object_id = COALESCE(
  (
    SELECT OBJECT_ID(s.base_object_name)
    FROM sys.synonyms s
    WHERE s.object_id = OBJECT_ID(@p1)
  ),
  OBJECT_ID(@p1)
)
ORDER BY c.column_id`

	rows, err := db.QueryContext(ctx, q, objectIDArg(ref.Schema, ref.Name))
	if err != nil {
		return nil, fmt.Errorf("sqlserver: list columns: %w", err)
	}
	defer rows.Close()

	out := make([]ColumnInfo, 0)
	for rows.Next() {
		var (
			col      ColumnInfo
			typeName string
			maxLen   int32
			prec     int32
			scale    int32
			nullable bool
			def      sql.NullString
			comment  sql.NullString
			ident    bool
			seed     sql.NullString
			incr     sql.NullString
			computed bool
			compDef  sql.NullString
		)
		if err := rows.Scan(
			&col.Ordinal, &col.Name, &typeName, &maxLen, &prec, &scale,
			&nullable, &def, &comment, &ident, &seed, &incr, &computed, &compDef,
		); err != nil {
			return nil, fmt.Errorf("sqlserver: list columns scan: %w", err)
		}
		col.DataType = FormatDataType(typeName, maxLen, prec, scale)
		col.Nullable = nullable
		if def.Valid && strings.TrimSpace(def.String) != "" {
			v := strings.TrimSpace(def.String)
			col.Default = &v
		}
		if comment.Valid {
			col.Comment = comment.String
		}
		col.AutoIncrement = ident
		if seed.Valid {
			col.IdentitySeed = seed.String
		}
		if incr.Valid {
			col.IdentityIncr = incr.String
		}
		col.Computed = computed
		if compDef.Valid {
			col.ComputedDef = strings.TrimSpace(compDef.String)
		}
		out = append(out, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	comment, err := tableComment(ctx, db, ref)
	if err != nil {
		return nil, err
	}
	return &ColumnsResult{Columns: out, TableComment: comment}, nil
}

func tableComment(ctx context.Context, db *sql.DB, ref RelationRef) (string, error) {
	const q = `
SELECT CAST(ep.value AS nvarchar(4000))
FROM sys.extended_properties ep
WHERE ep.major_id = OBJECT_ID(@p1)
  AND ep.minor_id = 0
  AND ep.class = 1
  AND ep.name = N'MS_Description'`
	var comment sql.NullString
	if err := db.QueryRowContext(ctx, q, objectIDArg(ref.Schema, ref.Name)).Scan(&comment); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("sqlserver: table comment: %w", err)
	}
	if comment.Valid {
		return comment.String, nil
	}
	return "", nil
}
