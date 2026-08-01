package dataio

import (
	"bufio"
	"fmt"
	"io"
	"strings"
)

// ClickHouse TabSeparated 转义（与官方文档一致）：
// 输出最少需转义：tab、LF、反斜杠；另含常见控制字符。

const tsvDefaultNull = `\N`

func tsvNullToken(opts CsvOptions) string {
	if opts.NullString != "" {
		return opts.NullString
	}
	return tsvDefaultNull
}

func escapeTSVField(s string) string {
	if s == "" {
		return s
	}
	var b strings.Builder
	b.Grow(len(s) + 8)
	for i := 0; i < len(s); i++ {
		switch c := s[i]; c {
		case '\\':
			b.WriteString(`\\`)
		case '\t':
			b.WriteString(`\t`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case 0:
			b.WriteString(`\0`)
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

func unescapeTSVField(s string) string {
	if !strings.ContainsRune(s, '\\') {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' || i+1 >= len(s) {
			b.WriteByte(s[i])
			continue
		}
		i++
		switch s[i] {
		case 'b':
			b.WriteByte('\b')
		case 'f':
			b.WriteByte('\f')
		case 'r':
			b.WriteByte('\r')
		case 'n':
			b.WriteByte('\n')
		case 't':
			b.WriteByte('\t')
		case '0':
			b.WriteByte(0)
		case '\\':
			b.WriteByte('\\')
		case '\'':
			b.WriteByte('\'')
		case 'a':
			b.WriteByte('\a')
		case 'v':
			b.WriteByte('\v')
		case 'x':
			if i+2 < len(s) && isHex(s[i+1]) && isHex(s[i+2]) {
				b.WriteByte(hexByte(s[i+1], s[i+2]))
				i += 2
			} else {
				b.WriteByte('x')
			}
		default:
			// `\c` → c（ClickHouse 解析规则）
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

func isHex(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

func hexByte(hi, lo byte) byte {
	return hexNibble(hi)<<4 | hexNibble(lo)
}

func hexNibble(c byte) byte {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10
	default:
		return 0
	}
}

// splitTSVLine 按真实 Tab 拆分（字段内 Tab 已转义为 `\t` 两字符）。
func splitTSVLine(line string) []string {
	line = strings.TrimSuffix(line, "\r")
	if line == "" {
		return []string{""}
	}
	parts := strings.Split(line, "\t")
	for i := range parts {
		parts[i] = unescapeTSVField(parts[i])
	}
	return parts
}

func writeTSVRecord(w io.Writer, fields []string) error {
	for i, field := range fields {
		if i > 0 {
			if _, err := w.Write([]byte{'\t'}); err != nil {
				return err
			}
		}
		if _, err := io.WriteString(w, escapeTSVField(field)); err != nil {
			return err
		}
	}
	_, err := w.Write([]byte{'\n'})
	return err
}

// tsvRecordReader 逐行读取 ClickHouse TabSeparated 记录。
type tsvRecordReader struct {
	sc *bufio.Scanner
}

func newTSVRecordReader(r io.Reader) *tsvRecordReader {
	sc := bufio.NewScanner(r)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, 16*1024*1024)
	return &tsvRecordReader{sc: sc}
}

func (t *tsvRecordReader) Read() ([]string, error) {
	for {
		if !t.sc.Scan() {
			if err := t.sc.Err(); err != nil {
				return nil, fmt.Errorf("clickhouse: read tsv: %w", err)
			}
			return nil, io.EOF
		}
		line := t.sc.Text()
		// 允许文件末尾空行
		if line == "" {
			continue
		}
		return splitTSVLine(line), nil
	}
}
