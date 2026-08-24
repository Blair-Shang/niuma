package tree

import (
	"fmt"
	"regexp"
	"strings"
	"testing"
)

var placeholderPattern = regexp.MustCompile(`@p\d+`)

// assertOrdinalArgs 校验查询未使用 `?`，且占位符按 @p1…@pN 依次出现、数量与 args 一致。
// 适用于每个参数只被引用一次的动态查询（list.go 全部构造函数）。
func assertOrdinalArgs(t *testing.T, label, query string, args []any) {
	t.Helper()
	if strings.Contains(query, "?") {
		t.Fatalf("%s: 仍在使用 `?` 占位符，go-mssqldb 不支持：\n%s", label, query)
	}
	found := placeholderPattern.FindAllString(query, -1)
	if len(found) != len(args) {
		t.Fatalf("%s: 占位符 %d 个但参数 %d 个：\n%s", label, len(found), len(args), query)
	}
	for i, got := range found {
		if want := fmt.Sprintf("@p%d", i+1); got != want {
			t.Fatalf("%s: 第 %d 个占位符为 %s，期望 %s：\n%s", label, i+1, got, want, query)
		}
	}
}

func TestNormalizeLimit(t *testing.T) {
	if got := normalizeLimit(0); got != DefaultLimit {
		t.Fatalf("normalizeLimit(0)=%d, want %d", got, DefaultLimit)
	}
	if got := normalizeLimit(-1); got != DefaultLimit {
		t.Fatalf("normalizeLimit(-1)=%d, want %d", got, DefaultLimit)
	}
	if got := normalizeLimit(MaxLimit + 10); got != MaxLimit {
		t.Fatalf("normalizeLimit(over)=%d, want %d", got, MaxLimit)
	}
	if got := normalizeLimit(42); got != 42 {
		t.Fatalf("normalizeLimit(42)=%d", got)
	}
}

func TestLikePrefix(t *testing.T) {
	if got := likePrefix(""); got != "" {
		t.Fatalf("empty filter: %q", got)
	}
	if got := likePrefix("dbo"); got != "dbo%" {
		t.Fatalf("simple: %q", got)
	}
	if got := likePrefix(`a%b_c\d`); got != `a\%b\_c\\d%` {
		t.Fatalf("escape: %q", got)
	}
}

func TestTableTypeFlags(t *testing.T) {
	tbl, view, syn := tableTypeFlags(nil)
	if !tbl || !view || !syn {
		t.Fatalf("nil types should enable all, got %v %v %v", tbl, view, syn)
	}
	tbl, view, syn = tableTypeFlags([]string{"table"})
	if !tbl || view || syn {
		t.Fatalf("table only: %v %v %v", tbl, view, syn)
	}
	tbl, view, syn = tableTypeFlags([]string{"VIEW", "synonym"})
	if tbl || !view || !syn {
		t.Fatalf("view+synonym: %v %v %v", tbl, view, syn)
	}
}

func TestRoutineTypeSQL(t *testing.T) {
	all := routineTypeSQL(nil)
	if !strings.Contains(all, `N'P'`) || !strings.Contains(all, `N'FN'`) {
		t.Fatalf("default kinds: %s", all)
	}
	procOnly := routineTypeSQL([]string{"procedure"})
	if !strings.Contains(procOnly, `N'P'`) || strings.Contains(procOnly, `N'FN'`) {
		t.Fatalf("procedure only: %s", procOnly)
	}
	empty := routineTypeSQL([]string{"unknown"})
	if empty != "" {
		t.Fatalf("unknown kinds should be empty, got %q", empty)
	}
}

func TestArgBinder(t *testing.T) {
	b := &argBinder{}
	if got := b.next("a"); got != "@p1" {
		t.Fatalf("first placeholder=%q", got)
	}
	if got := b.next("b"); got != "@p2" {
		t.Fatalf("second placeholder=%q", got)
	}
	if got := b.next("c"); got != "@p3" {
		t.Fatalf("third placeholder=%q", got)
	}
	args := b.values()
	if len(args) != 3 || args[0] != "a" || args[1] != "b" || args[2] != "c" {
		t.Fatalf("values=%v", args)
	}
	if empty := (&argBinder{}).values(); len(empty) != 0 {
		t.Fatalf("empty binder values=%v", empty)
	}
}

