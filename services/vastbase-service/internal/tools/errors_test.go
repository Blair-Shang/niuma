package tools

import (
	"strings"
	"testing"
)

func TestRewriteToolFailureAcldefault(t *testing.T) {
	stderr := `pg_dump: error: query failed: ERROR:  language with OID 0 does not exist
DETAIL:  N/A
CONTEXT:  referenced column: acldefault
pg_dump: detail: Query was: SELECT ... acldefault('l', lanowner) AS acldefault ...
→ E:\flux-test1.dump`
	got := rewriteToolFailure(stderr)
	for _, part := range []string{"不兼容", "导出 SQL", "vb_dump"} {
		if !strings.Contains(got, part) {
			t.Fatalf("missing %q in rewrite: %q", part, got)
		}
	}
}

func TestPickToolErrorLinePrefersError(t *testing.T) {
	stderr := "pg_dump: error: query failed: ERROR: boom\n→ E:\\x.dump\n"
	got := pickToolErrorLine(stderr)
	if got != "pg_dump: error: query failed: ERROR: boom" {
		t.Fatalf("got %q", got)
	}
}

func TestRewriteToolFailurePassthrough(t *testing.T) {
	stderr := "pg_dump: error: connection to server failed"
	got := rewriteToolFailure(stderr)
	if got != stderr {
		t.Fatalf("got %q", got)
	}
}
