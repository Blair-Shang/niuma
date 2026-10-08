package httpclient

import "testing"

func TestGrpcFrameRoundTrip(t *testing.T) {
	frame := frameGrpc([]byte(`{"name":"a"}`))
	if frame[0] != 0 {
		t.Fatal("compressed flag")
	}
	if string(unframeGrpc(frame)) != `{"name":"a"}` {
		t.Fatalf("body %s", unframeGrpc(frame))
	}
}
