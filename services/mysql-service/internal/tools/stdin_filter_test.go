package tools

import (
	"io"
	"strings"
	"testing"
)

type countingReader struct {
	r io.Reader
	n *int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	if c.n != nil {
		*c.n += int64(n)
	}
	return n, err
}

func TestStripGtidReaderKeepsData(t *testing.T) {
	src := strings.NewReader(`SET NAMES utf8mb4;
SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ 'aaaa:1-10';
CREATE TABLE t1 (id int);
INSERT INTO t1 VALUES (1);
`)
	out, err := io.ReadAll(newStripGtidReader(src))
	if err != nil {
		t.Fatal(err)
	}
	got := string(out)
	if strings.Contains(got, "GTID_PURGED") {
		t.Fatalf("gtid not stripped:\n%s", got)
	}
	if !strings.Contains(got, "CREATE TABLE") || !strings.Contains(got, "INSERT INTO") {
		t.Fatalf("data missing:\n%s", got)
	}
}

func TestStripGtidReaderLongInsertLine(t *testing.T) {
	// 超过旧 Scanner 默认舒适区的长行，必须仍能完整通过
	long := "INSERT INTO t VALUES (" + strings.Repeat("'x',", 200_000) + "1);\n"
	src := strings.NewReader("SET @@GLOBAL.GTID_PURGED='a:1-2';\n" + long + "SELECT 1;\n")
	out, err := io.ReadAll(newStripGtidReader(src))
	if err != nil {
		t.Fatal(err)
	}
	got := string(out)
	if strings.Contains(got, "GTID_PURGED") {
		t.Fatal("gtid not stripped")
	}
	if !strings.Contains(got, "INSERT INTO t VALUES") {
		t.Fatal("long insert missing")
	}
	if !strings.Contains(got, "SELECT 1") {
		t.Fatal("trailing sql missing")
	}
}

func TestStripGtidReaderStreamsLongLine(t *testing.T) {
	// 巨型 INSERT 不得整行一次读入；首次 Read 后底层消耗应远小于全长
	long := "INSERT INTO t VALUES (" + strings.Repeat("'x',", 500_000) + "1);\n"
	var consumed int64
	src := &countingReader{r: strings.NewReader(long), n: &consumed}
	r := newStripGtidReader(src)
	buf := make([]byte, 1024)
	n, err := r.Read(buf)
	if err != nil || n == 0 {
		t.Fatalf("first read: n=%d err=%v", n, err)
	}
	if consumed >= int64(len(long)) {
		t.Fatalf("buffered entire line (%d bytes) on first read", consumed)
	}
	if consumed > int64(stripGtidClassifyMax)+256*1024 {
		t.Fatalf("read too far ahead: %d", consumed)
	}
}

func TestStripGtidReaderKeepsInsertMentioningGtid(t *testing.T) {
	src := strings.NewReader("INSERT INTO notes VALUES ('see GTID_PURGED docs');\nCREATE TABLE t(id int);\n")
	out, err := io.ReadAll(newStripGtidReader(src))
	if err != nil {
		t.Fatal(err)
	}
	got := string(out)
	if !strings.Contains(got, "GTID_PURGED") || !strings.Contains(got, "CREATE TABLE") {
		t.Fatalf("data truncated:\n%s", got)
	}
}

func TestStripGtidReaderCommentForm(t *testing.T) {
	src := strings.NewReader(`/*!50003 SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN*/;
/*!50003 SET @@SESSION.SQL_LOG_BIN=0*/;
INSERT INTO t VALUES (1);
/*!50003 SET @@SESSION.SQL_LOG_BIN=@MYSQLDUMP_TEMP_LOG_BIN*/;
`)
	out, err := io.ReadAll(newStripGtidReader(src))
	if err != nil {
		t.Fatal(err)
	}
	got := string(out)
	if strings.Contains(got, "SQL_LOG_BIN") || strings.Contains(got, "MYSQLDUMP_TEMP_LOG_BIN") {
		t.Fatalf("log_bin not stripped:\n%s", got)
	}
	if !strings.Contains(got, "INSERT INTO t VALUES (1)") {
		t.Fatalf("insert missing:\n%s", got)
	}
}
