package session

import "testing"

func TestOffsetFromLineColumn(t *testing.T) {
	text := "{\n  \"$match\": {}\n}"
	if got := offsetFromLineColumn(text, 2, 3); got != 4 {
		t.Fatalf("offset = %d, want 4", got)
	}
}

func TestScanPipelineCursor_matchFieldKey(t *testing.T) {
	text := "[\n  { \"$match\": { \""
	state := scanPipelineCursor(text, len(text))
	if state.stage != "$match" {
		t.Fatalf("stage = %q, want $match", state.stage)
	}
	if !state.insideString {
		t.Fatal("expected inside string")
	}
	if pipelineStringRole(text, len(text)) != "key" {
		t.Fatal("expected key role")
	}
}

func TestNearestLookupFrom(t *testing.T) {
	text := "[\n  { \"$lookup\": {\n    \"from\": \"orders\",\n    \"foreignField\": \""
	got := nearestLookupFrom(text, len(text))
	if got != "orders" {
		t.Fatalf("from = %q, want orders", got)
	}
}

func TestSuggestPipelineStaticStage(t *testing.T) {
	text := "[\n  { "
	offset := len(text)
	suggestCtx := &pipelineSuggestContext{
		cursor: scanPipelineCursor(text, offset),
		text:   text,
		offset: offset,
		prefix: "",
	}
	items := staticPipelineSuggestions(suggestCtx)
	if len(items) == 0 {
		t.Fatal("expected stage suggestions")
	}
	if suggestCtx.contextLabel != "stage-key" && suggestCtx.contextLabel != "pipeline-stage" {
		t.Fatalf("context = %q", suggestCtx.contextLabel)
	}
}

func TestSuggestPipelineWithMetadata(t *testing.T) {
	text := "[\n  { \"$match\": { \""
	fields := []SchemaField{{Path: "age", Types: []string{"number"}, Frequency: 1}}
	collections := []string{"orders", "users"}

	suggestCtx := &pipelineSuggestContext{
		fields:      fields,
		collections: collections,
		cursor:      scanPipelineCursor(text, len(text)),
		text:        text,
		offset:      len(text),
		prefix:      "",
	}
	dynamic := dynamicPipelineSuggestions(suggestCtx)
	if len(dynamic) == 0 {
		t.Fatal("expected field suggestions")
	}
	if dynamic[0].Label != "age" {
		t.Fatalf("label = %q, want age", dynamic[0].Label)
	}
}
