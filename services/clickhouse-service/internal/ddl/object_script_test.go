package ddl

import (
	"errors"
	"strings"
	"testing"

	"niuma/services/clickhouse-service/internal/dialect"
)

func TestParseObjectNameFromSQL(t *testing.T) {
	t.Parallel()
	if got := ParseObjectNameFromSQL("CREATE OR REPLACE VIEW `db`.`my_view` AS SELECT 1", ObjectKindView); got != "my_view" {
		t.Fatalf("view name=%q", got)
	}
	if got := ParseObjectNameFromSQL(
		"CREATE MATERIALIZED VIEW `db`.`mv1` ENGINE = MergeTree ORDER BY tuple() AS SELECT 1",
		ObjectKindMaterializedView,
	); got != "mv1" {
		t.Fatalf("mv name=%q", got)
	}
	if got := ParseObjectNameFromSQL(
		"CREATE DICTIONARY `db`.`d1` (id UInt64) PRIMARY KEY id SOURCE(NULL()) LAYOUT(FLAT()) LIFETIME(0)",
		ObjectKindDictionary,
	); got != "d1" {
		t.Fatalf("dict name=%q", got)
	}
}

func TestParseObjectRefFromSQL(t *testing.T) {
	t.Parallel()
	if got := ParseObjectRefFromSQL("CREATE OR REPLACE VIEW `db`.`my_view` AS SELECT 1", ObjectKindView); got != "`db`.`my_view`" {
		t.Fatalf("ref=%q", got)
	}
}

func TestPrepareObjectScriptViewOrReplace(t *testing.T) {
	t.Parallel()
	profile := dialect.ResolveCapabilities("22.8.15.25", false)
	res, err := PrepareObjectScript(ObjectScriptParams{
		Kind: ObjectKindView,
		SQL:  "CREATE VIEW `db`.`v1` AS SELECT 1",
	}, &profile)
	if err != nil {
		t.Fatal(err)
	}
	if res.Strategy != ObjectScriptStrategyOrReplace {
		t.Fatalf("strategy=%q", res.Strategy)
	}
	if len(res.SQL) != 1 || !strings.HasPrefix(strings.ToUpper(res.SQL[0]), "CREATE OR REPLACE VIEW") {
		t.Fatalf("sql=%v", res.SQL)
	}
}

func TestPrepareObjectScriptMaterializedViewDropCreate(t *testing.T) {
	t.Parallel()
	profile := dialect.ResolveCapabilities("24.8.4.13", false)
	res, err := PrepareObjectScript(ObjectScriptParams{
		Kind: ObjectKindMaterializedView,
		SQL:  "CREATE OR REPLACE MATERIALIZED VIEW `db`.`mv1` AS SELECT 1",
	}, &profile)
	if err != nil {
		t.Fatal(err)
	}
	if res.Strategy != ObjectScriptStrategyDropCreate {
		t.Fatalf("strategy=%q", res.Strategy)
	}
	if len(res.SQL) != 2 {
		t.Fatalf("sql len=%d %v", len(res.SQL), res.SQL)
	}
	if !strings.HasPrefix(res.SQL[0], "DROP TABLE IF EXISTS `db`.`mv1`") {
		t.Fatalf("drop=%q", res.SQL[0])
	}
	if !strings.HasPrefix(res.SQL[1], "CREATE MATERIALIZED VIEW `db`.`mv1`") {
		t.Fatalf("create=%q", res.SQL[1])
	}
}

func TestPrepareObjectScriptDictionaryDropCreate(t *testing.T) {
	t.Parallel()
	profile := dialect.ResolveCapabilities("24.8.4.13", false)
	res, err := PrepareObjectScript(ObjectScriptParams{
		Kind: ObjectKindDictionary,
		SQL:  "CREATE OR REPLACE DICTIONARY `db`.`d1` (id UInt64) PRIMARY KEY id SOURCE(NULL()) LAYOUT(FLAT()) LIFETIME(0)",
	}, &profile)
	if err != nil {
		t.Fatal(err)
	}
	if res.Strategy != ObjectScriptStrategyDropCreate || len(res.SQL) != 2 {
		t.Fatalf("res=%+v", res)
	}
	if !strings.Contains(res.SQL[0], "DROP DICTIONARY IF EXISTS `db`.`d1`") {
		t.Fatalf("drop=%q", res.SQL[0])
	}
}

