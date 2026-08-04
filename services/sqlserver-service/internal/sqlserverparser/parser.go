// Package sqlserverparser 将 T-SQL 适配为 sqllsp.DialectParser。
//
// 能力分层：
//   - 启发式补全槽位 + 关键字 / 内置函数（全量补全入口）
//   - 轻量 Diagnostics（括号平衡、常见笔误）
//   - 方括号标识符 QuoteIdent
//   - BuiltinSignature 参数提示
package sqlserverparser

import (
	"strings"
	"unicode"

	"niuma/pkg/sqllsp"
)

// Parser 实现 sqllsp.DialectParser（SQL Server / T-SQL）。
type Parser struct {
	keywords []string
}

// New 创建 SQL Server 方言解析器。
func New() *Parser {
	return &Parser{keywords: append([]string(nil), sqlServerKeywords...)}
}

// Keywords 返回关键字。
func (p *Parser) Keywords() []string { return p.keywords }

// Functions 返回内置函数名（高亮 / 词表同源）。
func (p *Parser) Functions() []string { return sqlServerBuiltinFunctionNames() }

// BuiltinSignature 实现 sqllsp.BuiltinSignatureProvider。
func (p *Parser) BuiltinSignature(name string) *sqllsp.SignatureInformation {
	return lookupBuiltinSignature(name)
}

// QuoteIdent 用方括号引用标识符。
func (p *Parser) QuoteIdent(name string) string {
	n := strings.TrimSpace(name)
	if n == "" {
		return n
	}
	needs := false
	for i, r := range n {
		if i == 0 {
			if !(r == '_' || unicode.IsLetter(r)) {
				needs = true
				break
			}
			continue
		}
		if r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r) {
			continue
		}
		needs = true
		break
	}
	if !needs {
		return n
	}
	return "[" + strings.ReplaceAll(n, "]", "]]") + "]"
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

// CompletionContext 启发式槽位 + T-SQL 片段 / 函数 / 关键字。
func (p *Parser) CompletionContext(text string, pos sqllsp.Position) sqllsp.CompletionContext {
	cc := sqllsp.HeuristicCompletionContext(text, pos, p.keywords)
	cc.Snippets = sqlServerCreateSnippets()
	cc.Functions = sqlServerBuiltinFunctions()
	// 保证关键字与函数始终进入期望槽位（编辑器智能提示全量）。
	if len(cc.Expect) == 0 {
		cc.Expect = []sqllsp.CompletionKind{
			sqllsp.KindKeyword,
			sqllsp.KindFunction,
			sqllsp.KindColumn,
			sqllsp.KindTable,
			sqllsp.KindSchema,
			sqllsp.KindRoutine,
		}
	} else {
		cc.Expect = ensureKinds(cc.Expect, sqllsp.KindKeyword, sqllsp.KindFunction)
	}
	return cc
}

