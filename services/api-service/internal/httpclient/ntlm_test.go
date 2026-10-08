package httpclient

import (
	"encoding/hex"
	"testing"
)

func TestMD4AndNTOWFv2(t *testing.T) {
	empty := md4Sum(nil)
	if hex.EncodeToString(empty[:]) != "31d6cfe0d16ae931b73c59d7e0c089c0" {
		t.Fatalf("md4 empty %x", empty)
	}
	abc := md4Sum([]byte("abc"))
	if hex.EncodeToString(abc[:]) != "a448017aaf21d8525fc10ae87aa6729d" {
		t.Fatalf("md4 abc %x", abc)
	}
	got := hex.EncodeToString(NTOWFv2("User", "Password", "Domain"))
	if got != "0c868a403bfd7a93a3001ef22ef02e3f" {
		t.Fatalf("ntowfv2 %s", got)
	}
}
