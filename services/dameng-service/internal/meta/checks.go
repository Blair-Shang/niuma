package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// CheckInfo 描述一条 CHECK 约束。
type CheckInfo struct {
	Name       string `json:"name"`
	Expression string `json:"expression"`
}

// ChecksResult 是 CHECK 约束列表。
type ChecksResult struct {
	Checks []CheckInfo `json:"checks"`
}

// ListChecks 读取表 CHECK 约束（CONSTRAINT_TYPE='C'）。
func ListChecks(ctx context.Context, db *sql.DB, r RelationRef) (ChecksResult, error) {
	q := `
SELECT c.CONSTRAINT_NAME,
       c.SEARCH_CONDITION
FROM ALL_CONSTRAINTS c
WHERE c.OWNER = ? AND c.TABLE_NAME = ? AND c.CONSTRAINT_TYPE = 'C'
ORDER BY c.CONSTRAINT_NAME`
	rows, err := db.QueryContext(ctx, q, r.Schema, r.Name)
	if err != nil {
		return ChecksResult{}, fmt.Errorf("dameng: checks: %w", err)
	}
	defer rows.Close()

	out := ChecksResult{}
	for rows.Next() {
		var name string
		var expr sql.NullString
		if err := rows.Scan(&name, &expr); err != nil {
			return ChecksResult{}, err
		}
		out.Checks = append(out.Checks, CheckInfo{
			Name:       name,
			Expression: strings.TrimSpace(expr.String),
		})
	}
	return out, rows.Err()
}
