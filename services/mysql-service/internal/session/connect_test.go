package session

import "testing"

func TestEffectiveTLSConfigTunnelDowngrade(t *testing.T) {
	t.Parallel()
	o := ConnectOptions{SSLMode: "preferred"}
	if got := o.effectiveTLSConfig(true); got != "false" {
		t.Fatalf("tunnel preferred -> %q want false", got)
	}
	if got := o.effectiveTLSConfig(false); got != "preferred" {
		t.Fatalf("direct preferred -> %q", got)
	}
	o.SSLMode = "require"
	if got := o.effectiveTLSConfig(true); got != "skip-verify" {
		t.Fatalf("tunnel require -> %q", got)
	}
}

func TestPortOrDefault(t *testing.T) {
	t.Parallel()
	p := ConnectParams{}
	if p.portOrDefault() != DefaultPort {
		t.Fatalf("port=%d", p.portOrDefault())
	}
}

func TestBuildDriverConfigAttributesAndCharset(t *testing.T) {
	t.Parallel()
	cfg, err := buildDriverConfig(ConnectParams{
		HostAddress:  "127.0.0.1",
		PortNumber:   3306,
		LoginAccount: "root",
		Secret:       "secret",
		Options: ConnectOptions{
			Charset:         "utf8mb4",
			Collation:       "utf8mb4_unicode_ci",
			ApplicationName: "niuma-test",
			SSLMode:         "preferred",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ConnectionAttributes != "program_name:niuma-test" {
		t.Fatalf("ConnectionAttributes=%q", cfg.ConnectionAttributes)
	}
	if cfg.Collation != "utf8mb4_unicode_ci" {
		t.Fatalf("Collation=%q", cfg.Collation)
	}
	if _, ok := cfg.Params["connectionAttributes"]; ok {
		t.Fatal("connectionAttributes must not be in Params (would SET as sysvar)")
	}
	if _, ok := cfg.Params["charset"]; ok {
		t.Fatal("charset must not be in Params (would SET as sysvar)")
	}
	if cfg.TLSConfig != "preferred" {
		t.Fatalf("TLSConfig=%q want preferred", cfg.TLSConfig)
	}
}

func TestBuildDriverConfigDefaultAppName(t *testing.T) {
	t.Parallel()
	cfg, err := buildDriverConfig(ConnectParams{
		HostAddress: "db.example",
		Options:     ConnectOptions{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ConnectionAttributes != "program_name:"+defaultAppName {
		t.Fatalf("ConnectionAttributes=%q", cfg.ConnectionAttributes)
	}
	if cfg.Collation != "" {
		t.Fatalf("empty collation expected, got %q", cfg.Collation)
	}
}

func TestBuildDriverConfigRejectsUnsafeCharset(t *testing.T) {
	t.Parallel()
	_, err := buildDriverConfig(ConnectParams{
		HostAddress: "db.example",
		Options:     ConnectOptions{Charset: "utf8mb4; DROP TABLE"},
	})
	if err == nil {
		t.Fatal("expected invalid charset error")
	}
}

func TestNormalizeCollation(t *testing.T) {
	t.Parallel()
	if got := normalizeCollation("utf8mb4", "utf8mb4_unicode_ci"); got != "utf8mb4_unicode_ci" {
		t.Fatalf("got %q", got)
	}
	if got := normalizeCollation("utf8mb4", "latin1_swedish_ci"); got != "" {
		t.Fatalf("mismatch should clear, got %q", got)
	}
	if got := normalizeCollation("utf8", "utf8mb3_general_ci"); got != "utf8mb3_general_ci" {
		t.Fatalf("utf8/utf8mb3 alias got %q", got)
	}
	if got := normalizeCollation("gbk", ""); got != "" {
		t.Fatalf("empty got %q", got)
	}
}

func TestBuildTLSNamedModes(t *testing.T) {
	t.Parallel()
	o := ConnectOptions{SSLMode: "preferred"}
	name, custom, err := o.buildTLS("db.example:3306", false)
	if err != nil || custom != nil || name != "preferred" {
		t.Fatalf("preferred: name=%q custom=%v err=%v", name, custom != nil, err)
	}
	name, custom, err = o.buildTLS("127.0.0.1:3306", true)
	if err != nil || custom != nil || name != "false" {
		t.Fatalf("tunnel preferred: name=%q custom=%v err=%v", name, custom != nil, err)
	}
}

func TestBuildTLSCustomRequiresCAForVerify(t *testing.T) {
	t.Parallel()
	o := ConnectOptions{SSLMode: "verify-ca", SSLCA: ""}
	o.SSLCA = " " // hasCustom but empty after trim via only spaces on other fields
	// force hasCustom via cert without key should fail earlier; verify-ca without readable ca:
	o = ConnectOptions{SSLMode: "verify-ca", SSLCA: "C:\\nonexistent-ca.pem"}
	_, _, err := o.buildTLS("db.example:3306", false)
	if err == nil {
		t.Fatal("expected error for missing ca file")
	}
}