func TestPrepareObjectScriptOnClusterAndRename(t *testing.T) {
	t.Parallel()
	profile := dialect.ResolveCapabilities("23.3.2.1", true)
	res, err := PrepareObjectScript(ObjectScriptParams{
		Kind:         ObjectKindView,
		SQL:          "CREATE VIEW `db`.`v2` AS SELECT 1",
		Database:     "db",
		ExistingName: "v1",
		Mode:         "alter",
		Cluster:      "c1",
	}, &profile)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.SQL) != 2 {
		t.Fatalf("sql=%v", res.SQL)
	}
	if !strings.Contains(res.SQL[0], "DROP VIEW IF EXISTS `db`.`v1` ON CLUSTER `c1`") {
		t.Fatalf("rename drop=%q", res.SQL[0])
	}
	if !strings.Contains(res.SQL[1], "ON CLUSTER `c1`") {
		t.Fatalf("create=%q", res.SQL[1])
	}
}

func TestPrepareObjectScriptSelectionRaw(t *testing.T) {
	t.Parallel()
	profile := dialect.DefaultProfile()
	res, err := PrepareObjectScript(ObjectScriptParams{
		Kind:          ObjectKindView,
		SQL:           "SELECT 1",
		SelectionOnly: true,
	}, &profile)
	if err != nil {
		t.Fatal(err)
	}
	if res.Strategy != ObjectScriptStrategyRaw || res.SQL[0] != "SELECT 1" {
		t.Fatalf("res=%+v", res)
	}
}

func TestPrepareObjectScriptMVOrReplaceWhenCapOn(t *testing.T) {
	t.Parallel()
	profile := dialect.ResolveCapabilities("24.8.4.13", false)
	profile.Capabilities = append(profile.Capabilities, dialect.CapCreateOrReplaceMaterializedView)
	res, err := PrepareObjectScript(ObjectScriptParams{
		Kind: ObjectKindMaterializedView,
		SQL:  "CREATE MATERIALIZED VIEW `db`.`mv1` AS SELECT 1",
	}, &profile)
	if err != nil {
		t.Fatal(err)
	}
	if res.Strategy != ObjectScriptStrategyOrReplace {
		t.Fatalf("strategy=%q", res.Strategy)
	}
	if !strings.HasPrefix(strings.ToUpper(res.SQL[0]), "CREATE OR REPLACE MATERIALIZED VIEW") {
		t.Fatalf("sql=%q", res.SQL[0])
	}
}

func TestShouldFallbackObjectScript(t *testing.T) {
	t.Parallel()
	if !ShouldFallbackObjectScript(errors.New(
		"clickhouse: exec: code: 48, message: RENAME EXCHANGE is not supported because exchanging files is not supported by the OS",
	)) {
		t.Fatal("expected rename exchange fallback")
	}
	if !ShouldFallbackObjectScript(errors.New(
		"clickhouse: exec: code: 62, message: Syntax error: failed at position 19 (MATERIALIZED)",
	)) {
		t.Fatal("expected MV syntax fallback")
	}
	if !ShouldFallbackObjectScript(errors.New(
		"clickhouse: exec: code: 387, message: Dictionary my_test.d1 already exists",
	)) {
		t.Fatal("expected dictionary 387 fallback")
	}
	if ShouldFallbackObjectScript(errors.New("code: 57, already exists")) {
		t.Fatal("generic already exists must not fallback")
	}
}

func TestEnsureOnClusterClause(t *testing.T) {
	t.Parallel()
	got, err := EnsureOnClusterClause("CREATE OR REPLACE VIEW `db`.`v` AS SELECT 1", "c1")
	if err != nil {
		t.Fatal(err)
	}
	if got != "CREATE OR REPLACE VIEW `db`.`v` ON CLUSTER `c1` AS SELECT 1" {
		t.Fatalf("got=%q", got)
	}
}
