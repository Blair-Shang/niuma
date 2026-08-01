package meta

import (
	"strings"
	"testing"
)

func TestExtractLatestDeadlock(t *testing.T) {
	raw := `
=====================================
2024-01-01 12:00:00 0x7f INNODB MONITOR OUTPUT
=====================================
------------------------
LATEST DETECTED DEADLOCK
------------------------
*** (1) TRANSACTION:
TRANSACTION 123, ACTIVE 5 sec
*** WE ROLL BACK TRANSACTION (1)
------------
TRANSACTIONS
------------
Trx id counter 999
`
	got := extractLatestDeadlock(raw)
	if got == "" {
		t.Fatal("expected deadlock excerpt")
	}
	if !strings.Contains(got, "LATEST DETECTED DEADLOCK") || !strings.Contains(got, "WE ROLL BACK") {
		t.Fatalf("unexpected excerpt: %q", got)
	}
	if strings.Contains(got, "Trx id counter") {
		t.Fatalf("should not include TRANSACTIONS section: %q", got)
	}
	if extractLatestDeadlock("no deadlock here") != "" {
		t.Fatal("expected empty when marker missing")
	}
}
