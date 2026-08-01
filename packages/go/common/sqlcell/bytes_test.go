package sqlcell

import (
	"encoding/base64"
	"testing"
)

func TestDecodeTextBytes_Chinese(t *testing.T) {
	s, ok := DecodeTextBytes([]byte("管理员001"))
	if !ok || s != "管理员001" {
		t.Fatalf("got %q ok=%v", s, ok)
	}
}

func TestEncodeTextColumnBytes_Chinese(t *testing.T) {
	got := EncodeTextColumnBytes([]byte("刘经理"))
	if got != "刘经理" {
		t.Fatalf("got %#v", got)
	}
}

func TestEncodeTextColumnBytes_InvalidUTF8(t *testing.T) {
	raw := []byte{0xff, 0xfe}
	got := EncodeTextColumnBytes(raw)
	m, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %#v", got)
	}
	if m["$binary"] != base64.StdEncoding.EncodeToString(raw) {
		t.Fatalf("unexpected envelope %#v", m)
	}
}

func TestIsMostlyPrintable_Chinese(t *testing.T) {
	if !IsMostlyPrintable([]byte("刘经理")) {
		t.Fatal("Chinese UTF-8 should be mostly printable")
	}
	if !IsMostlyPrintable([]byte("DATAHUB")) {
		t.Fatal("ASCII should be mostly printable")
	}
	if IsMostlyPrintable([]byte{0x00, 0x01, 0xff, 0xfe}) {
		t.Fatal("binary garbage should not be mostly printable")
	}
}

func TestEncodeBytesAsTextOrBinary(t *testing.T) {
	if got := EncodeBytesAsTextOrBinary([]byte("你好")); got != "你好" {
		t.Fatalf("text: %#v", got)
	}
	raw := []byte{0x00, 0x01, 0x02}
	got := EncodeBytesAsTextOrBinary(raw)
	if _, ok := got.(map[string]any); !ok {
		t.Fatalf("binary: %#v", got)
	}
}

func TestIsMysqlTextKind(t *testing.T) {
	if !IsMysqlTextKind("VARCHAR") || !IsMysqlTextKind("text") {
		t.Fatal("expected text kinds")
	}
	if IsMysqlTextKind("BLOB") || IsMysqlTextKind("INT") {
		t.Fatal("unexpected text kinds")
	}
}
