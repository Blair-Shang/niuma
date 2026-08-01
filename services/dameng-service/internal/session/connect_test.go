package session

import (
	"strings"
	"testing"
)

func TestBuildDSN(t *testing.T) {
	p := ConnectParams{
		HostAddress:  "db.example",
		LoginAccount: "u ser",
		Secret:       "p@ss word",
		Options:      ConnectOptions{Schema: "APP"},
	}
	s, e := buildDSN(p)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.HasPrefix(s, "dm://u ser:p@ss word@db.example:5236?") {
		t.Fatalf("unexpected dsn prefix: %s", s)
	}
	if !strings.Contains(s, "schema=APP") || !strings.Contains(s, "appName=NiuMa") || !strings.Contains(s, "connectTimeout=30000") {
		t.Fatalf("unexpected dsn query: %s", s)
	}
}

func TestBuildDSNSpecialPassword(t *testing.T) {
	// 与用户真实密码同类：含 ; ? ) ，url.UserPassword 会误编码导致 -2501。
	p := ConnectParams{
		HostAddress:  "47.117.4.4",
		PortNumber:   55236,
		LoginAccount: "WMS_DEV",
		Secret:       "a4E;?4UL)6.1",
		Options:      ConnectOptions{Schema: "WMS_DEV"},
	}
	s, e := buildDSN(p)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(s, ":a4E;?4UL)6.1@") {
		t.Fatalf("password must stay raw for dm parseDSN, got %s", s)
	}
	if strings.Contains(s, "%3F") || strings.Contains(s, "%29") || strings.Contains(s, "%3B") {
		t.Fatalf("password must not be percent-encoded, got %s", s)
	}
	// 密码内的 ? 不能抢走 query 分隔（依赖末尾真实 ?params）
	if !strings.Contains(s, "?appName=") && !strings.Contains(s, "&appName=") {
		t.Fatalf("missing appName query: %s", s)
	}
	qi := strings.LastIndex(s, "?")
	at := strings.LastIndex(s[:qi], "@")
	pass := s[strings.Index(s, "://")+3 : at]
	pass = pass[strings.Index(pass, ":")+1:]
	if pass != "a4E;?4UL)6.1" {
		t.Fatalf("parsed password %q", pass)
	}
}
