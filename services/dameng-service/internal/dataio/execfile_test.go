package dataio

import (
	"errors"
	"testing"
)

func TestIsBenignDropMissingError(t *testing.T) {
	err2106 := errors.New("Error -2106: 第1行附近出现错误：无效的表或视图名[DOC_ASN_DETAILS]")
	cases := []struct {
		name string
		sql  string
		err  error
		want bool
	}{
		{
			name: "drop table missing",
			sql:  `DROP TABLE "DOC_ASN_DETAILS"`,
			err:  err2106,
			want: true,
		},
		{
			name: "drop view missing",
			sql:  `DROP VIEW IF EXISTS "V1"`,
			err:  errors.New("invalid table or view name"),
			want: true,
		},
		{
			name: "insert missing not benign",
			sql:  `INSERT INTO "DOC_ASN_DETAILS" VALUES (1)`,
			err:  err2106,
			want: false,
		},
		{
			name: "drop other error",
			sql:  `DROP TABLE "T"`,
			err:  errors.New("Error -6407: 权限不足"),
			want: false,
		},
		{
			name: "nil error",
			sql:  `DROP TABLE "T"`,
			err:  nil,
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isBenignDropMissingError(tc.sql, tc.err)
			if got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestDropStatementIfExists(t *testing.T) {
	got := dropStatement("table", `"DOC_ASN_DETAILS"`)
	want := "DROP TABLE IF EXISTS \"DOC_ASN_DETAILS\";\n"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	got = dropStatement("sequence", `"S1"`)
	want = "DROP SEQUENCE IF EXISTS \"S1\";\n"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
