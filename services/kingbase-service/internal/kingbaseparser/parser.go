// Package kingbaseparser adapts Kingbase dialect SQL to sqllsp.DialectParser.
//
// 能力分层：
//   - StmtClassify + DML/DDL 轻量 Diagnostics（半成品 Hint 降噪）
//   - 例程外壳 + 体内分句诊断（对标 mysqlparser/routine）
//   - 私有工作 AST：TableRef / DECLARE / 参数 → 补全与语义
//   - 兼容模式（oracle/mysql）关键字与 Hint
//   - DocumentSymbol / Definition / Format（可选 LSP 能力）
package kingbaseparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

// Parser 实现 sqllsp.DialectParser（Kingbase）及可选扩展接口。
type Parser struct {
	keywords []string
	compat   CompatMode
}

// New 创建默认 PostgreSQL 兼容模式的 Kingbase 解析器。
func New() *Parser {
	return NewWithCompat(CompatPG)
}

// NewWithCompat 按兼容模式创建解析器。
func NewWithCompat(compat CompatMode) *Parser {
	base := kingbaseKeywords
	return &Parser{
		keywords: keywordsForCompat(base, compat),
		compat:   compat,
	}
}

// Compat 返回当前兼容模式。
func (p *Parser) Compat() CompatMode { return p.compat }

// Keywords 返回关键字。
func (p *Parser) Keywords() []string {
	return p.keywords
}

// Functions 返回当前兼容模式下的内置函数名（高亮 / 词表同源）。
func (p *Parser) Functions() []string {
	return kingbaseBuiltinFunctionNames(p.compat)
}

// Diagnostics 分句诊断：例程 / DML / 轻量 DDL；半成品结构问题降为 Hint。
func (p *Parser) Diagnostics(_, text string) []sqllsp.Diagnostic {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}
	var diags []sqllsp.Diagnostic
	for _, sp := range splitDocumentStatements(text) {
		stmt := sp.text
		kind := Classify(stmt)
		var sub []sqllsp.Diagnostic
		switch kind {
		case StmtEmpty:
			continue
		case StmtCreateProc, StmtCreateFunc:
			sub = diagnoseRoutine(stmt, p.compat)
		case StmtSelect, StmtInsert, StmtUpdate, StmtDelete, StmtMerge:
			sub = diagnoseDML(stmt, kind, p.compat)
		case StmtCreateTable, StmtCreateView, StmtCreateSequence, StmtCreateIndex, StmtCreateOther:
			sub = diagnoseDDLLight(stmt, kind, p.compat)
		case StmtExplain:
			// EXPLAIN + 内层
			inner := skipLeadingNoise(stmt)
			if matchKeywordAt(stmt, inner, "explain") {
				rest := strings.TrimSpace(stmt[inner+7:])
				if rest != "" {
					sub = diagnoseDML(rest, Classify(rest), p.compat)
				}
			}
		case StmtUnknown:
			// 未识别首词：括号 / 拼写 / 半成品尾部 / 残缺 DML 动词提示
			sub = diagnoseBalance(stmt)
			sub = append(sub, diagnoseTypos(stmt)...)
			sub = append(sub, diagnoseIncompleteTail(stmt)...)
			sub = append(sub, diagnoseUnknownLead(stmt)...)
			sub = append(sub, diagnoseCompatSelect(stmt, p.compat, looksIncomplete(strings.TrimSpace(stmt)))...)
		default:
			sub = diagnoseBalance(stmt)
			sub = append(sub, diagnoseTypos(stmt)...)
			sub = append(sub, diagnoseIncompleteTail(stmt)...)
			sub = append(sub, diagnoseCompatSelect(stmt, p.compat, looksIncomplete(strings.TrimSpace(stmt)))...)
		}
		diags = append(diags, remapDiags(text, sp.start, stmt, sub)...)
	}
	return diags
}

// CompletionContext 启发式槽位 + 工作 AST（表绑定 / 局部变量）+ CREATE 片段。
func (p *Parser) CompletionContext(text string, pos sqllsp.Position) sqllsp.CompletionContext {
	cc := sqllsp.HeuristicCompletionContext(text, pos, p.keywords)
	cc.Snippets = kingbaseCreateSnippets()
	cc.Functions = kingbaseBuiltinFunctions(p.compat)

	ast := ParseWorkAST(text, pos)
	if len(ast.Tables) > 0 {
		cc.Tables = ast.Tables
	}
	cc.Locals = ast.LocalNames()

	if inRoutineBodyAt(text, pos) {
		cc.Expect = []sqllsp.CompletionKind{
			sqllsp.KindKeyword,
			sqllsp.KindFunction,
			sqllsp.KindRoutine,
			sqllsp.KindColumn,
			sqllsp.KindTable,
			sqllsp.KindSchema,
		}
	}
	return cc
}

// DocumentSymbols 实现 sqllsp.DocumentSymbolProvider。
func (p *Parser) DocumentSymbols(text string) []sqllsp.DocumentSymbol {
	return DocumentSymbols(text)
}

// DefinitionTarget 实现 sqllsp.DefinitionProvider。
func (p *Parser) DefinitionTarget(text string, pos sqllsp.Position) *sqllsp.DefinitionTarget {
	t := DefinitionAt(text, pos)
	if t == nil {
		return nil
	}
	return &sqllsp.DefinitionTarget{
		Kind:   t.Kind,
		Schema: t.Schema,
		Table:  t.Table,
		Name:   t.Name,
		Range:  t.Range,
	}
}

