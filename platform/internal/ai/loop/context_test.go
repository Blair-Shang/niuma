package loop

import (
	"strings"
	"testing"

	"niuma/platform/internal/store"
)

func TestNormalizeContext_capabilitiesDialect(t *testing.T) {
	draft := &ContextDraft{
		Workspace: &ContextWorkspace{
			ModuleID:      "vastbase",
			DialectFamily: "vastbase",
			Capabilities:  []string{"proc.plsql_bare", "script.oracle_slash"},
		},
	}
	n := NormalizeContext(draft)
	if !strings.Contains(n.PromptBlock, "capabilities=proc.plsql_bare,script.oracle_slash") {
		t.Fatalf("missing caps: %q", n.PromptBlock)
	}
	if !strings.Contains(n.PromptBlock, "CREATE PROCEDURE: use AS|IS") {
		t.Fatalf("missing proc rule: %q", n.PromptBlock)
	}
}

func TestNormalizeContext_selectionAndWorkspace(t *testing.T) {
	draft := &ContextDraft{
		Workspace: &ContextWorkspace{
			ModuleID:  "vastbase",
			ProfileID: "p1",
			Title:     "query.sql",
		},
		Attachments: []ContextAttachment{
			{
				ID:    "sel:1",
				Kind:  "selection",
				Label: "选区",
				Payload: map[string]any{
					"text": "SELECT 1",
				},
			},
		},
	}
	n := NormalizeContext(draft)
	if n.Workspace == nil || n.Workspace.ProfileID != "p1" {
		t.Fatalf("workspace: %+v", n.Workspace)
	}
	if !strings.Contains(n.PromptBlock, "SELECT 1") {
		t.Fatalf("prompt missing selection: %q", n.PromptBlock)
	}
	if !strings.Contains(n.PromptBlock, "[Context Pack]") {
		t.Fatalf("missing header: %q", n.PromptBlock)
	}
	if !strings.Contains(n.PromptBlock, "[Dialect · Vastbase") {
		t.Fatalf("missing vastbase dialect rules: %q", n.PromptBlock)
	}
	if !strings.Contains(n.PromptBlock, "Do NOT use: LANGUAGE plpgsql") {
		t.Fatalf("missing procedure hard rule: %q", n.PromptBlock)
	}
}

func TestNormalizeContext_sshWorkspace(t *testing.T) {
	draft := &ContextDraft{
		Workspace: &ContextWorkspace{
			ModuleID:  "ssh",
			ProfileID: "p-ssh",
			SessionID: "s-ssh",
			Title:     "prod-box",
			Cwd:       "/var/log",
		},
	}
	n := NormalizeContext(draft)
	if n.Workspace == nil || n.Workspace.Cwd != "/var/log" {
		t.Fatalf("cwd: %+v", n.Workspace)
	}
	if !strings.Contains(n.PromptBlock, "cwd=/var/log") {
		t.Fatalf("missing cwd: %q", n.PromptBlock)
	}
	if !strings.Contains(n.PromptBlock, "[Workspace · SSH]") {
		t.Fatalf("missing ssh workspace rules: %q", n.PromptBlock)
	}
	if !strings.Contains(n.PromptBlock, "ssh_*") {
		t.Fatalf("missing ssh tool hint: %q", n.PromptBlock)
	}
}

func TestNormalizeContext_stripsSecrets(t *testing.T) {
	draft := &ContextDraft{
		Attachments: []ContextAttachment{{
			ID:    "c1",
			Kind:  "connection",
			Label: "prod",
			Payload: map[string]any{
				"profileId": "p1",
				"password":  "super-secret",
				"apiKey":    "sk-xxx",
			},
		}},
	}
	n := NormalizeContext(draft)
	if strings.Contains(n.PromptBlock, "super-secret") || strings.Contains(n.PromptBlock, "sk-xxx") {
		t.Fatalf("secret leaked: %q", n.PromptBlock)
	}
	if len(n.Attachments) != 1 || n.Attachments[0].Payload["profileId"] != "p1" {
		t.Fatalf("payload: %+v", n.Attachments)
	}
}

func TestNormalizeContext_truncatesSelection(t *testing.T) {
	big := strings.Repeat("中", maxSelectionBytes) // multi-byte; may exceed byte cap
	draft := &ContextDraft{
		Attachments: []ContextAttachment{{
			ID:    "sel:big",
			Kind:  "selection",
			Label: "大选区",
			Payload: map[string]any{
				"text": big + "TAIL",
			},
		}},
	}
	n := NormalizeContext(draft)
	if !n.Truncated {
		t.Fatal("expected truncated")
	}
	text, _ := n.Attachments[0].Payload["text"].(string)
	if strings.Contains(text, "TAIL") {
		t.Fatalf("tail should be cut: len=%d", len(text))
	}
}

func TestNormalizeContext_diagnosticBodyInPrompt(t *testing.T) {
	draft := &ContextDraft{
		Attachments: []ContextAttachment{{
			ID:     "diag:1",
			Kind:   "diagnostic",
			Label:  "EXPLAIN",
			Detail: "plan",
			Payload: map[string]any{
				"text": "Seq Scan on public.orders  (cost=0.00..10.00)",
			},
		}},
	}
	n := NormalizeContext(draft)
	if !strings.Contains(n.PromptBlock, "Seq Scan on public.orders") {
		t.Fatalf("diagnostic body missing: %q", n.PromptBlock)
	}
}

