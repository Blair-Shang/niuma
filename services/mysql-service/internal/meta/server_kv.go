package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// ServerKVItem 是 Variables / Status 的一行键值。
type ServerKVItem struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// ServerKVResult 是 meta.serverVariables / meta.serverStatus 返回。
type ServerKVResult struct {
	Items     []ServerKVItem `json:"items"`
	Truncated bool           `json:"truncated,omitempty"`
	Limit     int            `json:"limit,omitempty"`
}

const serverKVFetchLimit = 2000

// ListServerVariables 读取 SHOW GLOBAL VARIABLES（可选 LIKE 过滤）。
func ListServerVariables(ctx context.Context, db *sql.DB, like string) (*ServerKVResult, error) {
	return listServerKV(ctx, db, "SHOW GLOBAL VARIABLES", like)
}

// ListServerStatus 读取 SHOW GLOBAL STATUS（可选 LIKE 过滤）。
func ListServerStatus(ctx context.Context, db *sql.DB, like string) (*ServerKVResult, error) {
	return listServerKV(ctx, db, "SHOW GLOBAL STATUS", like)
}

func listServerKV(ctx context.Context, db *sql.DB, baseSQL, like string) (*ServerKVResult, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: server kv: nil db")
	}
	like = strings.TrimSpace(like)
	var (
		rows *sql.Rows
		err  error
	)
	if like != "" {
		// LIKE 模式由调用方传入；仍限制长度，避免异常输入。
		if len(like) > 128 {
			like = like[:128]
		}
		rows, err = db.QueryContext(ctx, baseSQL+" LIKE ?", like)
	} else {
		rows, err = db.QueryContext(ctx, baseSQL)
	}
	if err != nil {
		return nil, fmt.Errorf("mysql: %s: %w", baseSQL, err)
	}
	defer rows.Close()

	out := &ServerKVResult{Items: make([]ServerKVItem, 0, 128), Limit: serverKVFetchLimit}
	for rows.Next() {
		var name, value sql.NullString
		if err := rows.Scan(&name, &value); err != nil {
			return nil, fmt.Errorf("mysql: scan server kv: %w", err)
		}
		out.Items = append(out.Items, ServerKVItem{
			Name:  name.String,
			Value: value.String,
		})
		if len(out.Items) > serverKVFetchLimit {
			out.Truncated = true
			out.Items = out.Items[:serverKVFetchLimit]
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
