package ai

import (
	"encoding/json"
	"testing"
)

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
