package meta

import "testing"

func TestStripOracleScriptTerminator(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "function with trailing slash",
			in:   "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$\nBEGIN\n  NULL;\nEND;\n$$ LANGUAGE plpgsql;\n/",
			want: "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$\nBEGIN\n  NULL;\nEND;\n$$ LANGUAGE plpgsql;",
		},
		{
			name: "trailing slash with spaces",
			in:   "CREATE VIEW v AS SELECT 1;\n  /  \n",
			want: "CREATE VIEW v AS SELECT 1;",
		},
		{
			name: "no terminator",
			in:   "CREATE VIEW v AS SELECT 1;",
			want: "CREATE VIEW v AS SELECT 1;",
		},
		{
			name: "slash in body kept",
			in:   "SELECT 1 / 2;",
			want: "SELECT 1 / 2;",
		},
		{
			name: "empty",
			in:   "",
			want: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := stripOracleScriptTerminator(tc.in)
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
