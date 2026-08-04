package dialect

import "testing"

func TestParseVersionNum(t *testing.T) {
	if got := ParseVersionNum("16.0.1000.6"); got != "1600" {
		t.Fatalf("ParseVersionNum= %q want 1600", got)
	}
	if got := ParseVersionNum("15.0.2000.5"); got != "1500" {
		t.Fatalf("ParseVersionNum= %q want 1500", got)
	}
	if got := ParseVersionNum("bad"); got != "" {
		t.Fatalf("ParseVersionNum bad= %q want empty", got)
	}
}

func TestIsSQLServerFamily(t *testing.T) {
	ok := "Microsoft SQL Server 2022 (RTM) - 16.0.1000.6 (X64)"
	if !IsSQLServerFamily(ok) {
		t.Fatal("expected SQL Server banner accepted")
	}
	if IsSQLServerFamily("PostgreSQL 16.1") {
		t.Fatal("expected postgres rejected")
	}
	if IsSQLServerFamily("8.0.36-MySQL Community Server") {
		t.Fatal("expected mysql rejected")
	}
}

func TestResolveCapabilities(t *testing.T) {
	p12 := ResolveCapabilities("12.0.2000.8", false) // 2014
	if !Has(&p12, CapSequence) {
		t.Fatal("2014 should have sequence")
	}
	if Has(&p12, CapJSON) {
		t.Fatal("2014 should not have json")
	}

	p16 := ResolveCapabilities("16.0.1000.6", true)
	if !Has(&p16, CapJSON) || !Has(&p16, CapSplitGoBatches) {
		t.Fatal("2022 azure should have json + go batches")
	}
	if p16.SQLCompatibility != "azure" {
		t.Fatalf("sqlCompatibility= %q want azure", p16.SQLCompatibility)
	}
	if p16.Family != FamilySQLServer {
		t.Fatalf("family= %q", p16.Family)
	}
}
