package session

import (
	"encoding/json"
	"fmt"
	"runtime"
	"strings"
	"testing"
)

func TestBuildDSN_Basic(t *testing.T) {
	trust := true
	params := ConnectParams{
		HostAddress:  "127.0.0.1",
		PortNumber:   1433,
		LoginAccount: "sa",
		Secret:       "Secret1",
		Options: ConnectOptions{
			Database:               "master",
			Encrypt:                "disable",
			TrustServerCertificate: &trust,
			ApplicationName:        "NiuMa-Test",
		},
	}
	dsn, err := buildDSN(params)
	if err != nil {
		t.Fatal(err)
	}
	if !containsAll(
		dsn,
		"sqlserver://",
		"127.0.0.1:1433",
		"database=master",
		"encrypt=disable",
		"TrustServerCertificate=true",
		"dial+timeout=10",
		"connection+timeout=0",
	) {
		t.Fatalf("unexpected dsn: %s", dsn)
	}
}

func TestBuildDSN_NamedInstance(t *testing.T) {
	params := ConnectParams{
		HostAddress:  "dbhost",
		PortNumber:   0,
		LoginAccount: "sa",
		Secret:       "x",
		Options: ConnectOptions{
			Instance: "SQLEXPRESS",
			Encrypt:  "optional",
		},
	}
	dsn, err := buildDSN(params)
	if err != nil {
		t.Fatal(err)
	}
	if !containsAll(dsn, "dbhost", "/SQLEXPRESS", "encrypt=false") {
		t.Fatalf("unexpected named-instance dsn: %s", dsn)
	}
}

func TestQuoteIdent(t *testing.T) {
	got, err := QuoteIdent("my]db")
	if err != nil {
		t.Fatal(err)
	}
	if got != "[my]]db]" {
		t.Fatalf("got %q", got)
	}
}

func TestValidateAuthWindows(t *testing.T) {
	err := validateAuth(ConnectParams{
		Options: ConnectOptions{AuthType: "windows"},
	})
	if runtime.GOOS == "windows" {
		if err != nil {
			t.Fatalf("windows auth should be allowed on Windows: %v", err)
		}
		return
	}
	if err == nil || !strings.Contains(err.Error(), "only available on Windows") {
		t.Fatalf("expected windows-only error, got %v", err)
	}
}

func TestBuildDSN_Windows(t *testing.T) {
	dsn, err := buildDSN(ConnectParams{
		HostAddress: "dbhost",
		PortNumber:  1433,
		Options:     ConnectOptions{AuthType: "windows", Encrypt: "disable"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(dsn, "@") && strings.Contains(dsn, "://:") {
		t.Fatalf("windows dsn should not embed empty credentials: %s", dsn)
	}
	if !strings.Contains(dsn, "authenticator=winsspi") {
		t.Fatalf("expected winsspi authenticator, got %s", dsn)
	}
}

func TestBuildDSN_AADPassword(t *testing.T) {
	dsn, err := buildDSN(ConnectParams{
		HostAddress:  "demo.database.windows.net",
		PortNumber:   1433,
		LoginAccount: "user@contoso.com",
		Secret:       "p",
		Options:      ConnectOptions{AuthType: "aad_password", Encrypt: "mandatory"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dsn, "fedauth=ActiveDirectoryPassword") {
		t.Fatalf("expected AAD password fedauth, got %s", dsn)
	}
}

func TestValidateConnectOptionsAzureEncrypt(t *testing.T) {
	err := validateConnectOptions(ConnectParams{
		HostAddress: "demo.database.windows.net",
		Options:     ConnectOptions{Encrypt: "optional"},
	})
	if err == nil {
		t.Fatal("expected azure encrypt validation error")
	}
	err = validateConnectOptions(ConnectParams{
		HostAddress: "demo.database.windows.net",
		Options:     ConnectOptions{Encrypt: "mandatory"},
	})
	if err != nil {
		t.Fatalf("mandatory should pass: %v", err)
	}
}

func TestConnectParams_TopLevelDatabaseOverridesOptions(t *testing.T) {
	var params ConnectParams
	if err := json.Unmarshal([]byte(`{
		"hostAddress":"127.0.0.1",
		"portNumber":1433,
		"loginAccount":"sa",
		"secret":"x",
		"options":{"database":"master"},
		"database":"AppDb"
	}`), &params); err != nil {
		t.Fatal(err)
	}
	if params.Options.Database != "AppDb" {
		t.Fatalf("database override: got %q", params.Options.Database)
	}
}

func TestFormatConnectErrorLogin(t *testing.T) {
	got := FormatConnectError(fmt.Errorf("mssql: Login failed for user 'sa'"))
	if !strings.Contains(got, "login failed") {
		t.Fatalf("got %q", got)
	}
}

func containsAll(s string, parts ...string) bool {
	for _, p := range parts {
		if !strings.Contains(s, p) {
			return false
		}
	}
	return true
}
