// Package dmparser 将达梦方言适配为 sqllsp.DialectParser。
//
// 能力分层：
//   - StmtClassify + DML/DDL 轻量 Diagnostics（半成品 Hint 降噪）
//   - 例程外壳 + 体内分句诊断（对标 mysqlparser/routine）
//   - 私有工作 AST：TableRef / DECLARE / 参数 → 补全与语义
//   - 兼容模式（oracle/mysql）关键字与 Hint
//   - DocumentSymbol / Definition / Format（可选 LSP 能力）
package dmparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

// Parser 实现 sqllsp.DialectParser（Dameng）及可选扩展接口。
type Parser struct {
	keywords []string
	compat   CompatMode
}

// New 创建达梦方言解析器（兼容模式 Auto）。
func New() *Parser {
	return NewWithCompat(CompatAuto)
}

// NewWithCompat 按兼容模式创建解析器。
func NewWithCompat(compat CompatMode) *Parser {
	base := damengKeywords
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
	return damengBuiltinFunctionNames(p.compat)
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
		default:
			sub = diagnoseBalance(stmt)
			sub = append(sub, diagnoseTypos(stmt)...)
			sub = append(sub, diagnoseCompatSelect(stmt, p.compat, looksIncomplete(strings.TrimSpace(stmt)))...)
		}
		diags = append(diags, remapDiags(text, sp.start, stmt, sub)...)
	}
	return diags
}

// CompletionContext 启发式槽位 + 工作 AST（表绑定 / 局部变量）+ CREATE 片段。
func (p *Parser) CompletionContext(text string, pos sqllsp.Position) sqllsp.CompletionContext {
	cc := sqllsp.HeuristicCompletionContext(text, pos, p.keywords)
	cc.Snippets = damengCreateSnippets()
	cc.Functions = damengBuiltinFunctions(p.compat)

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

// SplitStatements 实现 sqllsp.StatementSplitter（达梦分句感知）。
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

func damengCreateSnippets() []sqllsp.CompletionItem {
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
			Documentation: "创建存储过程（PL/SQL，无 DELIMITER）",
			InsertText:    "CREATE OR REPLACE PROCEDURE \"${1:proc_name}\"(${2:})\nAS\nBEGIN\n\t${3:NULL;}\nEND;\n/\n",
			SortText:      "2_CREATE PROCEDURE",
		},
		{
			Label:         "CREATE FUNCTION",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建函数（PL/SQL，无 DELIMITER）",
			InsertText:    "CREATE OR REPLACE FUNCTION \"${1:func_name}\"(${2:})\nRETURN ${3:INT}\nAS\nBEGIN\n\t${4:RETURN 0;}\nEND;\n/\n",
			SortText:      "2_CREATE FUNCTION",
		},
		{
			Label:         "CREATE TABLE",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建表",
			InsertText:    "CREATE TABLE \"${1:table_name}\" (\n\t\"${2:id}\" INT IDENTITY(1, 1) NOT NULL,\n\tPRIMARY KEY (\"${2:id}\")\n);\n",
			SortText:      "2_CREATE TABLE",
		},
	}
}

var damengKeywords = []string{
	"ADD", "ALL", "ALTER", "AND", "ANY", "AS", "ASC", "AUTHORIZATION",
	"BEGIN", "BETWEEN", "BIGINT", "BINARY", "BLOB", "BOOLEAN", "BOTH", "BY",
	"CALL", "CASCADE", "CASE", "CAST", "CHAR", "CHARACTER", "CHECK", "CLOB", "CLOSE",
	"CLUSTER", "COLUMN", "COMMENT", "COMMIT", "CONNECT", "CONSTRAINT", "CONTINUE",
	"CREATE", "CROSS", "CURRENT", "CURRENT_DATE", "CURRENT_SCHEMA", "CURRENT_TIME",
	"CURRENT_TIMESTAMP", "CURRENT_USER", "CURSOR",
	"DATE", "DATETIME", "DECIMAL", "DECLARE", "DEFAULT", "DELETE", "DESC", "DISTINCT",
	"DOUBLE", "DROP", "ELSE", "ELSIF", "END", "ESCAPE", "EXCEPTION", "EXISTS", "EXIT",
	"EXPLAIN", "EXTRACT", "FALSE", "FETCH", "FLOAT", "FOR", "FOREIGN", "FROM", "FULL",
	"FUNCTION", "GOTO", "GRANT", "GROUP", "HAVING", "IDENTIFIED", "IDENTITY", "IF",
	"IMMEDIATE", "IN", "INDEX", "INNER", "INSERT", "INT", "INTEGER", "INTERSECT",
	"INTO", "IS", "JOIN", "KEY", "LEFT", "LIKE", "LIMIT", "LOOP", "MERGE", "MINUS",
	"NATURAL", "NO", "NOT", "NULL", "NUMBER", "NUMERIC", "OF", "OFFSET", "ON", "OPEN",
	"OR", "ORDER", "OUTER", "OVER", "PARTITION", "PRECISION", "PRIMARY", "PROCEDURE",
	"PUBLIC", "RAISE", "REAL", "REFERENCES", "REPLACE", "RESTRICT", "RETURN", "RETURNING",
	"REVOKE", "RIGHT", "ROLLBACK", "ROW", "ROWNUM", "ROWS", "SAVEPOINT", "SCHEMA",
	"SELECT", "SEQUENCE", "SESSION", "SET", "SMALLINT", "SOME", "START", "SYNONYM",
	"TABLE", "TABLESPACE", "THEN", "TIME", "TIMESTAMP", "TO", "TRANSACTION", "TRIGGER",
	"TRUE", "TRUNCATE", "UNION", "UNIQUE", "UPDATE", "USER", "USING", "VALUES",
	"VARCHAR", "VARCHAR2", "VIEW", "WHEN", "WHERE", "WHILE", "WITH", "XOR",
}
