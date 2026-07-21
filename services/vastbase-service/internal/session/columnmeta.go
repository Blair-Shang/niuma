package session

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// querier 是能执行只读增强查询的连接（池或独占 conn）。
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const columnMetaEnrichSQL = `
SELECT
  pg_catalog.format_type(f.typid, f.typmod) AS data_type,
  CASE
    WHEN f.relid = 0 OR f.attnum <= 0 THEN NULL
    ELSE NOT a.attnotnull
  END AS nullable,
  CASE
    WHEN f.relid = 0 OR f.attnum <= 0 THEN NULL
    ELSE EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index ix
      WHERE ix.indrelid = f.relid
        AND ix.indisprimary
        AND f.attnum = ANY (ix.indkey)
    )
  END AS is_pk
FROM unnest($1::oid[], $2::int4[], $3::oid[], $4::int2[])
  AS f(typid, typmod, relid, attnum)
LEFT JOIN pg_catalog.pg_attribute a
  ON a.attrelid = f.relid
 AND a.attnum = f.attnum
 AND NOT a.attisdropped
`

const columnFormatTypeSQL = `
SELECT pg_catalog.format_type(f.typid, f.typmod)
FROM unnest($1::oid[], $2::int4[]) AS f(typid, typmod)
`

// buildColumnMetas 根据 FieldDescription 构造列元数据：
//   - DataType：format_type(oid, typmod) 带精度（如 varchar(64)、numeric(10,2)）
//   - Nullable / PrimaryKey：来自真实表列时解析；表达式列则为空（前端可省略）。
func buildColumnMetas(ctx context.Context, q querier, fds []pgconn.FieldDescription) []ColumnMeta {
	out := baseColumnMetas(fds)
	if len(fds) == 0 || q == nil {
		return out
	}

	oids, mods, relids, attnums := fieldDescArrays(fds)
	rows, err := q.Query(ctx, columnMetaEnrichSQL, oids, mods, relids, attnums)
	if err == nil {
		defer rows.Close()
		applied, applyErr := applyEnrichedColumnMetas(out, rows)
		if applyErr == nil && applied == len(out) {
			return out
		}
		clearColumnKeyFlags(out)
	}
	applyFormatTypeFallback(ctx, q, out, oids, mods)
	return out
}

func applyFormatTypeFallback(ctx context.Context, q querier, out []ColumnMeta, oids []uint32, mods []int32) {
	if len(out) == 0 {
		return
	}
	rows, err := q.Query(ctx, columnFormatTypeSQL, oids, mods)
	if err != nil {
		return
	}
	defer rows.Close()
	i := 0
	for rows.Next() {
		if i >= len(out) {
			break
		}
		var dataType string
		if err := rows.Scan(&dataType); err != nil {
			return
		}
		if dataType != "" {
			out[i].DataType = dataType
		}
		i++
	}
}

func baseColumnMetas(fds []pgconn.FieldDescription) []ColumnMeta {
	out := make([]ColumnMeta, len(fds))
	for i, fd := range fds {
		out[i] = ColumnMeta{
			Name:     string(fd.Name),
			DataType: oidTypeName(fd.DataTypeOID),
		}
	}
	return out
}

func fieldDescArrays(fds []pgconn.FieldDescription) (oids []uint32, mods []int32, relids []uint32, attnums []int16) {
	oids = make([]uint32, len(fds))
	mods = make([]int32, len(fds))
	relids = make([]uint32, len(fds))
	attnums = make([]int16, len(fds))
	for i, fd := range fds {
		oids[i] = fd.DataTypeOID
		mods[i] = fd.TypeModifier
		relids[i] = fd.TableOID
		attnums[i] = int16(fd.TableAttributeNumber)
	}
	return oids, mods, relids, attnums
}

func applyEnrichedColumnMetas(out []ColumnMeta, rows pgx.Rows) (int, error) {
	i := 0
	for rows.Next() {
		if i >= len(out) {
			break
		}
		var dataType string
		var nullable *bool
		var isPK *bool
		if err := rows.Scan(&dataType, &nullable, &isPK); err != nil {
			return i, err
		}
		if dataType != "" {
			out[i].DataType = dataType
		}
		out[i].Nullable = nullable
		out[i].PrimaryKey = isPK
		i++
	}
	if err := rows.Err(); err != nil {
		return i, err
	}
	return i, nil
}

func clearColumnKeyFlags(out []ColumnMeta) {
	for i := range out {
		out[i].Nullable = nil
		out[i].PrimaryKey = nil
	}
}
