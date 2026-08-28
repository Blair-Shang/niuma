package supervisor

import "testing"

func TestLostEvents(t *testing.T) {
	t.Parallel()
	got := lostEvents("com.niuma.mysql", "mysql", "capability service exited")
	if len(got) != 2 {
		t.Fatalf("len=%d", len(got))
	}
	if got[0]["type"] != "platform.service.state" || got[0]["state"] != "lost" {
		t.Fatalf("platform event: %#v", got[0])
	}
	if got[1]["type"] != "mysql.session.state" || got[1]["sessionId"] != "*" {
		t.Fatalf("session event: %#v", got[1])
	}

	plain := lostEvents("com.niuma.unknown", "", "x")
	if len(plain) != 1 {
		t.Fatalf("no namespace should skip session.state, got %d", len(plain))
	}
}
