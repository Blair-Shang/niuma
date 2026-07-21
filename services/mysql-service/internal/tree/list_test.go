package tree

import "testing"

func TestLikePrefix(t *testing.T) {
	t.Parallel()
	if got := likePrefix("ab_c%"); got != `ab\_c\%%` {
		t.Fatalf("got %q", got)
	}
	if likePrefix("  ") != "" {
		t.Fatal("empty filter")
	}
}

func TestIsSystemDatabase(t *testing.T) {
	t.Parallel()
	if !IsSystemDatabase("mysql") || !IsSystemDatabase("SYS") {
		t.Fatal("expected system")
	}
	if IsSystemDatabase("app") {
		t.Fatal("app is not system")
	}
}

func TestTableTypeSQL(t *testing.T) {
	t.Parallel()
	if got := tableTypeSQL(nil); got != "'BASE TABLE','VIEW'" {
		t.Fatalf("nil: %q", got)
	}
	if got := tableTypeSQL([]string{"table"}); got != "'BASE TABLE'" {
		t.Fatalf("table: %q", got)
	}
	if got := tableTypeSQL([]string{"view"}); got != "'VIEW'" {
		t.Fatalf("view: %q", got)
	}
}

func TestRoutineTypeSQL(t *testing.T) {
	t.Parallel()
	if got := routineTypeSQL(nil); got != "'PROCEDURE','FUNCTION'" {
		t.Fatalf("nil: %q", got)
	}
	if got := routineTypeSQL([]string{"procedure"}); got != "'PROCEDURE'" {
		t.Fatalf("procedure: %q", got)
	}
	if got := routineTypeSQL([]string{"function"}); got != "'FUNCTION'" {
		t.Fatalf("function: %q", got)
	}
}
