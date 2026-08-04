// Package protocol 定义 Shell（C++）与 Platform（Go）之间应用 IPC 的报文分帧。
//
// 过渡期传输为 Windows 命名管道（非 Windows 用 Unix Domain Socket），
// 分帧格式为：4 字节小端长度前缀 + UTF-8 JSON 载荷。长度前缀描述其后 JSON
// 字节数（不含前缀自身）。未来升级为 gRPC 后本包可整体退役。
package protocol

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// headerSize 是长度前缀的字节数（uint32 小端）。
const headerSize = 4

// MaxFrameSize 限制单帧 JSON 载荷的最大字节数，防止异常长度前缀触发超大分配。
// 桌面工具查询页可能含大字段，故放宽到 1 GiB（仍低于 uint32 协议上限）。
const MaxFrameSize = 1 << 30 // 1 GiB

// ErrFrameTooLarge 表示对端声明的帧长度超过 MaxFrameSize。
var ErrFrameTooLarge = errors.New("protocol: frame exceeds max size")

// ReadFrame 从 r 读取一帧并返回其 JSON 载荷。
//
// r 通常为一个已连接的管道/套接字。当对端关闭连接时返回 io.EOF，调用方据此
// 结束该连接的读取循环。
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

// WriteFrame 把 payload 作为一帧写入 w（先写 4 字节小端长度，再写载荷）。
//
// payload 应为 UTF-8 JSON 字节。超过 MaxFrameSize 时返回 ErrFrameTooLarge。
func WriteFrame(w io.Writer, payload []byte) error {
	if len(payload) > MaxFrameSize {
		return fmt.Errorf("%w: %d bytes", ErrFrameTooLarge, len(payload))
	}

	var header [headerSize]byte
	binary.LittleEndian.PutUint32(header[:], uint32(len(payload)))
	if _, err := w.Write(header[:]); err != nil {
		return fmt.Errorf("protocol: write header: %w", err)
	}
	if _, err := w.Write(payload); err != nil {
		return fmt.Errorf("protocol: write payload: %w", err)
	}
	return nil
}
