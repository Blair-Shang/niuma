package dataio

import (
	"bufio"
	"bytes"
	"io"
	"regexp"
	"strings"
)

var copyFromStdinRe = regexp.MustCompile(`(?is)^\s*COPY\b[\s\S]*\bFROM\s+STDIN\b`)

// stripSQLLeadingComments 去掉语句前的空行与 -- 行注释（dump 在 COPY 前会写 -- Data:）。
func stripSQLLeadingComments(sql string) string {
	lines := strings.Split(sql, "\n")
	i := 0
	for i < len(lines) {
		trim := strings.TrimSpace(lines[i])
		if trim == "" || strings.HasPrefix(trim, "--") {
			i++
			continue
		}
		break
	}
	return strings.TrimSpace(strings.Join(lines[i:], "\n"))
}

// isCopyFromStdin 判断语句是否为 psql 脚本中的 COPY ... FROM STDIN。
func isCopyFromStdin(sql string) bool {
	return copyFromStdinRe.MatchString(stripSQLLeadingComments(sql))
}

// copyDataReader 从 SQL 脚本中流式读取 COPY 数据段，直到单独一行 "\."（不含该行）。
type copyDataReader struct {
	br      *bufio.Reader
	pending []byte
	done    bool
	n       int64 // 已读入协议流的字节数（不含 \. 终止行）
	termN   int64 // 终止行消耗的字节数
}

func (c *copyDataReader) Read(p []byte) (int, error) {
	if len(c.pending) > 0 {
		n := copy(p, c.pending)
		c.pending = c.pending[n:]
		return n, nil
	}
	if c.done {
		return 0, io.EOF
	}

	line, err := c.br.ReadBytes('\n')
	if len(line) == 0 {
		c.done = true
		if err == io.EOF {
			return 0, io.EOF
		}
		if err != nil {
			return 0, err
		}
		return 0, io.EOF
	}

	trimmed := bytes.TrimRight(line, "\r\n")
	if bytes.Equal(trimmed, []byte(`\.`)) {
		c.termN += int64(len(line))
		c.done = true
		return 0, io.EOF
	}

	c.n += int64(len(line))
	c.pending = line
	if err == io.EOF {
		// 最后一行无换行：先吐出内容，下次 Read 再 EOF
		n := copy(p, c.pending)
		c.pending = c.pending[n:]
		if len(c.pending) == 0 {
			c.done = true
		}
		if n > 0 {
			return n, nil
		}
		return 0, io.EOF
	}
	if err != nil {
		return 0, err
	}

	n := copy(p, c.pending)
	c.pending = c.pending[n:]
	return n, nil
}

func (c *copyDataReader) consumed() int64 {
	return c.n + c.termN
}
