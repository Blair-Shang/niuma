package tools

import (
	"bufio"
	"bytes"
	"io"
	"strings"
)

const (
	// stripGtidClassifyMax 行首分类上限：mysqldump 的 GTID/SQL_LOG_BIN 关键字都在行头附近。
	stripGtidClassifyMax = 4 * 1024
)

type stripGtidMode int

const (
	stripModeLineStart stripGtidMode = iota
	stripModePass
	stripModeSkip
	stripModeSkipNL
)

// stripGtidReader 过滤 mysqldump 写入的 GTID / SQL_LOG_BIN 相关语句。
// 流式转发：绝不把整条超长 INSERT 读进内存，避免还原假死与内存暴涨。
type stripGtidReader struct {
	br      *bufio.Reader
	pending []byte
	mode    stripGtidMode
	err     error
}

func newStripGtidReader(r io.Reader) *stripGtidReader {
	return &stripGtidReader{
		br:   bufio.NewReaderSize(r, 256*1024),
		mode: stripModeLineStart,
	}
}

func (s *stripGtidReader) Read(p []byte) (int, error) {
	for len(s.pending) == 0 {
		if s.err != nil {
			return 0, s.err
		}
		if err := s.fill(); err != nil {
			if err == io.EOF && len(s.pending) == 0 {
				s.err = io.EOF
				return 0, io.EOF
			}
			if err != io.EOF {
				s.err = err
				return 0, err
			}
			// EOF 但还有 pending，先吐出
		}
		if len(s.pending) == 0 && s.err == io.EOF {
			return 0, io.EOF
		}
	}

	n := copy(p, s.pending)
	s.pending = s.pending[n:]
	return n, nil
}

func (s *stripGtidReader) fill() error {
	switch s.mode {
	case stripModeSkip:
		return s.fillSkip(false)
	case stripModeSkipNL:
		return s.fillSkip(true)
	case stripModePass:
		return s.fillPass()
	default:
		return s.fillLineStart()
	}
}

func (s *stripGtidReader) fillLineStart() error {
	head, err := readLinePrefix(s.br, stripGtidClassifyMax)
	if len(head) == 0 {
		return err
	}

	trimmed := bytes.TrimSpace(head)
	upper := strings.ToUpper(string(trimmed))
	if shouldStripGtidLine(upper) {
		if bytes.Contains(head, []byte{';'}) {
			if bytes.IndexByte(head, '\n') >= 0 {
				s.mode = stripModeLineStart
			} else {
				// 已丢掉含 ';' 的前缀，继续丢掉同行剩余
				s.mode = stripModeSkipNL
			}
		} else {
			s.mode = stripModeSkip
		}
		if err == io.EOF {
			return io.EOF
		}
		return nil
	}

	s.pending = head
	if bytes.IndexByte(head, '\n') >= 0 {
		s.mode = stripModeLineStart
	} else {
		s.mode = stripModePass
	}
	if err == io.EOF {
		return io.EOF
	}
	return nil
}

func (s *stripGtidReader) fillPass() error {
	fragment, err := s.br.ReadSlice('\n')
	if len(fragment) > 0 {
		s.pending = append([]byte(nil), fragment...)
		if bytes.IndexByte(fragment, '\n') >= 0 {
			s.mode = stripModeLineStart
		} else {
			s.mode = stripModePass
		}
	}
	if err == bufio.ErrBufferFull {
		return nil
	}
	return err
}

// fillSkip 丢弃字节：toNL=false 时丢到 ';'，之后改丢到 '\n'；toNL=true 时只丢到 '\n'。
func (s *stripGtidReader) fillSkip(toNL bool) error {
	delim := byte(';')
	if toNL {
		delim = '\n'
	}
	for {
		fragment, err := s.br.ReadSlice(delim)
		if err == bufio.ErrBufferFull {
			// 超长片段无分隔符，直接丢弃继续
			continue
		}
		if bytes.IndexByte(fragment, delim) >= 0 {
			if toNL || delim == '\n' {
				s.mode = stripModeLineStart
			} else {
				// 刚遇到 ';'，同行可能还有残余，丢到换行
				s.mode = stripModeSkipNL
			}
			if err == io.EOF {
				return io.EOF
			}
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// readLinePrefix 读取行首前缀，遇到 '\n' / ';' 或达到 max 即停（不含无限攒行）。
func readLinePrefix(br *bufio.Reader, max int) ([]byte, error) {
	if max <= 0 {
		max = stripGtidClassifyMax
	}
	var out []byte
	for len(out) < max {
		b, err := br.ReadByte()
		if err != nil {
			if err == io.EOF {
				if len(out) == 0 {
					return nil, io.EOF
				}
				return out, io.EOF
			}
			return out, err
		}
		out = append(out, b)
		if b == '\n' || b == ';' {
			return out, nil
		}
	}
	return out, nil
}

func shouldStripGtidLine(upperTrimmed string) bool {
	if upperTrimmed == "" {
		return false
	}
	// 仅剥离 mysqldump 注入的会话/GTID 控制语句，不碰普通 DDL/DML。
	// 兼容 `SET ...` 与 `/*!50003 SET ...*/` 两种写法。
	isSet := strings.HasPrefix(upperTrimmed, "SET ") ||
		strings.Contains(upperTrimmed, " SET ")
	if !isSet {
		return false
	}
	return strings.Contains(upperTrimmed, "GTID_PURGED") ||
		strings.Contains(upperTrimmed, "MYSQLDUMP_TEMP_LOG_BIN") ||
		strings.Contains(upperTrimmed, "@@SESSION.SQL_LOG_BIN")
}
