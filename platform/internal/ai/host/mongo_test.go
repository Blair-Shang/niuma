package host

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type mongoStubRuntime struct {
	lastMethod string
	lastParams map[string]any
}

func (s *mongoStubRuntime) Call(_ context.Context, method string, params map[string]any) (json.RawMessage, error) {
	s.lastMethod = method
	s.lastParams = params
	switch method {
	case "mongodb.tree.databases":
		return json.RawMessage(`{"databases":[{"name":"app","sizeOnDisk":1024,"empty":false}]}`), nil
	case "mongodb.tree.collections":
		return json.RawMessage(`{"collections":[{"name":"users","type":"collection","count":3}]}`), nil
	case "mongodb.document.find":
		return json.RawMessage(`{"documents":[{"_id":"1"}],"hasMore":false}`), nil
	case "mongodb.schema.sample":
		return json.RawMessage(`{"fields":[{"path":"name","types":["string"]}],"sampleCount":2}`), nil
	case "mongodb.query.exec":
		return json.RawMessage(`{"documents":[{"ok":1}],"engine":"driver"}`), nil
	default:
		return json.RawMessage(`{}`), nil
	}
}

func (s *mongoStubRuntime) KindOf(_ context.Context, _ string) (string, error) {
	return "mongodb", nil
}

func TestIsMongoTool(t *testing.T) {
	if !IsMongoTool(ToolMongoFind) || IsMongoTool("find") || IsSQLTool(ToolMongoExec) {
		t.Fatal("mongo_* only")
	}
}

func TestHostToolSpecsMongo(t *testing.T) {
	specs := HostToolSpecs("mongodb")
	if len(specs) != 6 {
		t.Fatalf("mongo specs=%d", len(specs))
	}
	for _, spec := range specs {
		if !IsMongoTool(spec.Name) {
			t.Fatalf("unexpected %s", spec.Name)
		}
		if SpecServerID(spec) != ServerIDMongo {
			t.Fatalf("server=%s", SpecServerID(spec))
		}
	}
}

func TestCallMongoListDatabases(t *testing.T) {
	rt := &mongoStubRuntime{}
	text, err := CallMongo(context.Background(), rt, ToolMongoListDatabases, map[string]any{
		"profileId": "p1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, `"name": "app"`) {
		t.Fatalf("result: %s", text)
	}
	if rt.lastMethod != "mongodb.tree.databases" {
		t.Fatalf("method=%s", rt.lastMethod)
	}
}

func TestCallMongoFindRequiresSession(t *testing.T) {
	_, err := Call(context.Background(), &mongoStubRuntime{}, ToolMongoFind, map[string]any{
		"profileId":  "p1",
		"database":   "app",
		"collection": "users",
	})
	if err == nil || !strings.Contains(err.Error(), "sessionId required") {
		t.Fatalf("want sessionId required, got %v", err)
	}
}

func TestCallMongoFind(t *testing.T) {
	rt := &mongoStubRuntime{}
	text, err := CallMongo(context.Background(), rt, ToolMongoFind, map[string]any{
		"sessionId":  "s1",
		"database":   "app",
		"collection": "users",
		"filter":     `{"name":"a"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rt.lastMethod != "mongodb.document.find" {
		t.Fatalf("method=%s", rt.lastMethod)
	}
	if !strings.Contains(text, `"_id"`) {
		t.Fatalf("result: %s", text)
	}
}

func TestCallMongoRunReadonlyRejectsWrite(t *testing.T) {
	rt := &mongoStubRuntime{}
	_, err := CallMongo(context.Background(), rt, ToolMongoRunReadonly, map[string]any{
		"sessionId": "s1",
		"database":  "app",
		"input":     "db.users.insertOne({a:1})",
	})
	if err == nil || !strings.Contains(err.Error(), "mongo_exec") {
		t.Fatalf("want write rejected, got %v", err)
	}
	if rt.lastMethod != "" {
		t.Fatalf("must not call bridge, got %s", rt.lastMethod)
	}
}

func TestAssertReadonlyMongo(t *testing.T) {
	cases := []struct {
		in string
		ok bool
	}{
		{"db.users.find({})", true},
		{"db.users.aggregate([{$match:{}}])", true},
		{"db.users.countDocuments({})", true},
		{"db.users.insertOne({})", false},
		{"db.users.updateMany({}, {$set:{a:1}})", false},
		{"db.users.drop()", false},
		{"", false},
	}
	for _, tc := range cases {
		err := AssertReadonlyMongo(tc.in)
		if tc.ok && err != nil {
			t.Fatalf("%q: %v", tc.in, err)
		}
		if !tc.ok && err == nil {
			t.Fatalf("%q: want error", tc.in)
		}
	}
}
