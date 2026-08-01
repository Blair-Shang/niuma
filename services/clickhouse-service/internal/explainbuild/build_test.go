package explainbuild

import (
	"strings"
	"testing"

	"niuma/services/clickhouse-service/internal/dialect"
)

func TestStripOuterExplain(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, want string
	}{
		{"SELECT 1", "SELECT 1"},
		{"EXPLAIN SELECT 1", "SELECT 1"},
		{"EXPLAIN PLAN SELECT 1", "SELECT 1"},
		{"EXPLAIN PLAN indexes = 1, header = 1\nSELECT 1", "SELECT 1"},
		{"EXPLAIN ESTIMATE\nSELECT count() FROM t", "SELECT count() FROM t"},
		{"EXPLAIN QUERY TREE SELECT 1", "SELECT 1"},
		{"EXPLAINANALYZE SELECT 1", "EXPLAINANALYZE SELECT 1"}, // 非独立关键字
		{"  explain pipeline graph = 0 select 1  ", "select 1"},
	}
	for _, tc := range cases {
		if got := StripOuterExplain(tc.in); got != tc.want {
			t.Fatalf("StripOuterExplain(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestBuildPlanDefaults(t *testing.T) {
	t.Parallel()
	got, err := Build("SELECT 1", Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got.Mode != ModePlan {
		t.Fatalf("mode=%q", got.Mode)
	}
	want := "EXPLAIN PLAN indexes = 1, header = 1, description = 1\nSELECT 1"
	if got.SQL != want {
		t.Fatalf("sql=%q want %q", got.SQL, want)
	}
}

func TestBuildEstimateAndAnalyze(t *testing.T) {
	t.Parallel()
	est, err := Build("SELECT 1", Options{Mode: ModeEstimate})
	if err != nil {
		t.Fatal(err)
	}
	if est.SQL != "EXPLAIN ESTIMATE\nSELECT 1" {
		t.Fatalf("estimate sql=%q", est.SQL)
	}
	an, err := Build("SELECT 1", Options{Analyze: true})
	if err != nil {
		t.Fatal(err)
	}
	if an.Mode != ModeAnalyze || an.SQL != "EXPLAIN ANALYZE\nSELECT 1" {
		t.Fatalf("analyze=%+v", an)
	}
}

func TestBuildStripsDoubleExplain(t *testing.T) {
	t.Parallel()
	got, err := Build("EXPLAIN PLAN SELECT 1", Options{Mode: ModePipeline})
	if err != nil {
		t.Fatal(err)
	}
	if got.InnerSQL != "SELECT 1" {
		t.Fatalf("inner=%q", got.InnerSQL)
	}
	if !strings.HasPrefix(got.SQL, "EXPLAIN PIPELINE\n") {
		t.Fatalf("sql=%q", got.SQL)
	}
}

func TestValidateMode(t *testing.T) {
	t.Parallel()
	old := dialect.ResolveCapabilities("22.8.15.25", false)
	if err := ValidateMode(ModePlan, &old); err != nil {
		t.Fatal(err)
	}
	if err := ValidateMode(ModeEstimate, &old); err != nil {
		t.Fatal(err)
	}
	if err := ValidateMode(ModeAnalyze, &old); err == nil {
		t.Fatal("22.8 must reject ANALYZE")
	}
	modern := dialect.ResolveCapabilities("24.8.4.13", false)
	if err := ValidateMode(ModeAnalyze, &modern); err == nil {
		t.Fatal("24.8 must reject ANALYZE")
	}
	if err := ValidateMode(ModeQueryTree, &modern); err != nil {
		t.Fatal(err)
	}
	v267 := dialect.ResolveCapabilities("26.7.1.1", false)
	if err := ValidateMode(ModeAnalyze, &v267); err != nil {
		t.Fatal(err)
	}
}
