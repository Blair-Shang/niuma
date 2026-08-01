// Package sqllsp 提供嵌入方言能力服务的 SQL Language Server 核心：
// JSON-RPC 文档同步、诊断、补全编排；解析与 catalog 由调用方注入。
package sqllsp

import "context"

// CompletionKind 表示补全槽位类型。
type CompletionKind string

const (
	KindKeyword  CompletionKind = "keyword"
	KindSchema   CompletionKind = "schema"
	KindTable    CompletionKind = "table"
	KindColumn   CompletionKind = "column"
	KindFunction CompletionKind = "function"
	KindRoutine  CompletionKind = "routine"
	KindSnippet  CompletionKind = "snippet"
)

// Position 是 LSP 0-based 行列。
type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

// Range 是 LSP 范围。
type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

// Diagnostic 是 LSP 诊断项。
type Diagnostic struct {
	Range    Range  `json:"range"`
	Severity int    `json:"severity,omitempty"` // 1=Error 2=Warning 3=Info 4=Hint
	Source   string `json:"source,omitempty"`
	Message  string `json:"message"`
}

// CompletionItem 是 LSP 补全项（精简字段）。
type CompletionItem struct {
	Label         string         `json:"label"`
	Kind          int            `json:"kind,omitempty"` // LSP CompletionItemKind
	Detail        string         `json:"detail,omitempty"`
	InsertText    string         `json:"insertText,omitempty"`
	Documentation string         `json:"documentation,omitempty"`
	SortText      string         `json:"sortText,omitempty"`
	Data          map[string]any `json:"data,omitempty"`
}

// CompletionContext 由方言解析器根据光标前文本给出。
type CompletionContext struct {
	// Expect 期望的对象种类（可多选，按优先级）。
	Expect []CompletionKind
	// Schema 当前已知 schema/database（表/列槽位时；别名已解开后为真实库）。
	Schema string
	// Table 当前已知表（列槽位时；别名已解开后为真实表名）。
	Table string
	// Prefix 标识符前缀（不含引号）。
	Prefix string
	// Keywords 方言关键字候选（可为空，由 Server 合并 Keywords()）。
	Keywords []string
	// Snippets 方言片段（CREATE PROCEDURE 等）；可空。
	Snippets []CompletionItem
	// Functions 方言内置函数（NOW / DATE_FORMAT 等）；可空。
	Functions []CompletionItem
	// Tables 当前语句已绑定的表引用（FROM/JOIN/UPDATE/INTO）。
	Tables []TableRef
	// Locals 过程参数 / DECLARE 变量（补全优先；语义诊断可忽略）。
	Locals []string
	// RoutineFilter 例程补全过滤：""=全部 / "function" / "procedure"。
	RoutineFilter string
}

// TableRef 语句中的表引用（可含别名）。
type TableRef struct {
	Schema string // database/schema；可空表示用默认库
	Name   string // 物理表名
	Alias  string // 别名；无别名时可与 Name 相同或为空
	// StartByte / EndByte 表名在原文中的字节区间（语义诊断用）。
	StartByte int
	EndByte   int
	// Virtual 为 true 表示 CTE / 派生表别名，不做 catalog 存在性检查。
	Virtual bool
	// Columns CTE / 派生表投影列（Virtual 时优先用于补全；可空表示未知）。
	Columns []string
}

// CatalogParams 对齐各库 catalog.* 检索入参。
type CatalogParams struct {
	SessionID     string
	Database      string
	Schema        string
	Table         string
	Prefix        string
	Limit         int
	ExcludeSystem bool
}

// SchemaHit / TableHit / ColumnHit 对齐 catalog 返回形状。
type SchemaHit struct {
	Name string
}

type TableHit struct {
	Name   string
	Type   string
	Schema string
}

type ColumnHit struct {
	Name     string
	DataType string
	Schema   string
	Table    string
}

// RoutineHit 存储过程 / 用户函数。
type RoutineHit struct {
	Name   string
	Type   string // procedure | function
	Schema string
}

// Catalog 由方言 service 注入，进程内查元数据（勿另开连接）。
type Catalog interface {
	ListSchemas(ctx context.Context, p CatalogParams) ([]SchemaHit, bool, error)
	ListTables(ctx context.Context, p CatalogParams) ([]TableHit, bool, error)
	ListColumns(ctx context.Context, p CatalogParams) ([]ColumnHit, bool, error)
}

// RoutineCatalog 可选：例程列表补全。
type RoutineCatalog interface {
	ListRoutines(ctx context.Context, p CatalogParams) ([]RoutineHit, bool, error)
}

// RoutineParamCatalog 可选：例程形参（签名提示）。
type RoutineParamCatalog interface {
	ListRoutineParameters(ctx context.Context, p RoutineParamParams) (*RoutineSignature, error)
}

// RoutineParamParams 例程形参查询。
type RoutineParamParams struct {
	SessionID string
	Database  string
	Schema    string
	Name      string
	Kind      string // procedure | function
}

// RoutineSignature 例程签名。
type RoutineSignature struct {
	Name       string
	Kind       string
	Parameters []ParameterInformation
	ReturnType string
}

