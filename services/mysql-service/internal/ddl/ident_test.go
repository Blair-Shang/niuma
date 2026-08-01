package ddl

import "testing"

func TestFormatDefaultExpr(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"ss", "'ss'"},
		{"'ss'", "'ss'"},
		{"NULL", "NULL"},
		{"null", "null"},
		{"CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP"},
		{"CURRENT_TIMESTAMP(6)", "CURRENT_TIMESTAMP(6)"},
		{"NOW()", "NOW()"},
		{"12", "12"},
		{"-3.5", "-3.5"},
		{"(uuid())", "(uuid())"},
		{"it's", "'it''s'"},
	}
	for _, c := range cases {
		got := FormatDefaultExpr(c.in)
		if got != c.want {
			t.Fatalf("FormatDefaultExpr(%q)=%q want %q", c.in, got, c.want)
		}
	}
}
