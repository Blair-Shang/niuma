package dialect

import "testing"

func TestIsMariaDB(t *testing.T) {
	t.Parallel()
	if !IsMariaDB("10.11.6-MariaDB", "") {
		t.Fatal("expected MariaDB version string")
	}
	if !IsMariaDB("8.0.36", "MariaDB") {
		t.Fatal("expected MariaDB comment")
	}
	if IsMariaDB("8.0.36", "MySQL Community Server") {
		t.Fatal("Oracle MySQL must not be treated as MariaDB")
	}
}

func TestParseVersionNum(t *testing.T) {
	t.Parallel()
	if got := ParseVersionNum("8.0.36"); got != "80036" {
		t.Fatalf("got %q", got)
	}
	if got := ParseVersionNum("5.7.44-log"); got != "50744" {
		t.Fatalf("got %q", got)
	}
}

func TestResolveCapabilities57(t *testing.T) {
	t.Parallel()
	p := ResolveCapabilities("5.7.44", "MySQL Community Server", "mysql_native_password")
	if p.Family != FamilyMySQL {
		t.Fatalf("family=%q", p.Family)
	}
	if Has(&p, CapAuthCachingSHA2) {
		t.Fatal("5.7 must not enable caching_sha2 by default")
	}
	if !Has(&p, CapBacktickIdent) || !Has(&p, CapEditorBuiltinSQL) {
		t.Fatal("missing base caps")
	}
	if !Has(&p, CapSplitDelimiterBlocks) {
		t.Fatal("5.7 must enable split.delimiter_blocks")
	}
	if Has(&p, CapJSONNativeType) {
		t.Fatal("5.7 must not default json.native_type")
	}
}

func TestResolveCapabilities8(t *testing.T) {
	t.Parallel()
	p := ResolveCapabilities("8.0.36", "MySQL Community Server", "caching_sha2_password")
	if !Has(&p, CapAuthCachingSHA2) || !Has(&p, CapJSONNativeType) || !Has(&p, CapCTEWindow) {
		t.Fatalf("missing 8.0 caps: %#v", p.Capabilities)
	}
	if !Has(&p, CapSplitDelimiterBlocks) {
		t.Fatal("8.0 must enable split.delimiter_blocks")
	}
	if p.VersionNum != "80036" {
		t.Fatalf("versionNum=%q", p.VersionNum)
	}
}
