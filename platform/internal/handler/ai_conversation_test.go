package handler_test

import (
	"context"
	"encoding/json"
	"testing"

	"niuma/platform/internal/handler"
)

// TestAIConversationCRUD 覆盖会话创建、列表与删除。
func TestAIConversationCRUD(t *testing.T) {
	t.Parallel()
	d := newTestAIDispatcher(t, nil)
	ctx := context.Background()

	createRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIConversationCreate,
		"id":     "1",
		"params": map[string]any{"title": "hello"},
	})
	createResp := decodeAITestResponse(t, d.HandleFrame(ctx, createRaw))
	if !createResp.OK {
		t.Fatalf("create: %s", createResp.Error)
	}
	var created struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(createResp.Result), &created)
	if created.ConversationID == "" {
		t.Fatal("expected conversationId")
	}

	listRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIConversationList,
		"id":     "2",
		"params": map[string]any{},
	})
	listResp := decodeAITestResponse(t, d.HandleFrame(ctx, listRaw))
	if !listResp.OK {
		t.Fatalf("list: %s", listResp.Error)
	}

	delRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIConversationDelete,
		"id":     "3",
		"params": map[string]any{"conversationId": created.ConversationID},
	})
	delResp := decodeAITestResponse(t, d.HandleFrame(ctx, delRaw))
	if !delResp.OK {
		t.Fatalf("delete: %s", delResp.Error)
	}
}
