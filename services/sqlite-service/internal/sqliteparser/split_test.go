package sqliteparser

import (
	"strings"
	"testing"
)

func TestSplitSQLKeepsTriggerBody(t *testing.T) {
	sql := `CREATE TRIGGER t1 AFTER INSERT ON t
BEGIN
  UPDATE t SET n = n + 1;
  INSERT INTO log(msg) VALUES ('x');
END;
SELECT 1;`
	parts := SplitSQL(sql)
	if len(parts) != 2 {
		t.Fatalf("want 2 statements, got %d: %#v", len(parts), parts)
	}
	if !strings.Contains(strings.ToUpper(parts[0]), "CREATE TRIGGER") {
		t.Fatalf("trigger not kept together: %q", parts[0])
	}
	if !strings.HasSuffix(strings.TrimSpace(strings.ToUpper(parts[0])), "END") {
		t.Fatalf("trigger missing END: %q", parts[0])
	}
	if parts[1] != "SELECT 1" {
		t.Fatalf("second stmt: %q", parts[1])
	}
}

func TestSplitSQLPlain(t *testing.T) {
	parts := SplitSQL("SELECT 1; SELECT 2;")
	if len(parts) != 2 {
		t.Fatalf("got %#v", parts)
	}
}

func TestSplitSQLBeginTransactionDump(t *testing.T) {
	// 对齐 dataio.dump 产出：BEGIN TRANSACTION 不得吞掉后续分号。
	sql := `PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE t(id INTEGER);
INSERT INTO t VALUES(1);
INSERT INTO t VALUES(2);
COMMIT;
PRAGMA foreign_keys=ON;
`
	parts := SplitSQL(sql)
	if len(parts) != 7 {
		t.Fatalf("want 7 statements, got %d: %#v", len(parts), parts)
	}
	if !strings.EqualFold(strings.TrimSpace(parts[1]), "BEGIN TRANSACTION") {
		t.Fatalf("begin stmt: %q", parts[1])
	}
	if !strings.EqualFold(strings.TrimSpace(parts[5]), "COMMIT") {
		t.Fatalf("commit stmt: %q", parts[5])
	}
}

func TestSplitSQLBeginImmediateAndBare(t *testing.T) {
	parts := SplitSQL("BEGIN IMMEDIATE; SELECT 1; COMMIT;")
	if len(parts) != 3 {
		t.Fatalf("immediate: got %#v", parts)
	}
	parts = SplitSQL("BEGIN; SELECT 1; ROLLBACK;")
	if len(parts) != 3 {
		t.Fatalf("bare begin: got %#v", parts)
	}
}

func TestSplitSQLTriggerAfterBeginTransaction(t *testing.T) {
	sql := `BEGIN TRANSACTION;
CREATE TRIGGER t1 AFTER INSERT ON t
BEGIN
  UPDATE t SET n = n + 1;
END;
COMMIT;`
	parts := SplitSQL(sql)
	if len(parts) != 3 {
		t.Fatalf("want 3 statements, got %d: %#v", len(parts), parts)
	}
	if !strings.Contains(strings.ToUpper(parts[1]), "CREATE TRIGGER") {
		t.Fatalf("trigger not kept: %q", parts[1])
	}
	if strings.Contains(parts[1], "COMMIT") {
		t.Fatalf("commit swallowed into trigger: %q", parts[1])
	}
}
