package ai

import (
	"testing"
	"time"
)

func TestInferToolRisk(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"list_tables", RiskRead},
		{"run_readonly_sql", RiskRead},
		{"describe_table", RiskRead},
		{"insert_row", RiskWrite},
		{"update_document", RiskWrite},
		{"delete_rows", RiskWrite},
		{"drop_table", RiskWrite},
		{"execute_sql", RiskWrite},
		{"run_shell", RiskDangerous},
		{"execute_command", RiskDangerous},
		{"", RiskRead},
	}
	for _, tc := range cases {
		if got := InferToolRisk(tc.name); got != tc.want {
			t.Errorf("InferToolRisk(%q)=%q want %q", tc.name, got, tc.want)
		}
	}
}

func TestRequiresConfirm(t *testing.T) {
	if RequiresConfirm(RiskRead) {
		t.Fatal("read should not require confirm")
	}
	if !RequiresConfirm(RiskWrite) || !RequiresConfirm(RiskDangerous) {
		t.Fatal("write/dangerous should require confirm")
	}
}

func TestPolicyGateApproveReject(t *testing.T) {
	g := newPolicyGate()
	ch := g.register("inv-1", "run-a")
	if !g.decide("inv-1", true) {
		t.Fatal("decide approve failed")
	}
	select {
	case v := <-ch:
		if !v {
			t.Fatal("expected approve")
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting approve")
	}

	ch2 := g.register("inv-2", "run-a")
	if !g.decide("inv-2", false) {
		t.Fatal("decide reject failed")
	}
	select {
	case v := <-ch2:
		if v {
			t.Fatal("expected reject")
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting reject")
	}
}

func TestPolicyGateRejectRun(t *testing.T) {
	g := newPolicyGate()
	ch := g.register("inv-x", "run-b")
	g.rejectRun("run-b")
	select {
	case v := <-ch:
		if v {
			t.Fatal("rejectRun should send false")
		}
	case <-time.After(time.Second):
		t.Fatal("timeout")
	}
	if len(g.listPending("")) != 0 {
		t.Fatal("waiters should be empty")
	}
}
