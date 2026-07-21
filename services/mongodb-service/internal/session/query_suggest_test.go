package session

import "testing"

func TestScanQueryCursor_dbDot(t *testing.T) {
	text := "db."
	state := scanQueryCursor(text, len(text))
	if state.kind != queryCtxDbMember {
		t.Fatalf("kind = %q, want db-member", state.kind)
	}
	if state.prefix != "" {
		t.Fatalf("prefix = %q, want empty after db.", state.prefix)
	}
}

func TestScanQueryCursor_collectionMethod(t *testing.T) {
	text := "db.users."
	offset := len(text)
	state := scanQueryCursor(text, offset)
	if state.kind != queryCtxCollectionCall {
		t.Fatalf("kind = %q, want collection-call", state.kind)
	}
	if state.targetCollection != "users" {
		t.Fatalf("collection = %q, want users", state.targetCollection)
	}
}

func TestScanQueryCursor_getCollection(t *testing.T) {
	text := "db.getCollection('orders')."
	offset := len(text)
	state := scanQueryCursor(text, offset)
	if state.kind != queryCtxCollectionCall {
		t.Fatalf("kind = %q, want collection-call", state.kind)
	}
	if state.targetCollection != "orders" {
		t.Fatalf("collection = %q, want orders", state.targetCollection)
	}
}

func TestScanQueryCursor_filterField(t *testing.T) {
	text := "db.users.find({ \""
	offset := len(text)
	state := scanQueryCursor(text, offset)
	if state.kind != queryCtxFilterKey {
		t.Fatalf("kind = %q, want filter-key", state.kind)
	}
	if state.targetCollection != "users" {
		t.Fatalf("collection = %q, want users", state.targetCollection)
	}
}

func TestScanQueryCursor_pipeline(t *testing.T) {
	text := "db.users.aggregate([\n  { \""
	offset := len(text)
	state := scanQueryCursor(text, offset)
	if state.kind != queryCtxPipeline {
		t.Fatalf("kind = %q, want pipeline", state.kind)
	}
	if state.targetCollection != "users" {
		t.Fatalf("collection = %q, want users", state.targetCollection)
	}
}

func TestScanQueryCursor_dbPartialMember(t *testing.T) {
	text := "db.getc"
	state := scanQueryCursor(text, len(text))
	if state.kind != queryCtxDbMember {
		t.Fatalf("kind = %q, want db-member", state.kind)
	}
}

func TestScanQueryCursor_collectionMethodPartial(t *testing.T) {
	text := "db.users.fin"
	state := scanQueryCursor(text, len(text))
	if state.kind != queryCtxCollectionCall {
		t.Fatalf("kind = %q, want collection-call", state.kind)
	}
	if state.targetCollection != "users" {
		t.Fatalf("collection = %q, want users", state.targetCollection)
	}
}

func TestScanQueryCursor_shellHelper(t *testing.T) {
	text := "show da"
	state := scanQueryCursor(text, len(text))
	if state.kind != queryCtxTopLevel {
		t.Fatalf("kind = %q, want top-level", state.kind)
	}
	if state.prefix != "show da" {
		t.Fatalf("prefix = %q, want %q", state.prefix, "show da")
	}
}

func TestQueryCommandCompletions_shellHelper(t *testing.T) {
	items := queryCommandCompletions(shellHelpers, "show da")
	if len(items) == 0 {
		t.Fatal("expected show databases suggestion")
	}
	found := false
	for _, item := range items {
		if item.Label == "show databases" || item.Label == "show dbs" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected show databases/dbs in %#v", items)
	}
}
