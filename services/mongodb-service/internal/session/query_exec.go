package session

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

const (
	maxQueryInputBytes  = 64 * 1024
	maxQueryOutputBytes = 8 * 1024 * 1024
	queryExecTimeout    = 60 * time.Second
)

var (
	reFindChainLimit = regexp.MustCompile(`(?i)\.limit\s*\(\s*(\d+)\s*\)`)
	reFindChainSkip  = regexp.MustCompile(`(?i)\.skip\s*\(\s*(\d+)\s*\)`)
)

// QueryExecParams 是 query.exec 入参。
type QueryExecParams struct {
	Database  string
	Input     string
	Explain   bool
	ToolPaths ToolPathOverrides
}

// QueryExecResult 是 query.exec 返回。
type QueryExecResult struct {
	Documents []json.RawMessage `json:"documents,omitempty"`
	Document  json.RawMessage   `json:"document,omitempty"`
	Explain   json.RawMessage   `json:"explain,omitempty"`
	Count     int64             `json:"count,omitempty"`
	Output    string            `json:"output,omitempty"`
	Engine    string            `json:"engine,omitempty"` // mongosh | driver
}

// ExecQuery 执行 mongosh 风格查询。
// 优先走 mongosh --eval（完整原生 Shell 语法）；不可用时回退到驱动层子集解析。
func ExecQuery(ctx context.Context, sess *Session, params QueryExecParams) (*QueryExecResult, error) {
	input := strings.TrimSpace(params.Input)
	if input == "" {
		return &QueryExecResult{Documents: []json.RawMessage{}, Engine: "driver"}, nil
	}
	if len(input) > maxQueryInputBytes {
		return nil, fmt.Errorf("input exceeds 64 KiB limit")
	}
	database := strings.TrimSpace(params.Database)
	if database == "" {
		return nil, fmt.Errorf("database required")
	}
	if sess == nil || sess.Client == nil {
		return nil, fmt.Errorf("session required")
	}

	if result, ok, err := execQueryViaMongosh(ctx, sess, database, input, params.Explain, params.ToolPaths); ok {
		return result, err
	}

	// 无 mongosh 时：驱动层支持常用原生命令（show / use）与 find/aggregate 子集
	if result, ok, err := execQueryViaDriverHelpers(ctx, sess, database, input); ok {
		return result, err
	}

	result, err := execQueryViaDriver(ctx, sess.Client, database, input, params.Explain)
	if err != nil {
		return nil, fmt.Errorf("%w (install mongosh for full shell syntax)", err)
	}
	result.Engine = "driver"
	return result, nil
}

func execQueryViaMongosh(
	ctx context.Context,
	sess *Session,
	database, input string,
	explain bool,
	requestPaths ToolPathOverrides,
) (*QueryExecResult, bool, error) {
	exe, ok := ResolveToolPath("mongosh", sess.Params.Options.ToolPaths, requestPaths)
	if !ok {
		return nil, false, nil
	}

	uri, env, err := CLIEnv(sess.Params, database)
	if err != nil {
		return nil, true, err
	}

	evalScript := wrapMongoshEval(input, explain)
	args := []string{
		uri,
		"--quiet",
		"--json=relaxed",
		"--eval", evalScript,
	}
	if secret := strings.TrimSpace(sess.Params.Secret); secret != "" {
		args = append(args, "--password", secret)
	}

	runCtx, cancel := context.WithTimeout(ctx, queryExecTimeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, exe, args...)
	cmd.Env = env
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	outBytes := stdout.Bytes()
	if len(outBytes) > maxQueryOutputBytes {
		outBytes = outBytes[:maxQueryOutputBytes]
	}
	output := strings.TrimSpace(string(outBytes))
	errText := strings.TrimSpace(stderr.String())

	if runErr != nil {
		msg := errText
		if msg == "" {
			msg = output
		}
		if msg == "" {
			msg = runErr.Error()
		}
		if runCtx.Err() == context.DeadlineExceeded {
			return nil, true, fmt.Errorf("mongosh: query timed out after %s", queryExecTimeout)
		}
		return nil, true, fmt.Errorf("mongosh: %s", sanitizeMongoshError(msg))
	}

	result, parseErr := parseMongoshJSONOutput(output, explain)
	if parseErr != nil {
		return &QueryExecResult{
			Output: output,
			Count:  1,
			Engine: "mongosh",
		}, true, nil
	}
	result.Engine = "mongosh"
	return result, true, nil
}

