package session

import "testing"

func TestPortOrDefault(t *testing.T) {
	p := ConnectParams{PortNumber: 0}
	if p.PortOrDefault() != DefaultPort || DefaultPort != 5432 {
		t.Fatalf("port=%d want 5432", p.PortOrDefault())
	}
	p.PortNumber = 15432
	if p.PortOrDefault() != 15432 {
		t.Fatalf("port=%d", p.PortOrDefault())
	}
}

func TestDatabaseOrDefault(t *testing.T) {
	var o ConnectOptions
	if o.DatabaseOrDefault() != "postgres" {
		t.Fatalf("db=%q", o.DatabaseOrDefault())
	}
	o.Database = "mydb"
	if o.DatabaseOrDefault() != "mydb" {
		t.Fatalf("db=%q", o.DatabaseOrDefault())
	}
}
