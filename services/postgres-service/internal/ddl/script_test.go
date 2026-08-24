package ddl

import (
	"reflect"
	"strings"
	"testing"
)

func TestBuildScriptCreateDatabaseOmitsCurrentUserOwner(t *testing.T) {
	t.Parallel()

	res, err := BuildScript(ScriptParams{
		Action:   ActionCreateDatabase,
		Name:     "app_db",
		Owner:    "CURRENT_USER",
		Encoding: "UTF8",
		Template: "template0",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(res.SQL, "CURRENT_USER") {
		t.Fatalf("CREATE DATABASE must omit CURRENT_USER owner, sql=%q", res.SQL)
	}
	if strings.Contains(res.SQL, "OWNER") {
		t.Fatalf("expected no OWNER clause, sql=%q", res.SQL)
	}
	if !strings.Contains(res.SQL, `CREATE DATABASE "app_db"`) {
		t.Fatalf("sql=%q", res.SQL)
	}
}

func TestBuildScriptCreateDatabaseWithExplicitOwner(t *testing.T) {
	t.Parallel()

	res, err := BuildScript(ScriptParams{
		Action:   ActionCreateDatabase,
		Name:     "app_db",
		Owner:    "WMS_DEV",
		Encoding: "UTF8",
		Template: "template0",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.SQL, `OWNER = "WMS_DEV"`) {
		t.Fatalf("sql=%q", res.SQL)
	}
}

func TestMaintenanceDatabaseCandidates(t *testing.T) {
	t.Parallel()

	got := MaintenanceDatabaseCandidates("app_db", "WMS")
	want := []string{"WMS", "postgres", "template1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got=%v want=%v", got, want)
	}
}

func TestMaintenanceDatabaseCandidatesSkipsTarget(t *testing.T) {
	t.Parallel()

	got := MaintenanceDatabaseCandidates("postgres", "postgres")
	want := []string{"template1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got=%v want=%v", got, want)
	}
}

func TestMaintenanceDatabaseCandidatesSkipsTemplate0Preferred(t *testing.T) {
	t.Parallel()

	got := MaintenanceDatabaseCandidates("app", "template0")
	want := []string{"postgres", "template1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got=%v want=%v", got, want)
	}
}

func TestMaintenanceDatabase(t *testing.T) {
	t.Parallel()

	if got := MaintenanceDatabase("app", "WMS"); got != "WMS" {
		t.Fatalf("preferred: got=%q", got)
	}
	if got := MaintenanceDatabase("app", ""); got != "postgres" {
		t.Fatalf("default: got=%q", got)
	}
	if got := MaintenanceDatabase("postgres", "postgres"); got != "template1" {
		t.Fatalf("skip target: got=%q", got)
	}
}
