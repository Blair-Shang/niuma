package tools

import (
	"bufio"
	"strings"
	"testing"
)

func TestScanLinesToDrainsLongLine(t *testing.T) {
	var msgs []string
	m := NewManager(nil, nil, func(payload map[string]any) {
		if msg, ok := payload["message"].(string); ok {
			msgs = append(msgs, msg)
		}
	})
	long := "INSERT INTO t VALUES (" + strings.Repeat("x", 200_000) + ");\n"
	src := strings.NewReader(long + "-- Dumping data for table 'foo'\n")
	m.scanLinesTo("t1", src, nil)
	found := false
	for _, msg := range msgs {
		if strings.Contains(msg, "Dumping data") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected comment after long line, msgs=%v", msgs)
	}
}

func TestReadToolLineTruncatesButDrains(t *testing.T) {
	long := strings.Repeat("a", maxToolScanLine+1000) + "\nshort\n"
	br := bufio.NewReader(strings.NewReader(long))
	line, truncated, err := readToolLine(br, maxToolScanLine)
	if err != nil || !truncated || len(line) != maxToolScanLine {
		t.Fatalf("line len=%d truncated=%v err=%v", len(line), truncated, err)
	}
	line2, truncated2, err := readToolLine(br, maxToolScanLine)
	if err != nil || truncated2 || line2 != "short" {
		t.Fatalf("second line=%q truncated=%v err=%v", line2, truncated2, err)
	}
}

func TestShouldEmitToolProgress(t *testing.T) {
	if !shouldEmitToolProgress("-- Retrieving table structure for table foo...") {
		t.Fatal("mysqldump verbose should emit")
	}
	if shouldEmitToolProgress("INSERT INTO t VALUES (1)") {
		t.Fatal("SQL statement should be filtered")
	}
	if shouldEmitToolProgress("CREATE TABLE t (id int)") {
		t.Fatal("CREATE should be filtered")
	}
	if !shouldEmitToolProgress("ERROR 1064 (42000) at line 1") {
		t.Fatal("error lines should emit")
	}
	if shouldEmitToolProgress("`alwaysExcSubTask` char(1) COLLATE utf8mb3_bin NOT NULL DEFAULT 'N',") {
		t.Fatal("DDL fragments should be filtered")
	}
	if shouldEmitToolProgress("------------") {
		t.Fatal("separator lines should be filtered")
	}
}

func TestTruncateRunes(t *testing.T) {
	got := truncateRunes(strings.Repeat("测", 10), 3)
	if got != "测测测…" {
		t.Fatalf("got %q", got)
	}
}

func TestAppendCappedLine(t *testing.T) {
	var buf strings.Builder
	for i := 0; i < 100; i++ {
		appendCappedLine(&buf, strings.Repeat("x", 100), 250)
	}
	if buf.Len() > 250 {
		t.Fatalf("buf too large: %d", buf.Len())
	}
}
