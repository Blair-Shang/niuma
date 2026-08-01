package sqllsp_test

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"niuma/pkg/sqllsp"
)

type stubParser struct{}

func (stubParser) Keywords() []string {
	return []string{"SELECT", "FROM", "WHERE", "INSERT", "UPDATE"}
}

func (stubParser) Diagnostics(_, text string) []sqllsp.Diagnostic {
	if text == "BAD" {
		return []sqllsp.Diagnostic{{
			Range:    sqllsp.Range{Start: sqllsp.Position{}, End: sqllsp.Position{Character: 3}},
			Severity: 1,
			Message:  "syntax error",
		}}
	}
	return nil
}

func (stubParser) CompletionContext(text string, pos sqllsp.Position) sqllsp.CompletionContext {
	return sqllsp.HeuristicCompletionContext(text, pos, stubParser{}.Keywords())
}

type stubCatalog struct{}

func (stubCatalog) ListSchemas(_ context.Context, p sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	all := []sqllsp.SchemaHit{{Name: "app"}, {Name: "mysql"}}
	var out []sqllsp.SchemaHit
	for _, h := range all {
		if p.Prefix == "" || hasPrefixFold(h.Name, p.Prefix) {
			out = append(out, h)
		}
	}
	return out, false, nil
}

func (stubCatalog) ListTables(_ context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	all := []sqllsp.TableHit{
		{Name: "users", Type: "table", Schema: p.Schema},
		{Name: "orders", Type: "table", Schema: p.Schema},
	}
	var out []sqllsp.TableHit
	for _, h := range all {
		if p.Prefix == "" || hasPrefixFold(h.Name, p.Prefix) {
			out = append(out, h)
		}
	}
	return out, false, nil
}

func (stubCatalog) ListColumns(_ context.Context, p sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	byTable := map[string][]sqllsp.ColumnHit{
		"users":  {{Name: "id", DataType: "int", Schema: p.Schema, Table: "users"}, {Name: "name", DataType: "varchar", Schema: p.Schema, Table: "users"}},
		"orders": {{Name: "id", DataType: "int", Schema: p.Schema, Table: "orders"}, {Name: "user_id", DataType: "int", Schema: p.Schema, Table: "orders"}},
	}
	cols := byTable[strings.ToLower(p.Table)]
	var out []sqllsp.ColumnHit
	for _, h := range cols {
		if p.Prefix == "" || hasPrefixFold(h.Name, p.Prefix) {
			out = append(out, h)
		}
	}
	return out, false, nil
}

func hasPrefixFold(s, prefix string) bool {
	if len(prefix) > len(s) {
		return false
	}
	return equalFold(s[:len(prefix)], prefix)
}

func equalFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}

func TestInitializeAndCompletion(t *testing.T) {
	var notified []map[string]any
	srv := sqllsp.NewServer(stubParser{}, stubCatalog{}, nil, func(_ string, msg map[string]any) {
		notified = append(notified, msg)
	})
	srv.DefaultDatabase = func(string) string { return "app" }

	conn := srv.Conns.Open("sess-1", "client-1", "app")

	initRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params":  map[string]any{},
	})
	resp, err := srv.HandleMessage(context.Background(), conn, initRaw)
	if err != nil {
		t.Fatal(err)
	}
	if resp["result"] == nil {
		t.Fatalf("expected initialize result, got %#v", resp)
	}

	openRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didOpen",
		"params": map[string]any{
			"textDocument": map[string]any{
				"uri":     "niuma-sql://mysql/sess-1/e1",
				"version": 1,
				"text":    "SELECT * FROM ",
			},
		},
	})
	if _, err := srv.HandleMessage(context.Background(), conn, openRaw); err != nil {
		t.Fatal(err)
	}

	compRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "textDocument/completion",
		"params": map[string]any{
			"textDocument": map[string]any{"uri": "niuma-sql://mysql/sess-1/e1"},
			"position":     map[string]any{"line": 0, "character": 14},
		},
	})
	compResp, err := srv.HandleMessage(context.Background(), conn, compRaw)
	if err != nil {
		t.Fatal(err)
	}
	result, _ := compResp["result"].(map[string]any)
	items, _ := result["items"].([]sqllsp.CompletionItem)
	if items == nil {
		// json roundtrip via any — result keeps typed slice
		rawItems, _ := json.Marshal(result["items"])
		if err := json.Unmarshal(rawItems, &items); err != nil {
			t.Fatalf("items: %#v", result["items"])
		}
	}
	if len(items) == 0 {
		t.Fatal("expected completion items")
	}

	badOpen, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didChange",
		"params": map[string]any{
			"textDocument":   map[string]any{"uri": "niuma-sql://mysql/sess-1/e1", "version": 2},
			"contentChanges": []map[string]any{{"text": "BAD"}},
		},
	})
	if _, err := srv.HandleMessage(context.Background(), conn, badOpen); err != nil {
		t.Fatal(err)
	}
	waitForDiagnostics(t, &notified, time.Second)
}

