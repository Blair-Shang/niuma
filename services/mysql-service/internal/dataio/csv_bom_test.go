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

func TestParseDelimiterCommand(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"DELIMITER ;;", ";;", true},
		{"delimiter $$", "$$", true},
		{"  DELIMITER ;  ", ";", true},
		{"SELECT 1", "", false},
		{"DELIMITER", "", true},
	}
	for _, c := range cases {
		got, ok := parseDelimiterCommand(c.in)
		if ok != c.ok || got != c.want {
			t.Fatalf("%q: got (%q,%v) want (%q,%v)", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestIsDelimiterCommandLine(t *testing.T) {
	t.Parallel()
	if !isDelimiterCommandLine("DELIMIT", nil, 'E') {
		t.Fatal("expected prefix match while typing DELIMITER")
	}
	if !isDelimiterCommandLine("DELIMITER", nil, ' ') {
		t.Fatal("expected DELIMITER + space")
	}
	if isDelimiterCommandLine("SELECT", nil, ' ') {
		t.Fatal("SELECT should not be delimiter command")
	}
}
