package session

import (
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestRowsAffectedPtr(t *testing.T) {
	t.Parallel()
	if got := rowsAffectedPtr(9664, 0); got == nil || *got != 9664 {
		t.Fatalf("DML: got %v", got)
	}
	if got := rowsAffectedPtr(0, 0); got == nil || *got != 0 {
		t.Fatalf("DML zero: got %v", got)
	}
	if got := rowsAffectedPtr(10, 3); got != nil {
		t.Fatalf("SELECT with columns: got %v", got)
	}
}

func TestRowsAffectedFromTag(t *testing.T) {
	t.Parallel()
	tag := pgconn.NewCommandTag("UPDATE 9664")
	got := rowsAffectedFromTag(tag, 0)
	if got == nil || *got != 9664 {
		t.Fatalf("got %v want 9664", got)
	}
	if rowsAffectedFromTag(tag, 2) != nil {
		t.Fatal("expected nil when result columns present")
	}
}
