package handler_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	"niuma/platform/internal/handler"
	"niuma/platform/internal/idgen"
	"niuma/platform/internal/migrate"
	"niuma/platform/internal/store"

	_ "modernc.org/sqlite"
)

func newAPICatalogDispatcher(t *testing.T) *handler.Dispatcher {
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
	idGen, err := idgen.NewSnowflake(0)
	if err != nil {
		t.Fatal(err)
	}
	return handler.New(handler.Deps{
		Settings:   store.NewSettingStore(db),
		IDs:        idGen,
		APICatalog: store.NewAPICatalogStore(db),
	})
}

func TestAPICatalogEnvironmentAndVariables(t *testing.T) {
	d := newAPICatalogDispatcher(t)

	createResp := invokeMap(t, d, handler.MethodAPIEnvironmentCreate, map[string]any{
		"environmentId":   "env-local",
		"environmentName": "Local",
		"baseUrl":         "http://127.0.0.1:9000",
	})
	if !createResp.OK {
		t.Fatalf("create env: %s", createResp.Error)
	}

	replaceResp := invokeMap(t, d, handler.MethodAPIVariableReplaceScope, map[string]any{
		"variableScope": "global",
		"variables": []map[string]any{
			{"variableName": "org", "initialValue": "demo", "currentValue": "demo"},
		},
	})
	if !replaceResp.OK {
		t.Fatalf("replace global: %s", replaceResp.Error)
	}

	envVarsResp := invokeMap(t, d, handler.MethodAPIVariableReplaceScope, map[string]any{
		"variableScope": "environment",
		"scopeRefId":    "env-local",
		"variables": []map[string]any{
			{"variableName": "token", "initialValue": "abc", "currentValue": "abc", "variableKind": "secret"},
		},
	})
	if !envVarsResp.OK {
		t.Fatalf("replace env vars: %s", envVarsResp.Error)
	}

	listEnvResp := invokeMap(t, d, handler.MethodAPIEnvironmentList, map[string]any{})
	if !listEnvResp.OK {
		t.Fatalf("list env: %s", listEnvResp.Error)
	}
	var envListed struct {
		Environments []struct {
			EnvironmentID string `json:"environmentId"`
			BaseURL       string `json:"baseUrl"`
		} `json:"environments"`
	}
	if err := json.Unmarshal([]byte(listEnvResp.Result), &envListed); err != nil {
		t.Fatal(err)
	}
	if len(envListed.Environments) != 1 || envListed.Environments[0].EnvironmentID != "env-local" {
		t.Fatalf("envListed=%+v", envListed)
	}

	listVarResp := invokeMap(t, d, handler.MethodAPIVariableList, map[string]any{})
	if !listVarResp.OK {
		t.Fatalf("list vars: %s", listVarResp.Error)
	}
	var varListed struct {
		Variables []struct {
			VariableScope string `json:"variableScope"`
			VariableName  string `json:"variableName"`
		} `json:"variables"`
	}
	if err := json.Unmarshal([]byte(listVarResp.Result), &varListed); err != nil {
		t.Fatal(err)
	}
	if len(varListed.Variables) != 2 {
		t.Fatalf("varListed=%+v", varListed)
	}

	updateResp := invokeMap(t, d, handler.MethodAPIEnvironmentUpdate, map[string]any{
		"environmentId":   "env-local",
		"environmentName": "Local Dev",
		"baseUrl":         "http://localhost:9000",
	})
	if !updateResp.OK {
		t.Fatalf("update env: %s", updateResp.Error)
	}

	delResp := invokeMap(t, d, handler.MethodAPIEnvironmentDelete, map[string]any{"environmentId": "env-local"})
	if !delResp.OK {
		t.Fatalf("delete env: %s", delResp.Error)
	}

	emptyVars := invokeMap(t, d, handler.MethodAPIVariableList, map[string]any{
		"variableScope": "environment",
		"scopeRefId":    "env-local",
	})
	if !emptyVars.OK {
		t.Fatalf("list env vars after delete: %s", emptyVars.Error)
	}
	var afterDelete struct {
		Variables []any `json:"variables"`
	}
	if err := json.Unmarshal([]byte(emptyVars.Result), &afterDelete); err != nil {
		t.Fatal(err)
	}
	if len(afterDelete.Variables) != 0 {
		t.Fatalf("expected env vars cleared, got %+v", afterDelete)
	}
}
