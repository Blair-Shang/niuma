package codec

import (
	"bytes"
	"testing"
)

func TestDecodeUTF8AndHex(t *testing.T) {
	t.Parallel()
	raw, err := Decode("ping", UTF8, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "ping" {
		t.Fatalf("utf8 = %q", raw)
	}
	raw, err = Decode("70 69:6e-67", Hex, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "ping" {
		t.Fatalf("hex = %q", raw)
	}
	raw, err = Decode("cGluZw==", Base64, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "ping" {
		t.Fatalf("base64 = %q", raw)
	}
}

func TestDecodeAutoPicksHexOrUTF8(t *testing.T) {
	t.Parallel()
	raw, err := Decode("70 69 6e 67", Auto, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "ping" {
		t.Fatalf("auto hex = %q", raw)
	}
	raw, err = Decode("dfsfs", Auto, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "dfsfs" {
		t.Fatalf("auto text = %q", raw)
	}
}

func TestDecodeRejectsOversizeAndBadHex(t *testing.T) {
	t.Parallel()
	if _, err := Decode("abcdef", UTF8, 4); err == nil {
		t.Fatal("expected oversize error")
	}
	if _, err := Decode("xyz", Hex, 1024); err == nil {
		t.Fatal("expected bad hex")
	}
	if _, err := Decode("abc", Hex, 1024); err == nil {
		t.Fatal("expected odd hex length")
	}
}

func TestInspectPrefersUTF8(t *testing.T) {
	t.Parallel()
	view := Inspect([]byte("hi"), UTF8)
	if view.Data != "hi" || view.Hex != "6869" || view.Encoding != UTF8 || view.Bytes != 2 {
		t.Fatalf("view = %+v", view)
	}
	bin := []byte{0xff, 0xfe}
	view = Inspect(bin, UTF8)
	if view.Data != "" || view.Encoding != Hex || !bytes.Equal(mustHex(view.Hex), bin) {
		t.Fatalf("binary view = %+v", view)
	}
}

func mustHex(s string) []byte {
	raw, err := Decode(s, Hex, 0)
	if err != nil {
		panic(err)
	}
	return raw
}
