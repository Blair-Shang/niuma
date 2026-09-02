package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"niuma/platform/internal/migrate"

	_ "modernc.org/sqlite"
)

func openAPIHistoryStore(t *testing.T) *APIHistoryStore {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	if err := migrate.Run(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	return NewAPIHistoryStore(db)
}

func TestAPIHistoryAppendListDelete(t *testing.T) {
	s := openAPIHistoryStore(t)
	ctx := context.Background()
	rec := APIHistoryRecord{
		HistoryID:    "h1",
		RequestID:    "req-1",
		RequestName:  "List",
		HTTPMethod:   "GET",
		RequestURL:   "https://example.test/api",
		RequestJSON:  `{"id":"req-1","name":"List"}`,
		ExchangeJSON: `{"ok":true,"status":200,"body":"ok"}`,
		DurationMS:   12,
		HTTPStatus:   sql.NullInt64{Int64: 200, Valid: true},
	}
	if err := s.Append(ctx, rec); err != nil {
		t.Fatal(err)
	}
	list, err := s.List(ctx, "", "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].HistoryID != "h1" || list[0].HTTPMethod != "GET" {
		t.Fatalf("list=%+v", list)
	}
	if err := s.Delete(ctx, "h1"); err != nil {
		t.Fatal(err)
	}
	list, err = s.List(ctx, "", "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("after delete: %+v", list)
	}
}

func TestAPIHistoryPrune(t *testing.T) {
	s := openAPIHistoryStore(t)
	ctx := context.Background()
	for i := 0; i < APIHistoryRetain+5; i++ {
		rec := APIHistoryRecord{
			HistoryID:    "h" + strconv.Itoa(i),
			HTTPMethod:   "GET",
			RequestName:  "n",
			ExchangeJSON: `{"body":"ok"}`,
		}
		if err := s.Append(ctx, rec); err != nil {
			t.Fatal(err)
		}
	}
	list, err := s.List(ctx, DefaultAPIHistoryWorkspace, "", maxAPIHistoryList)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != APIHistoryRetain {
		t.Fatalf("retain=%d got=%d", APIHistoryRetain, len(list))
	}
}

func TestClipExchangeJSON(t *testing.T) {
	body := strings.Repeat("测", maxAPIExchangeBodyRunes+40)
	rawBytes, err := json.Marshal(map[string]any{"body": body})
	if err != nil {
		t.Fatal(err)
	}
	clipped := clipExchangeJSON(string(rawBytes))
	var payload map[string]any
	if err := json.Unmarshal([]byte(clipped), &payload); err != nil {
		t.Fatal(err)
	}
	got, _ := payload["body"].(string)
	if utf8.RuneCountInString(got) != maxAPIExchangeBodyRunes {
		t.Fatalf("runes=%d", utf8.RuneCountInString(got))
	}
}
