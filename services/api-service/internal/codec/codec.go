// Package codec 编解码套接字载荷（UTF-8 / 十六进制 / Base64）。
//
// 对齐 Packet Sender、Hercules 等工具：发送按用户选择的编码解码；
// 接收始终附带 hex，文本仅在合法 UTF-8 时给出。
package codec

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Encoding 是载荷编解码方式。
type Encoding string

const (
	// Auto 按载荷外形选择 hex 或 utf8，前端可把识别交给本包。
	Auto Encoding = "auto"
	// UTF8 按 UTF-8 文本处理。
	UTF8 Encoding = "utf8"
	// Hex 按十六进制字节处理（允许空格、冒号、0x 前缀）。
	Hex Encoding = "hex"
	// Base64 按标准 Base64 处理。
	Base64 Encoding = "base64"
)

// Normalize 把用户输入归一成已知编码；空值视为 auto。
func Normalize(raw string) Encoding {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "auto", "detect":
		return Auto
	case "utf8", "utf-8", "ascii", "text":
		return UTF8
	case "hex", "hexadecimal":
		return Hex
	case "base64", "b64":
		return Base64
	default:
		return Encoding(strings.ToLower(strings.TrimSpace(raw)))
	}
}

// Detect 根据载荷外形选择编码：成对十六进制走 hex，否则 utf8。
func Detect(data string) Encoding {
	if looksLikeHexPayload(data) {
		return Hex
	}
	return UTF8
}

// Decode 按编码把字符串还原为字节。max 为载荷上限（字节）。
func Decode(data string, enc Encoding, max int) ([]byte, error) {
	enc = Normalize(string(enc))
	if enc == Auto {
		enc = Detect(data)
	}
	var raw []byte
	var err error
	switch enc {
	case UTF8:
		raw = []byte(data)
	case Hex:
		raw, err = decodeHex(data)
	case Base64:
		raw, err = base64.StdEncoding.DecodeString(strings.TrimSpace(data))
	default:
		return nil, fmt.Errorf("api: unknown encoding %q (auto|utf8|hex|base64)", enc)
	}
	if err != nil {
		return nil, fmt.Errorf("api: decode %s: %w", enc, err)
	}
	if max > 0 && len(raw) > max {
		return nil, fmt.Errorf("api: payload exceeds %d bytes", max)
	}
	return raw, nil
}

// View 是一次收发后的展示视图（文本 + 十六进制）。
type View struct {
	Data     string
	Hex      string
	Encoding Encoding
	Bytes    int
}

// Inspect 生成接收/发送日志视图：始终带 hex；合法 UTF-8 才填 Data。
func Inspect(raw []byte, pref Encoding) View {
	pref = Normalize(string(pref))
	if pref == Auto {
		pref = UTF8
	}
	view := View{
		Hex:      hex.EncodeToString(raw),
		Encoding: Hex,
		Bytes:    len(raw),
	}
	switch pref {
	case Base64:
		view.Data = base64.StdEncoding.EncodeToString(raw)
		view.Encoding = Base64
	case Hex:
		view.Data = view.Hex
		view.Encoding = Hex
	default:
		if utf8.Valid(raw) {
			view.Data = string(raw)
			view.Encoding = UTF8
		}
	}
	return view
}

func looksLikeHexPayload(data string) bool {
	cleaned, err := decodeHex(data)
	if err != nil {
		return false
	}
	return len(cleaned) > 0
}

func decodeHex(data string) ([]byte, error) {
	cleaned := strings.Builder{}
	cleaned.Grow(len(data))
	s := strings.TrimSpace(data)
	s = strings.TrimPrefix(s, "0x")
	s = strings.TrimPrefix(s, "0X")
	for _, r := range s {
		switch {
		case r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == ':' || r == '-':
			continue
		default:
			cleaned.WriteRune(r)
		}
	}
	out := cleaned.String()
	if len(out)%2 == 1 {
		return nil, fmt.Errorf("odd hex length")
	}
	return hex.DecodeString(out)
}
