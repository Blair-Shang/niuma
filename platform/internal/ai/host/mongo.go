package host

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	defaultMongoFindLimit  = 20
	maxMongoFindLimit      = 50
	defaultMongoSampleSize = 20
	maxMongoSampleSize     = 50
)

type mongoScope struct {
	ProfileID  string
	SessionID  string
	ModuleID   string
	Database   string
	Collection string
	Input      string
	Filter     any
	Sort       any
	Projection any
	Skip       int64
	Limit      int64
	SampleSize int64
}

func parseMongoScope(args map[string]any) mongoScope {
	s := mongoScope{}
	s.ProfileID, _ = args["profileId"].(string)
	s.SessionID, _ = args["sessionId"].(string)
	s.ModuleID, _ = args["moduleId"].(string)
	s.Database, _ = args["database"].(string)
	s.Collection, _ = args["collection"].(string)
	s.Input, _ = args["input"].(string)
	if s.Input == "" {
		s.Input, _ = args["command"].(string)
	}
	s.ProfileID = strings.TrimSpace(s.ProfileID)
	s.SessionID = strings.TrimSpace(s.SessionID)
	s.ModuleID = strings.TrimSpace(s.ModuleID)
	s.Database = strings.TrimSpace(s.Database)
	s.Collection = strings.TrimSpace(s.Collection)
	s.Input = strings.TrimSpace(s.Input)
	s.Filter = args["filter"]
	s.Sort = args["sort"]
	s.Projection = args["projection"]
	s.Skip = intFromAny(args["skip"])
	s.Limit = intFromAny(args["limit"])
	s.SampleSize = intFromAny(args["sampleSize"])
	if s.ModuleID == "" {
		s.ModuleID = "mongodb"
	}
	return s
}

func (s mongoScope) requireProfile() error {
	if s.ProfileID == "" && s.SessionID == "" {
		return fmt.Errorf("profileId or sessionId required (open or @ a MongoDB connection)")
	}
	return nil
}

func (s mongoScope) requireSession() error {
	if s.SessionID == "" {
		return fmt.Errorf("sessionId required (open or reconnect the MongoDB tab)")
	}
	return nil
}

func (s mongoScope) requireDatabase() error {
	if s.Database == "" {
		return fmt.Errorf("database required (open a database or @ the collection)")
	}
	return nil
}

func (s mongoScope) requireCollection() error {
	if s.Collection == "" {
		return fmt.Errorf("collection required (open a collection or @ it in the tree)")
	}
	return nil
}

func (s mongoScope) identityParams() map[string]any {
	p := map[string]any{}
	if s.SessionID != "" {
		p["sessionId"] = s.SessionID
	} else if s.ProfileID != "" {
		p["profileId"] = s.ProfileID
	}
	return p
}

func (s mongoScope) asScope() scopeArgs {
	return scopeArgs{ProfileID: s.ProfileID, SessionID: s.SessionID, ModuleID: s.ModuleID, Database: s.Database}
}

func resolveMongoNS(ctx context.Context, rt Runtime, s mongoScope) (string, error) {
	ns, err := resolveNS(ctx, rt, s.asScope())
	if err != nil {
		return "", err
	}
	if ns != "mongodb" {
		return "", fmt.Errorf("mongo host: connection kind %q is not mongodb", ns)
	}
	return ns, nil
}

func putJSONArg(params map[string]any, key string, v any) {
	if v == nil {
		return
	}
	if s, ok := v.(string); ok {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		params[key] = json.RawMessage(s)
		return
	}
	params[key] = v
}

