package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// RoutineRef 定位过程/函数。
type RoutineRef struct {
	Schema string
	Name   string
	// Kind：procedure | function（大小写不敏感）
	Kind string
}

// RoutineSourceResult 是 meta.routineSource 返回。
type RoutineSourceResult struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Definition string `json:"definition"`
}

func normalizeRoutineKind(kind string) (string, string, error) {
	k := strings.ToLower(strings.TrimSpace(kind))
	switch k {
	case "procedure":
		return "procedure", "PROCEDURE", nil
	case "function":
		return "function", "FUNCTION", nil
	default:
		return "", "", fmt.Errorf("dameng: kind required (procedure|function)")
	}
}

// GetRoutineSource 读取过程/函数源码：优先 DBMS_METADATA.GET_DDL，失败则拼 ALL_SOURCE。
func GetRoutineSource(ctx context.Context, db *sql.DB, ref RoutineRef) (*RoutineSourceResult, error) {
	schema := strings.TrimSpace(ref.Schema)
	name := strings.TrimSpace(ref.Name)
	if schema == "" || name == "" {
		return nil, fmt.Errorf("dameng: schema and name required")
	}
	kind, metaType, err := normalizeRoutineKind(ref.Kind)
	if err != nil {
		return nil, err
	}

	if ddl, ok := getMetadataDDL(ctx, db, metaType, name, schema); ok {
		return &RoutineSourceResult{Name: name, Kind: kind, Definition: ddl}, nil
	}

	text, err := loadAllSource(ctx, db, schema, name, metaType)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("dameng: %s not found: %s.%s", kind, schema, name)
	}
	return &RoutineSourceResult{Name: name, Kind: kind, Definition: text}, nil
}

func getMetadataDDL(ctx context.Context, db *sql.DB, objectType, name, schema string) (string, bool) {
	var ddl string
	err := db.QueryRowContext(ctx,
		"SELECT DBMS_METADATA.GET_DDL(?, ?, ?) FROM DUAL",
		objectType, name, schema,
	).Scan(&ddl)
	if err != nil {
		return "", false
	}
	ddl = strings.TrimSpace(ddl)
	return ddl, ddl != ""
}

func loadAllSource(ctx context.Context, db *sql.DB, schema, name, objectType string) (string, error) {
	rows, err := db.QueryContext(ctx, `
SELECT TEXT
FROM ALL_SOURCE
WHERE OWNER = ? AND NAME = ? AND TYPE = ?
ORDER BY LINE`, schema, name, objectType)
	if err != nil {
		return "", fmt.Errorf("dameng: load ALL_SOURCE: %w", err)
	}
	defer rows.Close()

	var b strings.Builder
	for rows.Next() {
		var line sql.NullString
		if err := rows.Scan(&line); err != nil {
			return "", err
		}
		if line.Valid {
			b.WriteString(line.String)
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return strings.TrimSpace(b.String()), nil
}
