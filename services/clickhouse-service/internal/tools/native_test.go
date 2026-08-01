package tools

import (
	"bytes"
	"strings"
	"testing"

	"niuma/pkg/tunnel"
	"niuma/services/clickhouse-service/internal/session"
)

func TestPrepareNativeConnectRejectsHTTP(t *testing.T) {
	t.Parallel()
	_, err := prepareNativeConnect(session.ConnectParams{
		HostAddress: "127.0.0.1",
		PortNumber:  8123,
		Options:     session.ConnectOptions{Protocol: session.ProtocolHTTP},
	})
	if err == nil || !strings.Contains(err.Error(), "HTTP") {
		t.Fatalf("expected HTTP error, got %v", err)
	}
}

func TestPrepareNativeConnectRejectsTunnel(t *testing.T) {
	t.Parallel()
	_, err := prepareNativeConnect(session.ConnectParams{
		HostAddress: "db.internal",
		PortNumber:  9000,
		Options: session.ConnectOptions{
			Protocol: session.ProtocolNative,
			Tunnel:   &tunnel.Options{Type: tunnel.TypeSSH},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "tunnel") {
		t.Fatalf("expected tunnel error, got %v", err)
	}
}

func TestPrepareNativeConnectOK(t *testing.T) {
	t.Parallel()
	got, err := prepareNativeConnect(session.ConnectParams{
		HostAddress: "127.0.0.1",
		PortNumber:  9000,
		Options:     session.ConnectOptions{Protocol: session.ProtocolNative},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Options.ProtocolOrDefault() != session.ProtocolNative {
		t.Fatalf("protocol %q", got.Options.Protocol)
	}
}

func TestEnsureStatement(t *testing.T) {
	t.Parallel()
	if got := ensureStatement("CREATE TABLE t (id Int32)"); got != "CREATE TABLE t (id Int32);\n" {
		t.Fatalf("got %q", got)
	}
	if got := ensureStatement("CREATE TABLE t (id Int32);"); got != "CREATE TABLE t (id Int32);\n" {
		t.Fatalf("got %q", got)
	}
}

func TestStripDatabaseQualifier(t *testing.T) {
	t.Parallel()
	in := "CREATE TABLE `mydb`.`t` (`id` Int32)"
	got := stripDatabaseQualifier(in, "mydb")
	if strings.Contains(got, "`mydb`.") {
		t.Fatalf("still qualified: %s", got)
	}
}

func TestQualifierStripWriter(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	w := newQualifierStripWriter(&buf, "demo")
	chunk := []byte("INSERT INTO `demo`.`t` VALUES (1); INSERT INTO `demo`.`u` VALUES (2);")
	// 分片写入，覆盖 needle 跨边界
	mid := 12
	if _, err := w.Write(chunk[:mid]); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(chunk[mid:]); err != nil {
		t.Fatal(err)
	}
	if err := w.Flush(); err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	if strings.Contains(got, "`demo`.") {
		t.Fatalf("still qualified: %s", got)
	}
	if !strings.Contains(got, "INSERT INTO `t`") || !strings.Contains(got, "INSERT INTO `u`") {
		t.Fatalf("unexpected: %s", got)
	}
}

func TestIsProtectedDatabase(t *testing.T) {
	t.Parallel()
	if !isProtectedDatabase("system") || !isProtectedDatabase("INFORMATION_SCHEMA") {
		t.Fatal("expected protected")
	}
	if isProtectedDatabase("default") || isProtectedDatabase("app") {
		t.Fatal("user db should pass")
	}
}
