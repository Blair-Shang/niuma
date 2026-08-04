// Package protocol 定义 Layer-1 能力服务与 Platform 之间的应用 IPC 报文分帧。
//
// 过渡期传输为 Windows 命名管道（非 Windows 用 Unix Domain Socket），
// 分帧格式为：4 字节小端长度前缀 + UTF-8 JSON 载荷。各语言实现须与此契约对齐
// （见 docs/13-service-layout.md）。
package protocol

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

const headerSize = 4

// MaxFrameSize 限制单帧 JSON 载荷的最大字节数。
// 桌面工具查询页可能含大字段，故放宽到 1 GiB（仍低于 uint32 协议上限）。
const MaxFrameSize = 1 << 30 // 1 GiB

// ErrFrameTooLarge 表示对端声明的帧长度超过 MaxFrameSize。
var ErrFrameTooLarge = errors.New("serviceipc: frame exceeds max size")

// ReadFrame 从 r 读取一帧并返回其 JSON 载荷。
func ReadFrame(r io.Reader) ([]byte, error) {
	var header [headerSize]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return nil, err
	}

	n := binary.LittleEndian.Uint32(header[:])
	if n > MaxFrameSize {
		return nil, fmt.Errorf("%w: %d bytes", ErrFrameTooLarge, n)
	}
	if n == 0 {
		return []byte{}, nil
	}

	payload := make([]byte, n)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

// WriteFrame 把 payload 作为一帧写入 w。
func WriteFrame(w io.Writer, payload []byte) error {
	if len(payload) > MaxFrameSize {
		return fmt.Errorf("%w: %d bytes", ErrFrameTooLarge, len(payload))
	}

	var header [headerSize]byte
	binary.LittleEndian.PutUint32(header[:], uint32(len(payload)))
	if _, err := w.Write(header[:]); err != nil {
		return fmt.Errorf("serviceipc: write header: %w", err)
	}
	if _, err := w.Write(payload); err != nil {
		return fmt.Errorf("serviceipc: write payload: %w", err)
	}
	return nil
}
