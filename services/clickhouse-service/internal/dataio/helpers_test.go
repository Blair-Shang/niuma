package dataio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSkipUTF8BOM(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "bom.csv")
	content := append([]byte{0xEF, 0xBB, 0xBF}, []byte("a,b\n1,2\n")...)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r, err := skipUTF8BOM(f)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 16)
	n, _ := r.Read(buf)
	got := string(buf[:n])
	if !strings.HasPrefix(got, "a,b") {
		t.Fatalf("expected CSV after BOM, got %q", got)
	}
}

func TestQuoteIdent(t *testing.T) {
	t.Parallel()
	if got := quoteIdent("a`b"); got != "`a``b`" {
		t.Fatalf("got %q", got)
	}
}

func TestClassifyEngine(t *testing.T) {
	t.Parallel()
	if classifyEngine("View") != "view" {
		t.Fatal("view")
	}
	if classifyEngine("MaterializedView") != "materialized_view" {
		t.Fatal("mv")
	}
	if classifyEngine("MergeTree") != "table" {
		t.Fatal("table")
	}
}

func TestNormalizeDumpParamsDefaults(t *testing.T) {
	t.Parallel()
	p := DumpParams{}
	normalizeDumpParams(&p)
	if p.Mode != DumpStructureAndData {
		t.Fatalf("mode %q", p.Mode)
	}
	if !p.IncludeTables || !p.IncludeViews || !p.IncludeMaterializedViews {
		t.Fatal("expected default includes")
	}
}

func TestStripDatabaseQualifier(t *testing.T) {
	t.Parallel()
	in := "CREATE TABLE `db`.`t` (`id` Int32)"
	got := stripDatabaseQualifier(in, "db")
	if strings.Contains(got, "`db`.") {
		t.Fatalf("still qualified: %s", got)
	}
	if !strings.Contains(got, "`t`") {
		t.Fatalf("lost table: %s", got)
	}
	view := "CREATE VIEW v AS SELECT * FROM db.other"
	got = stripDatabaseQualifier(view, "db")
	if strings.Contains(got, "db.") {
		t.Fatalf("unquoted qualifier left: %s", got)
	}
}

func TestRewriteRestoreStatement(t *testing.T) {
	t.Parallel()
	got := rewriteRestoreStatement("CREATE DATABASE IF NOT EXISTS `wms_ftest`", "my_test")
	if got != "CREATE DATABASE IF NOT EXISTS `my_test`" {
		t.Fatalf("got %q", got)
	}
	got = rewriteRestoreStatement("USE wms_ftest", "my_test")
	if got != "USE `my_test`" {
		t.Fatalf("got %q", got)
	}
	got = rewriteRestoreStatement("CREATE TABLE t (id Int32)", "my_test")
	if got != "CREATE TABLE t (id Int32)" {
		t.Fatalf("passthrough %q", got)
	}
}

func TestApplyColumnMapPassthrough(t *testing.T) {
	t.Parallel()
	dst, idx := applyColumnMap([]string{"a", "b"}, nil)
	if len(dst) != 2 || dst[0] != "a" || idx[1] != 1 {
		t.Fatalf("passthrough failed: %#v %#v", dst, idx)
	}
}
