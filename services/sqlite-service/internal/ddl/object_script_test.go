package ddl

import (
	"testing"

	"niuma/services/sqlite-service/internal/dialect"
)

func TestPrepareObjectScriptViewDropCreate(t *testing.T) {
	res, err := PrepareObjectScript(ObjectScriptParams{
		Kind:         ObjectKindView,
		SQL:          `CREATE VIEW v1 AS SELECT 1`,
		Schema:       "main",
		ExistingName: "v1",
		Mode:         "alter",
	}, &dialect.ServerProfile{Capabilities: nil})
	if err != nil {
		t.Fatal(err)
	}
	if res.Strategy != ObjectScriptStrategyDropCreate {
		t.Fatalf("strategy %s", res.Strategy)
	}
	if len(res.SQL) != 2 {
		t.Fatalf("sql %#v", res.SQL)
	}
}

func TestPrepareObjectScriptViewOrReplace(t *testing.T) {
	res, err := PrepareObjectScript(ObjectScriptParams{
		Kind: ObjectKindView,
		SQL:  `CREATE VIEW v1 AS SELECT 1`,
	}, &dialect.ServerProfile{Capabilities: []string{dialect.CapCreateOrReplaceView}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Strategy != ObjectScriptStrategyOrReplace {
		t.Fatalf("strategy %s", res.Strategy)
	}
	if len(res.SQL) != 1 || !containsFold(res.SQL[0], "OR REPLACE") {
		t.Fatalf("sql %#v", res.SQL)
	}
}

func TestParseObjectNameFromSQL(t *testing.T) {
	if got := ParseObjectNameFromSQL(`CREATE TRIGGER "main"."trg1" AFTER INSERT ON t BEGIN SELECT 1; END`, ObjectKindTrigger); got != "trg1" {
		t.Fatalf("got %q", got)
	}
	if got := ParseObjectNameFromSQL(`CREATE INDEX idx_t ON t(id)`, ObjectKindIndex); got != "idx_t" {
		t.Fatalf("got %q", got)
	}
}

func containsFold(s, sub string) bool {
	return len(s) >= len(sub) && (indexFold(s, sub) >= 0)
}

func indexFold(s, sub string) int {
	upper := func(b byte) byte {
		if b >= 'a' && b <= 'z' {
			return b - 32
		}
		return b
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		ok := true
		for j := 0; j < len(sub); j++ {
			if upper(s[i+j]) != upper(sub[j]) {
				ok = false
				break
			}
		}
		if ok {
			return i
		}
	}
	return -1
}
