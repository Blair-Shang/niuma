package dialect

import (
	"errors"
	"testing"
)

func TestParseVersionNum(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, want string
	}{
		{"24.8.4.13", "24080413"},
		{"22.8.15.25", "22081525"},
		{"23.3.1", "23030100"},
		{"not-a-version", ""},
	}
	for _, tc := range cases {
		if got := ParseVersionNum(tc.in); got != tc.want {
			t.Fatalf("ParseVersionNum(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestIsLikelyClickHouseVersion(t *testing.T) {
	t.Parallel()
	if !IsLikelyClickHouseVersion("24.8.4.13") {
		t.Fatal("expected clickhouse version")
	}
	if IsLikelyClickHouseVersion("8.0.36-MySQL") {
		t.Fatal("mysql must be rejected")
	}
	if IsLikelyClickHouseVersion("10.11.6-MariaDB") {
		t.Fatal("mariadb must be rejected")
	}
	if IsLikelyClickHouseVersion("") {
		t.Fatal("empty must be rejected")
	}
}

func TestResolveCapabilitiesBase(t *testing.T) {
	t.Parallel()
	p := ResolveCapabilities("22.8.15.25", false)
	if p.Family != FamilyClickHouse {
		t.Fatalf("family=%q", p.Family)
	}
	for _, cap := range []string{
		CapBacktickIdent,
		CapSettingsClause,
		CapEditorBuiltinSQL,
		CapEditorSqlLsp,
		CapMaterializedView,
		CapDictionary,
		CapIoCSV,
		CapIoNativeFormat,
		CapDDLDesign,
		CapExplainEstimate,
		CapCreateOrReplaceView,
	} {
		if !Has(&p, cap) {
			t.Fatalf("missing cap %s", cap)
		}
	}
	if Has(&p, CapLightweightDelete) {
		t.Fatal("22.8 must not default lightweight_delete")
	}
	if Has(&p, CapExplainAnalyze) {
		t.Fatal("22.8 must not enable explain_analyze")
	}
	if Has(&p, CapExplainQueryTree) {
		t.Fatal("22.8 must not enable explain_query_tree")
	}
	if Has(&p, CapCreateOrReplaceMaterializedView) {
		t.Fatal("22.8 must not enable create_or_replace_materialized_view")
	}
	if Has(&p, CapCreateOrReplaceDictionary) {
		t.Fatal("22.8 must not enable create_or_replace_dictionary")
	}
	if Has(&p, CapCluster) {
		t.Fatal("hasCluster=false must omit cluster cap")
	}
	if p.VersionNum != "22081525" {
		t.Fatalf("versionNum=%q", p.VersionNum)
	}
}

func TestResolveCapabilitiesModern(t *testing.T) {
	t.Parallel()
	p := ResolveCapabilities("23.3.2.1", true)
	if !Has(&p, CapLightweightDelete) {
		t.Fatal("23.3+ must enable lightweight_delete")
	}
	if !Has(&p, CapExplainQueryTree) {
		t.Fatal("23.3+ must enable explain_query_tree")
	}
	if Has(&p, CapExplainAnalyze) {
		t.Fatal("23.3 must not enable explain_analyze")
	}
	if !Has(&p, CapCluster) {
		t.Fatal("hasCluster=true must enable cluster")
	}
	p24 := ResolveCapabilities("24.8.4.13", false)
	if Has(&p24, CapExplainAnalyze) {
		t.Fatal("24.8 must not enable explain_analyze")
	}
	p26 := ResolveCapabilities("26.7.1.1", false)
	if !Has(&p26, CapExplainAnalyze) {
		t.Fatal("26.7+ must enable explain_analyze")
	}
	if Has(&p26, CapCreateOrReplaceMaterializedView) || Has(&p26, CapCreateOrReplaceDictionary) {
		t.Fatal("26.7 must keep MV/dictionary OR REPLACE caps off until matrix bump")
	}
	pDef := ResolveCapabilities("", false)
	if !Has(&pDef, CapCreateOrReplaceView) {
		t.Fatal("default profile must enable create_or_replace_view")
	}
}

func TestHasNilSafe(t *testing.T) {
	t.Parallel()
	if Has(nil, CapBacktickIdent) {
		t.Fatal("nil profile must be false")
	}
	p := DefaultProfile()
	if p.Family != FamilyClickHouse {
		t.Fatalf("default family=%q", p.Family)
	}
	if !Has(&p, CapBacktickIdent) {
		t.Fatal("default must include backtick")
	}
}

func TestErrNotClickHouseSentinel(t *testing.T) {
	t.Parallel()
	if !errors.Is(ErrNotClickHouse, ErrNotClickHouse) {
		t.Fatal("sentinel identity")
	}
}
