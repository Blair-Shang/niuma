package socket

import (
	"bytes"
	"fmt"
)

// FrameMode 是 TCP 字节流的切帧方式。UDP 数据报本身就是一帧，不使用这里。
type FrameMode string

const (
	// FrameRaw 一次 Read 作为一条记录。
	FrameRaw FrameMode = "raw"
	// FrameDelimiter 攒到分隔符（含分隔符）才成一帧。
	FrameDelimiter FrameMode = "delimiter"
	// FrameLength 按长度字段切帧。总长度 = 字段偏移 + 字段宽度 + 字段值 + 调整量。
	FrameLength FrameMode = "length"
)

const (
	lengthUint8  = 1
	lengthUint16 = 2
	lengthUint32 = 4
	maxDelimiter = 8
)

// FrameSpec 描述如何从 TCP 流取出完整报文。
type FrameSpec struct {
	Mode         FrameMode
	Delimiter    []byte
	LengthOffset int
	LengthSize   int
	LittleEndian bool
	// LengthAdjust 加在「偏移 + 字段宽 + 字段值」之后。Modbus TCP 为 0（总长 = 6 + length）。
	LengthAdjust int
}

// streamFramer 在一条连接上保留未凑齐的尾部。
type streamFramer struct {
	spec FrameSpec
	buf  []byte
}

func newStreamFramer(spec FrameSpec) *streamFramer {
	if spec.Mode == "" {
		spec.Mode = FrameRaw
	}
	return &streamFramer{spec: spec}
}

// Push 吃进一段 Read，返回已经凑齐的帧。尾部留在缓冲里。
func (f *streamFramer) Push(chunk []byte) ([][]byte, error) {
	if len(chunk) == 0 {
		return nil, nil
	}
	if f.spec.Mode == FrameRaw {
		out := make([]byte, len(chunk))
		copy(out, chunk)
		return [][]byte{out}, nil
	}
	f.buf = append(f.buf, chunk...)
	var frames [][]byte
	for {
		frame, err := f.pull()
		if err != nil {
			return frames, err
		}
		if frame == nil {
			return frames, nil
		}
		frames = append(frames, frame)
	}
}

func (f *streamFramer) pull() ([]byte, error) {
	switch f.spec.Mode {
	case FrameDelimiter:
		return f.pullDelimiter()
	case FrameLength:
		return f.pullLength()
	default:
		return nil, fmt.Errorf("api: unknown frame mode %q", f.spec.Mode)
	}
}

func (f *streamFramer) pullDelimiter() ([]byte, error) {
	idx := bytes.Index(f.buf, f.spec.Delimiter)
	if idx >= 0 {
		n := idx + len(f.spec.Delimiter)
		if n > MaxPayload {
			return nil, fmt.Errorf("api: delimiter frame exceeds %d bytes", MaxPayload)
		}
		frame := append([]byte(nil), f.buf[:n]...)
		f.buf = append([]byte(nil), f.buf[n:]...)
		return frame, nil
	}
	if len(f.buf) > MaxPayload {
		return nil, fmt.Errorf("api: delimiter frame exceeds %d bytes", MaxPayload)
	}
	return nil, nil
}

func (f *streamFramer) pullLength() ([]byte, error) {
	need := f.spec.LengthOffset + f.spec.LengthSize
	if len(f.buf) < need {
		if len(f.buf) > MaxPayload {
			return nil, fmt.Errorf("api: length frame exceeds %d bytes", MaxPayload)
		}
		return nil, nil
	}
	value, err := readLength(f.buf[f.spec.LengthOffset:need], f.spec.LittleEndian)
	if err != nil {
		return nil, err
	}
	total64 := int64(need) + int64(value) + int64(f.spec.LengthAdjust)
	if total64 < int64(need) || total64 > MaxPayload {
		return nil, fmt.Errorf("api: invalid frame length %d", total64)
	}
	total := int(total64)
	if len(f.buf) < total {
		return nil, nil
	}
	frame := append([]byte(nil), f.buf[:total]...)
	f.buf = append([]byte(nil), f.buf[total:]...)
	return frame, nil
}

func readLength(raw []byte, little bool) (int, error) {
	var v uint32
	if little {
		for i, b := range raw {
			v |= uint32(b) << (8 * i)
		}
	} else {
		for _, b := range raw {
			v = (v << 8) | uint32(b)
		}
	}
	if v > MaxPayload {
		return 0, fmt.Errorf("api: invalid frame length %d", v)
	}
	return int(v), nil
}

func normalizeFrame(spec FrameSpec) (FrameSpec, error) {
	switch spec.Mode {
	case "", FrameRaw:
		spec.Mode = FrameRaw
		return spec, nil
	case FrameDelimiter:
		if len(spec.Delimiter) == 0 || len(spec.Delimiter) > maxDelimiter {
			return spec, fmt.Errorf("api: delimiter must be 1..%d bytes", maxDelimiter)
		}
		return spec, nil
	case FrameLength:
		switch spec.LengthSize {
		case lengthUint8, lengthUint16, lengthUint32:
		default:
			return spec, fmt.Errorf("api: lengthSize must be 1, 2, or 4")
		}
		if spec.LengthOffset < 0 || spec.LengthOffset > 64 {
			return spec, fmt.Errorf("api: lengthOffset out of range")
		}
		if spec.LengthAdjust < -64 || spec.LengthAdjust > MaxPayload {
			return spec, fmt.Errorf("api: lengthAdjust out of range")
		}
		return spec, nil
	default:
		return spec, fmt.Errorf("api: unknown frame mode %q", spec.Mode)
	}
}
