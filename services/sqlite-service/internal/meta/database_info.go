package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// AttachedDatabase 是 PRAGMA database_list 一行。
type AttachedDatabase struct {
	Seq  int    `json:"seq"`
	Name string `json:"name"`
	File string `json:"file,omitempty"`
}

// DatabaseInfoResult 是库属性 / 诊断面板用的只读概览。
type DatabaseInfoResult struct {
	Version      string             `json:"version,omitempty"`
	PageCount    int64              `json:"pageCount,omitempty"`
	PageSize     int64              `json:"pageSize,omitempty"`
	FreelistCount int64             `json:"freelistCount,omitempty"`
	Encoding     string             `json:"encoding,omitempty"`
	JournalMode  string             `json:"journalMode,omitempty"`
	Synchronous  string             `json:"synchronous,omitempty"`
	ForeignKeys  bool               `json:"foreignKeys"`
	AutoVacuum   string             `json:"autoVacuum,omitempty"`
	Databases    []AttachedDatabase `json:"databases,omitempty"`
}

func pragmaInt64(ctx context.Context, db *sql.DB, name string) (int64, error) {
	var v sql.NullInt64
	if err := db.QueryRowContext(ctx, "PRAGMA "+name).Scan(&v); err != nil {
		return 0, err
	}
	if !v.Valid {
		return 0, nil
	}
	return v.Int64, nil
}

func pragmaText(ctx context.Context, db *sql.DB, name string) (string, error) {
	var v sql.NullString
	if err := db.QueryRowContext(ctx, "PRAGMA "+name).Scan(&v); err != nil {
		return "", err
	}
	return strings.TrimSpace(v.String), nil
}

// GetDatabaseInfo 采集版本与关键 PRAGMA（只读）。
func GetDatabaseInfo(ctx context.Context, db *sql.DB) (*DatabaseInfoResult, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: meta: nil db")
	}
	out := &DatabaseInfoResult{}

	_ = db.QueryRowContext(ctx, `SELECT sqlite_version()`).Scan(&out.Version)
	out.PageCount, _ = pragmaInt64(ctx, db, "page_count")
	out.PageSize, _ = pragmaInt64(ctx, db, "page_size")
	out.FreelistCount, _ = pragmaInt64(ctx, db, "freelist_count")
	out.Encoding, _ = pragmaText(ctx, db, "encoding")
	out.JournalMode, _ = pragmaText(ctx, db, "journal_mode")
	out.Synchronous, _ = pragmaText(ctx, db, "synchronous")
	out.AutoVacuum, _ = pragmaText(ctx, db, "auto_vacuum")
	if fk, err := pragmaInt64(ctx, db, "foreign_keys"); err == nil {
		out.ForeignKeys = fk != 0
	}

	rows, err := db.QueryContext(ctx, `PRAGMA database_list`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: meta: database_list: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var seq int
		var name, file string
		if err := rows.Scan(&seq, &name, &file); err != nil {
			return nil, fmt.Errorf("sqlite: meta: scan database_list: %w", err)
		}
		out.Databases = append(out.Databases, AttachedDatabase{
			Seq:  seq,
			Name: strings.TrimSpace(name),
			File: file,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