// MongoToolSpecs 返回官方 MongoDB 工具列表（与 UI 同 Bridge：mongodb.* → mongodb-service）。
func MongoToolSpecs() []ToolSpec {
	scope := map[string]any{
		"profileId":  map[string]any{"type": "string", "description": "NiuMa MongoDB connection profile id"},
		"sessionId":  map[string]any{"type": "string", "description": "Active MongoDB session id from the open tab"},
		"database":   map[string]any{"type": "string", "description": "Database name"},
		"collection": map[string]any{"type": "string", "description": "Collection name"},
		"moduleId":   map[string]any{"type": "string", "description": "Must be mongodb"},
	}
	schemaProps := func(extra map[string]any) map[string]any {
		out := make(map[string]any, len(scope)+len(extra))
		for k, v := range scope {
			out[k] = v
		}
		for k, v := range extra {
			out[k] = v
		}
		return out
	}
	return []ToolSpec{
		{
			Name:        ToolMongoListDatabases,
			Description: "List databases on the current MongoDB connection (read-only).",
			Parameters:  objectSchema(schemaProps(nil), nil),
			Risk:        "read",
			ServerID:    ServerIDMongo,
		},
		{
			Name:        ToolMongoListCollections,
			Description: "List collections in a database (read-only).",
			Parameters:  objectSchema(schemaProps(nil), []string{"database"}),
			Risk:        "read",
			ServerID:    ServerIDMongo,
		},
		{
			Name:        ToolMongoFind,
			Description: "Find documents in a collection (read-only). Limit defaults to 20, max 50.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"filter":     map[string]any{"description": "MongoDB filter document or JSON string; default {}"},
				"sort":       map[string]any{"description": "Optional sort document"},
				"projection": map[string]any{"description": "Optional projection document"},
				"skip":       map[string]any{"type": "integer"},
				"limit":      map[string]any{"type": "integer"},
			}), []string{"database", "collection"}),
			Risk:     "read",
			ServerID: ServerIDMongo,
		},
		{
			Name:        ToolMongoSchemaSample,
			Description: "Infer collection field types from a document sample (read-only).",
			Parameters: objectSchema(schemaProps(map[string]any{
				"sampleSize": map[string]any{"type": "integer", "description": "Sample size, default 20, max 50"},
				"filter":     map[string]any{"description": "Optional filter document or JSON string"},
			}), []string{"database", "collection"}),
			Risk:     "read",
			ServerID: ServerIDMongo,
		},
		{
			Name:        ToolMongoRunReadonly,
			Description: "Run a read-only mongosh statement (find/count/distinct/aggregate/explain) via query.exec. For insert/update/delete/drop use mongo_exec so the user can confirm.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"input":   map[string]any{"type": "string", "description": "mongosh statement, e.g. db.users.find({}).limit(10)"},
				"command": map[string]any{"type": "string", "description": "Alias of input"},
			}), []string{"database"}),
			Risk:     "read",
			ServerID: ServerIDMongo,
		},
		{
			Name:        ToolMongoExec,
			Description: "Run a mongosh statement on the current database (writes included). Call it directly when the user asks to write; the app shows a confirm card. Do not ask in chat first. Prefer mongo_find / mongo_run_readonly for reads.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"input":   map[string]any{"type": "string", "description": "mongosh statement after the user approves"},
				"command": map[string]any{"type": "string", "description": "Alias of input"},
			}), []string{"database"}),
			Risk:     "dangerous",
			ServerID: ServerIDMongo,
		},
	}
}

// CallMongo 执行官方 mongo_* 工具：只转到已有 mongodb-service Bridge。
func CallMongo(ctx context.Context, rt Runtime, name string, args map[string]any) (string, error) {
	if args == nil {
		args = map[string]any{}
	}
	s := parseMongoScope(args)
	switch name {
	case ToolMongoListDatabases:
		return mongoListDatabases(ctx, rt, s)
	case ToolMongoListCollections:
		return mongoListCollections(ctx, rt, s)
	case ToolMongoFind:
		return mongoFind(ctx, rt, s)
	case ToolMongoSchemaSample:
		return mongoSchemaSample(ctx, rt, s)
	case ToolMongoRunReadonly:
		return mongoQueryExec(ctx, rt, s, true)
	case ToolMongoExec:
		return mongoQueryExec(ctx, rt, s, false)
	default:
		return "", fmt.Errorf("unknown host tool: %s", name)
	}
}

