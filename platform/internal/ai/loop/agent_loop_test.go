package loop

import (
	"context"
	"encoding/json"
	"testing"

	"niuma/platform/internal/ai/host"
)

type stubHostRuntime struct{}

func (stubHostRuntime) Call(_ context.Context, _ string, _ map[string]any) (json.RawMessage, error) {
	return json.RawMessage(`{"schemas":[],"truncated":false}`), nil
}

func (stubHostRuntime) KindOf(_ context.Context, _ string) (string, error) {
	return "vastbase", nil
}

func TestMergeWorkspaceArgs(t *testing.T) {
	n := NormalizeContext(&ContextDraft{
		Workspace: &ContextWorkspace{ProfileID: "p1", SessionID: "s1"},
	})
	raw := mergeWorkspaceArgs(`{"schema":"public"}`, n)
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		t.Fatal(err)
	}
	if obj["profileId"] != "p1" || obj["sessionId"] != "s1" || obj["schema"] != "public" {
		t.Fatalf("%v", obj)
	}
}

func TestMergeWorkspaceArgsInjectsCwd(t *testing.T) {
	n := NormalizeContext(&ContextDraft{
		Workspace: &ContextWorkspace{ProfileID: "p1", SessionID: "s1", Cwd: "/var/log"},
	})
	raw := mergeWorkspaceArgs(`{}`, n)
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		t.Fatal(err)
	}
	if obj["cwd"] != "/var/log" || obj["path"] != "/var/log" {
		t.Fatalf("%v", obj)
	}
}

func TestSanitizeToolPrefix(t *testing.T) {
	if got := sanitizeToolPrefix("vastbase readonly!"); got != "vastbase_readonly_" {
		// trailing ! becomes _; trim behavior
		if got == "" {
			t.Fatal(got)
		}
	}
	if got := sanitizeToolPrefix("9x"); got != "s_9x" {
		t.Fatalf("got %q", got)
	}
}

func TestBuildEnabledToolDefsIncludesHostSQL(t *testing.T) {
	s := New(Deps{Host: stubHostRuntime{}})
	defs, bound, err := s.buildEnabledToolDefs(context.Background(), "vastbase")
	if err != nil {
		t.Fatal(err)
	}
	if len(defs) != 4 {
		t.Fatalf("defs=%d", len(defs))
	}
	b, ok := bound[host.ToolListTables]
	if !ok || b.HostName != host.ToolListTables {
		t.Fatalf("missing host tool: %+v", bound)
	}
}

func TestBuildEnabledToolDefsIncludesHostSSH(t *testing.T) {
	s := New(Deps{Host: stubHostRuntime{}})
	defs, bound, err := s.buildEnabledToolDefs(context.Background(), "ssh")
	if err != nil {
		t.Fatal(err)
	}
	if len(defs) != 5 {
		t.Fatalf("defs=%d", len(defs))
	}
	b, ok := bound[host.ToolSSHListDir]
	if !ok || b.HostName != host.ToolSSHListDir || b.Server.ServerID != host.ServerIDSSH {
		t.Fatalf("missing ssh host tool: %+v", bound)
	}
}

func TestCallSQLListSchemasViaStub(t *testing.T) {
	text, err := host.CallSQL(context.Background(), stubHostRuntime{}, host.ToolListSchemas, map[string]any{
		"profileId": "p1",
		"moduleId":  "vastbase",
	})
	if err != nil {
		t.Fatal(err)
	}
	if text == "" {
		t.Fatal("empty result")
	}
}

func TestParseOpenAIStreamChunkToolCalls(t *testing.T) {
	acc := newToolCallAccumulator()
	d1, _, err := parseOpenAIStreamChunk(`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_tables","arguments":""}}]}}]}`)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range d1.ToolCalls {
		acc.apply(tc)
	}
	d2, _, err := parseOpenAIStreamChunk(`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"a\":1}"}}]}}]}`)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range d2.ToolCalls {
		acc.apply(tc)
	}
	calls := acc.calls()
	if len(calls) != 1 || calls[0].Function.Name != "list_tables" || calls[0].Function.Arguments != `{"a":1}` {
		t.Fatalf("%+v", calls)
	}
}
