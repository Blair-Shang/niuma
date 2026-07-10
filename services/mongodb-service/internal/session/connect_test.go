package session

import (
	"strings"
	"testing"
)

func TestBuildURI_standalone(t *testing.T) {
	uri, err := buildURI(ConnectParams{
		HostAddress:  "127.0.0.1",
		PortNumber:   27017,
		LoginAccount: "admin",
		Secret:       "secret",
		Options: ConnectOptions{
			AuthDatabase: "admin",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(uri, "mongodb://") {
		t.Fatalf("expected mongodb:// prefix, got %q", uri)
	}
	if !strings.Contains(uri, "127.0.0.1:27017") {
		t.Fatalf("expected host:port in uri, got %q", uri)
	}
	if !strings.Contains(uri, "authSource=admin") {
		t.Fatalf("expected authSource, got %q", uri)
	}
}

func TestBuildURI_srv(t *testing.T) {
	uri, err := buildURI(ConnectParams{
		HostAddress: "cluster.example.com",
		Options: ConnectOptions{
			SrvRecord: true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(uri, "mongodb+srv://") {
		t.Fatalf("expected mongodb+srv:// prefix, got %q", uri)
	}
	if strings.Contains(uri, ":27017") {
		t.Fatalf("srv uri should not include explicit port, got %q", uri)
	}
}

func TestPortOrDefault(t *testing.T) {
	p := ConnectParams{PortNumber: 0}
	if p.portOrDefault() != DefaultPort {
		t.Fatalf("expected default port %d, got %d", DefaultPort, p.portOrDefault())
	}
}