func TestAliasColumnCompletion(t *testing.T) {
	srv := sqllsp.NewServer(stubParser{}, stubCatalog{}, nil, nil)
	srv.DefaultDatabase = func(string) string { return "app" }
	conn := srv.Conns.Open("sess-1", "client-1", "app")

	sql := "SELECT o. FROM users u JOIN orders o ON u.id = o.user_id"
	openRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didOpen",
		"params": map[string]any{
			"textDocument": map[string]any{
				"uri": "niuma-sql://mysql/sess-1/e2", "version": 1, "text": sql,
			},
		},
	})
	if _, err := srv.HandleMessage(context.Background(), conn, openRaw); err != nil {
		t.Fatal(err)
	}

	// cursor after "o."
	pos := strings.Index(sql, "o.") + 2
	compRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "textDocument/completion",
		"params": map[string]any{
			"textDocument": map[string]any{"uri": "niuma-sql://mysql/sess-1/e2"},
			"position":     map[string]any{"line": 0, "character": pos},
		},
	})
	compResp, err := srv.HandleMessage(context.Background(), conn, compRaw)
	if err != nil {
		t.Fatal(err)
	}
	result, _ := compResp["result"].(map[string]any)
	rawItems, _ := json.Marshal(result["items"])
	var items []sqllsp.CompletionItem
	if err := json.Unmarshal(rawItems, &items); err != nil {
		t.Fatal(err)
	}
	foundUserID := false
	foundName := false
	for _, it := range items {
		if it.Label == "user_id" {
			foundUserID = true
		}
		if it.Label == "name" {
			foundName = true
		}
	}
	if !foundUserID {
		t.Fatalf("expected orders.user_id in %#v", items)
	}
	if foundName {
		t.Fatalf("should not suggest users.name for o., got %#v", items)
	}
}

func TestHeuristicFromTables(t *testing.T) {
	cc := sqllsp.HeuristicCompletionContext("SELECT * FROM u", sqllsp.Position{Character: 15}, nil)
	found := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindTable {
			found = true
		}
	}
	if !found {
		t.Fatalf("expect table kind, got %#v", cc)
	}
	if cc.Prefix != "u" {
		t.Fatalf("prefix=%q", cc.Prefix)
	}
}

// 上一句 UPDATE…SET 不得抢走下一句 FROM 表补全。
func TestHeuristicFromAfterUpdateSet(t *testing.T) {
	sql := "UPDATE bas_sku SET addtime=CURRENT_DATE();\n\nSELECT * FROM bas"
	cc := sqllsp.HeuristicCompletionContext(sql, sqllsp.OffsetToPosition(sql, len(sql)), nil)
	found := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindTable {
			found = true
		}
	}
	if !found {
		t.Fatalf("expect table kind after prior UPDATE…SET, got %#v", cc)
	}
	if cc.Prefix != "bas" {
		t.Fatalf("prefix=%q", cc.Prefix)
	}
	for _, k := range cc.Expect {
		if k == sqllsp.KindColumn {
			t.Fatalf("must not be column slot poisoned by prior SET, got %#v", cc)
		}
	}
}

