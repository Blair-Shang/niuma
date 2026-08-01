package dataio

import "testing"

func TestDumpObjectNameAllowed(t *testing.T) {
	want := map[string]struct{}{
		"T1": {},
		"t1": {},
	}

	t.Run("schema dump filters only tables and views", func(t *testing.T) {
		if !dumpObjectNameAllowed("table", "T1", want, true) {
			t.Fatal("selected table should pass")
		}
		if dumpObjectNameAllowed("table", "T2", want, true) {
			t.Fatal("unselected table should be filtered")
		}
		if !dumpObjectNameAllowed("procedure", "P1", want, true) {
			t.Fatal("procedure must not be filtered by table name list")
		}
		if !dumpObjectNameAllowed("function", "F1", want, true) {
			t.Fatal("function must not be filtered by table name list")
		}
		if !dumpObjectNameAllowed("package", "PKG1", want, true) {
			t.Fatal("package must not be filtered by table name list")
		}
		if !dumpObjectNameAllowed("trigger", "TRG1", want, true) {
			t.Fatal("trigger must not be filtered by table name list")
		}
		if !dumpObjectNameAllowed("sequence", "SEQ1", want, true) {
			t.Fatal("sequence must not be filtered by table name list")
		}
	})

	t.Run("single object dump filters by name", func(t *testing.T) {
		procWant := map[string]struct{}{"P1": {}, "p1": {}}
		if !dumpObjectNameAllowed("procedure", "P1", procWant, false) {
			t.Fatal("matching procedure should pass")
		}
		if dumpObjectNameAllowed("procedure", "P2", procWant, false) {
			t.Fatal("other procedure should be filtered")
		}
	})
}
