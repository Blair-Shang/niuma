package dialect

import "testing"

func TestParseVersionNum(t *testing.T) {
	if got := ParseVersionNum("3.45.1"); got != "3045001" {
		t.Fatalf("got %q", got)
	}
	if got := ParseVersionNum("bad"); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestResolveCapabilities(t *testing.T) {
	p := ResolveCapabilities("3.45.1", true, "wal", true)
	if p.Family != FamilySQLite {
		t.Fatalf("family %q", p.Family)
	}
	if !Has(&p, CapReadonly) || !Has(&p, CapWAL) || !Has(&p, CapJSONFunctions) {
		t.Fatalf("missing caps: %#v", p.Capabilities)
	}
	if p.VersionNum != "3045001" {
		t.Fatalf("versionNum %q", p.VersionNum)
	}
}

func TestResolveCapabilitiesOldVersionDropsCTE(t *testing.T) {
	p := ResolveCapabilities("3.7.17", false, "", false)
	if Has(&p, CapCTEWindow) {
		t.Fatalf("3.7 should not advertise cte.window: %#v", p.Capabilities)
	}
}
