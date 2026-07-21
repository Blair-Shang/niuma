package session

import (
	"testing"
)

func TestQuoteConnValue(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"postgres", "postgres"},
		{"my db", "'my db'"},
		{`a'b`, `'a\'b'`},
		{"", "''"},
	}
	for _, tc := range cases {
		if got := quoteConnValue(tc.in); got != tc.want {
			t.Fatalf("quoteConnValue(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestEncodeCellNilAndBasic(t *testing.T) {
	if encodeCell(nil) != nil {
		t.Fatal("nil should stay nil")
	}
	if encodeCell("x") != "x" {
		t.Fatal("string passthrough")
	}
	if encodeCell(int64(3)) != int64(3) {
		t.Fatal("int64 passthrough")
	}
}

func TestConnectOptionsDefaults(t *testing.T) {
	var o ConnectOptions
	if o.DatabaseOrDefault() != defaultDatabase {
		t.Fatal("database default")
	}
	if o.sslModeOrDefault() != defaultSSLMode {
		t.Fatal("ssl default")
	}
	if !o.ExcludeSystemSchemasEnabled() {
		t.Fatal("exclude system schemas default true")
	}
	f := false
	o.ExcludeSystemSchemas = &f
	if o.ExcludeSystemSchemasEnabled() {
		t.Fatal("exclude override")
	}
}

func TestEffectiveSSLModeTunnelDowngrade(t *testing.T) {
	cases := []struct {
		name         string
		ssl          string
		tunnelActive bool
		want         string
	}{
		{name: "prefer no tunnel", ssl: "prefer", tunnelActive: false, want: "prefer"},
		{name: "prefer with tunnel", ssl: "prefer", tunnelActive: true, want: "disable"},
		{name: "allow with tunnel", ssl: "allow", tunnelActive: true, want: "disable"},
		{name: "require with tunnel", ssl: "require", tunnelActive: true, want: "require"},
		{name: "verify-full with tunnel", ssl: "verify-full", tunnelActive: true, want: "verify-full"},
		{name: "disable with tunnel", ssl: "disable", tunnelActive: true, want: "disable"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			o := ConnectOptions{SSLMode: tc.ssl}
			if got := o.effectiveSSLMode(tc.tunnelActive); got != tc.want {
				t.Fatalf("effectiveSSLMode=%q want %q", got, tc.want)
			}
		})
	}
}

func TestClientEncodingOrEmpty(t *testing.T) {
	t.Parallel()
	o := ConnectOptions{ClientEncoding: "UTF8"}
	if got := o.clientEncodingOrEmpty(); got != "UTF8" {
		t.Fatalf("got %q", got)
	}
	o.ClientEncoding = "bad enc"
	if got := o.clientEncodingOrEmpty(); got != "" {
		t.Fatalf("unsafe should clear, got %q", got)
	}
}

func TestBuildPoolConfigClientEncoding(t *testing.T) {
	t.Parallel()
	cfg, err := buildPoolConfig(ConnectParams{
		HostAddress:  "127.0.0.1",
		PortNumber:   5432,
		LoginAccount: "u",
		Secret:       "p",
		Options: ConnectOptions{
			Database:       "postgres",
			SSLMode:        "disable",
			ClientEncoding: "UTF8",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if enc := cfg.ConnConfig.RuntimeParams["client_encoding"]; enc != "UTF8" {
		t.Fatalf("client_encoding=%q", enc)
	}
}
