package session

import (
	"context"
	"testing"
)

func TestTxStateDefaultAutoCommit(t *testing.T) {
	s := &Session{}
	st := s.TxStateSnapshot()
	if !st.AutoCommit {
		t.Fatalf("expected default autoCommit=true, got %+v", st)
	}
	if st.InTransaction {
		t.Fatalf("expected not in tx")
	}
	if !s.IsAutoCommit() {
		t.Fatalf("IsAutoCommit should be true by default")
	}
}

func TestMarkInTxRequiresPinnedConn(t *testing.T) {
	s := &Session{autoCommit: false}
	s.markInTxAfterStatement()
	if s.inTx {
		t.Fatalf("should not mark inTx without txConn")
	}
}

func TestQuoteIdent(t *testing.T) {
	if got := quoteIdent("wms_ftest"); got != "`wms_ftest`" {
		t.Fatalf("quoteIdent: got %q", got)
	}
	if got := quoteIdent("a`b"); got != "`a``b`" {
		t.Fatalf("quoteIdent escape: got %q", got)
	}
}

func TestEnsureConnDatabaseSkipWhenSame(t *testing.T) {
	s := &Session{txDatabase: "wms_ftest"}
	// conn nil + empty → no-op
	if err := s.ensureConnDatabase(context.Background(), nil, true, ""); err != nil {
		t.Fatalf("empty database: %v", err)
	}
	// same name should skip without needing a live conn
	if err := s.ensureConnDatabase(context.Background(), nil, true, "wms_ftest"); err != nil {
		t.Fatalf("same database should skip: %v", err)
	}
	if err := s.ensureConnDatabase(context.Background(), nil, true, "WMS_FTEST"); err != nil {
		t.Fatalf("case-insensitive skip: %v", err)
	}
}

