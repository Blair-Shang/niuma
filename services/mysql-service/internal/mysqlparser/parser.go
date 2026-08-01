// Package mysqlparser 将 TiDB parser 适配为 sqllsp.DialectParser。
//
// 覆盖范围：
//   - 常规 DML/DDL 语法诊断（TiDB parser，MySQL 兼容）
//   - 客户端 DELIMITER 预处理后再诊断（过程模板不误报）
//   - 补全槽位：启发式（FROM/JOIN/SET/WHERE…）+ 关键字 + 内置函数
//   - DocumentSymbol / Definition / LocalNames / Format（可选 LSP 能力）
//
// 例程（PROCEDURE/FUNCTION）：外壳启发式 + BEGIN…END 体内顶层语句 TiDB 分句诊断。
//
// 尚未齐全（后续加深，不阻塞 LSP）：
//   - 触发器完整 AST 语义
//   - 别名解析、多表 JOIN 列归属的更深语义
//   - 预处理器以外的全部 MySQL 8 专有语法边角
package mysqlparser

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/pingcap/tidb/pkg/parser"
	_ "github.com/pingcap/tidb/pkg/parser/test_driver" // 注册默认驱动

	"niuma/pkg/sqllsp"
)

var lineColRe = regexp.MustCompile(`(?i)line\s+(\d+)\s+column\s+(\d+)`)

// Parser 实现 sqllsp.DialectParser（MySQL）及可选扩展接口。
type Parser struct {
	keywords []string
}

// New 创建 MySQL 方言解析器。
func New() *Parser {
	return &Parser{keywords: mysqlKeywords}
}

// Keywords 返回关键字。
func (p *Parser) Keywords() []string {
	return p.keywords
}

// Functions 返回内置函数名（高亮 / 词表同源）。
func (p *Parser) Functions() []string {
	return mysqlBuiltinFunctionNames()
}

// Diagnostics 用 TiDB parser 解析；半成品语句返回语法错误诊断。
// 先做 DELIMITER 客户端指令预处理，避免过程体整段误报。
// CREATE PROCEDURE/FUNCTION 走例程专用通道（外壳启发式 + 体内分句 TiDB），
// 避免 CREATE FUNCTION 在 FUNCTION 关键字处的假阳性，并暴露正文语法错。
func (p *Parser) Diagnostics(_, text string) []sqllsp.Diagnostic {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}
	normalized := preprocessDelimiter(text)
	if isRoutineDDL(normalized) {
		return diagnoseRoutine(normalized)
	}
	pr := parser.New()
	_, _, err := pr.Parse(normalized, "", "")
	if err == nil {
		return nil
	}
	msg := err.Error()
	// 半成品输入常见近 EOF 错误：降噪为 Hint，避免边敲边整屏红
	severity := 1
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "near \"\"") ||
		(strings.Contains(lower, "expects") && strings.HasSuffix(strings.TrimSpace(trimmed), ",")) ||
		strings.HasSuffix(strings.TrimSpace(trimmed), "(") {
		severity = 4 // Hint
	}
	line, col := 0, 0
	if m := lineColRe.FindStringSubmatch(msg); len(m) == 3 {
		if l, e := strconv.Atoi(m[1]); e == nil && l > 0 {
			line = l - 1
		}
		if c, e := strconv.Atoi(m[2]); e == nil && c > 0 {
			col = c - 1
		}
	}
	return []sqllsp.Diagnostic{{
		Range: sqllsp.Range{
			Start: sqllsp.Position{Line: line, Character: col},
			End:   sqllsp.Position{Line: line, Character: col + 1},
		},
		Severity: severity,
		Source:   "mysql-lsp",
		Message:  msg,
	}}
}

// CompletionContext 启发式槽位 + 关键字 + 内置函数 + CREATE 片段 + 例程局部名。
func (p *Parser) CompletionContext(text string, pos sqllsp.Position) sqllsp.CompletionContext {
	cc := sqllsp.HeuristicCompletionContext(text, pos, p.keywords)
	cc.Snippets = mysqlCreateSnippets()
	cc.Functions = mysqlBuiltinFunctions()

	normalized := preprocessDelimiter(text)
	if info := parseRoutineScope(normalized, 0); info != nil {
		cc.Locals = info.localNames()
	}

	if inRoutineBodyAt(text, pos) {
		cc.Expect = []sqllsp.CompletionKind{
			sqllsp.KindKeyword,
			sqllsp.KindFunction,
			sqllsp.KindRoutine,
			sqllsp.KindColumn,
			sqllsp.KindTable,
			sqllsp.KindSchema,
		}
		cc.RoutineFilter = "function"
	}
	return cc
}

// DocumentSymbols 实现 sqllsp.DocumentSymbolProvider。
func (p *Parser) DocumentSymbols(text string) []sqllsp.DocumentSymbol {
	return DocumentSymbols(text)
}

// DefinitionTarget 实现 sqllsp.DefinitionProvider。
func (p *Parser) DefinitionTarget(text string, pos sqllsp.Position) *sqllsp.DefinitionTarget {
	return DefinitionAt(text, pos)
}

// FormatDocument 实现 sqllsp.FormatProvider。
func (p *Parser) FormatDocument(text string) (string, bool) {
	return FormatDocument(text)
}