// 单句 UPDATE…SET 仍应提示列。
func TestHeuristicUpdateSetStillColumns(t *testing.T) {
	sql := "UPDATE bas_sku SET add"
	cc := sqllsp.HeuristicCompletionContext(sql, sqllsp.OffsetToPosition(sql, len(sql)), nil)
	found := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindColumn {
			found = true
		}
	}
	if !found {
		t.Fatalf("expect column kind in SET clause, got %#v", cc)
	}
	if !strings.EqualFold(cc.Table, "bas_sku") {
		t.Fatalf("table=%q", cc.Table)
	}
}

// ON a.| 应立刻识别为别名列槽（空前缀），而不是把 a 当前缀过滤列。
func TestHeuristicOnAliasDotEmptyPrefix(t *testing.T) {
	sql := "SELECT * FROM bsm_code a LEFT JOIN bsm_user b on a."
	cc := sqllsp.HeuristicCompletionContext(sql, sqllsp.Position{Character: len(sql)}, nil)
	if len(cc.Expect) != 1 || cc.Expect[0] != sqllsp.KindColumn {
		t.Fatalf("expect column-only after alias., got %#v", cc.Expect)
	}
	if cc.Prefix != "" {
		t.Fatalf("prefix after a. should be empty, got %q", cc.Prefix)
	}
	if !strings.EqualFold(cc.Table, "bsm_code") {
		t.Fatalf("alias a should resolve to bsm_code, got table=%q schema=%q tables=%#v",
			cc.Table, cc.Schema, cc.Tables)
	}
}

// SELECT 多列（含逗号）仍应提示列；CREATE VIEW … AS SELECT 同样适用。
func TestHeuristicSelectListWithComma(t *testing.T) {
	sql := "CREATE VIEW `test2`.`new_view` AS\nSELECT\n    organizationId,activef"
	pos := sqllsp.OffsetToPosition(sql, len(sql))
	cc := sqllsp.HeuristicCompletionContext(sql, pos, nil)
	foundCol := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindColumn {
			foundCol = true
		}
	}
	if !foundCol {
		t.Fatalf("expect column in SELECT list after comma, got %#v", cc.Expect)
	}
	if cc.Prefix != "activef" {
		t.Fatalf("prefix=%q", cc.Prefix)
	}
}

func TestHeuristicSelectListWithFromAfterCursor(t *testing.T) {
	sql := "SELECT\n    organizationId,activef\nFROM  bsm_code"
	// cursor after activef (before FROM)
	offset := strings.Index(sql, "activef") + len("activef")
	cc := sqllsp.HeuristicCompletionContext(sql, sqllsp.OffsetToPosition(sql, offset), nil)
	foundCol := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindColumn {
			foundCol = true
		}
	}
	if !foundCol {
		t.Fatalf("expect column, got %#v", cc.Expect)
	}
	if len(cc.Tables) == 0 || !strings.EqualFold(cc.Tables[0].Name, "bsm_code") {
		t.Fatalf("should bind FROM bsm_code even when cursor is in SELECT list, got %#v", cc.Tables)
	}
	if cc.Prefix != "activef" {
		t.Fatalf("prefix=%q", cc.Prefix)
	}
}

func TestHeuristicSelectListNotAfterFrom(t *testing.T) {
	sql := "SELECT a, b FROM bsm_code WHERE "
	cc := sqllsp.HeuristicCompletionContext(sql, sqllsp.OffsetToPosition(sql, len(sql)), nil)
	// WHERE 分支优先
	foundCol := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindColumn {
			foundCol = true
		}
	}
	if !foundCol {
		t.Fatalf("WHERE should still expect columns, got %#v", cc.Expect)
	}
}

