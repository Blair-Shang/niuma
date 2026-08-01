package sqllsp_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"niuma/pkg/sqllsp"
)

func TestExtractSelectListColumns(t *testing.T) {
	cols := sqllsp.ExtractSelectListColumns("SELECT dept_id, COUNT(*) AS cnt FROM emp GROUP BY dept_id")
	if len(cols) != 2 || cols[0] != "dept_id" || cols[1] != "cnt" {
		t.Fatalf("cols=%#v", cols)
	}
	cols = sqllsp.ExtractSelectListColumns("SELECT a.id, b.name nick FROM t")
	if len(cols) != 2 || cols[0] != "id" || cols[1] != "nick" {
		t.Fatalf("cols=%#v", cols)
	}
	cols = sqllsp.ExtractSelectListColumns("SELECT * FROM t")
	if len(cols) != 0 {
		t.Fatalf("star should yield no static cols, got %#v", cols)
	}
}

func TestExtractCTEDefsWithColumns(t *testing.T) {
	sql := "WITH emp_stat AS (SELECT dept_id, COUNT(*) AS cnt FROM emp GROUP BY dept_id) SELECT * FROM emp_stat"
	defs := sqllsp.ExtractCTEDefs(sql)
	if len(defs) != 1 || defs[0].Name != "emp_stat" {
		t.Fatalf("defs=%#v", defs)
	}
	if len(defs[0].Columns) != 2 || defs[0].Columns[0] != "dept_id" || defs[0].Columns[1] != "cnt" {
		t.Fatalf("cte columns=%#v", defs[0].Columns)
	}

	sql2 := "WITH cte(a, b) AS (SELECT 1, 2) SELECT * FROM cte"
	defs2 := sqllsp.ExtractCTEDefs(sql2)
	if len(defs2) != 1 || len(defs2[0].Columns) != 2 || defs2[0].Columns[0] != "a" || defs2[0].Columns[1] != "b" {
		t.Fatalf("explicit cte cols=%#v", defs2)
	}
}

func TestDerivedTableColumnsOnRef(t *testing.T) {
	sql := "SELECT x. FROM (SELECT id, name AS nm FROM users) x WHERE "
	refs := sqllsp.ExtractTableRefs(sql, strings.Index(sql, "x.")+2)
	var x *sqllsp.TableRef
	for i := range refs {
		if refs[i].Alias == "x" || refs[i].Name == "x" {
			x = &refs[i]
			break
		}
	}
	if x == nil || !x.Virtual {
		t.Fatalf("expected virtual x, got %#v", refs)
	}
	if len(x.Columns) != 2 || x.Columns[0] != "id" || x.Columns[1] != "nm" {
		t.Fatalf("derived cols=%#v", x.Columns)
	}
}

func TestCTEColumnCompletion(t *testing.T) {
	srv := sqllsp.NewServer(stubParser{}, stubCatalog{}, nil, nil)
	srv.DefaultDatabase = func(string) string { return "app" }
	conn := srv.Conns.Open("sess-1", "client-1", "app")

	sql := "WITH emp_stat AS (SELECT dept_id, COUNT(*) AS cnt FROM emp GROUP BY dept_id) SELECT emp_stat. FROM emp_stat"
	uri := "niuma-sql://mysql/sess-1/cte1"
	openRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didOpen",
		"params": map[string]any{
			"textDocument": map[string]any{"uri": uri, "version": 1, "text": sql},
		},
	})
	if _, err := srv.HandleMessage(context.Background(), conn, openRaw); err != nil {
		t.Fatal(err)
	}
	pos := strings.Index(sql, "emp_stat.") + len("emp_stat.")
	compRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "textDocument/completion",
		"params": map[string]any{
			"textDocument": map[string]any{"uri": uri},
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
	foundDept, foundCnt := false, false
	for _, it := range items {
		if it.Label == "dept_id" {
			foundDept = true
		}
		if it.Label == "cnt" {
			foundCnt = true
		}
	}
	if !foundDept || !foundCnt {
		t.Fatalf("expected cte columns dept_id/cnt, got %#v", items)
	}
}

func TestDerivedColumnCompletion(t *testing.T) {
	srv := sqllsp.NewServer(stubParser{}, stubCatalog{}, nil, nil)
	srv.DefaultDatabase = func(string) string { return "app" }
	conn := srv.Conns.Open("sess-1", "client-1", "app")

	sql := "SELECT x. FROM (SELECT id, name FROM users) x"
	uri := "niuma-sql://mysql/sess-1/der1"
	openRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didOpen",
		"params": map[string]any{
			"textDocument": map[string]any{"uri": uri, "version": 1, "text": sql},
		},
	})
	if _, err := srv.HandleMessage(context.Background(), conn, openRaw); err != nil {
		t.Fatal(err)
	}
	pos := strings.Index(sql, "x.") + 2
	compRaw, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "textDocument/completion",
		"params": map[string]any{
			"textDocument": map[string]any{"uri": uri},
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
	foundID, foundName := false, false
	for _, it := range items {
		if it.Label == "id" {
			foundID = true
		}
		if it.Label == "name" {
			foundName = true
		}
	}
	if !foundID || !foundName {
		t.Fatalf("expected derived columns id/name, got %#v", items)
	}
}
