package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/mysql-service/internal/meta"
	"niuma/services/mysql-service/internal/session"
	"niuma/services/mysql-service/internal/tree"
)

const (
	// DefaultCatalogLimit 是 SQL 补全目录检索的默认条数。
	DefaultCatalogLimit = 200
	// MaxCatalogLimit 是补全目录检索上限（与前端 SQL_CATALOG_MAX_LIMIT 对齐）。
	MaxCatalogLimit = 500
)

type catalogListParams struct {
	SessionID     string   `json:"sessionId"`
	Database      string   `json:"database"`
	Schema        string   `json:"schema"` // MySQL：= database 名
	Table         string   `json:"table"`
	Name          string   `json:"name"`
	Prefix        string   `json:"prefix"`
	Limit         int      `json:"limit"`
	ExcludeSystem *bool    `json:"excludeSystem"`
	Types         []string `json:"types"`
}

type catalogSchemaHit struct {
	Name string `json:"name"`
}

type catalogSchemasResult struct {
	Schemas   []catalogSchemaHit `json:"schemas"`
	Truncated bool               `json:"truncated,omitempty"`
}

func catalogLimit(limit int) int {
	if limit <= 0 {
		return DefaultCatalogLimit
	}
	if limit > MaxCatalogLimit {
		return MaxCatalogLimit
	}
	return limit
}

func (p catalogListParams) relationName() string {
	if strings.TrimSpace(p.Name) != "" {
		return strings.TrimSpace(p.Name)
	}
	return strings.TrimSpace(p.Table)
}

// catalogSchemas 按前缀检索 database 列表（协议槽位仍叫 schemas，见 docs/25 §5.4）。
func (d *Dispatcher) catalogSchemas(ctx context.Context, req Request) Response {
	var params catalogListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}

	db, sess, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	exclude := true
	if params.ExcludeSystem != nil {
		exclude = *params.ExcludeSystem
	} else if sess != nil {
		exclude = sess.Params.Options.ExcludeSystemSchemasEnabled()
	} else {
		var connect session.ConnectParams
		if json.Unmarshal(req.Params, &connect) == nil {
			exclude = connect.Options.ExcludeSystemSchemasEnabled()
		}
	}

	result, err := tree.ListDatabases(ctx, db, tree.ListParams{
		Filter:        params.Prefix,
		Limit:         catalogLimit(params.Limit),
		ExcludeSystem: exclude,
	})
	if err != nil {
		logOpWarn(MethodCatalogSchemas, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}

	out := make([]catalogSchemaHit, 0, len(result.Databases))
	for _, item := range result.Databases {
		out = append(out, catalogSchemaHit{Name: item.Name})
	}
	logOpInfo(
		MethodCatalogSchemas,
		"session", params.SessionID,
		"prefix", params.Prefix,
		"count", len(out),
		"truncated", result.Truncated,
	)
	return okResponse(req.ID, catalogSchemasResult{Schemas: out, Truncated: result.Truncated})
}

// catalogTables 按 schema(=database) + 前缀检索表/视图。
func (d *Dispatcher) catalogTables(ctx context.Context, req Request) Response {
	var params catalogListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return errorResponse(req.ID, "schema required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, schema)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	types := params.Types
	if len(types) == 0 {
		types = []string{"table", "view"}
	}

	result, err := tree.ListTables(ctx, db, tree.ListParams{
		Filter:   params.Prefix,
		Limit:    catalogLimit(params.Limit),
		Database: schema,
		Types:    types,
	})
	if err != nil {
		logOpWarn(MethodCatalogTables, err, "session", params.SessionID, "schema", schema)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodCatalogTables,
		"session", params.SessionID,
		"schema", schema,
		"prefix", params.Prefix,
		"count", len(result.Tables),
		"truncated", result.Truncated,
	)
	return okResponse(req.ID, result)
}

// catalogColumns 列出表列；prefix 为空返回全部列。
func (d *Dispatcher) catalogColumns(ctx context.Context, req Request) Response {
	var params catalogListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	schema := strings.TrimSpace(params.Schema)
	name := params.relationName()
	if schema == "" || name == "" {
		return errorResponse(req.ID, "schema and table/name required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, schema)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListColumns(ctx, db, meta.RelationRef{Database: schema, Name: name})
	if err != nil {
		logOpWarn(MethodCatalogColumns, err, "session", params.SessionID, "schema", schema, "table", name)
		return errorResponse(req.ID, err.Error())
	}

	prefix := strings.ToLower(strings.TrimSpace(params.Prefix))
	cols := result.Columns
	if prefix != "" {
		filtered := make([]meta.ColumnInfo, 0, len(cols))
		for _, c := range cols {
			if strings.HasPrefix(strings.ToLower(c.Name), prefix) {
				filtered = append(filtered, c)
			}
		}
		cols = filtered
	}

	logOpInfo(
		MethodCatalogColumns,
		"session", params.SessionID,
		"schema", schema,
		"table", name,
		"prefix", params.Prefix,
		"count", len(cols),
	)
	return okResponse(req.ID, map[string]any{"columns": cols})
}
