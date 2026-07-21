package streamspec

import "testing"

func TestMatchSSHSpec(t *testing.T) {
	t.Parallel()
	spec := Spec{
		Method:     "stream.ssh.terminal",
		BindParam:  "terminalId",
		MatchField: "terminalId",
		EventTypes: []string{"ssh.terminal.data", "ssh.terminal.exit"},
		Exclusive:  true,
	}
	payload := []byte(`{"type":"ssh.terminal.data","terminalId":"t1","data":"x"}`)
	if !spec.Match(payload, "t1") {
		t.Fatal("expected match")
	}
	if spec.Match(payload, "t2") {
		t.Fatal("expected no match")
	}
}
