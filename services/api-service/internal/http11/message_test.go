package http11

import (
	"bytes"
	"compress/gzip"
	"strings"
	"testing"
)

func TestBuildRequestFillsRequiredFields(t *testing.T) {
	raw := BuildRequest("POST", "/echo", "example.com", 80, map[string]string{
		"Accept": "application/json",
		"X-Bad":  "a\r\nInjected: 1",
	}, nil)
	text := string(raw)
	if !strings.Contains(text, "POST /echo HTTP/1.1\r\n") {
		t.Fatalf("request line missing: %q", text)
	}
	if !strings.Contains(text, "Host: example.com\r\n") {
		t.Fatalf("host: %q", text)
	}
	if !strings.Contains(text, "Content-Length: 0\r\n") {
		t.Fatalf("empty POST length: %q", text)
	}
	if !strings.Contains(text, "User-Agent: "+UserAgent+"\r\n") {
		t.Fatalf("user-agent: %q", text)
	}
	if !strings.Contains(text, "Accept-Encoding: "+AcceptEncoding+"\r\n") {
		t.Fatalf("accept-encoding: %q", text)
	}
	if strings.Contains(text, "\r\nInjected:") {
		t.Fatalf("crlf survived: %q", text)
	}
}

func TestParseChunkedAndGzip(t *testing.T) {
	var compressed bytes.Buffer
	zw := gzip.NewWriter(&compressed)
	if _, err := zw.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	var chunked bytes.Buffer
	chunked.WriteString("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Encoding: gzip\r\n\r\n")
	chunked.WriteString(strings.ToUpper(hexLen(compressed.Len())))
	chunked.WriteString("\r\n")
	chunked.Write(compressed.Bytes())
	chunked.WriteString("\r\n0\r\n\r\n")

	msg, rest, done, err := ParseResponse(chunked.Bytes(), "GET")
	if err != nil || !done || len(rest) != 0 {
		t.Fatalf("done=%v rest=%d err=%v", done, len(rest), err)
	}
	if string(msg.Body) != "hello" {
		t.Fatalf("body = %q", msg.Body)
	}
	wire := string(msg.Bytes())
	if strings.Contains(strings.ToLower(wire), "transfer-encoding:") {
		t.Fatalf("chunked header kept: %q", wire)
	}
	if !strings.Contains(wire, "Content-Length: 5\r\n") {
		t.Fatalf("rewritten length: %q", wire)
	}
}

func TestFramerWaitsForContentLength(t *testing.T) {
	f := NewFramer("")
	frames, err := f.Push([]byte("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhel"))
	if err != nil || len(frames) != 0 {
		t.Fatalf("partial frames=%d err=%v", len(frames), err)
	}
	frames, err = f.Push([]byte("lo"))
	if err != nil || len(frames) != 1 || !bytes.Contains(frames[0], []byte("hello")) {
		t.Fatalf("frame=%q err=%v", frames, err)
	}
}

func TestFlushCloseDelimitedBody(t *testing.T) {
	f := NewFramer("")
	if _, err := f.Push([]byte("HTTP/1.1 200 OK\r\n\r\nbye")); err != nil {
		t.Fatal(err)
	}
	frames, err := f.Flush()
	if err != nil || len(frames) != 1 || !bytes.Contains(frames[0], []byte("bye")) {
		t.Fatalf("flush=%q err=%v", frames, err)
	}
}

func TestHeadHasNoBody(t *testing.T) {
	raw := []byte("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n")
	msg, _, done, err := ParseResponse(raw, "HEAD")
	if err != nil || !done || len(msg.Body) != 0 {
		t.Fatalf("done=%v body=%q err=%v", done, msg.Body, err)
	}
}

func hexLen(n int) string {
	const digits = "0123456789abcdef"
	if n == 0 {
		return "0"
	}
	var out []byte
	for n > 0 {
		out = append([]byte{digits[n%16]}, out...)
		n /= 16
	}
	return string(out)
}
