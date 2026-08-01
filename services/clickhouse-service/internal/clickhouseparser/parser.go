// Package clickhouseparser 将 ClickHouse SQL 适配为 sqllsp.DialectParser。
//
// 能力分层：
//   - 启发式补全槽位（HeuristicCompletionContext）+ 关键字 / 内置函数
//   - 轻量 Diagnostics（括号平衡、常见笔误）；半成品不报 Error
//   - 反引号标识符 QuoteIdent
package clickhouseparser

import (
	"strings"
	"unicode"

	"niuma/pkg/sqllsp"
)

// Parser 实现 sqllsp.DialectParser（ClickHouse）。
type Parser struct {
	keywords []string
}

// New 创建 ClickHouse 方言解析器。
func New() *Parser {
	return &Parser{keywords: append([]string(nil), clickHouseKeywords...)}
}

// Keywords 返回关键字。
func (p *Parser) Keywords() []string { return p.keywords }

// Functions 返回内置函数名（高亮 / 词表同源）。
func (p *Parser) Functions() []string { return clickHouseBuiltinFunctionNames() }

// QuoteIdent 用反引号引用标识符。
func (p *Parser) QuoteIdent(name string) string {
	n := strings.ReplaceAll(name, "`", "``")
	return "`" + n + "`"
}

// Diagnostics 轻量诊断：空文档跳过；半成品结构问题降为 Hint。
func (p *Parser) Diagnostics(_, text string) []sqllsp.Diagnostic {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}
	var diags []sqllsp.Diagnostic
	for _, sp := range splitStatements(text) {
		stmt := strings.TrimSpace(sp.text)
		if stmt == "" {
			continue
		}
		sub := diagnoseBalance(stmt)
		sub = append(sub, diagnoseTypos(stmt)...)
		diags = append(diags, remapDiags(text, sp.start, stmt, sub)...)
	}
	return diags
}

// CompletionContext 启发式槽位 + ClickHouse 片段 / 函数。
func (p *Parser) CompletionContext(text string, pos sqllsp.Position) sqllsp.CompletionContext {
	cc := sqllsp.HeuristicCompletionContext(text, pos, p.keywords)
	cc.Snippets = clickHouseCreateSnippets()
	cc.Functions = clickHouseBuiltinFunctions()
	return cc
}

type stmtSpan struct {
	start int
	text  string
}

func splitStatements(text string) []stmtSpan {
	var out []stmtSpan
	start := 0
	inSingle, inDouble, inBack := false, false, false
	inLineComment, inBlockComment := false, false
	for i := 0; i < len(text); i++ {
		c := text[i]
		if inLineComment {
			if c == '\n' {
				inLineComment = false
			}
			continue
		}
		if inBlockComment {
			if c == '*' && i+1 < len(text) && text[i+1] == '/' {
				inBlockComment = false
				i++
			}
			continue
		}
		if inSingle {
			if c == '\'' {
				if i+1 < len(text) && text[i+1] == '\'' {
					i++
				} else {
					inSingle = false
				}
			}
			continue
		}
		if inDouble {
			if c == '"' {
				if i+1 < len(text) && text[i+1] == '"' {
					i++
				} else {
					inDouble = false
				}
			}
			continue
		}
		if inBack {
			if c == '`' {
				if i+1 < len(text) && text[i+1] == '`' {
					i++
				} else {
					inBack = false
				}
			}
			continue
		}
		if c == '-' && i+1 < len(text) && text[i+1] == '-' {
			inLineComment = true
			i++
			continue
		}
		if c == '/' && i+1 < len(text) && text[i+1] == '*' {
			inBlockComment = true
			i++
			continue
		}
		switch c {
		case '\'':
			inSingle = true
		case '"':
			inDouble = true
		case '`':
			inBack = true
		case ';':
			out = append(out, stmtSpan{start: start, text: text[start:i]})
			start = i + 1
		}
	}
	if start < len(text) {
		out = append(out, stmtSpan{start: start, text: text[start:]})
	}
	return out
}

