package handler

import "testing"

func TestApplyDirListLimit_NoLimitReturnsAll(t *testing.T) {
	t.Parallel()
	in := make([]FtpEntry, 3)
	for i := range in {
		in[i] = FtpEntry{Name: string(rune('a' + i))}
	}
	out, truncated := applyDirListLimit(in, 0)
	if truncated || len(out) != 3 {
		t.Fatalf("limit=0 must keep all entries, got n=%d truncated=%v", len(out), truncated)
	}
}

func TestApplyDirListLimit_ExplicitLimitTruncates(t *testing.T) {
	t.Parallel()
	in := make([]FtpEntry, 5)
	out, truncated := applyDirListLimit(in, 2)
	if !truncated || len(out) != 2 {
		t.Fatalf("limit=2 got n=%d truncated=%v", len(out), truncated)
	}
}

func TestApplyDirListLimit_CapsExplicitLimit(t *testing.T) {
	t.Parallel()
	in := make([]FtpEntry, maxDirListEntries+10)
	out, truncated := applyDirListLimit(in, maxDirListEntries+1)
	if !truncated || len(out) != maxDirListEntries {
		t.Fatalf("explicit huge limit must cap at %d, got n=%d truncated=%v", maxDirListEntries, len(out), truncated)
	}
}