// FormatDocument 实现 sqllsp.FormatProvider。
func (p *Parser) FormatDocument(text string) (string, bool) {
	return FormatDocument(text)
}

// SplitStatements 实现 sqllsp.StatementSplitter（感知 dollar quote 与 Oracle /）。
func (p *Parser) SplitStatements(text string) []sqllsp.StatementSpan {
	spans := splitDocumentStatements(text)
	out := make([]sqllsp.StatementSpan, 0, len(spans))
	for _, sp := range spans {
		if strings.TrimSpace(sp.text) == "" {
			continue
		}
		out = append(out, sqllsp.StatementSpan{Start: sp.start, Text: sp.text})
	}
	return out
}

// LocalNames 实现 sqllsp.LocalScopeProvider（全文例程局部名并集）。
func (p *Parser) LocalNames(text string) []string {
	if !isRoutineDDL(text) && !strings.Contains(strings.ToLower(text), "procedure") &&
		!strings.Contains(strings.ToLower(text), "function") {
		return nil
	}
	ast := parseRoutineAST(text, 0)
	return ast.LocalNames()
}

func kingbaseCreateSnippets() []sqllsp.CompletionItem {
	return []sqllsp.CompletionItem{
		{
			Label:         "CREATE VIEW",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建视图",
			InsertText:    "CREATE OR REPLACE VIEW \"${1:view_name}\" AS\nSELECT ${2:*}\nFROM \"${3:table}\";\n",
			SortText:      "2_CREATE VIEW",
		},
		{
			Label:         "CREATE PROCEDURE",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建存储过程",
			InsertText:    "CREATE OR REPLACE PROCEDURE \"${1:proc_name}\"(${2:})\nLANGUAGE plpgsql\nAS $proc$\nBEGIN\n\t${3:NULL;}\nEND;\n$proc$;\n",
			SortText:      "2_CREATE PROCEDURE",
		},
		{
			Label:         "CREATE FUNCTION",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建函数（PL/pgSQL）",
			InsertText:    "CREATE OR REPLACE FUNCTION \"${1:func_name}\"(${2:})\nRETURNS ${3:integer}\nLANGUAGE plpgsql\nAS $func$\nBEGIN\n\tRETURN ${4:0};\nEND;\n$func$;\n",
			SortText:      "2_CREATE FUNCTION",
		},
		{
			Label:         "CREATE TABLE",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建表",
			InsertText:    "CREATE TABLE \"${1:table_name}\" (\n\t\"${2:id}\" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY\n);\n",
			SortText:      "2_CREATE TABLE",
		},
	}
}

var kingbaseKeywords = []string{
	"ADD", "ALL", "ALTER", "ANALYZE", "AND", "ANY", "ARRAY", "AS", "ASC",
	"BEGIN", "BETWEEN", "BIGINT", "BIGSERIAL", "BOOLEAN", "BOTH", "BY",
	"CALL", "CASCADE", "CASE", "CAST", "CHAR", "CHARACTER", "CHECK", "COLLATE",
	"COLUMN", "COMMENT", "COMMIT", "CONCURRENTLY", "CONSTRAINT", "CREATE", "CROSS",
	"CURRENT_DATE", "CURRENT_SCHEMA", "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURRENT_USER",
	"DATE", "DECIMAL", "DEFAULT", "DELETE", "DESC", "DISTINCT", "DO", "DOUBLE", "DROP",
	"ELSE", "END", "ESCAPE", "EXCEPT", "EXCLUDE", "EXISTS", "EXPLAIN", "EXTRACT",
	"FALSE", "FETCH", "FLOAT", "FOR", "FOREIGN", "FROM", "FULL", "FUNCTION", "GENERATED",
	"GRANT", "GROUP", "HAVING", "IDENTITY", "IF", "ILIKE", "IN", "INDEX", "INNER",
	"INSERT", "INT", "INTEGER", "INTERSECT", "INTO", "IS", "JOIN", "JSON", "JSONB",
	"KEY", "LANGUAGE", "LATERAL", "LEFT", "LIKE", "LIMIT", "LOCAL", "MATERIALIZED",
	"NATURAL", "NOT", "NULL", "NUMERIC", "OFFSET", "ON", "ONLY", "OR", "ORDER", "OUTER",
	"OVER", "PARTITION", "PLPGSQL", "PRIMARY", "PROCEDURE", "PUBLIC", "RECURSIVE",
	"REFERENCES", "RENAME", "REPLACE", "RETURNING", "RETURNS", "REVOKE", "RIGHT", "ROLLBACK",
	"ROW", "ROWS", "SCHEMA", "SELECT", "SERIAL", "SEQUENCE", "SET", "SMALLINT", "SOME",
	"START", "TABLE", "TABLESPACE", "TEMP", "TEMPORARY", "THEN", "TIME", "TIMESTAMP",
	"TO", "TRANSACTION", "TRIGGER", "TRUE", "TRUNCATE", "UNION", "UNIQUE", "UNLOGGED",
	"UPDATE", "USER", "USING", "UUID", "VALUES", "VARCHAR", "VIEW", "WHEN", "WHERE",
	"WINDOW", "WITH",
}