func TestBuildDatabasesQuery(t *testing.T) {
	query, args := buildDatabasesQuery(ListParams{})
	assertOrdinalArgs(t, "databases/no filter", query, args)
	if len(args) != 0 {
		t.Fatalf("no filter should bind nothing, got %v", args)
	}
	if !strings.Contains(query, "SELECT TOP (501)") {
		t.Fatalf("default limit not applied:\n%s", query)
	}

	query, args = buildDatabasesQuery(ListParams{Filter: "ma", Limit: 10})
	assertOrdinalArgs(t, "databases/filter", query, args)
	if len(args) != 1 || args[0] != "ma%" {
		t.Fatalf("filter args=%v", args)
	}
	if !strings.Contains(query, `d.name LIKE @p1 ESCAPE '\'`) {
		t.Fatalf("filter predicate missing:\n%s", query)
	}
	if !strings.Contains(query, "SELECT TOP (11)") {
		t.Fatalf("limit+1 not applied:\n%s", query)
	}
}

func TestBuildSchemasQuery(t *testing.T) {
	query, args := buildSchemasQuery(ListParams{ExcludeSystem: true})
	assertOrdinalArgs(t, "schemas/no filter", query, args)
	if len(args) != 0 {
		t.Fatalf("no filter should bind nothing, got %v", args)
	}
	if !strings.Contains(query, `N'INFORMATION_SCHEMA'`) {
		t.Fatalf("system schema exclusion missing:\n%s", query)
	}

	query, args = buildSchemasQuery(ListParams{Filter: "db"})
	assertOrdinalArgs(t, "schemas/filter", query, args)
	if len(args) != 1 || args[0] != "db%" {
		t.Fatalf("filter args=%v", args)
	}
	if strings.Contains(query, `N'INFORMATION_SCHEMA'`) {
		t.Fatalf("ExcludeSystem=false should not exclude:\n%s", query)
	}
}

// TestBuildTablesQueryPlaceholderOrder 覆盖三分支 UNION ALL：占位符序号必须与
// args 下标严格对齐，否则 schema 与 filter 会互相错位。
func TestBuildTablesQueryPlaceholderOrder(t *testing.T) {
	query, args, ok := buildTablesQuery(ListParams{Filter: "usr"}, "dbo")
	if !ok {
		t.Fatal("default types should query")
	}
	assertOrdinalArgs(t, "tables/all types+filter", query, args)

	want := []any{"dbo", "usr%", "dbo", "usr%", "dbo", "usr%"}
	if len(args) != len(want) {
		t.Fatalf("args=%v, want %v", args, want)
	}
	for i := range want {
		if args[i] != want[i] {
			t.Fatalf("args[%d]=%v, want %v (full=%v)", i, args[i], want[i], args)
		}
	}
	for _, expr := range []string{
		"WHERE s.name = @p1",
		`t.name LIKE @p2 ESCAPE '\'`,
		"WHERE s.name = @p3",
		`v.name LIKE @p4 ESCAPE '\'`,
		"WHERE s.name = @p5",
		`syn.name LIKE @p6 ESCAPE '\'`,
	} {
		if !strings.Contains(query, expr) {
			t.Fatalf("missing %q:\n%s", expr, query)
		}
	}
}

func TestBuildTablesQueryTypeSubsets(t *testing.T) {
	query, args, ok := buildTablesQuery(ListParams{Types: []string{"view"}}, "dbo")
	if !ok {
		t.Fatal("view type should query")
	}
	assertOrdinalArgs(t, "tables/view only", query, args)
	if len(args) != 1 || args[0] != "dbo" {
		t.Fatalf("view only args=%v", args)
	}
	if strings.Contains(query, "sys.tables") || strings.Contains(query, "sys.synonyms") {
		t.Fatalf("view only should not union other types:\n%s", query)
	}

	if _, _, ok := buildTablesQuery(ListParams{Types: []string{"unknown"}}, "dbo"); ok {
		t.Fatal("unknown type should skip the query")
	}
}

