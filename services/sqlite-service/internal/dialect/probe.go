package dialect

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// ProbeOptions 影响能力探测的连接侧选项。
type ProbeOptions struct {
	ReadOnly    bool
	JournalMode string
}

// Probe 探测 SQLite 版本与能力，返回 ServerProfile。
func Probe(ctx context.Context, db *sql.DB, opts ProbeOptions) (*ServerProfile, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: dialect: nil db")
	}
	var version string
	if err := db.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&version); err != nil {
		return nil, fmt.Errorf("sqlite: dialect: sqlite_version: %w", err)
	}
	version = strings.TrimSpace(version)
	if version == "" {
		return nil, fmt.Errorf("sqlite: dialect: empty sqlite_version")
	}

	hasJSON := probeJSON(ctx, db)
	journal := strings.TrimSpace(opts.JournalMode)
	if journal == "" {
		journal = readPragma(ctx, db, "journal_mode")
	}

	p := ResolveCapabilities(version, opts.ReadOnly, journal, hasJSON)
	return &p, nil
}

func probeJSON(ctx context.Context, db *sql.DB) bool {
	// JSON1 扩展：失败则无 json.functions Cap。
	var n int
	err := db.QueryRowContext(ctx, `SELECT json_valid('{}')`).Scan(&n)
	return err == nil && n == 1
}

func readPragma(ctx context.Context, db *sql.DB, name string) string {
	name = strings.TrimSpace(name)
	if name == "" || !isSafeIdent(name) {
		return ""
	}
	var v string
	_ = db.QueryRowContext(ctx, "PRAGMA "+name).Scan(&v)
	return strings.TrimSpace(v)
}

func isSafeIdent(s string) bool {
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_':
		default:
			return false
		}
	}
	return s != ""
}
