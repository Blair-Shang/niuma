package session

import (
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
	if !containsAll(dsn, "sqlserver://", "127.0.0.1:1433", "database=master", "encrypt=disable", "TrustServerCertificate=true") {
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

func TestValidateAuthRejectsWindows(t *testing.T) {
	err := validateAuth(ConnectParams{
		LoginAccount: "x",
		Options:      ConnectOptions{AuthType: "windows"},
	})
	if err == nil {
		t.Fatal("expected error for windows auth in P0")
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
