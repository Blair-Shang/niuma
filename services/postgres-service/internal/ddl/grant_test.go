package ddl

import (
	"strings"
	"testing"
)

func TestBuildGrantSQLCollapsesAllWithSpecificPrivileges(t *testing.T) {
	t.Parallel()

	sql, err := buildGrantSQL(ScriptParams{
		Action:     ActionGrant,
		Name:       "public",
		ObjectKind: "schema",
		Privileges: []string{"USAGE", "CREATE", "ALL"},
		Grantee:    "PUBLIC",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `GRANT ALL ON SCHEMA "public" TO PUBLIC`
	if sql != want {
		t.Fatalf("sql=%q want=%q", sql, want)
	}
	if strings.Contains(sql, "USAGE") || strings.Contains(sql, "CREATE,") {
		t.Fatalf("ALL must not be mixed with specific privileges, sql=%q", sql)
	}
}

func TestBuildGrantSQLRejectsGrantOptionOnPublic(t *testing.T) {
	t.Parallel()

	_, err := buildGrantSQL(ScriptParams{
		Action:      ActionGrant,
		Name:        "public",
		ObjectKind:  "schema",
		Privileges:  []string{"ALL"},
		Grantee:     "PUBLIC",
		GrantOption: true,
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "PUBLIC") {
		t.Fatalf("err=%v", err)
	}
}

func TestBuildGrantSQLGrantOptionOnRole(t *testing.T) {
	t.Parallel()

	sql, err := buildGrantSQL(ScriptParams{
		Action:      ActionGrant,
		Name:        "public",
		ObjectKind:  "schema",
		Privileges:  []string{"ALL"},
		Grantee:     "app_role",
		GrantOption: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `GRANT ALL ON SCHEMA "public" TO "app_role" WITH GRANT OPTION`
	if sql != want {
		t.Fatalf("sql=%q want=%q", sql, want)
	}
}

func TestBuildGrantSQLSpecificSchemaPrivileges(t *testing.T) {
	t.Parallel()

	sql, err := buildGrantSQL(ScriptParams{
		Action:     ActionGrant,
		Name:       "public",
		ObjectKind: "schema",
		Privileges: []string{"USAGE", "CREATE"},
		Grantee:    "PUBLIC",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `GRANT USAGE, CREATE ON SCHEMA "public" TO PUBLIC`
	if sql != want {
		t.Fatalf("sql=%q want=%q", sql, want)
	}
}

func TestBuildRevokeSQLCollapsesAllPrivilegesAlias(t *testing.T) {
	t.Parallel()

	sql, err := buildRevokeSQL(ScriptParams{
		Action:     ActionRevoke,
		Name:       "public",
		ObjectKind: "schema",
		Privileges: []string{"USAGE", "ALL PRIVILEGES"},
		Grantee:    "reader",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `REVOKE ALL ON SCHEMA "public" FROM "reader"`
	if sql != want {
		t.Fatalf("sql=%q want=%q", sql, want)
	}
}
