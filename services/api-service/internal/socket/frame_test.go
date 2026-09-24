package socket

import (
	"bytes"
	"testing"
)

func TestDelimiterFrames(t *testing.T) {
	t.Parallel()
	f := newStreamFramer(FrameSpec{Mode: FrameDelimiter, Delimiter: []byte("\r\n")})
	frames, err := f.Push([]byte("ping\r\npo"))
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) != 1 || string(frames[0]) != "ping\r\n" {
		t.Fatalf("frames = %q", frames)
	}
	more, err := f.Push([]byte("ng\r\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(more) != 1 || string(more[0]) != "pong\r\n" {
		t.Fatalf("more = %q", more)
	}
}

func TestModbusTCPLengthAcrossReads(t *testing.T) {
	t.Parallel()
	// MBAP: 事务 2 + 协议 2 + 长度 2。长度值是其后的字节数。总长 = 6 + length。
	f := newStreamFramer(FrameSpec{
		Mode:         FrameLength,
		LengthOffset: 4,
		LengthSize:   2,
	})
	head := []byte{0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x01, 0x03}
	frames, err := f.Push(head)
	if err != nil || len(frames) != 0 {
		t.Fatalf("partial frames=%d err=%v", len(frames), err)
	}
	rest := []byte{0x00, 0x00, 0x00, 0x0a}
	frames, err = f.Push(rest)
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) != 1 || len(frames[0]) != 12 {
		t.Fatalf("frame len = %d count %d", len(frames[0]), len(frames))
	}
}

func TestTwoLengthFramesInOneRead(t *testing.T) {
	t.Parallel()
	f := newStreamFramer(FrameSpec{Mode: FrameLength, LengthOffset: 0, LengthSize: 1})
	// 1 字节长度值 1，总长 = 0 + 1 + 1 = 2。两帧：01 aa | 01 cc
	raw := []byte{0x01, 0xaa, 0x01, 0xcc}
	frames, err := f.Push(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) != 2 || string(frames[0]) != "\x01\xaa" || string(frames[1]) != "\x01\xcc" {
		t.Fatalf("frames = %x", frames)
	}
}

func TestDelimiterExtractsFrameBeforeOverflow(t *testing.T) {
	t.Parallel()
	f := newStreamFramer(FrameSpec{Mode: FrameDelimiter, Delimiter: []byte("\n")})
	chunk := append(append(make([]byte, MaxPayload-1), '\n'), 'x')
	frames, err := f.Push(chunk)
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) != 1 || len(frames[0]) != MaxPayload {
		t.Fatalf("frame len=%d count=%d", len(frames[0]), len(frames))
	}
	if _, err := f.Push(bytes.Repeat([]byte{'y'}, MaxPayload)); err == nil {
		t.Fatal("expected overflow after the completed frame")
	}
}

func TestLengthRejectsOversized(t *testing.T) {
	t.Parallel()
	f := newStreamFramer(FrameSpec{Mode: FrameLength, LengthOffset: 0, LengthSize: 4})
	_, err := f.Push([]byte{0x00, 0x20, 0x00, 0x00})
	if err == nil {
		t.Fatal("expected oversized length error")
	}
}
