package handler

import (
	"testing"

	"niuma/platform/internal/supervisor"
)

func TestCapabilityRegistryResolve(t *testing.T) {
	sup := &supervisor.Supervisor{}
	reg, err := NewCapabilityRegistry(sup)
	if err != nil {
		t.Fatalf("new registry: %v", err)
	}
	reg.routes = []*capabilityRoute{
		{namespace: "ftp"},
		{namespace: "ssh"},
		{namespace: "com.niuma.db-pg"},
	}

	tests := []struct {
		method      string
		wantNS      string
		wantAction  string
		wantOK      bool
	}{
		{"ftp.session.open", "ftp", "session.open", true},
		{"ftp.dir.list", "ftp", "dir.list", true},
		{"com.niuma.db-pg.session.open", "com.niuma.db-pg", "session.open", true},
		{"com.niuma.db-pg.query.exec", "com.niuma.db-pg", "query.exec", true},
		{"platform.settings.get", "", "", false},
		{"ssh.session.open", "ssh", "session.open", true},
		{"ssh.terminal.open", "ssh", "terminal.open", true},
		{"ssh.terminal.input", "ssh", "terminal.input", true},
		{"ftp", "", "", false},
	}

	for _, tc := range tests {
		route, action, ok := reg.resolve(tc.method)
		if ok != tc.wantOK {
			t.Fatalf("%s: ok=%v want %v", tc.method, ok, tc.wantOK)
		}
		if !tc.wantOK {
			continue
		}
		if route.namespace != tc.wantNS {
			t.Fatalf("%s: namespace=%q want %q", tc.method, route.namespace, tc.wantNS)
		}
		if action != tc.wantAction {
			t.Fatalf("%s: action=%q want %q", tc.method, action, tc.wantAction)
		}
	}
}
