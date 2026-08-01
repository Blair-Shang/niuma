package dialect

import "testing"

func TestIsLikelyKingbaseVersion(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"KingbaseES V008R006C008B0020 on x86_64", true},
		{"PostgreSQL 14.2 (KingbaseES V8)", true},
		{"PostgreSQL 14.2 on x86_64-pc-linux-gnu", false},
		{"Vastbase G100 V2.2", false},
		{"ClickHouse 24.8.4.13", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := IsLikelyKingbaseVersion(tc.in); got != tc.want {
			t.Fatalf("IsLikelyKingbaseVersion(%q)=%v want %v", tc.in, got, tc.want)
		}
	}
}

func TestResolveCapabilitiesOracle(t *testing.T) {
	p := ResolveCapabilities("KingbaseES V008R006C008B0020", "oracle")
	if p.Family != FamilyKingbase {
		t.Fatalf("family=%q", p.Family)
	}
	if p.SQLCompatibility != "oracle" {
		t.Fatalf("compat=%q", p.SQLCompatibility)
	}
	if !Has(&p, CapCompatOracle) || !Has(&p, CapScriptOracleSlash) {
		t.Fatalf("missing oracle caps: %#v", p.Capabilities)
	}
}

func TestResolveCapabilitiesPG(t *testing.T) {
	p := ResolveCapabilities("KingbaseES V9", "pg")
	if !Has(&p, CapProcPlsqlBare) || !Has(&p, CapDollarQuote) {
		t.Fatalf("missing pg caps: %#v", p.Capabilities)
	}
	if Has(&p, CapCompatOracle) {
		t.Fatalf("unexpected oracle compat")
	}
}

func TestParseVersionNum(t *testing.T) {
	got := ParseVersionNum("KingbaseES V008R006C008B0020")
	if got == "" {
		t.Fatal("empty versionNum")
	}
}