func mongoListDatabases(ctx context.Context, rt Runtime, s mongoScope) (string, error) {
	if err := s.requireProfile(); err != nil {
		return "", err
	}
	ns, err := resolveMongoNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	var result struct {
		Databases []struct {
			Name       string `json:"name"`
			SizeOnDisk int64  `json:"sizeOnDisk"`
			Empty      bool   `json:"empty"`
		} `json:"databases"`
	}
	if err := invokeJSON(ctx, rt, ns+".tree.databases", s.identityParams(), &result); err != nil {
		return "", err
	}
	return indentJSON(map[string]any{
		"count":     len(result.Databases),
		"databases": result.Databases,
	})
}

func mongoListCollections(ctx context.Context, rt Runtime, s mongoScope) (string, error) {
	if err := s.requireProfile(); err != nil {
		return "", err
	}
	if err := s.requireDatabase(); err != nil {
		return "", err
	}
	ns, err := resolveMongoNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	params := s.identityParams()
	params["database"] = s.Database
	var result struct {
		Collections []struct {
			Name  string `json:"name"`
			Type  string `json:"type"`
			Count *int64 `json:"count"`
		} `json:"collections"`
	}
	if err := invokeJSON(ctx, rt, ns+".tree.collections", params, &result); err != nil {
		return "", err
	}
	return indentJSON(map[string]any{
		"database":    s.Database,
		"count":       len(result.Collections),
		"collections": result.Collections,
	})
}

func mongoFind(ctx context.Context, rt Runtime, s mongoScope) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	if err := s.requireDatabase(); err != nil {
		return "", err
	}
	if err := s.requireCollection(); err != nil {
		return "", err
	}
	ns, err := resolveMongoNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	params := s.identityParams()
	params["database"] = s.Database
	params["collection"] = s.Collection
	params["skip"] = s.Skip
	params["limit"] = clampRedisCount(s.Limit, defaultMongoFindLimit, maxMongoFindLimit)
	putJSONArg(params, "filter", s.Filter)
	putJSONArg(params, "sort", s.Sort)
	putJSONArg(params, "projection", s.Projection)
	var result map[string]any
	if err := invokeJSON(ctx, rt, ns+".document.find", params, &result); err != nil {
		return "", err
	}
	return indentJSON(result)
}

func mongoSchemaSample(ctx context.Context, rt Runtime, s mongoScope) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	if err := s.requireDatabase(); err != nil {
		return "", err
	}
	if err := s.requireCollection(); err != nil {
		return "", err
	}
	ns, err := resolveMongoNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	params := s.identityParams()
	params["database"] = s.Database
	params["collection"] = s.Collection
	params["sampleSize"] = clampRedisCount(s.SampleSize, defaultMongoSampleSize, maxMongoSampleSize)
	putJSONArg(params, "filter", s.Filter)
	var result map[string]any
	if err := invokeJSON(ctx, rt, ns+".schema.sample", params, &result); err != nil {
		return "", err
	}
	return indentJSON(result)
}

func mongoQueryExec(ctx context.Context, rt Runtime, s mongoScope, readonly bool) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	if err := s.requireDatabase(); err != nil {
		return "", err
	}
	if s.Input == "" {
		return "", fmt.Errorf("input or command required")
	}
	if readonly {
		if err := AssertReadonlyMongo(s.Input); err != nil {
			return "", err
		}
	}
	ns, err := resolveMongoNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	params := s.identityParams()
	params["database"] = s.Database
	params["input"] = s.Input
	var result map[string]any
	if err := invokeJSON(ctx, rt, ns+".query.exec", params, &result); err != nil {
		return "", err
	}
	return indentJSON(result)
}
