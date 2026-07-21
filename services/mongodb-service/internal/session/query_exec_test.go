package session

import (
	"context"
	"strings"
	"testing"
)

func TestWrapMongoshEval(t *testing.T) {
	got := wrapMongoshEval("db.users.find({}).limit(20)", false)
	if strings.Contains(got, "eval(") {
		t.Fatal("must not wrap with eval()")
	}
	if !strings.Contains(got, "db.users.find({}).limit(20)") {
		t.Fatalf("expected direct expression embed: %s", got)
	}
	for _, part := range []string{"toArray", "hasNext", "__niuma_safe", "Collection"} {
		if !strings.Contains(got, part) {
			t.Fatalf("wrap missing %q: %s", part, got)
		}
	}
	gotExplain := wrapMongoshEval("db.users.find({})", true)
	if !strings.Contains(gotExplain, "explain('executionStats')") {
		t.Fatalf("expected explain wrap: %s", gotExplain)
	}
}

func TestDriverHelperMatch(t *testing.T) {
	cases := []struct {
		input string
		want  bool
	}{
		{"show dbs", true},
		{"show databases", true},
		{"show collections", true},
		{"use admin", true},
		{"help", true},
		{"db.getCollectionNames()", true},
		{"db.users.find({})", false},
	}
	for _, tc := range cases {
		_, ok, _ := execQueryViaDriverHelpers(context.Background(), &Session{}, "test", tc.input)
		// db.users.find 未匹配助手（ok=false）；助手类在 nil client 上可能 ok=true 且 err!=nil
		if tc.want && !ok {
			t.Fatalf("%q: expected helper match", tc.input)
		}
		if !tc.want && ok {
			t.Fatalf("%q: should not match helper", tc.input)
		}
	}
}

func TestNeedsGetCollection(t *testing.T) {
	if !needsGetCollection("FLUX-DEMO.STD_WMS") {
		t.Fatal("dotted name needs getCollection")
	}
	if !needsGetCollection("a-b") {
		t.Fatal("hyphen name needs getCollection")
	}
	if needsGetCollection("users") {
		t.Fatal("simple name should use db.users")
	}
}

func TestParseGetCollectionDottedName(t *testing.T) {
	name := parseGetCollectionName(`db.getCollection('FLUX-DEMO.STD_WMS_CUSTOMER_620_H').find({})`)
	if name != "FLUX-DEMO.STD_WMS_CUSTOMER_620_H" {
		t.Fatalf("got %q", name)
	}
}

func TestParseMongoshJSONOutput(t *testing.T) {
	docs, err := parseMongoshJSONOutput(`[{"a":1},{"a":2}]`, false)
	if err != nil {
		t.Fatal(err)
	}
	if docs.Count != 2 || len(docs.Documents) != 2 {
		t.Fatalf("docs count = %d/%d", docs.Count, len(docs.Documents))
	}

	obj, err := parseMongoshJSONOutput(`{"ok":1}`, true)
	if err != nil {
		t.Fatal(err)
	}
	if obj.Explain == nil {
		t.Fatal("expected explain")
	}
}