// LocalNames 实现 sqllsp.LocalScopeProvider。
func (p *Parser) LocalNames(text string) []string {
	normalized := preprocessDelimiter(text)
	lower := strings.ToLower(normalized)
	if !isRoutineDDL(normalized) &&
		!strings.Contains(lower, "procedure") &&
		!strings.Contains(lower, "function") {
		return nil
	}
	info := parseRoutineScope(normalized, 0)
	if info == nil {
		return nil
	}
	return info.localNames()
}

func mysqlCreateSnippets() []sqllsp.CompletionItem {
	return []sqllsp.CompletionItem{
		{
			Label:         "CREATE VIEW",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建视图",
			InsertText:    "CREATE OR REPLACE VIEW `${1:view_name}` AS\nSELECT ${2:*}\nFROM `${3:table}`;\n",
			SortText:      "2_CREATE VIEW",
		},
		{
			Label:         "CREATE PROCEDURE",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建存储过程",
			InsertText:    "DELIMITER $$\nCREATE PROCEDURE `${1:proc_name}`(${2:})\nBEGIN\n\t${3:-- body}\nEND$$\nDELIMITER ;\n",
			SortText:      "2_CREATE PROCEDURE",
		},
		{
			Label:         "CREATE FUNCTION",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建函数",
			InsertText:    "DELIMITER $$\nCREATE FUNCTION `${1:func_name}`(${2:}) RETURNS ${3:INT}\nDETERMINISTIC\nBEGIN\n\t${4:RETURN 0;}\nEND$$\nDELIMITER ;\n",
			SortText:      "2_CREATE FUNCTION",
		},
		{
			Label:         "CREATE TABLE",
			Kind:          sqllsp.LSPKindSnippet,
			Detail:        "snippet",
			Documentation: "创建表",
			InsertText:    "CREATE TABLE `${1:table_name}` (\n\t`${2:id}` INT NOT NULL AUTO_INCREMENT,\n\tPRIMARY KEY (`${2:id}`)\n);\n",
			SortText:      "2_CREATE TABLE",
		},
	}
}

// ParseOK 供测试：完整语句可解析。
func ParseOK(sql string) bool {
	pr := parser.New()
	_, _, err := pr.Parse(preprocessDelimiter(sql), "", "")
	return err == nil
}

var mysqlKeywords = []string{
	"ADD", "AFTER", "ALGORITHM", "ALL", "ALTER", "ANALYZE", "AND", "AS", "ASC", "AUTO_INCREMENT",
	"BEFORE", "BEGIN", "BETWEEN", "BIGINT", "BINARY", "BLOB", "BOTH", "BY", "CALL", "CASCADE",
	"CASE", "CHANGE", "CHAR", "CHARACTER", "CHECK", "CLOSE", "COLLATE", "COLUMN", "COMMENT",
	"COMMIT", "CONDITION", "CONSTRAINT", "CONTINUE", "CREATE", "CROSS", "CURSOR",
	"CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURRENT_USER", "DATABASE",
	"DATE", "DATETIME", "DECIMAL", "DECLARE", "DEFAULT", "DELAYED", "DELETE", "DESC", "DESCRIBE",
	"DETERMINISTIC", "DISTINCT", "DIV", "DO", "DOUBLE", "DROP", "DUAL", "EACH", "ELSE", "ELSEIF",
	"END", "ENGINE", "ENUM", "ESCAPE", "EXISTS", "EXIT", "EXPLAIN", "FALSE", "FETCH", "FLOAT",
	"FOR", "FORCE", "FOREIGN", "FROM", "FULL", "FUNCTION", "GENERATED", "GET", "GRANT", "GROUP",
	"HANDLER", "HAVING", "IF", "IGNORE", "IN", "INDEX", "INNER", "INOUT", "INSERT", "INT",
	"INTEGER", "INTO", "IS", "ITERATE", "JOIN", "JSON", "KEY", "KEYS", "KILL", "LANGUAGE",
	"LEAVE", "LEFT", "LIKE", "LIMIT", "LOOP", "LOCK", "LONGBLOB", "LONGTEXT", "MATCH",
	"MEDIUMBLOB", "MEDIUMINT", "MEDIUMTEXT", "MOD", "MODIFIES", "NATURAL", "NOT", "NO", "NULL",
	"NUMERIC", "ON", "OPEN", "OR", "ORDER", "OUT", "OUTER", "OVER", "PARTITION", "PRECISION",
	"PRIMARY", "PROCEDURE", "RANGE", "READS", "REFERENCES", "REGEXP", "RELEASE", "RENAME",
	"REPEAT", "REPLACE", "RESIGNAL", "RESTRICT", "RETURN", "RETURNS", "REVOKE", "RIGHT",
	"ROLLBACK", "ROW", "ROWS", "SAVEPOINT", "SCHEMA", "SELECT", "SEPARATOR", "SET", "SHOW",
	"SIGNAL", "SIGNED", "SMALLINT", "SQL", "SQLEXCEPTION", "SQLSTATE", "SQLWARNING", "START",
	"STRAIGHT_JOIN", "TABLE", "TABLES", "TEMPORARY", "TEXT", "THEN", "TIME", "TIMESTAMP",
	"TINYBLOB", "TINYINT", "TINYTEXT", "TO", "TRANSACTION", "TRIGGER", "TRUE", "TRUNCATE",
	"UNDO", "UNION", "UNIQUE", "UNLOCK", "UNSIGNED", "UNTIL", "UPDATE", "USE", "USING",
	"VALUES", "VARBINARY", "VARCHAR", "VIEW", "WHEN", "WHERE", "WHILE", "WITH", "XOR", "YEAR",
	"ZEROFILL",
}