func TestHeuristicSelectListSingleLineComma(t *testing.T) {
	sql := "SELECT organizationId,activef FROM bsm_code"
	offset := strings.Index(sql, "activef") + len("activef")
	cc := sqllsp.HeuristicCompletionContext(sql, sqllsp.Position{Character: offset}, nil)
	foundCol := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindColumn {
			foundCol = true
		}
	}
	if !foundCol {
		t.Fatalf("expect column after comma in SELECT list, got %#v", cc.Expect)
	}
	if cc.Prefix != "activef" {
		t.Fatalf("prefix=%q", cc.Prefix)
	}
}

func TestHeuristicSelectListExpectsFunction(t *testing.T) {
	sql := "SELECT da"
	cc := sqllsp.HeuristicCompletionContext(sql, sqllsp.Position{Character: len(sql)}, nil)
	foundFn := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindFunction {
			foundFn = true
		}
	}
	if !foundFn {
		t.Fatalf("SELECT list should expect functions, got %#v", cc.Expect)
	}
}

func TestHeuristicWhereExpectsFunction(t *testing.T) {
	sql := "SELECT * FROM t WHERE no"
	cc := sqllsp.HeuristicCompletionContext(sql, sqllsp.OffsetToPosition(sql, len(sql)), nil)
	foundFn := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindFunction {
			foundFn = true
		}
	}
	if !foundFn {
		t.Fatalf("WHERE should expect functions, got %#v", cc.Expect)
	}
}

type truncCatalog struct{ stubCatalog }

func (truncCatalog) ListTables(_ context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	hits, _, err := stubCatalog{}.ListTables(context.Background(), p)
	return hits, true, err
}

func TestCompletionIsIncompleteWhenTruncated(t *testing.T) {
	srv := sqllsp.NewServer(stubParser{}, truncCatalog{}, nil, nil)
	srv.DefaultDatabase = func(string) string { return "app" }
	conn := srv.Conns.Open("sess-1", "client-1", "app")

	openRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didOpen",
		"params": map[string]any{
			"textDocument": map[string]any{
				"uri": "niuma-sql://mysql/sess-1/e3", "version": 1, "text": "SELECT * FROM ",
			},
		},
	})
	if _, err := srv.HandleMessage(context.Background(), conn, openRaw); err != nil {
		t.Fatal(err)
	}
	compRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "textDocument/completion",
		"params": map[string]any{
			"textDocument": map[string]any{"uri": "niuma-sql://mysql/sess-1/e3"},
			"position":     map[string]any{"line": 0, "character": 14},
		},
	})
	compResp, err := srv.HandleMessage(context.Background(), conn, compRaw)
	if err != nil {
		t.Fatal(err)
	}
	result, _ := compResp["result"].(map[string]any)
	if result["isIncomplete"] != true {
		t.Fatalf("expected isIncomplete=true, got %#v", result["isIncomplete"])
	}
}

func TestSuggestDatabasePerDocument(t *testing.T) {
	srv := sqllsp.NewServer(stubParser{}, stubCatalog{}, nil, nil)
	conn := srv.Conns.Open("sess-1", "client-1", "app")
	uriA := "niuma-sql://mysql/sess-1/a"
	uriB := "niuma-sql://mysql/sess-1/b"
	open := func(uri, text string) {
		raw, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0",
			"method":  "textDocument/didOpen",
			"params": map[string]any{
				"textDocument": map[string]any{"uri": uri, "version": 1, "text": text},
			},
		})
		if _, err := srv.HandleMessage(context.Background(), conn, raw); err != nil {
			t.Fatal(err)
		}
	}
	open(uriA, "SELECT * FROM ")
	open(uriB, "SELECT * FROM ")
	setDB := func(uri, db string) {
		raw, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0",
			"method":  "niuma/setSuggestDatabase",
			"params":  map[string]any{"uri": uri, "database": db},
		})
		if _, err := srv.HandleMessage(context.Background(), conn, raw); err != nil {
			t.Fatal(err)
		}
	}
	setDB(uriA, "schema_a")
	setDB(uriB, "schema_b")
	docA, _ := conn.Docs.Get(uriA)
	docB, _ := conn.Docs.Get(uriB)
	if docA.SuggestDatabase != "schema_a" || docB.SuggestDatabase != "schema_b" {
		t.Fatalf("per-doc suggest: a=%q b=%q", docA.SuggestDatabase, docB.SuggestDatabase)
	}
}

