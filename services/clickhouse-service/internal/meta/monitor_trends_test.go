package meta

import "testing"

func TestNormalizeSlowQueriesOptions(t *testing.T) {
	t.Parallel()
	got := NormalizeSlowQueriesOptions(SlowQueriesOptions{})
	if got.WindowMinutes != defaultSlowWindowMinutes {
		t.Fatalf("window=%d", got.WindowMinutes)
	}
	if got.MinDurationMs != defaultSlowMinDurationMs {
		t.Fatalf("min=%d", got.MinDurationMs)
	}
	if got.Limit != defaultSlowLimit {
		t.Fatalf("limit=%d", got.Limit)
	}

	got = NormalizeSlowQueriesOptions(SlowQueriesOptions{
		WindowMinutes: 99999,
		MinDurationMs: -1,
		Limit:         9999,
	})
	if got.WindowMinutes != maxSlowWindowMinutes || got.Limit != maxSlowLimit || got.MinDurationMs != defaultSlowMinDurationMs {
		t.Fatalf("clamped=%+v", got)
	}
}
