package session

import (
	"encoding/json"
	"strings"
	"testing"

	"niuma/pkg/tunnel"
)

func TestPortOrDefault(t *testing.T) {
	t.Parallel()
	p := ConnectParams{Options: ConnectOptions{Protocol: ProtocolNative}}
	if p.PortOrDefault() != DefaultNativePort {
		t.Fatalf("native port=%d", p.PortOrDefault())
	}
	p.Options.Protocol = ProtocolHTTP
	if p.PortOrDefault() != DefaultHTTPPort {
		t.Fatalf("http port=%d", p.PortOrDefault())
	}
	sec := true
	p.Options.Secure = &sec
	if p.PortOrDefault() != DefaultHTTPTLSPort {
		t.Fatalf("https port=%d", p.PortOrDefault())
	}
	p.PortNumber = 19000
	if p.PortOrDefault() != 19000 {
		t.Fatal("explicit port must win")
	}
}

func TestQuoteIdent(t *testing.T) {
	t.Parallel()
	got, err := QuoteIdent("default")
	if err != nil || got != "`default`" {
		t.Fatalf("got %q err=%v", got, err)
	}
	got, err = QuoteIdent("a`b")
	if err != nil || got != "`a``b`" {
		t.Fatalf("escape got %q err=%v", got, err)
	}
	if _, err := QuoteIdent(""); err == nil {
		t.Fatal("empty must fail")
	}
	if _, err := QuoteIdent("x\x00y"); err == nil {
		t.Fatal("NUL must fail")
	}
}

func TestIsSafeDatabaseName(t *testing.T) {
	t.Parallel()
	if !IsSafeDatabaseName("default") || !IsSafeDatabaseName("db_1") {
		t.Fatal("valid names")
	}
	if IsSafeDatabaseName("db;drop") || IsSafeDatabaseName("a b") || IsSafeDatabaseName("") {
		t.Fatal("unsafe names must be rejected")
	}
}

func TestConnectParamsPasswordAlias(t *testing.T) {
	t.Parallel()
	var p ConnectParams
	raw := `{"hostAddress":"127.0.0.1","password":"s3cret","options":{"protocol":"http"}}`
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatal(err)
	}
	if p.Secret != "s3cret" {
		t.Fatalf("secret=%q", p.Secret)
	}
	if p.Options.ProtocolOrDefault() != ProtocolHTTP {
		t.Fatal("protocol")
	}
}

func TestBuildDriverOptionsRequiresHost(t *testing.T) {
	t.Parallel()
	_, err := buildDriverOptions(ConnectParams{})
	if err == nil || !strings.Contains(err.Error(), "host address required") {
		t.Fatalf("err=%v", err)
	}
}

func TestBuildDriverOptionsNative(t *testing.T) {
	t.Parallel()
	opts, err := buildDriverOptions(ConnectParams{
		HostAddress:  "127.0.0.1",
		LoginAccount: "default",
		Options: ConnectOptions{
			Protocol: ProtocolNative,
			Database: "analytics",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(opts.Addr) != 1 || opts.Addr[0] != "127.0.0.1:9000" {
		t.Fatalf("addr=%v", opts.Addr)
	}
	if opts.Auth.Database != "analytics" {
		t.Fatalf("db=%q", opts.Auth.Database)
	}
}

func TestCollectAddrsWithAltHosts(t *testing.T) {
	t.Parallel()
	addrs, err := collectAddrs(ConnectParams{
		HostAddress: "ch-a.example.com",
		PortNumber:  9000,
		Options: ConnectOptions{
			AltHosts: "ch-b.example.com, ch-c.example.com:9001",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"ch-a.example.com:9000",
		"ch-b.example.com:9000",
		"ch-c.example.com:9001",
	}
	if len(addrs) != len(want) {
		t.Fatalf("addrs=%v", addrs)
	}
	for i := range want {
		if addrs[i] != want[i] {
			t.Fatalf("addrs=%v want=%v", addrs, want)
		}
	}
}

func TestCollectAddrsTunnelIgnoresAltHosts(t *testing.T) {
	t.Parallel()
	addrs, err := collectAddrs(ConnectParams{
		HostAddress: "127.0.0.1",
		PortNumber:  64123,
		Options: ConnectOptions{
			AltHosts: "10.0.0.2:9000",
			Tunnel:   &tunnel.Options{Type: tunnel.TypeSSH, SSHProfileID: "ssh-1"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(addrs) != 1 || addrs[0] != "127.0.0.1:64123" {
		t.Fatalf("tunnel must keep primary only, got %v", addrs)
	}
}

func TestParseHostPortList(t *testing.T) {
	t.Parallel()
	got, err := parseHostPortList("a, b:9001;c\nd", 9000)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"a:9000", "b:9001", "c:9000", "d:9000"}
	if len(got) != len(want) {
		t.Fatalf("got=%v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got=%v want=%v", got, want)
		}
	}
	got, err = parseHostPortList("[::1]:9440, [::1]", 9000)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "[::1]:9440" || got[1] != "[::1]:9000" {
		t.Fatalf("ipv6 got=%v", got)
	}
}
