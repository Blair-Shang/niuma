// Package meta reads Dameng dictionary metadata.
package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type RelationRef struct {
	Schema string `json:"schema"`
	Name   string `json:"name"`
}
type ColumnInfo struct {
	Ordinal       int     `json:"ordinal"`
	Name          string  `json:"name"`
	DataType      string  `json:"dataType"`
	Nullable      bool    `json:"nullable"`
	Default       *string `json:"default,omitempty"`
	Comment       string  `json:"comment,omitempty"`
	AutoIncrement bool    `json:"autoIncrement,omitempty"`
}
type ColumnsResult struct {
	Columns []ColumnInfo `json:"columns"`
}

func ListColumns(ctx context.Context, db *sql.DB, r RelationRef) (ColumnsResult, error) {
	// 达梦兼容 Oracle：空串 '' 即 NULL，COALESCE(x,'') 在无注释时仍可能为 NULL，故注释列用 NullString 扫描。
	// 未加引号标识符在字典中为大写；补全/SQL 输入大小写不定，比较时统一 UPPER。
	q := `SELECT c.COLUMN_NAME,c.DATA_TYPE,c.NULLABLE,c.DATA_DEFAULT,c.COLUMN_ID,cm.COMMENTS FROM ALL_TAB_COLUMNS c LEFT JOIN ALL_COL_COMMENTS cm ON cm.OWNER=c.OWNER AND cm.TABLE_NAME=c.TABLE_NAME AND cm.COLUMN_NAME=c.COLUMN_NAME WHERE UPPER(c.OWNER)=UPPER(?) AND UPPER(c.TABLE_NAME)=UPPER(?) ORDER BY c.COLUMN_ID`
	rows, e := db.QueryContext(ctx, q, r.Schema, r.Name)
	if e != nil {
		return ColumnsResult{}, fmt.Errorf("dameng: list columns: %w", e)
	}
	defer rows.Close()
	o := ColumnsResult{}
	for rows.Next() {
		var c ColumnInfo
		var nullable string
		var d, comment sql.NullString
		if e = rows.Scan(&c.Name, &c.DataType, &nullable, &d, &c.Ordinal, &comment); e != nil {
			return o, e
		}
		c.Nullable = strings.EqualFold(nullable, "Y")
		if comment.Valid {
			c.Comment = comment.String
		}
		if d.Valid {
			s := d.String
			c.Default = &s
		}
		if strings.Contains(strings.ToUpper(c.DataType), "IDENTITY") {
			c.AutoIncrement = true
		}
		o.Columns = append(o.Columns, c)
	}
	if e = rows.Err(); e != nil {
		return o, e
	}
	// DATA_TYPE 常不含 IDENTITY 字样：用 SYSCOLUMNS.INFO2 位补齐（失败则忽略）
	identity := loadIdentityColumnSet(ctx, db, r.Schema, r.Name)
	if len(identity) > 0 {
		for i := range o.Columns {
			if _, ok := identity[strings.ToUpper(o.Columns[i].Name)]; ok {
				o.Columns[i].AutoIncrement = true
			}
		}
	}
	return o, nil
}

// loadIdentityColumnSet 返回大写列名集合。INFO2 最低位为 1 表示 IDENTITY（达梦常见约定）。
func loadIdentityColumnSet(ctx context.Context, db *sql.DB, schema, table string) map[string]struct{} {
	const q = `
SELECT COL.NAME
FROM SYS.SYSCOLUMNS COL
INNER JOIN SYS.SYSOBJECTS TAB ON COL.ID = TAB.ID
INNER JOIN SYS.SYSOBJECTS SCH ON TAB.SCHID = SCH.ID
WHERE UPPER(SCH.NAME) = UPPER(?) AND UPPER(TAB.NAME) = UPPER(?) AND BITAND(COL.INFO2, 1) = 1`
	rows, err := db.QueryContext(ctx, q, schema, table)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make(map[string]struct{})
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return out
		}
		name = strings.TrimSpace(name)
		if name != "" {
			out[strings.ToUpper(name)] = struct{}{}
		}
	}
	return out
}
