package session

import "testing"

func TestClampPageSize(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   int
		want int
	}{
		{0, DefaultQueryLimit},
		{-1, DefaultQueryLimit},
		{100, 100},
		{DefaultQueryLimit, DefaultQueryLimit},
		{MaxQueryLimit, MaxQueryLimit},
		{MaxQueryLimit + 1, MaxQueryLimit},
	}
	for _, tc := range cases {
		if got := clampPageSize(tc.in); got != tc.want {
			t.Fatalf("clampPageSize(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}
}
