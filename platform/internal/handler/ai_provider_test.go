package handler_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	"niuma/platform/internal/ai"
	"niuma/platform/internal/handler"
	"niuma/platform/internal/idgen"
	"niuma/platform/internal/migrate"
	"niuma/platform/internal/store"

	_ "modernc.org/sqlite"
)

func newTestAIDispatcher(t *testing.T, secrets store.SecretStore) *handler.Dispatcher {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "ai.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	ctx := context.Background()
	if err := migrate.Run(ctx, db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	idGen, err := idgen.NewSnowflake(1)
	if err != nil {
		t.Fatalf("idgen: %v", err)
	}
	if secrets == nil {
		secrets = newMemSecretStore()
	}
	return handler.New(handler.Deps{
		Settings:    store.NewSettingStore(db),
		Connections: store.NewConnectionStore(db),
		Credentials: store.NewCredentialStore(db),
		Secrets:     secrets,
		IDs:         idGen,
		AI: ai.NewService(ai.Deps{
			Providers:     store.NewAIProviderStore(db),
			Conversations: store.NewAIConversationStore(db),
			MCP:           store.NewAIMCPStore(db),
			Skills:        store.NewAISkillStore(db),
			Secrets:       secrets,
			IDs:           idGen,
		}),
	})
}

// TestAIProviderUpsertListDelete 覆盖 Provider 增删查与密钥经 SecretStore 落库。
func TestAIProviderUpsertListDelete(t *testing.T) {
	t.Parallel()
	secrets := newMemSecretStore()
	d := newTestAIDispatcher(t, secrets)
	ctx := context.Background()

	createRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIProviderUpsert,
		"id":     "1",
		"params": map[string]any{
			"provider": map[string]any{
				"providerName":     "OpenAI Test",
				"providerKind":     "openai",
				"defaultModelCode": "gpt-4o",
				"apiKey":           "sk-test-secret",
			},
		},
	})
	createResp := decodeAITestResponse(t, d.HandleFrame(ctx, createRaw))
	if !createResp.OK {
		t.Fatalf("upsert create: %s", createResp.Error)
	}
	var createResult struct {
		ProviderID string `json:"providerId"`
	}
	if err := json.Unmarshal([]byte(createResp.Result), &createResult); err != nil {
		t.Fatalf("parse create result: %v", err)
	}
	if createResult.ProviderID == "" {
		t.Fatal("expected providerId")
	}
	if secrets.size() != 1 {
		t.Fatalf("expected 1 secret, got %d", secrets.size())
	}

	keyRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIProviderGetApiKey,
		"id":     "1b",
		"params": map[string]any{"providerId": createResult.ProviderID},
	})
	keyResp := decodeAITestResponse(t, d.HandleFrame(ctx, keyRaw))
	if !keyResp.OK {
		t.Fatalf("getApiKey: %s", keyResp.Error)
	}
	var keyResult struct {
		Found  bool   `json:"found"`
		APIKey string `json:"apiKey"`
	}
	if err := json.Unmarshal([]byte(keyResp.Result), &keyResult); err != nil {
		t.Fatalf("parse getApiKey: %v", err)
	}
	if !keyResult.Found || keyResult.APIKey != "sk-test-secret" {
		t.Fatalf("unexpected getApiKey: %+v", keyResult)
	}

	listRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIProviderList,
		"id":     "2",
		"params": map[string]any{"includeModels": true},
	})
	listResp := decodeAITestResponse(t, d.HandleFrame(ctx, listRaw))
	if !listResp.OK {
		t.Fatalf("list: %s", listResp.Error)
	}
	var listResult struct {
		Providers []struct {
			ProviderID string `json:"providerId"`
			HasAPIKey  bool   `json:"hasApiKey"`
		} `json:"providers"`
	}
	if err := json.Unmarshal([]byte(listResp.Result), &listResult); err != nil {
		t.Fatalf("parse list: %v", err)
	}
	if len(listResult.Providers) != 1 || !listResult.Providers[0].HasAPIKey {
		t.Fatalf("unexpected list: %+v", listResult.Providers)
	}

	modelRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIModelUpsert,
		"id":     "3",
		"params": map[string]any{
			"model": map[string]any{
				"providerId": createResult.ProviderID,
				"modelCode":  "gpt-4o",
				"modelLabel": "GPT-4o",
			},
		},
	})
	modelResp := decodeAITestResponse(t, d.HandleFrame(ctx, modelRaw))
	if !modelResp.OK {
		t.Fatalf("model upsert: %s", modelResp.Error)
	}

	delRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIProviderDelete,
		"id":     "4",
		"params": map[string]any{"providerId": createResult.ProviderID},
	})
	delResp := decodeAITestResponse(t, d.HandleFrame(ctx, delRaw))
	if !delResp.OK {
		t.Fatalf("delete: %s", delResp.Error)
	}
	if secrets.size() != 0 {
		t.Fatalf("expected secrets cleared, got %d", secrets.size())
	}
}

func TestAIProviderEnsureSystemAndProtect(t *testing.T) {
	t.Parallel()
	d := newTestAIDispatcher(t, nil)
	ctx := context.Background()

	ensureRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIProviderEnsureSystem,
		"id":     "s1",
		"params": map[string]any{
			"enabled":          true,
			"baseUrl":          "https://www.niuma007.com/niuma/cloud/api/v1/ai/v1",
			"providerName":     "NiuMa",
			"defaultModelCode": "niuma-fast",
			"models": []map[string]any{
				{"code": "niuma-fast", "label": "Fast"},
			},
		},
	})
	ensureResp := decodeAITestResponse(t, d.HandleFrame(ctx, ensureRaw))
	if !ensureResp.OK {
		t.Fatalf("ensure: %s", ensureResp.Error)
	}

	delRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIProviderDelete,
		"id":     "s2",
		"params": map[string]any{"providerId": "niuma-system"},
	})
	delResp := decodeAITestResponse(t, d.HandleFrame(ctx, delRaw))
	if delResp.OK {
		t.Fatal("system provider must not be deleted")
	}

	upsertRaw, _ := json.Marshal(map[string]any{
		"method": handler.MethodAIProviderUpsert,
		"id":     "s3",
		"params": map[string]any{
			"providerId": "niuma-system",
			"provider": map[string]any{
				"providerName": "hack",
				"providerKind": "openai",
			},
		},
	})
	upsertResp := decodeAITestResponse(t, d.HandleFrame(ctx, upsertRaw))
	if upsertResp.OK {
		t.Fatal("system provider must be read-only via upsert")
	}
}

type aiTestResponse struct {
	OK     bool   `json:"ok"`
	Error  string `json:"error"`
	Result string `json:"result"`
}

func decodeAITestResponse(t *testing.T, raw []byte) aiTestResponse {
	t.Helper()
	var resp aiTestResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		t.Fatalf("decode response: %v body=%s", err, string(raw))
	}
	return resp
}