type truncSemanticCatalog struct{}

func (truncSemanticCatalog) ListSchemas(context.Context, sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	return nil, false, nil
}
func (truncSemanticCatalog) ListTables(context.Context, sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	return []sqllsp.TableHit{{Name: "users", Type: "table"}}, true, nil
}
func (truncSemanticCatalog) ListColumns(context.Context, sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	return nil, false, nil
}

func TestSemanticSkipsUnknownWhenTruncated(t *testing.T) {
	var notified []map[string]any
	srv := sqllsp.NewServer(stubParser{}, truncSemanticCatalog{}, nil, func(_ string, msg map[string]any) {
		notified = append(notified, msg)
	})
	srv.DefaultDatabase = func(string) string { return "app" }
	conn := srv.Conns.Open("sess-1", "client-1", "app")
	openRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didOpen",
		"params": map[string]any{
			"textDocument": map[string]any{
				"uri": "niuma-sql://mysql/sess-1/e4", "version": 1,
				"text": "SELECT * FROM missing_table",
			},
		},
	})
	if _, err := srv.HandleMessage(context.Background(), conn, openRaw); err != nil {
		t.Fatal(err)
	}
	waitForDiagnostics(t, &notified, time.Second)
	for _, msg := range notified {
		if msg["method"] != "textDocument/publishDiagnostics" {
			continue
		}
		params, _ := msg["params"].(map[string]any)
		diags, _ := params["diagnostics"].([]sqllsp.Diagnostic)
		raw, _ := json.Marshal(params["diagnostics"])
		_ = json.Unmarshal(raw, &diags)
		for _, d := range diags {
			if strings.Contains(d.Message, "unknown table") {
				t.Fatalf("truncated catalog must not warn unknown table, got %#v", diags)
			}
		}
	}
}

type emptyColumnsCatalog struct{}

func (emptyColumnsCatalog) ListSchemas(context.Context, sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	return []sqllsp.SchemaHit{{Name: "public"}}, false, nil
}
func (emptyColumnsCatalog) ListTables(context.Context, sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	// 表名存在于 catalog，但列查询返回空（模拟系统表落到错误 schema / 未解析到关系）
	return []sqllsp.TableHit{{Name: "pg_class", Type: "table"}}, false, nil
}
func (emptyColumnsCatalog) ListColumns(context.Context, sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	return nil, false, nil
}

func TestSemanticSkipsUnknownColumnWhenEmptyHits(t *testing.T) {
	var notified []map[string]any
	srv := sqllsp.NewServer(stubParser{}, emptyColumnsCatalog{}, nil, func(_ string, msg map[string]any) {
		notified = append(notified, msg)
	})
	srv.DefaultDatabase = func(string) string { return "public" }
	conn := srv.Conns.Open("sess-1", "client-1", "public")
	openRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didOpen",
		"params": map[string]any{
			"textDocument": map[string]any{
				"uri": "niuma-sql://kingbase/sess-1/e5", "version": 1,
				"text": "SELECT c.relkind FROM pg_class c",
			},
		},
	})
	if _, err := srv.HandleMessage(context.Background(), conn, openRaw); err != nil {
		t.Fatal(err)
	}
	waitForDiagnostics(t, &notified, time.Second)
	for _, msg := range notified {
		if msg["method"] != "textDocument/publishDiagnostics" {
			continue
		}
		params, _ := msg["params"].(map[string]any)
		var diags []sqllsp.Diagnostic
		raw, _ := json.Marshal(params["diagnostics"])
		_ = json.Unmarshal(raw, &diags)
		for _, d := range diags {
			if strings.Contains(d.Message, "unknown column") {
				t.Fatalf("empty column catalog must not warn unknown column, got %#v", diags)
			}
		}
	}
}

