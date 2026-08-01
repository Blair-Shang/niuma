package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// InnoDBDeadlockResult 是 meta.innodbDeadlock 返回（对齐 Navicat 最新死锁视图）。
type InnoDBDeadlockResult struct {
	HasDeadlock bool   `json:"hasDeadlock"`
	Excerpt     string `json:"excerpt,omitempty"`
	RawLength   int    `json:"rawLength,omitempty"`
}

// LatestInnoDBDeadlock 从 SHOW ENGINE INNODB STATUS 提取 LATEST DETECTED DEADLOCK 段。
func LatestInnoDBDeadlock(ctx context.Context, db *sql.DB) (*InnoDBDeadlockResult, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: innodb deadlock: nil db")
	}
	var typ, name, status sql.NullString
	if err := db.QueryRowContext(ctx, "SHOW ENGINE INNODB STATUS").Scan(&typ, &name, &status); err != nil {
		return nil, fmt.Errorf("mysql: show engine innodb status: %w", err)
	}
	raw := status.String
	out := &InnoDBDeadlockResult{RawLength: len(raw)}
	excerpt := extractLatestDeadlock(raw)
	if excerpt == "" {
		return out, nil
	}
	out.HasDeadlock = true
	out.Excerpt = excerpt
	return out, nil
}

func extractLatestDeadlock(status string) string {
	const marker = "LATEST DETECTED DEADLOCK"
	idx := strings.Index(status, marker)
	if idx < 0 {
		return ""
	}
	rest := status[idx:]
	// 下一段常见标题；截到此处为止。
	endMarkers := []string{
		"\n------------\nTRANSACTIONS\n",
		"\nTRANSACTIONS\n",
		"\n--------\nFILE I/O\n",
		"\nFILE I/O\n",
	}
	end := len(rest)
	for _, m := range endMarkers {
		if i := strings.Index(rest, m); i > 0 && i < end {
			end = i
		}
	}
	excerpt := strings.TrimSpace(rest[:end])
	const maxLen = 16_000
	if len(excerpt) > maxLen {
		excerpt = excerpt[:maxLen] + "\n…(truncated)"
	}
	return excerpt
}