// wrapMongoshEval 将用户脚本包装为 JSON 可序列化表达式：物化游标，可选 explain。
// 必须直接求值用户表达式，禁止包一层 eval()：eval 会丢 mongosh 对 Cursor 的包装，
// 导致 .limit / .sort / .skip 等链式方法报 "is not a function"。
// 裸 Collection / Db / Client 含循环引用，不能原样交给 --json=relaxed，需转成安全摘要。
func wrapMongoshEval(input string, explain bool) string {
	src := strings.TrimSpace(input)
	// show / use / help 等是 mongosh 助手语句，不能包成 (expr)
	if isMongoshHelperStatement(src) {
		return src
	}
	if explain && !strings.Contains(strings.ToLower(src), ".explain(") {
		src = "(" + src + ").explain('executionStats')"
	}
	return fmt.Sprintf(`(() => {
  const __niuma_safe = (v) => {
    if (v == null) return v;
    if (typeof v.toArray === 'function') return v.toArray();
    if (typeof v.hasNext === 'function') {
      const docs = [];
      while (v.hasNext()) docs.push(v.next());
      return docs;
    }
    if (typeof v === 'object') {
      if (typeof v.find === 'function' && typeof v.aggregate === 'function') {
        let name = '';
        try { name = String(v.getName()); } catch (_) {}
        return {
          ok: 1,
          type: 'Collection',
          name,
          hint: "Append .find({}) / .aggregate([]) / .countDocuments({})"
        };
      }
      if (typeof v.getCollectionNames === 'function') {
        let name = '';
        try { name = String(v.getName()); } catch (_) {}
        return { ok: 1, type: 'Database', name };
      }
      if (typeof v.getDB === 'function') {
        return { ok: 1, type: 'Mongo' };
      }
    }
    return v;
  };
  let __result = (%s);
  return __niuma_safe(__result);
})()`, src)
}

func isMongoshHelperStatement(src string) bool {
	lower := strings.ToLower(strings.TrimSpace(src))
	switch {
	case strings.HasPrefix(lower, "show"),
		strings.HasPrefix(lower, "use "),
		lower == "use",
		strings.HasPrefix(lower, "help"),
		lower == "exit",
		lower == "it":
		return true
	default:
		return false
	}
}

func sanitizeMongoshError(msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return "execution failed"
	}
	// mongosh 常把 < > 写成 \u003c \u003e
	msg = strings.ReplaceAll(msg, `\u003c`, "<")
	msg = strings.ReplaceAll(msg, `\u003e`, ">")
	msg = strings.ReplaceAll(msg, `\n`, "\n")
	if !utf8.ValidString(msg) {
		msg = string([]rune(msg))
	}
	const maxLen = 2000
	if len(msg) > maxLen {
		return msg[:maxLen] + "…"
	}
	return msg
}

func parseMongoshJSONOutput(output string, explain bool) (*QueryExecResult, error) {
	if output == "" || output == "undefined" || output == "null" {
		return &QueryExecResult{Document: json.RawMessage("null")}, nil
	}
	raw := json.RawMessage(output)
	if !json.Valid(raw) {
		return nil, fmt.Errorf("not json")
	}
	if explain {
		return &QueryExecResult{Explain: raw, Count: 1}, nil
	}
	trimmed := strings.TrimSpace(output)
	if strings.HasPrefix(trimmed, "[") {
		var docs []json.RawMessage
		if err := json.Unmarshal(raw, &docs); err != nil {
			return nil, err
		}
		return &QueryExecResult{Documents: docs, Count: int64(len(docs))}, nil
	}
	if strings.HasPrefix(trimmed, "{") {
		return &QueryExecResult{Document: raw, Count: 1}, nil
	}
	// 数字 / 布尔 / 字符串标量
	return &QueryExecResult{Document: raw, Count: 1, Output: trimmed}, nil
}

