package ddl

import (
	"strings"
	"testing"
)

func TestBuildScriptRenameTable(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action:  ActionRenameTable,
		Schema:  "public",
		Name:    "orders",
		NewName: "orders_v2",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Danger {
		t.Fatal("expected danger")
	}
	want := `ALTER TABLE "public"."orders" RENAME TO "orders_v2"`
	if res.SQL != want {
		t.Fatalf("sql=%q want=%q", res.SQL, want)
	}
}

func TestBuildScriptRenameFunctionByOID(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action:  ActionRenameFunction,
		OID:     4242,
		NewName: "fn_new",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.SQL, "4242::regprocedure") {
		t.Fatalf("sql=%q", res.SQL)
	}
	if !strings.Contains(res.SQL, `RENAME TO "fn_new"`) {
		t.Fatalf("sql=%q", res.SQL)
	}
}

func TestBuildScriptRenameRequiresNewName(t *testing.T) {
	_, err := BuildScript(ScriptParams{
		Action: ActionRenameView,
		Schema: "public",
		Name:   "v",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestBuildScriptCreateProcedure(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action: ActionCreateProcedure,
		Schema: "public",
		Name:   "new_procedure",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(res.SQL, "LANGUAGE") {
		t.Fatalf("Vastbase procedure template must not use LANGUAGE: %q", res.SQL)
	}
	if strings.Contains(res.SQL, "$$") {
		t.Fatalf("Vastbase procedure template must not use dollar-quoting: %q", res.SQL)
	}
	want := `CREATE OR REPLACE PROCEDURE "public"."new_procedure"(
  -- p_arg1 IN integer
)
SECURITY INVOKER
AS
BEGIN
  -- TODO: implement
  NULL;
END;
/`
	if res.SQL != want {
		t.Fatalf("sql=%q want=%q", res.SQL, want)
	}
}

func TestBuildScriptCreateDatabase(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action:   ActionCreateDatabase,
		Name:     "app_db",
		Encoding: "UTF8",
		Template: "template0",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Danger {
		t.Fatal("create database template should not be danger")
	}
	if !strings.Contains(res.SQL, `CREATE DATABASE "app_db"`) {
		t.Fatalf("sql=%q", res.SQL)
	}
	if !strings.Contains(res.SQL, "ENCODING = 'UTF8'") {
		t.Fatalf("sql=%q", res.SQL)
	}
}

func TestBuildScriptProtectedSchemaDrop(t *testing.T) {
	_, err := BuildScript(ScriptParams{
		Action: ActionDropSchema,
		Name:   "pg_catalog",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestBuildScriptCreateSchema(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action: ActionCreateSchema,
		Name:   "app",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.SQL != `CREATE SCHEMA "app"` {
		t.Fatalf("sql=%q", res.SQL)
	}
}

func TestBuildScriptRenameSchema(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action:  ActionRenameSchema,
		Name:    "app",
		NewName: "app_v2",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `ALTER SCHEMA "app" RENAME TO "app_v2"`
	if res.SQL != want {
		t.Fatalf("sql=%q want=%q", res.SQL, want)
	}
}

func TestBuildScriptAlterSchemaOwner(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action: ActionAlterSchemaOwner,
		Name:   "app",
		Owner:  "app_role",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `ALTER SCHEMA "app" OWNER TO "app_role"`
	if res.SQL != want {
		t.Fatalf("sql=%q want=%q", res.SQL, want)
	}
}

func TestBuildScriptAlterDatabaseOwnerCurrentUser(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action: ActionAlterDatabaseOwner,
		Name:   "app_db",
		Owner:  "CURRENT_USER",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `ALTER DATABASE "app_db" OWNER TO CURRENT_USER`
	if res.SQL != want {
		t.Fatalf("sql=%q want=%q", res.SQL, want)
	}
}

func TestBuildScriptAlterFunctionOwnerByOID(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action: ActionAlterFunctionOwner,
		OID:    4242,
		Owner:  "app_role",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `ALTER FUNCTION 4242::regprocedure OWNER TO "app_role"`
	if res.SQL != want {
		t.Fatalf("sql=%q want=%q", res.SQL, want)
	}
}

func TestBuildScriptAlterProcedureOwnerByArgs(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action: ActionAlterProcedureOwner,
		Schema: "public",
		Name:   "do_work",
		Args:   "integer, text",
		Owner:  "CURRENT_USER",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `ALTER PROCEDURE "public"."do_work"(integer, text) OWNER TO CURRENT_USER`
	if res.SQL != want {
		t.Fatalf("sql=%q want=%q", res.SQL, want)
	}
}

func TestBuildScriptRenameDatabase(t *testing.T) {
	res, err := BuildScript(ScriptParams{
		Action:  ActionRenameDatabase,
		Name:    "app_db",
		NewName: "app_db_v2",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `ALTER DATABASE "app_db" RENAME TO "app_db_v2"`
	if res.SQL != want {
		t.Fatalf("sql=%q want=%q", res.SQL, want)
	}
}

func TestBuildScriptDropProtectedDatabase(t *testing.T) {
	_, err := BuildScript(ScriptParams{
		Action: ActionDropDatabase,
		Name:   "postgres",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestMaintenanceDatabase(t *testing.T) {
	if got := MaintenanceDatabase("app"); got != maintenanceDatabaseName {
		t.Fatalf("got=%q", got)
	}
	if got := MaintenanceDatabase("postgres"); got != templateDatabaseName {
		t.Fatalf("got=%q", got)
	}
}