func ensureKinds(base []sqllsp.CompletionKind, extra ...sqllsp.CompletionKind) []sqllsp.CompletionKind {
	seen := map[sqllsp.CompletionKind]struct{}{}
	out := make([]sqllsp.CompletionKind, 0, len(base)+len(extra))
	for _, k := range base {
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	for _, k := range extra {
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	return out
}

func sqlServerCreateSnippets() []sqllsp.CompletionItem {
	return []sqllsp.CompletionItem{
		{
			Label:         "CREATE TABLE",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建表",
			InsertText:    "CREATE TABLE [${1:dbo}].[${2:table_name}] (\n    [${3:id}] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,\n    [${4:name}] NVARCHAR(100) NULL\n);\n",
			SortText:      "0s_create_table",
		},
		{
			Label:         "CREATE VIEW",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建视图",
			InsertText:    "CREATE OR ALTER VIEW [${1:dbo}].[${2:view_name}]\nAS\nSELECT ${3:*}\nFROM [${4:dbo}].[${5:table}];\n",
			SortText:      "0s_create_view",
		},
		{
			Label:         "CREATE PROCEDURE",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建存储过程",
			InsertText:    "CREATE OR ALTER PROCEDURE [${1:dbo}].[${2:proc_name}]\n    @${3:param} INT\nAS\nBEGIN\n    SET NOCOUNT ON;\n    ${4:SELECT 1;}\nEND;\nGO\n",
			SortText:      "0s_create_proc",
		},
		{
			Label:         "CREATE FUNCTION",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建标量函数",
			InsertText:    "CREATE OR ALTER FUNCTION [${1:dbo}].[${2:fn_name}] (@${3:param} INT)\nRETURNS INT\nAS\nBEGIN\n    RETURN ${4:0};\nEND;\nGO\n",
			SortText:      "0s_create_fn",
		},
	}
}

type stmtSpan struct {
	start int
	text  string
}

func splitStatements(text string) []stmtSpan {
	var out []stmtSpan
	start := 0
	inSingle, inBracket := false, false
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
		if inBracket {
			if c == ']' {
				if i+1 < len(text) && text[i+1] == ']' {
					i++
				} else {
					inBracket = false
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
		case '[':
			inBracket = true
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
	inSingle, inBracket := false, false
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
		if inBracket {
			if c == ']' {
				if i+1 < len(stmt) && stmt[i+1] == ']' {
					i++
				} else {
					inBracket = false
				}
			}
			continue
		}
		switch c {
		case '\'':
			inSingle = true
		case '[':
			inBracket = true
		case '(':
			stack = append(stack, c)
		case ')':
			if len(stack) == 0 {
				return []sqllsp.Diagnostic{{
					Range:    spanRange(stmt, i, i+1),
					Severity: severity(incomplete, 1),
					Source:   "sqlserver-lsp",
					Message:  "unexpected closing parenthesis",
				}}
			}
			stack = stack[:len(stack)-1]
		}
	}
	if len(stack) > 0 {
		return []sqllsp.Diagnostic{{
			Range:    spanRange(stmt, 0, min(8, len(stmt))),
			Severity: 4,
			Source:   "sqlserver-lsp",
			Message:  "unclosed parenthesis",
		}}
	}
	return nil
}

func diagnoseTypos(stmt string) []sqllsp.Diagnostic {
	upper := strings.ToUpper(stmt)
	var diags []sqllsp.Diagnostic
	if idx := indexWord(upper, "FORM"); idx >= 0 {
		diags = append(diags, sqllsp.Diagnostic{
			Range:    spanRange(stmt, idx, idx+4),
			Severity: 1,
			Source:   "sqlserver-lsp",
			Message:  "did you mean FROM?",
		})
	}
	if idx := indexWord(upper, "SELET"); idx >= 0 {
		diags = append(diags, sqllsp.Diagnostic{
			Range:    spanRange(stmt, idx, idx+5),
			Severity: 1,
			Source:   "sqlserver-lsp",
			Message:  "did you mean SELECT?",
		})
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
	return unicode.IsLetter(rune(b)) || unicode.IsDigit(rune(b)) || b == '_' || b == '@'
}

func looksIncomplete(stmt string) bool {
	s := strings.TrimSpace(strings.ToUpper(stmt))
	if s == "" {
		return true
	}
	tails := []string{"SELECT", "FROM", "WHERE", "JOIN", "AND", "OR", "SET", "BY", "INTO", "VALUES", "DECLARE", "EXEC", "EXECUTE"}
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
	if offset < 0 {
		offset = 0
	}
	line, character = 0, 0
	for i := 0; i < offset; i++ {
		if text[i] == '\n' {
			line++
			character = 0
		} else {
			character++
		}
	}
	return line, character
}

func remapDiags(full string, stmtStart int, stmt string, diags []sqllsp.Diagnostic) []sqllsp.Diagnostic {
	_ = stmt
	out := make([]sqllsp.Diagnostic, 0, len(diags))
	for _, d := range diags {
		startOff := posToOffset(full, d.Range.Start) + 0
		// Range 是相对 stmt 的；先按 stmt 偏移再映射到全文。
		relStart := posToOffset(stmt, d.Range.Start)
		relEnd := posToOffset(stmt, d.Range.End)
		absStart := stmtStart + relStart
		absEnd := stmtStart + relEnd
		_ = startOff
		out = append(out, sqllsp.Diagnostic{
			Range:    spanRange(full, absStart, absEnd),
			Severity: d.Severity,
			Source:   d.Source,
			Message:  d.Message,
		})
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