// SignatureHelp LSP 签名帮助。
type SignatureHelp struct {
	Signatures      []SignatureInformation `json:"signatures"`
	ActiveSignature int                    `json:"activeSignature"`
	ActiveParameter int                    `json:"activeParameter"`
}

// SignatureInformation 单条签名。
type SignatureInformation struct {
	Label         string                 `json:"label"`
	Documentation string                 `json:"documentation,omitempty"`
	Parameters    []ParameterInformation `json:"parameters,omitempty"`
}

// ParameterInformation 形参说明。
type ParameterInformation struct {
	Label         string `json:"label"`
	Documentation string `json:"documentation,omitempty"`
}

// BuiltinSignatureProvider 可选：内置函数签名。
type BuiltinSignatureProvider interface {
	BuiltinSignature(name string) *SignatureInformation
}

// IdentifierQuoter 可选：补全插入时按方言引用标识符。
type IdentifierQuoter interface {
	QuoteIdent(name string) string
}

// StatementSpan 文档内一条语句的字节区间。
type StatementSpan struct {
	Start int
	Text  string
}

// StatementSplitter 可选：方言感知分句（达梦 Q-quote / 斜杠等）。
type StatementSplitter interface {
	SplitStatements(text string) []StatementSpan
}

// DialectParser 方言语法分析（现成库或启发式）。
type DialectParser interface {
	// Keywords 返回关键字列表。
	Keywords() []string
	// Diagnostics 对整份文档给出诊断（允许半成品 SQL）。
	Diagnostics(uri, text string) []Diagnostic
	// CompletionContext 根据光标位置推断补全槽位。
	CompletionContext(text string, pos Position) CompletionContext
}

// DocumentSymbol LSP 文档符号（精简）。
type DocumentSymbol struct {
	Name           string           `json:"name"`
	Detail         string           `json:"detail,omitempty"`
	Kind           int              `json:"kind"`
	Range          Range            `json:"range"`
	SelectionRange Range            `json:"selectionRange"`
	Children       []DocumentSymbol `json:"children,omitempty"`
}

// LSP SymbolKind（节选）。
const (
	SymbolFile          = 1
	SymbolModule        = 2
	SymbolNamespace     = 3
	SymbolPackage       = 4
	SymbolClass         = 5
	SymbolMethod        = 6
	SymbolProperty      = 7
	SymbolField         = 8
	SymbolConstructor   = 9
	SymbolEnum          = 10
	SymbolInterface     = 11
	SymbolFunction      = 12
	SymbolVariable      = 13
	SymbolConstant      = 14
	SymbolString        = 15
	SymbolNumber        = 16
	SymbolBoolean       = 17
	SymbolArray         = 18
	SymbolObject        = 19
	SymbolKey           = 20
	SymbolNull          = 21
	SymbolEnumMember    = 22
	SymbolStruct        = 23
	SymbolEvent         = 24
	SymbolOperator      = 25
	SymbolTypeParameter = 26
)

// Location LSP 位置。
type Location struct {
	URI   string `json:"uri"`
	Range Range  `json:"range"`
}

// DefinitionTarget 方言给出的跳转目标（Server 可再经 catalog 解析）。
type DefinitionTarget struct {
	Kind   string // table | column | routine | local
	Schema string
	Table  string
	Name   string
	Range  Range
}

// DocumentSymbolProvider 可选：文档大纲。
type DocumentSymbolProvider interface {
	DocumentSymbols(text string) []DocumentSymbol
}

// DefinitionProvider 可选：跳转定义目标。
type DefinitionProvider interface {
	DefinitionTarget(text string, pos Position) *DefinitionTarget
}

// FormatProvider 可选：服务端格式化；ok=false 表示不处理。
type FormatProvider interface {
	FormatDocument(text string) (formatted string, ok bool)
}

// LocalScopeProvider 可选：过程局部名（语义诊断降噪）。
type LocalScopeProvider interface {
	LocalNames(text string) []string
}

// NotifyFunc 向客户端推送 JSON-RPC 通知（如 publishDiagnostics）。
// message 为完整 JSON-RPC 对象（含 jsonrpc/method/params）。
type NotifyFunc func(connectionID string, message map[string]any)

// LSP CompletionItemKind 常量（与协议对齐）。
const (
	LSPKindText        = 1
	LSPKindMethod      = 2
	LSPKindFunction    = 3
	LSPKindConstructor = 4
	LSPKindField       = 5
	LSPKindVariable    = 6
	LSPKindClass       = 7
	LSPKindInterface   = 8
	LSPKindModule      = 9
	LSPKindProperty    = 10
	LSPKindUnit        = 11
	LSPKindValue       = 12
	LSPKindEnum        = 13
	LSPKindKeyword     = 14
	LSPKindSnippet     = 15
	LSPKindColor       = 16
	LSPKindFile        = 17
	LSPKindReference   = 18
	LSPKindFolder      = 19
	LSPKindEnumMember  = 20
	LSPKindConstant    = 21
	LSPKindStruct      = 22
	LSPKindEvent       = 23
	LSPKindOperator    = 24
	LSPKindTypeParam   = 25
)

// DefaultCatalogLimit 补全目录默认条数。
const DefaultCatalogLimit = 100

// MaxCatalogLimit 补全目录上限。
const MaxCatalogLimit = 500