func TestAssembleMessages_multimodalUserImage(t *testing.T) {
	history := []store.AIMessage{
		{MessageRole: MessageRoleUser, MessageContent: "⟦nm-img:data:image/png;base64,AAAA⟧\n\n这是什么"},
	}
	msgs := AssembleMessages(history, NormalizedContext{}, "")
	if len(msgs) < 2 {
		t.Fatalf("want system+user, got %d", len(msgs))
	}
	last := msgs[len(msgs)-1]
	parts, ok := last.Content.([]ContentPart)
	if !ok {
		t.Fatalf("want multimodal parts, got %T", last.Content)
	}
	if len(parts) != 2 || parts[0].Type != "text" || parts[1].Type != "image_url" {
		t.Fatalf("parts: %+v", parts)
	}
	if parts[1].ImageURL == nil || !strings.HasPrefix(parts[1].ImageURL.URL, "data:image/png") {
		t.Fatalf("image url: %+v", parts[1].ImageURL)
	}
}

func TestAssembleMessages_textFileAttachment(t *testing.T) {
	history := []store.AIMessage{
		{MessageRole: MessageRoleUser, MessageContent: "⟦nm-txt:slow.sql⟧\nSELECT 1\n⟦/nm-txt⟧\n\n解释这段"},
	}
	msgs := AssembleMessages(history, NormalizedContext{}, "")
	if len(msgs) < 2 {
		t.Fatalf("want system+user, got %d", len(msgs))
	}
	last := msgs[len(msgs)-1]
	text, ok := last.Content.(string)
	if !ok {
		t.Fatalf("want string content, got %T", last.Content)
	}
	if !strings.Contains(text, "[Attached file: slow.sql]") || !strings.Contains(text, "SELECT 1") {
		t.Fatalf("text file missing: %q", text)
	}
	if !strings.Contains(text, "解释这段") {
		t.Fatalf("user text missing: %q", text)
	}
	if strings.Contains(text, "nm-txt") {
		t.Fatalf("marker leaked: %q", text)
	}
}

func TestAssembleMessages_injectsContextAndStripsMarkers(t *testing.T) {
	history := []store.AIMessage{
		{MessageRole: MessageRoleUser, MessageContent: "⟦nm-ref:x⟧\n\n解释这段"},
	}
	n := NormalizeContext(&ContextDraft{
		Workspace: &ContextWorkspace{ProfileID: "p1", ModuleID: "vastbase"},
	})
	msgs := AssembleMessages(history, n, "")
	if len(msgs) < 3 {
		t.Fatalf("want system+context+user, got %d", len(msgs))
	}
	if msgs[0].Role != MessageRoleSystem {
		t.Fatalf("first role %s", msgs[0].Role)
	}
	ctxText, ok := msgs[1].Content.(string)
	if !ok || !strings.Contains(ctxText, "[Context Pack]") {
		t.Fatalf("context block: %T %v", msgs[1].Content, msgs[1].Content)
	}
	last := msgs[len(msgs)-1]
	userText, ok := last.Content.(string)
	if !ok || last.Role != MessageRoleUser || strings.Contains(userText, "nm-ref") {
		t.Fatalf("user content: %T %v", last.Content, last.Content)
	}
	if userText != "解释这段" {
		t.Fatalf("unexpected user: %q", userText)
	}
}

func TestAssembleMessages_marksCurrentTurnOnOrphanedUsers(t *testing.T) {
	history := []store.AIMessage{
		{MessageRole: MessageRoleUser, MessageContent: "mongo资源占用搞为什么"},
		{MessageRole: MessageRoleUser, MessageContent: "当前磁盘占比图"},
	}
	msgs := AssembleMessages(history, NormalizedContext{}, "")
	if len(msgs) < 4 {
		t.Fatalf("want system+orphan+hint+current, got %d", len(msgs))
	}
	last := msgs[len(msgs)-1]
	text, ok := last.Content.(string)
	if !ok || last.Role != MessageRoleUser || text != "当前磁盘占比图" {
		t.Fatalf("last user: role=%s content=%v", last.Role, last.Content)
	}
	hint := msgs[len(msgs)-2]
	hintText, ok := hint.Content.(string)
	if !ok || hint.Role != MessageRoleSystem || !strings.Contains(hintText, "[Current turn]") {
		t.Fatalf("current-turn hint: role=%s content=%v", hint.Role, hint.Content)
	}
}

func TestAssembleMessages_noCurrentTurnHintWhenPaired(t *testing.T) {
	history := []store.AIMessage{
		{MessageRole: MessageRoleUser, MessageContent: "mongo为什么占资源"},
		{MessageRole: MessageRoleAssistant, MessageContent: "mongod 单核偏高"},
		{MessageRole: MessageRoleUser, MessageContent: "当前磁盘占比图"},
	}
	msgs := AssembleMessages(history, NormalizedContext{}, "")
	for _, m := range msgs {
		text, _ := m.Content.(string)
		if strings.Contains(text, "[Current turn]") {
			t.Fatalf("paired history should not inject current-turn hint")
		}
	}
	last := msgs[len(msgs)-1]
	text, ok := last.Content.(string)
	if !ok || text != "当前磁盘占比图" {
		t.Fatalf("last user: %v", last.Content)
	}
}
