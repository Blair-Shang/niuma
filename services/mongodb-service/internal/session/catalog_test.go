package session

import "testing"

func TestValidateDatabaseName(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{name: "ok", input: "mydb", wantErr: false},
		{name: "trim", input: "  shop  ", wantErr: false},
		{name: "empty", input: "  ", wantErr: true},
		{name: "dot", input: "my.db", wantErr: true},
		{name: "space", input: "my db", wantErr: true},
		{name: "dollar", input: "my$db", wantErr: true},
		{name: "slash", input: "my/db", wantErr: true},
		{name: "admin", input: "admin", wantErr: true},
		{name: "local", input: "local", wantErr: true},
		{name: "config", input: "config", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := ValidateDatabaseName(tc.input)
			if tc.wantErr && err == nil {
				t.Fatalf("expected error for %q", tc.input)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.input, err)
			}
		})
	}
}

func TestValidateCollectionName(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{name: "ok", input: "users", wantErr: false},
		{name: "dotted", input: "user.profile", wantErr: false},
		{name: "empty", input: "", wantErr: true},
		{name: "system", input: "system.profile", wantErr: true},
		{name: "dollar", input: "foo$bar", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := ValidateCollectionName(tc.input)
			if tc.wantErr && err == nil {
				t.Fatalf("expected error for %q", tc.input)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.input, err)
			}
		})
	}
}

func TestIsProtectedDatabase(t *testing.T) {
	t.Parallel()
	if !IsProtectedDatabase("admin") || !IsProtectedDatabase(" local ") {
		t.Fatal("expected admin/local to be protected")
	}
	if IsProtectedDatabase("shop") {
		t.Fatal("shop should not be protected")
	}
}