func execQueryViaDriverHelpers(
	ctx context.Context,
	sess *Session,
	database, input string,
) (*QueryExecResult, bool, error) {
	lower := strings.ToLower(strings.TrimSpace(input))
	matched := false
	switch {
	case lower == "show dbs" || lower == "show databases",
		lower == "show collections" || lower == "show tables",
		strings.HasPrefix(lower, "use "),
		lower == "db" || lower == "db.getname()",
		lower == "db.getcollectionnames()",
		lower == "db.stats()",
		lower == "help":
		matched = true
	}
	if !matched {
		return nil, false, nil
	}
	if sess == nil || sess.Client == nil {
		if lower == "help" {
			// help 不需要连接
		} else {
			return nil, true, fmt.Errorf("session required")
		}
	}

	switch {
	case lower == "show dbs" || lower == "show databases":
		dbs, err := ListDatabases(ctx, sess.Client)
		if err != nil {
			return nil, true, err
		}
		docs := make([]json.RawMessage, 0, len(dbs))
		for _, db := range dbs {
			raw, err := json.Marshal(map[string]any{
				"name":       db.Name,
				"sizeOnDisk": db.SizeOnDisk,
			})
			if err != nil {
				return nil, true, err
			}
			docs = append(docs, raw)
		}
		return &QueryExecResult{Documents: docs, Count: int64(len(docs)), Engine: "driver"}, true, nil

	case lower == "show collections" || lower == "show tables":
		items, err := ListCollections(ctx, sess.Client, database)
		if err != nil {
			return nil, true, err
		}
		docs := make([]json.RawMessage, 0, len(items))
		for _, item := range items {
			raw, err := json.Marshal(map[string]any{
				"name": item.Name,
				"type": item.Type,
			})
			if err != nil {
				return nil, true, err
			}
			docs = append(docs, raw)
		}
		return &QueryExecResult{Documents: docs, Count: int64(len(docs)), Engine: "driver"}, true, nil

	case strings.HasPrefix(lower, "use "):
		db := strings.TrimSpace(input[4:])
		if db == "" {
			return nil, true, fmt.Errorf("database name required")
		}
		sess.SetDatabase(db)
		msg := fmt.Sprintf("switched to db %s", db)
		raw, _ := json.Marshal(map[string]any{"ok": 1, "db": db, "message": msg})
		return &QueryExecResult{Document: raw, Count: 1, Output: msg, Engine: "driver"}, true, nil

	case lower == "db" || lower == "db.getname()":
		raw, _ := json.Marshal(map[string]any{"db": database})
		return &QueryExecResult{Document: raw, Count: 1, Engine: "driver"}, true, nil

	case lower == "db.getcollectionnames()":
		items, err := ListCollections(ctx, sess.Client, database)
		if err != nil {
			return nil, true, err
		}
		names := make([]string, 0, len(items))
		for _, item := range items {
			names = append(names, item.Name)
		}
		raw, err := json.Marshal(names)
		if err != nil {
			return nil, true, err
		}
		return &QueryExecResult{Document: raw, Count: int64(len(names)), Engine: "driver"}, true, nil

	case lower == "db.stats()":
		var result bson.M
		err := sess.Client.Database(database).RunCommand(ctx, bson.D{{Key: "dbStats", Value: 1}}).Decode(&result)
		if err != nil {
			return nil, true, err
		}
		raw, err := MarshalDocument(result)
		if err != nil {
			return nil, true, err
		}
		return &QueryExecResult{Document: raw, Count: 1, Engine: "driver"}, true, nil

	case lower == "help":
		help := strings.Join([]string{
			"Driver fallback (no mongosh) supports:",
			"  show dbs | show databases",
			"  show collections | show tables",
			"  use <db>",
			"  db / db.getName() / db.getCollectionNames() / db.stats()",
			"  db.<coll>.find|findOne|aggregate|countDocuments",
			"  db.getCollection('name').find|...",
			"Install mongosh for full shell syntax.",
		}, "\n")
		return &QueryExecResult{Output: help, Count: 1, Engine: "driver"}, true, nil

	default:
		return nil, false, nil
	}
}

func execQueryViaDriver(ctx context.Context, client *mongo.Client, database, input string, explain bool) (*QueryExecResult, error) {
	collection, err := parseQueryCollection(input)
	if err != nil {
		return nil, err
	}

	lower := strings.ToLower(input)
	switch {
	case strings.Contains(lower, ".aggregate("):
		pipelineRaw, err := extractQueryJSONArray(input, ".aggregate(")
		if err != nil {
			return nil, err
		}
		if explain {
			doc, err := ExplainAggregate(ctx, client, database, collection, pipelineRaw)
			if err != nil {
				return nil, err
			}
			return &QueryExecResult{Explain: doc, Count: 1}, nil
		}
		docs, err := RunAggregate(ctx, client, database, collection, pipelineRaw)
		if err != nil {
			return nil, err
		}
		return &QueryExecResult{Documents: docs, Count: int64(len(docs))}, nil
	case strings.Contains(lower, ".findone("):
		filterRaw, err := extractQueryJSONObject(input, ".findOne(")
		if err != nil {
			return nil, err
		}
		doc, err := findOneDocument(ctx, client, database, collection, filterRaw)
		if err != nil {
			return nil, err
		}
		if doc == nil {
			return &QueryExecResult{Document: json.RawMessage("null")}, nil
		}
		return &QueryExecResult{Document: doc, Count: 1}, nil
	case strings.Contains(lower, ".find("):
		filterRaw, err := extractQueryJSONObject(input, ".find(")
		if err != nil {
			return nil, err
		}
		limit := int64(parseFindChainInt(input, reFindChainLimit, 20))
		skip := int64(parseFindChainInt(input, reFindChainSkip, 0))
		if explain {
			doc, err := explainFind(ctx, client, database, collection, filterRaw, limit, skip)
			if err != nil {
				return nil, err
			}
			return &QueryExecResult{Explain: doc, Count: 1}, nil
		}
		result, err := FindDocuments(ctx, client, FindParams{
			Database:   database,
			Collection: collection,
			Filter:     filterRaw,
			Skip:       skip,
			Limit:      limit,
		})
		if err != nil {
			return nil, err
		}
		return &QueryExecResult{Documents: result.Documents, Count: int64(len(result.Documents))}, nil
	case strings.Contains(lower, ".countdocuments("):
		filterRaw, err := extractQueryJSONObject(input, ".countDocuments(")
		if err != nil {
			return nil, err
		}
		count, err := countDocuments(ctx, client, database, collection, filterRaw)
		if err != nil {
			return nil, err
		}
		return &QueryExecResult{Count: count, Output: strconv.FormatInt(count, 10)}, nil
	default:
		return nil, fmt.Errorf("unsupported query syntax without mongosh; use find, findOne, aggregate, or countDocuments")
	}
}

