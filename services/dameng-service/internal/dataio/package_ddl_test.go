package dataio

import (
	"strings"
	"testing"
)

func TestTrimPlsqlTerminators(t *testing.T) {
	t.Parallel()
	got := trimPlsqlTerminators("CREATE PACKAGE p AS\nEND;\n/\n")
	if strings.HasSuffix(strings.TrimSpace(got), "/") {
		t.Fatalf("trailing slash remains: %q", got)
	}
	if !strings.Contains(got, "CREATE PACKAGE") {
		t.Fatalf("lost ddl: %q", got)
	}
}

func TestSplitPackageSpecBody(t *testing.T) {
	t.Parallel()
	combined := `
CREATE OR REPLACE PACKAGE "new_pkg" AS
  PROCEDURE hello;
END "new_pkg";
CREATE OR REPLACE PACKAGE BODY "new_pkg" AS
  PROCEDURE hello AS
  BEGIN
    NULL;
  END hello;
END "new_pkg";
`
	spec, body := splitPackageSpecBody(combined)
	if !strings.Contains(strings.ToUpper(spec), "PACKAGE \"NEW_PKG\"") &&
		!strings.Contains(strings.ToUpper(spec), `PACKAGE "NEW_PKG"`) {
		if !strings.Contains(strings.ToUpper(spec), "PACKAGE") || strings.Contains(strings.ToUpper(spec), "PACKAGE BODY") {
			t.Fatalf("spec=%q", spec)
		}
	}
	if strings.Contains(strings.ToUpper(spec), "PACKAGE BODY") {
		t.Fatalf("spec still has body: %q", spec)
	}
	if !strings.Contains(strings.ToUpper(body), "PACKAGE BODY") {
		t.Fatalf("body=%q", body)
	}
	if strings.Contains(body, "PROCEDURE hello;") && !strings.Contains(strings.ToUpper(body), "BEGIN") {
		t.Fatalf("body looks like spec: %q", body)
	}
}

func TestSplitPackageSpecBody_AlreadySplit(t *testing.T) {
	t.Parallel()
	only := `CREATE OR REPLACE PACKAGE p AS
  PROCEDURE hello;
END;`
	spec, body := splitPackageSpecBody(only)
	if body != "" {
		t.Fatalf("unexpected body=%q", body)
	}
	if !strings.Contains(strings.ToUpper(spec), "PACKAGE") {
		t.Fatalf("spec=%q", spec)
	}
}
