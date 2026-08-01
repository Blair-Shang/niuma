package session

import "testing"

func TestTxStateSnapshotDefaultAutoCommit(t *testing.T) {
	s := &Session{}
	st := s.TxStateSnapshot()
	if !st.AutoCommit || st.InTransaction {
		t.Fatalf("expected default autoCommit=true, got %+v", st)
	}
}

func TestIsAutoCommitWhenPinned(t *testing.T) {
	s := &Session{autoCommit: false}
	if !s.IsAutoCommit() {
		t.Fatal("expected auto-commit while txConn is nil")
	}
}
