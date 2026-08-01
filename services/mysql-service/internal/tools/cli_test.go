package tools

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDumpArgsDefaults(t *testing.T) {
	args, err := DumpArgs("127.0.0.1", "3306", "root", "app", "out.sql", DumpOptions{})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"-h 127.0.0.1", "-P 3306", "-u root",
		"--result-file=out.sql", "--skip-triggers",
		"--set-gtid-purged=OFF", "--verbose", "app",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %v", want, args)
		}
	}
	if strings.Contains(joined, "--password") || strings.Contains(joined, "MYSQL_PWD") {
		t.Fatalf("password must not appear in args: %v", args)
	}
}

func TestDumpArgsOptions(t *testing.T) {
	args, err := DumpArgs("h", "3306", "u", "db", "out.sql", DumpOptions{
		StructureOnly:     true,
		DropIfExists:      true,
		Routines:          true,
		Triggers:          true,
		Events:            true,
		SingleTransaction: true,
		Tables:            []string{"t1", " t2 "},
	})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"--no-data", "--add-drop-table", "--routines", "--triggers",
		"--events", "--single-transaction", "db", "t1", "t2",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %v", want, args)
		}
	}
	if strings.Contains(joined, "--skip-triggers") {
		t.Fatalf("unexpected --skip-triggers: %v", args)
	}
}

func TestDumpArgsDataOnly(t *testing.T) {
	args, err := DumpArgs("h", "1", "u", "db", "out.sql", DumpOptions{DataOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--no-create-info") {
		t.Fatalf("missing --no-create-info: %v", args)
	}
}

func TestDumpArgsMutualExclusive(t *testing.T) {
	_, err := DumpArgs("h", "1", "u", "db", "out.sql", DumpOptions{
		StructureOnly: true,
		DataOnly:      true,
	})
	if err == nil {
		t.Fatal("expected mutual exclusion error")
	}
}

func TestDumpArgsRequiresDatabase(t *testing.T) {
	_, err := DumpArgs("h", "1", "u", "", "out.sql", DumpOptions{})
	if err == nil {
		t.Fatal("expected database required")
	}
}

func TestRestoreArgs(t *testing.T) {
	args, err := RestoreArgs("127.0.0.1", "3306", "root", "app", RestoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{"-h 127.0.0.1", "-P 3306", "-u root", "--database=app"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %v", want, args)
		}
	}
	if strings.Contains(joined, "--force") {
		t.Fatalf("unexpected --force by default: %v", args)
	}
}

func TestRestoreArgsForce(t *testing.T) {
	args, err := RestoreArgs("h", "1", "u", "db", RestoreOptions{Force: true})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--force") {
		t.Fatalf("missing --force: %v", args)
	}
}

func TestDumpArgsSetGtidPurgedOn(t *testing.T) {
	args, err := DumpArgs("h", "1", "u", "db", "out.sql", DumpOptions{SetGtidPurged: "ON"})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--set-gtid-purged=ON") {
		t.Fatalf("missing set-gtid-purged=ON: %v", args)
	}
}

func TestStripGtidReader(t *testing.T) {
	src := strings.NewReader(`SET NAMES utf8mb4;
SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ 'aaaa:1-10';
CREATE TABLE t1 (id int);
SET @@SESSION.SQL_LOG_BIN= 0;
INSERT INTO t1 VALUES (1);
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
`)
	out, err := io.ReadAll(newStripGtidReader(src))
	if err != nil {
		t.Fatal(err)
	}
	got := string(out)
	for _, bad := range []string{"GTID_PURGED", "SQL_LOG_BIN", "MYSQLDUMP_TEMP_LOG_BIN"} {
		if strings.Contains(got, bad) {
			t.Fatalf("expected %q stripped, got:\n%s", bad, got)
		}
	}
	for _, want := range []string{"SET NAMES utf8mb4;", "CREATE TABLE t1", "INSERT INTO t1"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in:\n%s", want, got)
		}
	}
}

func TestDetectUnknownToolUnavailable(t *testing.T) {
	got := Detect("not-a-real-mysql-tool", nil)
	if got.Available {
		t.Fatalf("expected Available=false for unknown tool, got %+v", got)
	}
}

func TestResolvePathExplicitFile(t *testing.T) {
	dir := t.TempDir()
	fake := filepath.Join(dir, "mysqldump.exe")
	if err := os.WriteFile(fake, []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	path, ok := ResolvePath("mysqldump", PathOverrides{"mysqldump": fake})
	if !ok || path != fake {
		t.Fatalf("ResolvePath override failed: ok=%v path=%q", ok, path)
	}
	got := Detect("mysqldump", PathOverrides{"mysqldump": fake})
	if !got.Available || got.Path != fake {
		t.Fatalf("Detect override failed: %+v", got)
	}
}

func TestDetectAllShape(t *testing.T) {
	m := NewManager(nil, nil, nil)
	all := m.DetectAll(nil)
	_ = all.Mysqldump
	_ = all.Mysql
}
