package http11

import (
	"bytes"
	"strconv"
	"strings"
)

// Framer 从 TCP 字节流取出一条完整 HTTP 响应，并写成已解码报文。
type Framer struct {
	buf    []byte
	method string
}

// NewFramer 创建响应切帧器。method 为 HEAD 时响应没有正文。
func NewFramer(method string) *Framer {
	return &Framer{method: method}
}

// Push 追加读取到的字节。凑齐一条响应时返回已解码报文。
func (f *Framer) Push(chunk []byte) ([][]byte, error) {
	f.buf = append(f.buf, chunk...)
	return f.pull(false)
}

// Flush 在连接关闭时把仅靠关闭定界的正文收成一条响应。
func (f *Framer) Flush() ([][]byte, error) {
	return f.pull(true)
}

func (f *Framer) pull(closed bool) ([][]byte, error) {
	var frames [][]byte
	for len(f.buf) > 0 {
		msg, rest, done, err := ParseResponse(f.buf, f.method)
		if err != nil {
			return frames, err
		}
		if done {
			frames = append(frames, msg.Bytes())
			f.buf = append([]byte(nil), rest...)
			continue
		}
		if !closed {
			return frames, nil
		}
		finished, ok := finishOnClose(f.buf, f.method)
		f.buf = nil
		if ok {
			frames = append(frames, finished.Bytes())
		}
		return frames, nil
	}
	return frames, nil
}

func finishOnClose(raw []byte, method string) (*Response, bool) {
	sep, sepLen := headerBreak(raw)
	if sep < 0 {
		return nil, false
	}
	head := strings.ToLower(string(raw[:sep]))
	if strings.Contains(head, "\ntransfer-encoding:") || strings.Contains(head, "\ncontent-length:") {
		return nil, false
	}
	body := raw[sep+sepLen:]
	patched := make([]byte, 0, len(raw)+32)
	patched = append(patched, raw[:sep]...)
	patched = append(patched, []byte("\r\nContent-Length: "+strconv.Itoa(len(body))+"\r\n\r\n")...)
	patched = append(patched, body...)
	msg, _, done, err := ParseResponse(patched, method)
	if err != nil || !done {
		return nil, false
	}
	return msg, true
}

func headerBreak(raw []byte) (int, int) {
	if i := bytes.Index(raw, []byte("\r\n\r\n")); i >= 0 {
		return i, 4
	}
	if i := bytes.Index(raw, []byte("\n\n")); i >= 0 {
		return i, 2
	}
	return -1, 0
}
