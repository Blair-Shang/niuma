package sqliteparser

import (
	"strings"
	"unicode"

	"niuma/pkg/sqllsp"
)

// SplitSQL 按分号拆分 SQL，保留 CREATE TRIGGER … BEGIN…END 体内的分号。
// 供 dataio.execSqlFile 与 Diagnostics 共用。
func SplitSQL(text string) []string {
	spans := splitSQLAware(text)
	out := make([]string, 0, len(spans))
	for _, sp := range spans {
		s := strings.TrimSpace(sp.text)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// SplitStatements 实现 sqllsp.StatementSplitter。
func (p *Parser) SplitStatements(text string) []sqllsp.StatementSpan {
	spans := splitSQLAware(text)
	out := make([]sqllsp.StatementSpan, 0, len(spans))
	for _, sp := range spans {
		if strings.TrimSpace(sp.text) == "" {
			continue
		}
		out = append(out, sqllsp.StatementSpan{Start: sp.start, Text: sp.text})
	}
	return out
}

func splitSQLAware(text string) []stmtSpan {
	var out []stmtSpan
	start := 0
	inSingle, inDouble, inBracket := false, false, false
	inLineComment, inBlockComment := false, false
	beginDepth := 0
	i := 0
	for i < len(text) {
		c := text[i]
		if inLineComment {
			if c == '\n' {
				inLineComment = false
			}
			i++
			continue
		}
		if inBlockComment {
			if c == '*' && i+1 < len(text) && text[i+1] == '/' {
				inBlockComment = false
				i += 2
				continue
			}
			i++
			continue
		}
		if inSingle {
			if c == '\'' {
				if i+1 < len(text) && text[i+1] == '\'' {
					i += 2
					continue
				}
				inSingle = false
			}
			i++
			continue
		}
		if inDouble {
			if c == '"' {
				if i+1 < len(text) && text[i+1] == '"' {
					i += 2
					continue
				}
				inDouble = false
			}
			i++
			continue
		}
		if inBracket {
			if c == ']' {
				inBracket = false
			}
			i++
			continue
		}
		if c == '-' && i+1 < len(text) && text[i+1] == '-' {
			inLineComment = true
			i += 2
			continue
		}
		if c == '/' && i+1 < len(text) && text[i+1] == '*' {
			inBlockComment = true
			i += 2
			continue
		}
		switch c {
		case '\'':
			inSingle = true
			i++
		case '"':
			inDouble = true
			i++
		case '[':
			inBracket = true
			i++
		case ';':
			if beginDepth == 0 {
				out = append(out, stmtSpan{start: start, text: text[start:i]})
				start = i + 1
			}
			i++
		default:
			if isIdentStartByte(c) {
				word, next := readWord(text, i)
				upper := strings.ToUpper(word)
				switch upper {
				case "BEGIN":
					// 仅 CREATE TRIGGER … BEGIN…END 抬高深度；
					// BEGIN / BEGIN TRANSACTION / BEGIN IMMEDIATE 等事务语句必须正常按分号拆分，
					// 否则整份 dump（PRAGMA; BEGIN TRANSACTION; … COMMIT;）会并成一条。
					if !isTransactionBegin(text, next) {
						beginDepth++
					}
				case "END":
					if beginDepth > 0 {
						beginDepth--
					}
				}
				i = next
				continue
			}
			i++
		}
	}
	if start < len(text) {
		out = append(out, stmtSpan{start: start, text: text[start:]})
	}
	return out
}

// isTransactionBegin 判断 BEGIN 之后是否为事务起始（非触发器复合块）。
// 事务形式：BEGIN [DEFERRED|IMMEDIATE|EXCLUSIVE] [TRANSACTION] ;
func isTransactionBegin(text string, afterBegin int) bool {
	j := skipSQLTrivia(text, afterBegin)
	if j >= len(text) || text[j] == ';' {
		return true
	}
	if !isIdentStartByte(text[j]) {
		return false
	}
	word, _ := readWord(text, j)
	switch strings.ToUpper(word) {
	case "DEFERRED", "IMMEDIATE", "EXCLUSIVE", "TRANSACTION":
		return true
	default:
		return false
	}
}

// skipSQLTrivia 跳过空白与注释（-- / /* */），供 peek 下一有效 token。
func skipSQLTrivia(text string, i int) int {
	for i < len(text) {
		c := text[i]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			i++
			continue
		}
		if c == '-' && i+1 < len(text) && text[i+1] == '-' {
			i += 2
			for i < len(text) && text[i] != '\n' {
				i++
			}
			continue
		}
		if c == '/' && i+1 < len(text) && text[i+1] == '*' {
			i += 2
			for i+1 < len(text) && !(text[i] == '*' && text[i+1] == '/') {
				i++
			}
			if i+1 < len(text) {
				i += 2
			}
			continue
		}
		break
	}
	return i
}

func isIdentStartByte(c byte) bool {
	return c == '_' || unicode.IsLetter(rune(c))
}

func isIdentContByte(c byte) bool {
	return isIdentStartByte(c) || (c >= '0' && c <= '9')
}

func readWord(text string, i int) (string, int) {
	j := i
	for j < len(text) && isIdentContByte(text[j]) {
		j++
	}
	return text[i:j], j
}