func TestBuildRoutinesQuery(t *testing.T) {
	query, args, ok := buildRoutinesQuery(ListParams{}, "dbo")
	if !ok {
		t.Fatal("default kinds should query")
	}
	assertOrdinalArgs(t, "routines/no filter", query, args)
	if len(args) != 1 || args[0] != "dbo" {
		t.Fatalf("args=%v", args)
	}

	query, args, ok = buildRoutinesQuery(ListParams{Filter: "sp_"}, "sales")
	if !ok {
		t.Fatal("filter should still query")
	}
	assertOrdinalArgs(t, "routines/filter", query, args)
	if len(args) != 2 || args[0] != "sales" || args[1] != `sp\_%` {
		t.Fatalf("args=%v", args)
	}
	if !strings.Contains(query, "WHERE s.name = @p1") ||
		!strings.Contains(query, `o.name LIKE @p2 ESCAPE '\'`) {
		t.Fatalf("placeholder wiring wrong:\n%s", query)
	}

	if _, _, ok := buildRoutinesQuery(ListParams{RoutineKinds: []string{"unknown"}}, "dbo"); ok {
		t.Fatal("unknown kind should skip the query")
	}
}

func TestBuildSequencesQuery(t *testing.T) {
	query, args := buildSequencesQuery(ListParams{}, "dbo")
	assertOrdinalArgs(t, "sequences/no filter", query, args)
	if len(args) != 1 || args[0] != "dbo" {
		t.Fatalf("args=%v", args)
	}

	query, args = buildSequencesQuery(ListParams{Filter: "seq"}, "dbo")
	assertOrdinalArgs(t, "sequences/filter", query, args)
	if len(args) != 2 || args[1] != "seq%" {
		t.Fatalf("args=%v", args)
	}
	if !strings.Contains(query, "WHERE s.name = @p1") ||
		!strings.Contains(query, `seq.name LIKE @p2 ESCAPE '\'`) {
		t.Fatalf("placeholder wiring wrong:\n%s", query)
	}
}

// TestCategoryCountsQueryReusesSingleParam 六个子查询过滤同一 schema，
// 复用 @p1，因此只应传入一个参数。
func TestCategoryCountsQueryReusesSingleParam(t *testing.T) {
	if strings.Contains(categoryCountsQuery, "?") {
		t.Fatalf("仍在使用 `?` 占位符：\n%s", categoryCountsQuery)
	}
	found := placeholderPattern.FindAllString(categoryCountsQuery, -1)
	if len(found) != 6 {
		t.Fatalf("期望 6 处占位符，实际 %d 处：\n%s", len(found), categoryCountsQuery)
	}
	for i, got := range found {
		if got != "@p1" {
			t.Fatalf("第 %d 处占位符为 %s，期望 @p1", i+1, got)
		}
	}
}

// TestNoQuestionMarkPlaceholderRegression 兜底回归：树查询一旦重新引入 `?`，
// go-mssqldb 会直接报 "Incorrect syntax near '?'"，此处提前拦住。
func TestNoQuestionMarkPlaceholderRegression(t *testing.T) {
	params := ListParams{Filter: "x", ExcludeSystem: true}
	dbQuery, _ := buildDatabasesQuery(params)
	schemaQuery, _ := buildSchemasQuery(params)
	tableQuery, _, _ := buildTablesQuery(params, "dbo")
	routineQuery, _, _ := buildRoutinesQuery(params, "dbo")
	sequenceQuery, _ := buildSequencesQuery(params, "dbo")

	for label, query := range map[string]string{
		"databases": dbQuery,
		"schemas":   schemaQuery,
		"tables":    tableQuery,
		"routines":  routineQuery,
		"sequences": sequenceQuery,
		"counts":    categoryCountsQuery,
	} {
		if strings.Contains(query, "?") {
			t.Errorf("%s 查询包含 `?` 占位符：\n%s", label, query)
		}
	}
}

func TestIsSystemSchema(t *testing.T) {
	if !IsSystemSchema("sys") || !IsSystemSchema("INFORMATION_SCHEMA") || !IsSystemSchema("db_owner") {
		t.Fatal("system schemas must match")
	}
	if IsSystemSchema("dbo") || IsSystemSchema("sales") || IsSystemSchema("") {
		t.Fatal("user / empty names must not be system schemas")
	}
	sql := systemSchemaExcludeSQL()
	for _, name := range systemSchemaNames {
		if !strings.Contains(sql, "N'"+name+"'") {
			t.Fatalf("exclude SQL missing %s: %s", name, sql)
		}
	}
}
