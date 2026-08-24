package sqllsp_test

import (
	"strings"
	"testing"

	"niuma/pkg/sqllsp"
)

func TestExtractTableRefsJoinAliases(t *testing.T) {
	sql := `SELECT u.id, o. FROM users u JOIN orders o ON u.id = o.user_id WHERE `
	refs := sqllsp.ExtractTableRefs(sql, len(sql))
	if len(refs) < 2 {
		t.Fatalf("refs=%#v", refs)
	}
	sch, tbl, ok := sqllsp.ResolveDotQualifier(refs, "u", "app")
	if !ok || tbl != "users" || sch != "app" {
		t.Fatalf("u -> %s.%s ok=%v", sch, tbl, ok)
	}
	sch, tbl, ok = sqllsp.ResolveDotQualifier(refs, "o", "app")
	if !ok || tbl != "orders" {
		t.Fatalf("o -> %s.%s ok=%v", sch, tbl, ok)
	}
}

func TestExtractTableRefsQualifiedAndBacktick(t *testing.T) {
	sql := "SELECT * FROM `app`.`users` AS u, `orders` o WHERE "
	refs := sqllsp.ExtractTableRefs(sql, len(sql))
	if len(refs) != 2 {
		t.Fatalf("want 2 refs, got %#v", refs)
	}
	if refs[0].Schema != "app" || refs[0].Name != "users" || refs[0].Alias != "u" {
		t.Fatalf("ref0=%#v", refs[0])
	}
	if refs[1].Name != "orders" || refs[1].Alias != "o" {
		t.Fatalf("ref1=%#v", refs[1])
	}
}

func TestExtractTableRefsUpdate(t *testing.T) {
	sql := "UPDATE demo.t SET "
	refs := sqllsp.ExtractTableRefs(sql, len(sql))
	if len(refs) != 1 || refs[0].Schema != "demo" || refs[0].Name != "t" {
		t.Fatalf("refs=%#v", refs)
	}
}

func TestExtractTableRefsSkipsSubquery(t *testing.T) {
	sql := "SELECT * FROM users u JOIN (SELECT id FROM other) x ON u.id = x.id WHERE "
	refs := sqllsp.ExtractTableRefs(sql, len(sql))
	foundUsers := false
	foundOther := false
	foundX := false
	for _, r := range refs {
		if r.Name == "users" {
			foundUsers = true
		}
		if r.Name == "other" {
			foundOther = true
		}
		if r.Name == "x" || r.Alias == "x" {
			foundX = true
			if !r.Virtual {
				t.Fatalf("derived alias should be virtual: %#v", r)
			}
		}
	}
	if !foundUsers {
		t.Fatalf("expected users in %#v", refs)
	}
	if foundOther {
		t.Fatalf("should skip subquery inner table, got %#v", refs)
	}
	if !foundX {
		t.Fatalf("expected derived alias x, got %#v", refs)
	}
}

func TestExtractCTENames(t *testing.T) {
	sql := "WITH cte AS (SELECT 1 AS n) SELECT * FROM cte"
	names := sqllsp.ExtractCTENames(sql)
	if len(names) != 1 || names[0] != "cte" {
		t.Fatalf("cte names=%#v", names)
	}
	refs := sqllsp.ExtractTableRefs(sql, len(sql))
	found := false
	for _, r := range refs {
		if r.Name == "cte" && r.Virtual {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected virtual CTE ref, got %#v", refs)
	}
}

func TestResolveDotQualifierTableName(t *testing.T) {
	refs := []sqllsp.TableRef{{Name: "users", Alias: "u"}}
	_, tbl, ok := sqllsp.ResolveDotQualifier(refs, "users", "app")
	if !ok || tbl != "users" {
		t.Fatalf("table name resolve failed")
	}
}

func TestExtractTableRefsBracketQualified(t *testing.T) {
	sql := "CREATE VIEW [dbo].[NewView]\nAS\nSELECT u.\nFROM [dbo].[Users] u"
	refs := sqllsp.ExtractTableRefs(sql, strings.Index(sql, "u.")+2)
	if len(refs) != 1 {
		t.Fatalf("want 1 ref, got %#v", refs)
	}
	if refs[0].Schema != "dbo" || refs[0].Name != "Users" || refs[0].Alias != "u" {
		t.Fatalf("ref=%#v", refs[0])
	}
	sch, tbl, ok := sqllsp.ResolveDotQualifier(refs, "u", "dbo")
	if !ok || sch != "dbo" || tbl != "Users" {
		t.Fatalf("alias u -> %s.%s ok=%v", sch, tbl, ok)
	}
}
