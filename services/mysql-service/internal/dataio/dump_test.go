package dataio

import (
	"strings"
	"testing"
)

func TestStripDatabaseQualifier(t *testing.T) {
	t.Parallel()

	got := stripDatabaseQualifier(
		"CREATE TABLE `biz` (\n  `id` int\n);\nINSERT INTO `test1`.`biz` VALUES (1);\nSELECT * FROM `test1`.`other`",
		"test1",
	)
	want := "CREATE TABLE `biz` (\n  `id` int\n);\nINSERT INTO `biz` VALUES (1);\nSELECT * FROM `other`"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}

	// 字符串字面量中的 test1. 不应被改写（无反引号包裹库名）
	lit := "INSERT INTO `t` VALUES ('test1.biz')"
	if stripDatabaseQualifier(lit, "test1") != lit {
		t.Fatal("must not rewrite string literals")
	}

	if stripDatabaseQualifier("SELECT 1", "") != "SELECT 1" {
		t.Fatal("empty database")
	}
}

func TestMysqlValueLiteralEscapes(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   interface{}
		want string
	}{
		{nil, "NULL"},
		{int64(42), "42"},
		{true, "1"},
		{false, "0"},
		{"a'b\\c", `'a\'b\\c'`},
		{[]byte("x\ny\x00z"), `'x\ny\0z'`},
	}
	for _, tc := range cases {
		if got := mysqlValueLiteral(tc.in); got != tc.want {
			t.Fatalf("mysqlValueLiteral(%v)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestWriteMysqlQuotedBytesKeepsUTF8(t *testing.T) {
	t.Parallel()
	raw := []byte("你好\n世界")
	var b strings.Builder
	writeMysqlQuotedBytes(&b, raw)
	got := b.String()
	want := "'你好\\n世界'"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
