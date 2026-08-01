package dataio

import "testing"

func TestResolveImportFormat(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want ImportFormat
	}{
		{"", FormatCSV},
		{"csv", FormatCSV},
		{"tsv", FormatTSV},
		{"JSONEachRow", FormatJSONEachRow},
		{"parquet", FormatParquet},
	}
	for _, tc := range cases {
		got := resolveImportFormat(CsvOptions{Format: tc.in})
		if got != tc.want {
			t.Fatalf("format %q: got %s want %s", tc.in, got, tc.want)
		}
	}
}

func TestClickHouseFormatName(t *testing.T) {
	t.Parallel()
	if got := clickHouseFormatName(CsvOptions{Format: "csv", Header: true}); got != "CSVWithNames" {
		t.Fatalf("got %s", got)
	}
	if got := clickHouseFormatName(CsvOptions{Format: "tsv", Header: false}); got != "TabSeparated" {
		t.Fatalf("got %s", got)
	}
	if got := clickHouseFormatName(CsvOptions{Format: "json_each_row"}); got != "JSONEachRow" {
		t.Fatalf("got %s", got)
	}
}

func TestNeedsBatchColumnMap(t *testing.T) {
	t.Parallel()
	if needsBatchColumnMap(CsvOptions{}) {
		t.Fatal("empty map should use format path")
	}
	if !needsBatchColumnMap(CsvOptions{ColumnMap: map[string]string{"a": "b"}}) {
		t.Fatal("custom map should use batch path")
	}
}

func TestBuildFormatSettings(t *testing.T) {
	t.Parallel()
	s := buildFormatSettings(CsvOptions{
		Format:    "csv",
		Delimiter: ";",
		SkipRows:  2,
		MaxErrors: 10,
		NullString: "\\N",
	})
	for _, part := range []string{
		"input_format_skip_unknown_fields=1",
		"input_format_allow_errors_num=10",
		"input_format_csv_skip_first_lines=2",
		"format_csv_delimiter=';'",
		"format_csv_null_representation='\\N'",
	} {
		if !containsSub(s, part) {
			t.Fatalf("settings %q missing %q", s, part)
		}
	}
}

func containsSub(s, part string) bool {
	return len(s) >= len(part) && (s == part || len(part) == 0 ||
		(len(s) > 0 && (func() bool {
			for i := 0; i+len(part) <= len(s); i++ {
				if s[i:i+len(part)] == part {
					return true
				}
			}
			return false
		})()))
}
