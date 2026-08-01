// Package meta 提供表级元数据（列 / 索引 / DDL / 键），对齐 DBeaver / IDEA Properties。
package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/tree"
)

// ColumnInfo 是列元数据。
type ColumnInfo struct {
	Name          string `json:"name"`
	DataType      string `json:"dataType,omitempty"`
	Nullable      bool   `json:"nullable"`
	Default       string `json:"default,omitempty"`
	PrimaryKey    bool   `json:"primaryKey,omitempty"`
	PKOrdinal     int    `json:"pkOrdinal,omitempty"`
	Hidden        bool   `json:"hidden,omitempty"`
	Ordinal       int    `json:"ordinal"`
	Check         string `json:"check,omitempty"`
	GeneratedExpr string `json:"generatedExpr,omitempty"`
	GeneratedType string `json:"generatedType,omitempty"` // VIRTUAL | STORED
}

// ColumnsResult 是列列表。
type ColumnsResult struct {
	Columns []ColumnInfo `json:"columns"`
}

// ListColumns 使用 PRAGMA table_xinfo / table_info。
func ListColumns(ctx context.Context, db *sql.DB, schema, table string) (*ColumnsResult, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: meta: nil db")
	}
	schema = schemaOrMain(schema)
	table = strings.TrimSpace(table)
	if table == "" {
		return nil, fmt.Errorf("sqlite: meta: table required")
	}

	rows, useXInfo, err := queryTableInfo(ctx, db, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]ColumnInfo, 0, 16)
	for rows.Next() {
		var cid, notnull, pk int
		var name, typ string
		var dflt sql.NullString
		var hidden int
		if useXInfo {
			if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk, &hidden); err != nil {
				return nil, fmt.Errorf("sqlite: meta: scan column: %w", err)
			}
		} else {
			if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
				return nil, fmt.Errorf("sqlite: meta: scan column: %w", err)
			}
		}
		col := ColumnInfo{
			Name:       strings.TrimSpace(name),
			DataType:   strings.TrimSpace(typ),
			Nullable:   notnull == 0,
			PrimaryKey: pk > 0,
			PKOrdinal:  pk,
			Hidden:     hidden != 0,
			Ordinal:    cid,
		}
		// table_xinfo.hidden：2=VIRTUAL GENERATED，3=STORED GENERATED
		switch hidden {
		case 2:
			col.GeneratedType = "VIRTUAL"
		case 3:
			col.GeneratedType = "STORED"
		}
		if dflt.Valid {
			col.Default = dflt.String
		}
		out = append(out, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	extras := loadColumnDDLExtras(ctx, db, schema, table)
	for i := range out {
		ex, ok := extras[strings.ToLower(out[i].Name)]
		if !ok {
			continue
		}
		if ex.Check != "" {
			out[i].Check = ex.Check
		}
		if ex.GeneratedExpr != "" {
			out[i].GeneratedExpr = ex.GeneratedExpr
		}
		if ex.GeneratedType != "" {
			out[i].GeneratedType = ex.GeneratedType
		}
	}
	return &ColumnsResult{Columns: out}, nil
}

func queryTableInfo(ctx context.Context, db *sql.DB, schema, table string) (*sql.Rows, bool, error) {
	pragmaX := pragmaCall(schema, "table_xinfo", table)
	rows, err := db.QueryContext(ctx, pragmaX)
	if err == nil {
		return rows, true, nil
	}
	pragma := pragmaCall(schema, "table_info", table)
	rows, err = db.QueryContext(ctx, pragma)
	if err != nil {
		return nil, false, fmt.Errorf("sqlite: meta: table_info: %w", err)
	}
	return rows, false, nil
}

func pragmaCall(schema, fn, table string) string {
	arg := quoteLiteral(table)
	if strings.EqualFold(schema, tree.SchemaMain) || schema == "" {
		return "PRAGMA " + fn + "(" + arg + ")"
	}
	return "PRAGMA " + quoteIdent(schema) + "." + fn + "(" + arg + ")"
}

func schemaOrMain(schema string) string {
	s := strings.TrimSpace(schema)
	if s == "" {
		return tree.SchemaMain
	}
	return s
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func quoteLiteral(s string) string {
	return `'` + strings.ReplaceAll(s, `'`, `''`) + `'`
}
