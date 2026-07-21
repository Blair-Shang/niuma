package tree

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// RoutineInfo 是过程 / 函数节点。
type RoutineInfo struct {
	Name string `json:"name"`
	Type string `json:"type"` // procedure | function
}

// RoutinesResult 是例程列表结果。
type RoutinesResult struct {
	Routines  []RoutineInfo `json:"routines"`
	Truncated bool          `json:"truncated,omitempty"`
}

// ListRoutines 列出指定 database 下的存储过程 / 函数。
func ListRoutines(ctx context.Context, db *sql.DB, params ListParams) (*RoutinesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: tree: nil db")
	}
	database := strings.TrimSpace(params.Database)
	if database == "" {
		return nil, fmt.Errorf("mysql: tree: database required")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)
	typeFilter := routineTypeSQL(params.Types)

	query := `
SELECT ROUTINE_NAME,
  CASE ROUTINE_TYPE
    WHEN 'PROCEDURE' THEN 'procedure'
    WHEN 'FUNCTION' THEN 'function'
    ELSE LOWER(ROUTINE_TYPE)
  END AS typ
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = ?`
	args := []any{database}
	if typeFilter != "" {
		query += `
  AND ROUTINE_TYPE IN (` + typeFilter + `)`
	}
	if prefix != "" {
		query += `
  AND ROUTINE_NAME LIKE ? ESCAPE '\\'`
		args = append(args, prefix)
	}
	query += `
ORDER BY ROUTINE_NAME
LIMIT ?`
	args = append(args, limit+1)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("mysql: tree routines: %w", err)
	}
	defer rows.Close()

	out := make([]RoutineInfo, 0, limit)
	for rows.Next() {
		var name, typ string
		if err := rows.Scan(&name, &typ); err != nil {
			return nil, fmt.Errorf("mysql: tree routines scan: %w", err)
		}
		out = append(out, RoutineInfo{Name: name, Type: typ})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mysql: tree routines rows: %w", err)
	}

	truncated := false
	if len(out) > limit {
		truncated = true
		out = out[:limit]
	}
	return &RoutinesResult{Routines: out, Truncated: truncated}, nil
}

func routineTypeSQL(types []string) string {
	if len(types) == 0 {
		return "'PROCEDURE','FUNCTION'"
	}
	wantProc, wantFunc := false, false
	for _, t := range types {
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "procedure", "proc":
			wantProc = true
		case "function", "func":
			wantFunc = true
		}
	}
	parts := make([]string, 0, 2)
	if wantProc {
		parts = append(parts, "'PROCEDURE'")
	}
	if wantFunc {
		parts = append(parts, "'FUNCTION'")
	}
	if len(parts) == 0 {
		return "'PROCEDURE','FUNCTION'"
	}
	return strings.Join(parts, ",")
}
