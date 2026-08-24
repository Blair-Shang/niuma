package meta

import (
	"context"
	"strings"
	"testing"
)

func TestKillSessionRejectsInvalidID(t *testing.T) {
	t.Parallel()
	err := KillSession(context.Background(), nil, 0)
	if err == nil || !strings.Contains(err.Error(), "invalid session id") {
		t.Fatalf("expected invalid session id, got %v", err)
	}
	err = KillSession(context.Background(), nil, -3)
	if err == nil || !strings.Contains(err.Error(), "invalid session id") {
		t.Fatalf("expected invalid session id, got %v", err)
	}
	err = KillSession(context.Background(), nil, 12)
	if err == nil || !strings.Contains(err.Error(), "nil db") {
		t.Fatalf("expected nil db, got %v", err)
	}
}
