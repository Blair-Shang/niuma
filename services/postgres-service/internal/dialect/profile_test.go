package dialect

import "testing"

func TestIsLikelyPostgreSQLVersion(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"PostgreSQL 16.2 on x86_64-pc-linux-gnu, compiled by gcc", true},
		{"PostgreSQL 14.10 (Ubuntu 14.10-1.pgdg22.04+1) on x86_64-pc-linux-gnu", true},
		{"PostgreSQL 14.2 (KingbaseES V8)", false},
		{"KingbaseES V008R006C008B0020 on x86_64", false},
		{"Vastbase G100 V2.2 (based on PostgreSQL 14)", false},
		{"openGauss 5.0.0 on x86_64-pc-linux-gnu", false},
		{"CockroachDB CCL v23.1.0", false},
		{"ClickHouse 24.8.4.13", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := IsLikelyPostgreSQLVersion(tc.in); got != tc.want {
			t.Fatalf("IsLikelyPostgreSQLVersion(%q)=%v want %v", tc.in, got, tc.want)
		}
	}
}

func TestResolveCapabilities(t *testing.T) {
	p := ResolveCapabilities("PostgreSQL 16.2 on x86_64-pc-linux-gnu")
	if p.Family != FamilyPostgreSQL {
		t.Fatalf("family=%q", p.Family)
	}
	if p.SQLCompatibility != "pg" {
		t.Fatalf("compat=%q", p.SQLCompatibility)
	}
	for _, cap := range []string{
		CapDoubleQuoteIdent,
		CapDollarQuote,
		CapProcPlpgsqlDollar,
		CapFuncPlpgsqlDollar,
		CapEditorSqlLsp,
		CapFormatPostgresql,
		CapGeneratedIdentity,
		CapListenNotify,
	} {
		if !Has(&p, cap) {
			t.Fatalf("missing cap %s: %#v", cap, p.Capabilities)
		}
	}
	if Has(&p, "compat.oracle") || Has(&p, "proc.plsql_bare") {
		t.Fatalf("unexpected fork/compat caps: %#v", p.Capabilities)
	}
}

func TestParseVersionNum(t *testing.T) {
	got := ParseVersionNum("16.2")
	if got != "160200" {
		t.Fatalf("server_version: got=%q", got)
	}
	got = ParseVersionNum("PostgreSQL 16.2 on x86_64")
	if got != "160200" {
		t.Fatalf("version(): got=%q", got)
	}
	if ParseVersionNum("") != "" {
		t.Fatal("empty should be empty")
	}
}

func TestDefaultProfileFamily(t *testing.T) {
	p := DefaultProfile()
	if p.Family != FamilyPostgreSQL {
		t.Fatalf("family=%q", p.Family)
	}
}
