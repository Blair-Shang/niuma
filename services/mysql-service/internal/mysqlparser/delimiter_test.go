package mysqlparser

import (
	"strings"
	"testing"
)

func TestPreprocessDelimiter(t *testing.T) {
	in := "DELIMITER //\nSELECT 1//\nDELIMITER ;\n"
	out := preprocessDelimiter(in)
	if !strings.Contains(out, "-- DELIMITER") {
		t.Fatalf("expected directive commented, got %q", out)
	}
	if !strings.Contains(out, "SELECT 1;") {
		t.Fatalf("expected // terminator normalized to ;, got %q", out)
	}
}
