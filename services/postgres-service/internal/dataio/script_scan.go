package dataio

import (
	"bufio"
	"io"
	"strings"
	"unicode"
)

// sqlStmtScanner 按分号拆分 SQL 脚本，跳过引号、美元引用、-- 行注释与 /* */ 块注释中的分号。
type sqlStmtScanner struct {
	reader         *bufio.Reader
	stmt           strings.Builder
	inSingle       bool
	inDouble       bool
	inLineComment  bool
	inBlockComment bool
	blockDepth     int
	dollarTag      string
	bytesRead      int64
}

func newSQLStmtScanner(r *bufio.Reader) *sqlStmtScanner {
	return &sqlStmtScanner{reader: r}
}

func (s *sqlStmtScanner) addBytes(n int64) {
	if n > 0 {
		s.bytesRead += n
	}
}

func (s *sqlStmtScanner) next() (string, error) {
	for {
		r, _, err := s.reader.ReadRune()
		if err == io.EOF {
			sql := s.flush()
			if sql != "" {
				return sql, nil
			}
			return "", io.EOF
		}
		if err != nil {
			return "", err
		}
		s.bytesRead++
		if !s.feed(r) {
			continue
		}
		sql := s.flush()
		if sql != "" {
			return sql, nil
		}
	}
}

func (s *sqlStmtScanner) flush() string {
	sql := stripSQLLeadingComments(s.stmt.String())
	s.stmt.Reset()
	return sql
}

func (s *sqlStmtScanner) peekByte() (byte, bool) {
	b, err := s.reader.Peek(1)
	if err != nil || len(b) == 0 {
		return 0, false
	}
	return b[0], true
}

func (s *sqlStmtScanner) readByte() {
	_, _ = s.reader.ReadByte()
	s.bytesRead++
}

func (s *sqlStmtScanner) feed(r rune) (stmtEnd bool) {
	if s.dollarTag != "" {
		s.stmt.WriteRune(r)
		if r == '$' && strings.HasSuffix(s.stmt.String(), s.dollarTag) {
			s.dollarTag = ""
		}
		return false
	}
	if s.inLineComment {
		s.stmt.WriteRune(r)
		if r == '\n' {
			s.inLineComment = false
		}
		return false
	}
	if s.inBlockComment {
		s.feedBlockComment(r)
		return false
	}
	if s.inSingle {
		s.stmt.WriteRune(r)
		if r == '\'' {
			if b, ok := s.peekByte(); ok && b == '\'' {
				s.readByte()
				s.stmt.WriteByte('\'')
			} else {
				s.inSingle = false
			}
		}
		return false
	}
	if s.inDouble {
		s.stmt.WriteRune(r)
		if r == '"' {
			s.inDouble = false
		}
		return false
	}

	if r == '-' {
		if b, ok := s.peekByte(); ok && b == '-' {
			s.readByte()
			s.stmt.WriteString("--")
			s.inLineComment = true
			return false
		}
	}
	if r == '/' {
		if b, ok := s.peekByte(); ok && b == '*' {
			s.readByte()
			s.stmt.WriteString("/*")
			s.inBlockComment = true
			s.blockDepth = 1
			return false
		}
	}

	if r == '\'' {
		s.inSingle = true
		s.stmt.WriteRune(r)
		return false
	}
	if r == '"' {
		s.inDouble = true
		s.stmt.WriteRune(r)
		return false
	}
	if r == '$' {
		s.readDollarTag()
		return false
	}
	if r == ';' {
		return true
	}
	s.stmt.WriteRune(r)
	return false
}

func (s *sqlStmtScanner) feedBlockComment(r rune) {
	s.stmt.WriteRune(r)
	if r == '*' {
		if b, ok := s.peekByte(); ok && b == '/' {
			s.readByte()
			s.stmt.WriteByte('/')
			s.blockDepth--
			if s.blockDepth <= 0 {
				s.inBlockComment = false
				s.blockDepth = 0
			}
		}
		return
	}
	if r == '/' {
		if b, ok := s.peekByte(); ok && b == '*' {
			s.readByte()
			s.stmt.WriteByte('*')
			s.blockDepth++
		}
	}
}

func (s *sqlStmtScanner) readDollarTag() {
	tag := "$"
	for {
		nr, _, nerr := s.reader.ReadRune()
		if nerr != nil {
			s.stmt.WriteString(tag)
			return
		}
		s.bytesRead++
		tag += string(nr)
		if nr == '$' {
			s.dollarTag = tag
			s.stmt.WriteString(tag)
			return
		}
		if !(unicode.IsLetter(nr) || unicode.IsDigit(nr) || nr == '_') {
			s.stmt.WriteString(tag)
			return
		}
	}
}

// splitSQLStatements 按分号拆分脚本，供测试覆盖注释/引号/美元引用。
func splitSQLStatements(text string) ([]string, error) {
	s := newSQLStmtScanner(bufio.NewReader(strings.NewReader(text)))
	out := make([]string, 0)
	for {
		stmt, err := s.next()
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		out = append(out, stmt)
	}
}