func diagnoseBalance(stmt string) []sqllsp.Diagnostic {
	var stack []rune
	incomplete := looksIncomplete(stmt)
	inSingle, inDouble, inBack := false, false, false
	for i := 0; i < len(stmt); i++ {
		c := rune(stmt[i])
		if inSingle {
			if c == '\'' {
				if i+1 < len(stmt) && stmt[i+1] == '\'' {
					i++
				} else {
					inSingle = false
				}
			}
			continue
		}
		if inDouble {
			if c == '"' {
				inDouble = false
			}
			continue
		}
		if inBack {
			if c == '`' {
				inBack = false
			}
			continue
		}
		switch c {
		case '\'':
			inSingle = true
		case '"':
			inDouble = true
		case '`':
			inBack = true
		case '(', '[', '{':
			stack = append(stack, c)
		case ')', ']', '}':
			if len(stack) == 0 {
				return []sqllsp.Diagnostic{{
					Range:    spanRange(stmt, i, i+1),
					Severity: severity(incomplete, 1),
					Source:   "clickhouse-lsp",
					Message:  "unexpected closing bracket",
				}}
			}
			open := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if !matches(open, c) {
				return []sqllsp.Diagnostic{{
					Range:    spanRange(stmt, i, i+1),
					Severity: severity(incomplete, 1),
					Source:   "clickhouse-lsp",
					Message:  "mismatched bracket",
				}}
			}
		}
	}
	if len(stack) > 0 {
		return []sqllsp.Diagnostic{{
			Range:    spanRange(stmt, 0, min(8, len(stmt))),
			Severity: 4, // Hint：半成品常见
			Source:   "clickhouse-lsp",
			Message:  "unclosed bracket",
		}}
	}
	return nil
}

func diagnoseTypos(stmt string) []sqllsp.Diagnostic {
	upper := strings.ToUpper(stmt)
	var diags []sqllsp.Diagnostic
	if idx := indexWord(upper, "FORM"); idx >= 0 {
		// FORM 常为 FROM 笔误；排除 FORMAT
		rest := upper[idx:]
		if !strings.HasPrefix(rest, "FORMAT") && !strings.HasPrefix(rest, "FORMAT(") {
			diags = append(diags, sqllsp.Diagnostic{
				Range:    spanRange(stmt, idx, idx+4),
				Severity: 1,
				Source:   "clickhouse-lsp",
				Message:  "did you mean FROM?",
			})
		}
	}
	return diags
}

func indexWord(upper, word string) int {
	for i := 0; i+len(word) <= len(upper); i++ {
		if upper[i:i+len(word)] != word {
			continue
		}
		beforeOK := i == 0 || !isIdentByte(upper[i-1])
		afterOK := i+len(word) == len(upper) || !isIdentByte(upper[i+len(word)])
		if beforeOK && afterOK {
			return i
		}
	}
	return -1
}

func isIdentByte(b byte) bool {
	return unicode.IsLetter(rune(b)) || unicode.IsDigit(rune(b)) || b == '_'
}

func looksIncomplete(stmt string) bool {
	s := strings.TrimSpace(strings.ToUpper(stmt))
	if s == "" {
		return true
	}
	tails := []string{"SELECT", "FROM", "WHERE", "JOIN", "AND", "OR", "SET", "BY", "INTO", "VALUES", "SETTINGS", "FORMAT"}
	for _, t := range tails {
		if strings.HasSuffix(s, t) {
			return true
		}
	}
	return strings.HasSuffix(s, ",") || strings.HasSuffix(s, "(")
}

func severity(incomplete bool, errSeverity int) int {
	if incomplete {
		return 4
	}
	return errSeverity
}

func matches(open, close rune) bool {
	return (open == '(' && close == ')') || (open == '[' && close == ']') || (open == '{' && close == '}')
}

func spanRange(text string, start, end int) sqllsp.Range {
	if start < 0 {
		start = 0
	}
	if end > len(text) {
		end = len(text)
	}
	if end < start {
		end = start
	}
	sl, sc := offsetToPos(text, start)
	el, ec := offsetToPos(text, end)
	return sqllsp.Range{
		Start: sqllsp.Position{Line: sl, Character: sc},
		End:   sqllsp.Position{Line: el, Character: ec},
	}
}

func offsetToPos(text string, offset int) (line, character int) {
	if offset > len(text) {
		offset = len(text)
	}
	line, col := 0, 0
	for i := 0; i < offset; i++ {
		if text[i] == '\n' {
			line++
			col = 0
		} else {
			col++
		}
	}
	return line, col
}

func remapDiags(doc string, stmtStart int, stmt string, diags []sqllsp.Diagnostic) []sqllsp.Diagnostic {
	if len(diags) == 0 {
		return nil
	}
	out := make([]sqllsp.Diagnostic, 0, len(diags))
	for _, d := range diags {
		absStart := stmtStart + posToOffset(stmt, d.Range.Start)
		absEnd := stmtStart + posToOffset(stmt, d.Range.End)
		sl, sc := offsetToPos(doc, absStart)
		el, ec := offsetToPos(doc, absEnd)
		d.Range = sqllsp.Range{
			Start: sqllsp.Position{Line: sl, Character: sc},
			End:   sqllsp.Position{Line: el, Character: ec},
		}
		out = append(out, d)
	}
	return out
}

func posToOffset(text string, pos sqllsp.Position) int {
	line, col := 0, 0
	for i := 0; i < len(text); i++ {
		if line == pos.Line && col == pos.Character {
			return i
		}
		if text[i] == '\n' {
			line++
			col = 0
		} else {
			col++
		}
	}
	return len(text)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