func waitForDiagnostics(t *testing.T, notified *[]map[string]any, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if len(*notified) > 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("expected diagnostics notification")
}

type countingCatalog struct {
	stubCatalog
	columns atomic.Int32
	tables  atomic.Int32
}

func (c *countingCatalog) ListTables(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	c.tables.Add(1)
	return c.stubCatalog.ListTables(ctx, p)
}

func (c *countingCatalog) ListColumns(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	c.columns.Add(1)
	return c.stubCatalog.ListColumns(ctx, p)
}

func TestCachingCatalogDedupesColumnLookups(t *testing.T) {
	inner := &countingCatalog{}
	cache := sqllsp.NewCachingCatalog(inner, time.Minute)
	ctx := context.Background()
	p := sqllsp.CatalogParams{SessionID: "s1", Schema: "app", Table: "users", Prefix: "n", Limit: 50}
	hits1, _, err := cache.ListColumns(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	p.Prefix = "na"
	hits2, _, err := cache.ListColumns(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	if inner.columns.Load() != 1 {
		t.Fatalf("expected 1 inner ListColumns, got %d", inner.columns.Load())
	}
	if len(hits1) == 0 || len(hits2) == 0 {
		t.Fatalf("expected filtered hits, got %v / %v", hits1, hits2)
	}
}

func TestCachingCatalogPrefixUsesWarmUntruncatedCache(t *testing.T) {
	inner := &countingCatalog{}
	cache := sqllsp.NewCachingCatalog(inner, time.Minute)
	ctx := context.Background()

	// 无前缀：暖缓存（stub 未截断）
	_, _, err := cache.ListTables(ctx, sqllsp.CatalogParams{SessionID: "s1", Schema: "app", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if inner.tables.Load() != 1 {
		t.Fatalf("expected 1 unprefixed ListTables, got %d", inner.tables.Load())
	}

	// 有前缀：未截断暖缓存 → 本地过滤，不再打 inner
	hits, _, err := cache.ListTables(ctx, sqllsp.CatalogParams{
		SessionID: "s1", Schema: "app", Prefix: "us", Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	if inner.tables.Load() != 1 {
		t.Fatalf("expected prefix to reuse warm cache, got %d inner calls", inner.tables.Load())
	}
	if len(hits) == 0 || hits[0].Name != "users" {
		t.Fatalf("expected users hit, got %#v", hits)
	}
}

func TestCachingCatalogPrefixBypassesTruncatedTableCache(t *testing.T) {
	inner := &truncatedTableCatalog{}
	cache := sqllsp.NewCachingCatalog(inner, time.Minute)
	ctx := context.Background()

	_, trunc, err := cache.ListTables(ctx, sqllsp.CatalogParams{SessionID: "s1", Schema: "app", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if !trunc {
		t.Fatal("expected truncated warm cache")
	}
	if inner.tables.Load() != 1 {
		t.Fatalf("expected 1 unprefixed ListTables, got %d", inner.tables.Load())
	}

	// 截断暖缓存：有前缀必须直查，不能只靠截断列表过滤
	hits, _, err := cache.ListTables(ctx, sqllsp.CatalogParams{
		SessionID: "s1", Schema: "app", Prefix: "zz", Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	if inner.tables.Load() != 2 {
		t.Fatalf("expected prefix path to hit inner again, got %d", inner.tables.Load())
	}
	if len(hits) == 0 || hits[0].Name != "zz_only_via_prefix" {
		t.Fatalf("expected prefix-direct hit, got %#v", hits)
	}
}

func TestCachingCatalogIsolatesDatabases(t *testing.T) {
	inner := &recordingCatalog{}
	cache := sqllsp.NewCachingCatalog(inner, time.Minute)
	ctx := context.Background()

	_, _, err := cache.ListTables(ctx, sqllsp.CatalogParams{
		SessionID: "s1", Database: "db_a", Schema: "public", Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = cache.ListTables(ctx, sqllsp.CatalogParams{
		SessionID: "s1", Database: "db_b", Schema: "public", Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	if inner.tables.Load() != 2 {
		t.Fatalf("expected separate cache per database, got %d inner calls", inner.tables.Load())
	}
	if len(inner.lastDBs) != 2 || inner.lastDBs[0] != "db_a" || inner.lastDBs[1] != "db_b" {
		t.Fatalf("expected Database preserved as db_a/db_b, got %#v", inner.lastDBs)
	}

	// 再查 db_a：应命中缓存，且不覆盖 db_b
	_, _, err = cache.ListTables(ctx, sqllsp.CatalogParams{
		SessionID: "s1", Database: "db_a", Schema: "public", Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	if inner.tables.Load() != 2 {
		t.Fatalf("expected db_a cache hit, got %d inner calls", inner.tables.Load())
	}
}

type truncatedTableCatalog struct {
	tables atomic.Int32
}

func (c *truncatedTableCatalog) ListSchemas(context.Context, sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	return nil, false, nil
}
func (c *truncatedTableCatalog) ListTables(_ context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	c.tables.Add(1)
	if strings.TrimSpace(p.Prefix) != "" {
		return []sqllsp.TableHit{{Name: "zz_only_via_prefix", Type: "table", Schema: p.Schema}}, false, nil
	}
	// 无前缀：截断，且不含 zz_only_via_prefix
	return []sqllsp.TableHit{{Name: "users", Type: "table", Schema: p.Schema}}, true, nil
}
func (c *truncatedTableCatalog) ListColumns(context.Context, sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	return nil, false, nil
}

type recordingCatalog struct {
	tables  atomic.Int32
	lastDBs []string
}

func (c *recordingCatalog) ListSchemas(context.Context, sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	return nil, false, nil
}
func (c *recordingCatalog) ListTables(_ context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	c.tables.Add(1)
	c.lastDBs = append(c.lastDBs, p.Database)
	return []sqllsp.TableHit{{Name: "t_" + p.Database, Type: "table", Schema: p.Schema}}, false, nil
}
func (c *recordingCatalog) ListColumns(context.Context, sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	return nil, false, nil
}

func TestDidChangeDoesNotBlockOnDiagnostics(t *testing.T) {
	slow := &blockingTableCatalog{release: make(chan struct{})}
	srv := sqllsp.NewServer(stubParser{}, slow, nil, nil)
	srv.DefaultDatabase = func(string) string { return "app" }
	conn := srv.Conns.Open("sess-1", "client-1", "app")

	openRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didOpen",
		"params": map[string]any{
			"textDocument": map[string]any{
				"uri": "niuma-sql://mysql/sess-1/e5", "version": 1,
				"text": "SELECT * FROM users",
			},
		},
	})
	done := make(chan error, 1)
	go func() {
		_, err := srv.HandleMessage(context.Background(), conn, openRaw)
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("didOpen blocked on diagnostics catalog lookup")
	}
	close(slow.release)
}

type blockingTableCatalog struct {
	release chan struct{}
}

func (c *blockingTableCatalog) ListSchemas(context.Context, sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	return nil, false, nil
}
func (c *blockingTableCatalog) ListTables(context.Context, sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	<-c.release
	return []sqllsp.TableHit{{Name: "users", Type: "table"}}, false, nil
}
func (c *blockingTableCatalog) ListColumns(context.Context, sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	return nil, false, nil
}

