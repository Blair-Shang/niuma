package session

import (
	"strings"
	"testing"
)

func TestShellStartupDatabase(t *testing.T) {
	sess := &Session{
		Params: ConnectParams{
			Options: ConnectOptions{DefaultDatabase: "app"},
		},
	}
	if got := shellStartupDatabase(sess); got != "app" {
		t.Fatalf("expected default database app, got %q", got)
	}

	sess.SetDatabase("inventory")
	if got := shellStartupDatabase(sess); got != "inventory" {
		t.Fatalf("expected current database inventory, got %q", got)
	}

	empty := &Session{Params: ConnectParams{}}
	if got := shellStartupDatabase(empty); got != "" {
		t.Fatalf("expected empty startup database, got %q", got)
	}
}

func TestShellCLIEnvWithoutDefaultDatabase(t *testing.T) {
	uri, _, err := ShellCLIEnv(&Session{
		Params: ConnectParams{
			HostAddress:  "127.0.0.1",
			PortNumber:   27017,
			LoginAccount: "admin",
			Options: ConnectOptions{
				AuthDatabase: "admin",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(uri, "/test") {
		t.Fatalf("shell uri should not default to /test, got %q", uri)
	}
	if !strings.Contains(uri, "authSource=admin") {
		t.Fatalf("expected authSource in uri, got %q", uri)
	}
}

func TestShellCLIEnvWithDefaultDatabase(t *testing.T) {
	uri, _, err := ShellCLIEnv(&Session{
		Params: ConnectParams{
			HostAddress: "127.0.0.1",
			PortNumber:  27017,
			Options: ConnectOptions{
				DefaultDatabase: "inventory",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(uri, "/inventory") {
		t.Fatalf("expected /inventory in uri, got %q", uri)
	}
}

func TestCLIEnvOmitsPasswordFromURI(t *testing.T) {
	uri, env, err := CLIEnv(ConnectParams{
		HostAddress:  "127.0.0.1",
		PortNumber:   27017,
		LoginAccount: "admin",
		Secret:       "s3cret",
		Options:      ConnectOptions{AuthDatabase: "admin"},
	}, "app")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(uri, "s3cret") {
		t.Fatalf("uri must not contain password, got %q", uri)
	}
	if !strings.Contains(uri, "admin@") {
		t.Fatalf("uri should keep username, got %q", uri)
	}
	found := false
	for _, item := range env {
		if item == "MONGODB_PASSWORD=s3cret" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected MONGODB_PASSWORD in env")
	}
}

func TestCLIToolURIWithoutPasswordStripsAuthSource(t *testing.T) {
	// 连接表单默认 auth_database=admin；无密码时不得写入 authSource，否则 mongo-tools 会空凭据 SCRAM。
	uri, _, err := CLIToolURI(ConnectParams{
		HostAddress:  "192.168.1.120",
		PortNumber:   28729,
		LoginAccount: "",
		Secret:       "",
		Options:      ConnectOptions{AuthDatabase: "admin"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(uri, "authSource=") {
		t.Fatalf("authSource must be omitted without credentials, got %q", uri)
	}
	if strings.Contains(uri, "@") {
		t.Fatalf("userinfo must be omitted without credentials, got %q", uri)
	}
	if !strings.Contains(uri, "192.168.1.120:28729") {
		t.Fatalf("expected host in uri, got %q", uri)
	}
}

func TestCLIToolURIWithoutPasswordStripsUsername(t *testing.T) {
	uri, _, err := CLIToolURI(ConnectParams{
		HostAddress:  "127.0.0.1",
		PortNumber:   27017,
		LoginAccount: "admin",
		Secret:       "",
		Options:      ConnectOptions{AuthDatabase: "admin"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(uri, "admin") || strings.Contains(uri, "authSource=") {
		t.Fatalf("expected anonymous uri, got %q", uri)
	}
}

func TestCLIToolURIWithPasswordIncludesCredentials(t *testing.T) {
	uri, _, err := CLIToolURI(ConnectParams{
		HostAddress:  "192.168.1.120",
		PortNumber:   28729,
		LoginAccount: "mongoAdmin",
		Secret:       "p@ss/word",
		Options:      ConnectOptions{AuthDatabase: "admin"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(uri, "mongoAdmin:") {
		t.Fatalf("expected username in uri, got %q", uri)
	}
	if !strings.Contains(uri, "authSource=admin") {
		t.Fatalf("expected authSource=admin, got %q", uri)
	}
	if strings.Contains(uri, "p@ss/word") {
		t.Fatalf("password must be URL-encoded, got %q", uri)
	}
}

func TestCLIToolURIPasswordRequiresUsername(t *testing.T) {
	_, _, err := CLIToolURI(ConnectParams{
		HostAddress: "127.0.0.1",
		Secret:      "s3cret",
	})
	if err == nil {
		t.Fatal("expected error when password set without username")
	}
}

func TestMongoToolArgs(t *testing.T) {
	dump := MongodumpArgs("mongodb://127.0.0.1:27017/", "app", "/tmp/out", nil)
	if dump[0] != "--uri=mongodb://127.0.0.1:27017/" {
		t.Fatalf("unexpected dump uri arg: %#v", dump)
	}
	if !containsPair(dump, "--db", "app") {
		t.Fatalf("expected --db app, got %#v", dump)
	}
}

func containsPair(args []string, key, value string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == key && args[i+1] == value {
			return true
		}
	}
	return false
}