func parseQueryCollection(input string) (string, error) {
	if coll := parseGetCollectionName(input); coll != "" {
		return coll, nil
	}
	if coll := parseDbDotCollection(input); coll != "" {
		return coll, nil
	}
	return "", fmt.Errorf("collection not found in query")
}

func extractQueryJSONObject(input, marker string) (json.RawMessage, error) {
	idx := strings.Index(strings.ToLower(input), strings.ToLower(marker))
	if idx < 0 {
		return nil, fmt.Errorf("object not found")
	}
	rest := input[idx+len(marker):]
	rest = strings.TrimLeft(rest, " \t\r\n")
	if len(rest) == 0 || rest[0] != '{' {
		return json.RawMessage("{}"), nil
	}
	segment, _, ok := extractBalancedSegment(rest, '{', '}')
	if !ok {
		return nil, fmt.Errorf("unclosed object literal")
	}
	if !json.Valid([]byte(segment)) {
		return nil, fmt.Errorf("invalid JSON object")
	}
	return json.RawMessage(segment), nil
}

func extractQueryJSONArray(input, marker string) (json.RawMessage, error) {
	idx := strings.Index(strings.ToLower(input), strings.ToLower(marker))
	if idx < 0 {
		return nil, fmt.Errorf("array not found")
	}
	rest := input[idx+len(marker):]
	rest = strings.TrimLeft(rest, " \t\r\n")
	if len(rest) == 0 || rest[0] != '[' {
		return nil, fmt.Errorf("pipeline must be a JSON array")
	}
	segment, _, ok := extractBalancedSegment(rest, '[', ']')
	if !ok {
		return nil, fmt.Errorf("unclosed array literal")
	}
	if !json.Valid([]byte(segment)) {
		return nil, fmt.Errorf("invalid JSON array")
	}
	return json.RawMessage(segment), nil
}

func parseFindChainInt(input string, re *regexp.Regexp, fallback int) int {
	match := re.FindStringSubmatch(input)
	if len(match) < 2 {
		return fallback
	}
	value, err := strconv.Atoi(match[1])
	if err != nil {
		return fallback
	}
	return value
}

func findOneDocument(ctx context.Context, client *mongo.Client, database, collection string, filter json.RawMessage) (json.RawMessage, error) {
	var filterDoc bson.M
	if len(filter) > 0 {
		if err := json.Unmarshal(filter, &filterDoc); err != nil {
			return nil, fmt.Errorf("parse filter: %w", err)
		}
	}
	var result bson.M
	err := client.Database(database).Collection(collection).FindOne(ctx, filterDoc).Decode(&result)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return MarshalDocument(result)
}

func countDocuments(ctx context.Context, client *mongo.Client, database, collection string, filter json.RawMessage) (int64, error) {
	var filterDoc bson.M
	if len(filter) > 0 {
		if err := json.Unmarshal(filter, &filterDoc); err != nil {
			return 0, fmt.Errorf("parse filter: %w", err)
		}
	}
	return client.Database(database).Collection(collection).CountDocuments(ctx, filterDoc)
}

func explainFind(ctx context.Context, client *mongo.Client, database, collection string, filter json.RawMessage, limit, skip int64) (json.RawMessage, error) {
	var filterDoc bson.M
	if len(filter) > 0 {
		if err := json.Unmarshal(filter, &filterDoc); err != nil {
			return nil, fmt.Errorf("parse filter: %w", err)
		}
	}
	findCmd := bson.D{
		{Key: "find", Value: collection},
		{Key: "filter", Value: filterDoc},
	}
	if limit > 0 {
		findCmd = append(findCmd, bson.E{Key: "limit", Value: limit})
	}
	if skip > 0 {
		findCmd = append(findCmd, bson.E{Key: "skip", Value: skip})
	}
	var explain bson.M
	err := client.Database(database).RunCommand(ctx, bson.D{
		{Key: "explain", Value: findCmd},
	}).Decode(&explain)
	if err != nil {
		return nil, fmt.Errorf("mongodb: find explain: %w", err)
	}
	raw, err := MarshalDocument(explain)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(raw), nil
}
