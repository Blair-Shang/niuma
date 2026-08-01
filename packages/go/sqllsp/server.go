package sqllsp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
)

// Server 是 SQL Language Server（单方言实例，可共享 Manager）。
type Server struct {
	Parser  DialectParser
	Catalog Catalog
	Conns   *Manager
	Notify  NotifyFunc
	// DefaultDatabase 补全缺省库（来自会话当前 database/schema）。
	DefaultDatabase func(sessionID string) string
	// CatalogLimit 默认检索条数。
	CatalogLimit int
	SourceName   string
	// TriggerCharacters 补全触发字符；空则默认 ".", " ", "`"。
	TriggerCharacters []string
}

// NewServer 创建 Server；conns 可为 nil（内部新建）。
// catalog 自动包一层短缓存，避免补全与语义诊断重复打字典。
func NewServer(parser DialectParser, catalog Catalog, conns *Manager, notify NotifyFunc) *Server {
	if conns == nil {
		conns = NewManager()
	}
	if catalog != nil {
		if _, ok := catalog.(*CachingCatalog); !ok {
			catalog = NewCachingCatalog(catalog, CatalogCacheTTL)
		}
	}
	return &Server{
		Parser:       parser,
		Catalog:      catalog,
		Conns:        conns,
		Notify:       notify,
		CatalogLimit: DefaultCatalogLimit,
		SourceName:   "sqllsp",
	}
}

// HandleMessage 处理一帧 JSON-RPC（client→server）。
// 若为 request，返回响应对象；若为 notification，返回 nil。
func (s *Server) HandleMessage(ctx context.Context, conn *Connection, raw json.RawMessage) (map[string]any, error) {
	var envelope struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("invalid json-rpc: %w", err)
	}
	if envelope.Method == "" {
		return nil, fmt.Errorf("json-rpc method required")
	}

	isReq := len(envelope.ID) > 0 && string(envelope.ID) != "null"
	result, err := s.dispatch(ctx, conn, envelope.Method, envelope.Params)
	if !isReq {
		return nil, nil
	}
	if err != nil {
		return map[string]any{
			"jsonrpc": "2.0",
			"id":      rawID(envelope.ID),
			"error": map[string]any{
				"code":    -32603,
				"message": err.Error(),
			},
		}, nil
	}
	return map[string]any{
		"jsonrpc": "2.0",
		"id":      rawID(envelope.ID),
		"result":  result,
	}, nil
}

func rawID(id json.RawMessage) any {
	var v any
	if err := json.Unmarshal(id, &v); err != nil {
		return nil
	}
	return v
}

func (s *Server) dispatch(ctx context.Context, conn *Connection, method string, params json.RawMessage) (any, error) {
	switch method {
	case "initialize":
		return s.initialize(params)
	case "initialized", "shutdown":
		return nil, nil
	case "exit":
		return nil, nil
	case "textDocument/didOpen":
		return nil, s.didOpen(conn, params)
	case "textDocument/didChange":
		return nil, s.didChange(conn, params)
	case "textDocument/didClose":
		return nil, s.didClose(conn, params)
	case "textDocument/completion":
		return s.completion(ctx, conn, params)
	case "textDocument/hover":
		return s.hover(ctx, conn, params)
	case "textDocument/documentSymbol":
		return s.documentSymbol(conn, params)
	case "textDocument/definition":
		return s.definition(ctx, conn, params)
	case "textDocument/formatting":
		return s.formatting(conn, params)
	case "textDocument/signatureHelp":
		return s.signatureHelp(ctx, conn, params)
	case "niuma/setSuggestDatabase":
		return nil, s.setSuggestDatabase(conn, params)
	default:
		return nil, fmt.Errorf("method not found: %s", method)
	}
}

func (s *Server) parser(conn *Connection) DialectParser {
	if conn != nil && conn.Parser != nil {
		return conn.Parser
	}
	return s.Parser
}

func (s *Server) quoteIdent(conn *Connection, name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return name
	}
	if q, ok := s.parser(conn).(IdentifierQuoter); ok {
		return q.QuoteIdent(name)
	}
	return name
}

func (s *Server) suggestDB(conn *Connection, uri string) string {
	if conn == nil {
		return ""
	}
	if uri != "" {
		if doc, ok := conn.Docs.get(uri); ok {
			if db := strings.TrimSpace(doc.SuggestDatabase); db != "" {
				return db
			}
		}
	}
	if db := strings.TrimSpace(conn.SuggestDatabase); db != "" {
		return db
	}
	if s.DefaultDatabase != nil {
		return strings.TrimSpace(s.DefaultDatabase(conn.SessionID))
	}
	return ""
}

// suggestSchema 文档/连接级 schema；空则由调用方回落到 suggestDB（MySQL 同义）。
func (s *Server) suggestSchema(conn *Connection, uri string) string {
	if conn == nil {
		return ""
	}
	if uri != "" {
		if doc, ok := conn.Docs.get(uri); ok {
			if sch := strings.TrimSpace(doc.SuggestSchema); sch != "" {
				return sch
			}
		}
	}
	return strings.TrimSpace(conn.SuggestSchema)
}

// catalogScope 解析补全/诊断用的「库 + 默认 schema」。
// MySQL/达梦：二者通常相同；金仓：Database=PG 库，Schema=public 等。
func (s *Server) catalogScope(conn *Connection, uri string) (catalogDB, defaultSchema string) {
	catalogDB = s.suggestDB(conn, uri)
	defaultSchema = s.suggestSchema(conn, uri)
	if defaultSchema == "" {
		defaultSchema = catalogDB
	}
	return catalogDB, defaultSchema
}

func (s *Server) setSuggestDatabase(conn *Connection, params json.RawMessage) error {
	var p struct {
		Database string `json:"database"`
		Schema   string `json:"schema"`
		URI      string `json:"uri"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return err
	}
	db := strings.TrimSpace(p.Database)
	sch := strings.TrimSpace(p.Schema)
	uri := strings.TrimSpace(p.URI)
	if uri != "" && conn.Docs != nil {
		conn.Docs.setSuggestDatabase(uri, db, sch)
		return nil
	}
	if s.Conns == nil {
		conn.SuggestDatabase = db
		if sch != "" {
			conn.SuggestSchema = sch
		}
		return nil
	}
	s.Conns.UpdateSuggestDatabase(conn.ID, db, sch)
	return nil
}

func (s *Server) initialize(params json.RawMessage) (any, error) {
	_ = params
	triggers := s.TriggerCharacters
	if len(triggers) == 0 {
		triggers = []string{".", " ", "`"}
	}
	parser := s.Parser
	caps := map[string]any{
		"textDocumentSync": map[string]any{
			"openClose": true,
			"change":    1, // Full
		},
		"completionProvider": map[string]any{
			"triggerCharacters": triggers,
		},
		"hoverProvider": true,
		"signatureHelpProvider": map[string]any{
			"triggerCharacters": []string{"(", ","},
		},
	}
	if _, ok := parser.(DocumentSymbolProvider); ok {
		caps["documentSymbolProvider"] = true
	}
	if _, ok := parser.(DefinitionProvider); ok {
		caps["definitionProvider"] = true
	}
	if _, ok := parser.(FormatProvider); ok {
		caps["documentFormattingProvider"] = true
	}
	return map[string]any{
		"capabilities": caps,
		"serverInfo": map[string]any{
			"name":    s.SourceName,
			"version": "0.4.0",
		},
	}, nil
}

type textDocItem struct {
	URI     string `json:"uri"`
	Version int    `json:"version"`
	Text    string `json:"text"`
}

func (s *Server) didOpen(conn *Connection, params json.RawMessage) error {
	var p struct {
		TextDocument textDocItem `json:"textDocument"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return err
	}
	conn.Docs.put(p.TextDocument.URI, p.TextDocument.Version, p.TextDocument.Text)
	s.publishDiagnostics(conn, p.TextDocument.URI, p.TextDocument.Text, p.TextDocument.Version)
	return nil
}

func (s *Server) didChange(conn *Connection, params json.RawMessage) error {
	var p struct {
		TextDocument struct {
			URI     string `json:"uri"`
			Version int    `json:"version"`
		} `json:"textDocument"`
		ContentChanges []struct {
			Text string `json:"text"`
		} `json:"contentChanges"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return err
	}
	if len(p.ContentChanges) == 0 {
		return nil
	}
	text := p.ContentChanges[len(p.ContentChanges)-1].Text
	conn.Docs.put(p.TextDocument.URI, p.TextDocument.Version, text)
	s.publishDiagnostics(conn, p.TextDocument.URI, text, p.TextDocument.Version)
	return nil
}

func (s *Server) didClose(conn *Connection, params json.RawMessage) error {
	var p struct {
		TextDocument struct {
			URI string `json:"uri"`
		} `json:"textDocument"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return err
	}
	s.cancelDiagnostics(conn, p.TextDocument.URI)
	conn.Docs.delete(p.TextDocument.URI)
	// 清空 markers
	s.emitDiagnostics(conn.ID, p.TextDocument.URI, 0, nil)
	return nil
}

func (s *Server) cancelDiagnostics(conn *Connection, uri string) {
	if conn == nil {
		return
	}
	conn.diagMu.Lock()
	defer conn.diagMu.Unlock()
	if cancel, ok := conn.diagCancel[uri]; ok && cancel != nil {
		cancel()
		delete(conn.diagCancel, uri)
	}
}

func (s *Server) publishDiagnostics(conn *Connection, uri, text string, version int) {
	conn.diagMu.Lock()
	if conn.diagCancel == nil {
		conn.diagCancel = make(map[string]context.CancelFunc)
		conn.diagGen = make(map[string]uint64)
	}
	if cancel, ok := conn.diagCancel[uri]; ok && cancel != nil {
		cancel()
	}
	conn.diagGen[uri]++
	gen := conn.diagGen[uri]
	ctx, cancel := context.WithCancel(context.Background())
	conn.diagCancel[uri] = cancel
	conn.diagMu.Unlock()

	// 异步诊断：didChange/didOpen 立刻返回，补全前 ensureDocSynced 不再被字典查询拖住。
	go func() {
		defer cancel()
		var diags []Diagnostic
		parser := s.parser(conn)
		if parser != nil {
			diags = parser.Diagnostics(uri, text)
			for i := range diags {
				if diags[i].Source == "" {
					diags[i].Source = s.SourceName
				}
				if diags[i].Severity == 0 {
					diags[i].Severity = 1
				}
			}
		}
		if ctx.Err() != nil {
			return
		}
		diags = append(diags, s.semanticDiagnostics(ctx, conn, uri, text)...)
		conn.diagMu.Lock()
		current := conn.diagGen[uri]
		conn.diagMu.Unlock()
		if current != gen || ctx.Err() != nil {
			return
		}
		s.emitDiagnostics(conn.ID, uri, version, diags)
	}()
}

func (s *Server) emitDiagnostics(connectionID, uri string, version int, diags []Diagnostic) {
	if s.Notify == nil {
		return
	}
	if diags == nil {
		diags = []Diagnostic{}
	}
	params := map[string]any{
		"uri":         uri,
		"diagnostics": diags,
	}
	if version > 0 {
		params["version"] = version
	}
	s.Notify(connectionID, map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/publishDiagnostics",
		"params":  params,
	})
}

func (s *Server) completion(ctx context.Context, conn *Connection, params json.RawMessage) (any, error) {
	var p struct {
		TextDocument struct {
			URI string `json:"uri"`
		} `json:"textDocument"`
		Position Position `json:"position"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}
	doc, ok := conn.Docs.get(p.TextDocument.URI)
	if !ok {
		return map[string]any{"isIncomplete": false, "items": []CompletionItem{}}, nil
	}
	items, incomplete, err := s.buildCompletion(ctx, conn, p.TextDocument.URI, doc.Text, p.Position)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"isIncomplete": incomplete,
		"items":        items,
	}, nil
}

func (s *Server) buildCompletion(ctx context.Context, conn *Connection, uri, text string, pos Position) ([]CompletionItem, bool, error) {
	parser := s.parser(conn)
	var cc CompletionContext
	if parser != nil {
		cc = parser.CompletionContext(text, pos)
	}
	if len(cc.Expect) == 0 {
		cc.Expect = []CompletionKind{KindKeyword, KindSchema, KindTable}
	}
	limit := s.CatalogLimit
	if limit <= 0 {
		limit = DefaultCatalogLimit
	}
	if limit > MaxCatalogLimit {
		limit = MaxCatalogLimit
	}

	defaultDB := s.suggestDB(conn, uri)
	defaultSchema := s.suggestSchema(conn, uri)
	offset := OffsetFromPosition(text, pos)
	if len(cc.Tables) == 0 {
		cc.Tables = ExtractTableRefs(text, offset)
	}

	// 用默认 schema 再解一次 alias. → 真实表
	if cc.Table != "" {
		schemaFallback := defaultSchema
		if schemaFallback == "" {
			schemaFallback = defaultDB
		}
		if sch, tbl, ok := ResolveDotQualifier(cc.Tables, cc.Table, schemaFallback); ok {
			if cc.Schema == "" || strings.EqualFold(cc.Schema, cc.Table) {
				cc.Schema = sch
			}
			cc.Table = tbl
		}
	}

	// catalogDB：MySQL=库；金仓=PG database；达梦=schema
	catalogDB, _ := s.catalogScope(conn, uri)
	if catalogDB == "" {
		catalogDB = defaultDB
	}
	schema := strings.TrimSpace(cc.Schema)
	if schema == "" {
		schema = defaultSchema
	}
	if schema == "" {
		schema = catalogDB
	}
	prefix := cc.Prefix
	var items []CompletionItem
	// 目录槽位始终 incomplete：客户端按键重查，避免空前缀结果被本地模糊过滤成「乱匹配」
	incomplete := false
	expectTable := false
	expectColumn := false
	for _, k := range cc.Expect {
		if k == KindTable {
			expectTable = true
			incomplete = true
		}
		if k == KindColumn {
			expectColumn = true
			incomplete = true
		}
		if k == KindSchema || k == KindRoutine {
			incomplete = true
		}
	}
	// FROM / JOIN 等表槽：表优先于关键字（ASC 等）
	kwSortPrefix := "0_"
	if expectTable && !expectColumn {
		kwSortPrefix = "2_"
	}

	seen := map[string]struct{}{}
	add := func(it CompletionItem) {
		key := fmt.Sprintf("%d:%s", it.Kind, strings.ToLower(it.Label))
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		items = append(items, it)
	}

	// 局部变量/参数优先
	for _, name := range cc.Locals {
		if prefix != "" && !strings.HasPrefix(strings.ToLower(name), strings.ToLower(prefix)) {
			continue
		}
		add(CompletionItem{
			Label:      name,
			Kind:       LSPKindVariable,
			Detail:     "local",
			InsertText: name,
			SortText:   "0_" + name,
		})
	}

	addColumns := func(sch, table string) {
		// CTE / 派生表：用投影列，不查 catalog
		if ref := FindTableRef(cc.Tables, table); ref != nil && ref.Virtual {
			for _, col := range ref.Columns {
				if prefix != "" && !strings.HasPrefix(strings.ToLower(col), strings.ToLower(prefix)) {
					continue
				}
				insert := s.quoteIdent(conn, col)
				detail := "cte/derived"
				if ref.Alias != "" {
					detail = ref.Alias
				} else if ref.Name != "" {
					detail = ref.Name
				}
				add(CompletionItem{
					Label:      col,
					Kind:       LSPKindField,
					Detail:     detail,
					InsertText: insert,
					SortText:   "0_" + col,
				})
			}
			return
		}
		if s.Catalog == nil || sch == "" || table == "" {
			return
		}
		hits, trunc, err := s.Catalog.ListColumns(ctx, CatalogParams{
			SessionID: conn.SessionID,
			Database:  catalogDB,
			Schema:    sch,
			Table:     table,
			Prefix:    prefix,
			Limit:     limit,
		})
		if err != nil {
			return
		}
		if trunc {
			incomplete = true
		}
		for _, h := range hits {
			detail := h.DataType
			if h.Table != "" && len(cc.Tables) > 1 {
				detail = h.Table + "." + h.DataType
			}
			insert := s.quoteIdent(conn, h.Name)
			add(CompletionItem{
				Label:      h.Name,
				Kind:       LSPKindField,
				Detail:     detail,
				InsertText: insert,
				SortText:   "0_" + h.Name,
			})
		}
	}

	for _, kind := range cc.Expect {
		switch kind {
		case KindKeyword:
			kws := cc.Keywords
			if len(kws) == 0 && parser != nil {
				kws = parser.Keywords()
			}
			for _, kw := range kws {
				if prefix != "" && !strings.HasPrefix(strings.ToLower(kw), strings.ToLower(prefix)) {
					continue
				}
				add(CompletionItem{
					Label:      kw,
					Kind:       LSPKindKeyword,
					InsertText: kw,
					// 表槽降级关键字；列槽/默认仍靠前
					SortText: kwSortPrefix + kw,
				})
			}
			for _, sn := range cc.Snippets {
				if prefix != "" && !strings.HasPrefix(strings.ToLower(sn.Label), strings.ToLower(prefix)) {
					continue
				}
				if sn.Kind == 0 {
					sn.Kind = LSPKindSnippet
				}
				if sn.SortText == "" {
					sn.SortText = "2_" + sn.Label
				}
				add(sn)
			}
		case KindSchema:
			if s.Catalog == nil {
				continue
			}
			hits, trunc, err := s.Catalog.ListSchemas(ctx, CatalogParams{
				SessionID: conn.SessionID,
				Database:  catalogDB,
				Prefix:    prefix,
				Limit:     limit,
			})
			if err != nil {
				continue
			}
			if trunc {
				incomplete = true
			}
			for _, h := range hits {
				insert := s.quoteIdent(conn, h.Name)
				add(CompletionItem{
					Label:      h.Name,
					Kind:       LSPKindModule,
					Detail:     "database",
					InsertText: insert,
					SortText:   "1_" + h.Name,
				})
			}
		case KindTable:
			if s.Catalog == nil || schema == "" {
				continue
			}
			hits, trunc, err := s.Catalog.ListTables(ctx, CatalogParams{
				SessionID: conn.SessionID,
				Database:  catalogDB,
				Schema:    schema,
				Prefix:    prefix,
				Limit:     limit,
			})
			if err != nil {
				continue
			}
			if trunc {
				incomplete = true
			}
			for _, h := range hits {
				detail := h.Type
				if detail == "" {
					detail = "table"
				}
				if h.Schema != "" && h.Schema != schema {
					detail = detail + " · " + h.Schema
				} else if schema != "" {
					detail = detail + " · " + schema
				}
				insert := s.quoteIdent(conn, h.Name)
				// 表槽优先于关键字（0_）
				sortPrefix := "0_"
				if expectColumn {
					sortPrefix = "1_"
				}
				add(CompletionItem{
					Label:      h.Name,
					Kind:       LSPKindClass,
					Detail:     detail,
					InsertText: insert,
					SortText:   sortPrefix + h.Name,
				})
			}
		case KindColumn:
			table := strings.TrimSpace(cc.Table)
			if table != "" {
				addColumns(schema, table)
				continue
			}
			// 无限定列槽：绑定表列并集（含 CTE/派生表投影）
			for _, r := range cc.Tables {
				name := r.Name
				if r.Alias != "" {
					name = r.Alias
				}
				if r.Virtual {
					addColumns("", name)
					continue
				}
				sch := coalesceSchema(r.Schema, defaultSchema)
				if sch == "" {
					sch = catalogDB
				}
				addColumns(sch, r.Name)
			}
		case KindFunction:
			for _, fn := range cc.Functions {
				if prefix != "" && !strings.HasPrefix(strings.ToLower(fn.Label), strings.ToLower(prefix)) {
					continue
				}
				if fn.Kind == 0 {
					fn.Kind = LSPKindFunction
				}
				if fn.SortText == "" {
					fn.SortText = "0f_" + fn.Label
				}
				if fn.Detail == "" {
					fn.Detail = "function"
				}
				add(fn)
			}
		case KindRoutine:
			rc, ok := s.Catalog.(RoutineCatalog)
			if !ok || schema == "" {
				continue
			}
			hits, trunc, err := rc.ListRoutines(ctx, CatalogParams{
				SessionID: conn.SessionID,
				Database:  catalogDB,
				Schema:    schema,
				Prefix:    prefix,
				Limit:     limit,
			})
			if err != nil {
				continue
			}
			if trunc {
				incomplete = true
			}
			filter := strings.ToLower(strings.TrimSpace(cc.RoutineFilter))
			for _, h := range hits {
				typ := strings.ToLower(strings.TrimSpace(h.Type))
				if filter != "" && typ != filter {
					continue
				}
				kind := LSPKindFunction
				detail := "function"
				sortPrefix := "0r_"
				if typ == "procedure" {
					kind = LSPKindMethod
					detail = "procedure"
					sortPrefix = "0p_"
				}
				quoted := s.quoteIdent(conn, h.Name)
				insert := quoted + "(${1})"
				add(CompletionItem{
					Label:      h.Name,
					Kind:       kind,
					Detail:     detail,
					InsertText: insert,
					SortText:   sortPrefix + h.Name,
				})
			}
		}
	}
	return items, incomplete, nil
}

// OffsetFromPosition 将 LSP Position 转为字节偏移（按 UTF-16 近似：ASCII/BMP 字符）。
func OffsetFromPosition(text string, pos Position) int {
	line, col := pos.Line, pos.Character
	if line < 0 {
		line = 0
	}
	if col < 0 {
		col = 0
	}
	curLine := 0
	for i := 0; i < len(text); {
		if curLine == line {
			// 在本行内前进 col 个 UTF-16 code unit（简化：按 rune，非 BMP 算 2）
			remain := col
			for i < len(text) && text[i] != '\n' && remain > 0 {
				r, size := decodeRune(text[i:])
				if r == '\r' {
					i += size
					continue
				}
				units := 1
				if r > 0xFFFF {
					units = 2
				}
				remain -= units
				i += size
			}
			return i
		}
		if text[i] == '\n' {
			curLine++
			i++
			continue
		}
		_, size := decodeRune(text[i:])
		i += size
	}
	return len(text)
}

func decodeRune(s string) (rune, int) {
	if s == "" {
		return 0, 0
	}
	r := rune(s[0])
	if r < 0x80 {
		return r, 1
	}
	for i, rr := range s {
		if i == 0 {
			r = rr
			continue
		}
		return r, i
	}
	return r, len(s)
}

// IdentPrefixAt 提取光标前标识符前缀。
func IdentPrefixAt(text string, offset int) string {
	if offset > len(text) {
		offset = len(text)
	}
	if offset < 0 {
		offset = 0
	}
	i := offset
	for i > 0 {
		r := rune(text[i-1])
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$' {
			i--
			continue
		}
		// 反引号内：向前找开引号
		break
	}
	return text[i:offset]
}

// LinePrefix 返回光标所在行光标前文本（小写，用于启发式）。
func LinePrefix(text string, offset int) string {
	if offset > len(text) {
		offset = len(text)
	}
	start := offset
	for start > 0 && text[start-1] != '\n' {
		start--
	}
	return text[start:offset]
}

func (s *Server) documentSymbol(conn *Connection, params json.RawMessage) (any, error) {
	provider, ok := s.parser(conn).(DocumentSymbolProvider)
	if !ok {
		return []DocumentSymbol{}, nil
	}
	var p struct {
		TextDocument struct {
			URI string `json:"uri"`
		} `json:"textDocument"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}
	doc, ok := conn.Docs.get(p.TextDocument.URI)
	if !ok {
		return []DocumentSymbol{}, nil
	}
	return provider.DocumentSymbols(doc.Text), nil
}

func (s *Server) definition(ctx context.Context, conn *Connection, params json.RawMessage) (any, error) {
	provider, ok := s.parser(conn).(DefinitionProvider)
	if !ok {
		return nil, nil
	}
	var p struct {
		TextDocument struct {
			URI string `json:"uri"`
		} `json:"textDocument"`
		Position Position `json:"position"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}
	doc, found := conn.Docs.get(p.TextDocument.URI)
	if !found {
		return nil, nil
	}
	target := provider.DefinitionTarget(doc.Text, p.Position)
	if target == nil {
		return nil, nil
	}
	// local / routine：直接返回文档内位置
	if target.Kind == "local" || target.Kind == "routine" {
		return Location{URI: p.TextDocument.URI, Range: target.Range}, nil
	}
	// table/column：若 catalog 能确认，仍跳到当前标识符（元数据无源码位置）
	if s.Catalog != nil && (target.Kind == "table" || target.Kind == "column") {
		catalogDB, defaultSchema := s.catalogScope(conn, p.TextDocument.URI)
		sch := strings.TrimSpace(target.Schema)
		if sch == "" {
			sch = defaultSchema
		}
		if target.Kind == "table" && sch != "" && target.Table != "" {
			hits, _, err := s.Catalog.ListTables(ctx, CatalogParams{
				SessionID: conn.SessionID,
				Database:  catalogDB,
				Schema:    sch,
				Prefix:    target.Table,
				Limit:     20,
			})
			if err == nil {
				for _, h := range hits {
					if strings.EqualFold(h.Name, target.Table) {
						return Location{URI: p.TextDocument.URI, Range: target.Range}, nil
					}
				}
			}
		}
		if target.Kind == "column" && sch != "" && target.Table != "" && target.Name != "" {
			hits, _, err := s.Catalog.ListColumns(ctx, CatalogParams{
				SessionID: conn.SessionID,
				Database:  catalogDB,
				Schema:    sch,
				Table:     target.Table,
				Prefix:    target.Name,
				Limit:     50,
			})
			if err == nil {
				for _, h := range hits {
					if strings.EqualFold(h.Name, target.Name) {
						return Location{URI: p.TextDocument.URI, Range: target.Range}, nil
					}
				}
			}
		}
	}
	return Location{URI: p.TextDocument.URI, Range: target.Range}, nil
}

func (s *Server) signatureHelp(ctx context.Context, conn *Connection, params json.RawMessage) (any, error) {
	var p struct {
		TextDocument struct {
			URI string `json:"uri"`
		} `json:"textDocument"`
		Position Position `json:"position"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}
	doc, ok := conn.Docs.get(p.TextDocument.URI)
	if !ok {
		return nil, nil
	}
	site := ParseCallSite(doc.Text, p.Position)
	if site == nil || site.Name == "" {
		return nil, nil
	}

	var sig *SignatureInformation
	if bp, ok := s.parser(conn).(BuiltinSignatureProvider); ok {
		sig = bp.BuiltinSignature(site.Name)
	}
	if sig == nil {
		sig = s.lookupRoutineSignature(ctx, conn, p.TextDocument.URI, site)
	}
	if sig == nil {
		return nil, nil
	}

	activeParam := site.ActiveParameter
	if len(sig.Parameters) == 0 {
		activeParam = 0
	} else if activeParam >= len(sig.Parameters) {
		activeParam = len(sig.Parameters) - 1
	} else if activeParam < 0 {
		activeParam = 0
	}
	return SignatureHelp{
		Signatures:      []SignatureInformation{*sig},
		ActiveSignature: 0,
		ActiveParameter: activeParam,
	}, nil
}

func (s *Server) lookupRoutineSignature(ctx context.Context, conn *Connection, uri string, site *CallSite) *SignatureInformation {
	pc, ok := s.Catalog.(RoutineParamCatalog)
	if !ok {
		return nil
	}
	catalogDB, defaultSchema := s.catalogScope(conn, uri)
	schema := strings.TrimSpace(site.Qualifier)
	if schema == "" {
		schema = defaultSchema
	}
	if schema == "" {
		return nil
	}

	kinds := []string{"function", "procedure"}
	if rc, ok := s.Catalog.(RoutineCatalog); ok {
		hits, _, err := rc.ListRoutines(ctx, CatalogParams{
			SessionID: conn.SessionID,
			Database:  catalogDB,
			Schema:    schema,
			Prefix:    site.Name,
			Limit:     50,
		})
		if err == nil {
			var matched []string
			for _, h := range hits {
				if !strings.EqualFold(h.Name, site.Name) {
					continue
				}
				typ := strings.ToLower(strings.TrimSpace(h.Type))
				if typ != "" {
					matched = append(matched, typ)
				}
			}
			if len(matched) > 0 {
				kinds = matched
			} else {
				return nil
			}
		}
	}

	for _, kind := range kinds {
		rs, err := pc.ListRoutineParameters(ctx, RoutineParamParams{
			SessionID: conn.SessionID,
			Database:  catalogDB,
			Schema:    schema,
			Name:      site.Name,
			Kind:      kind,
		})
		if err != nil || rs == nil {
			continue
		}
		if rs.Name == "" {
			rs.Name = site.Name
		}
		rs.Kind = kind
		return BuildRoutineSignatureInfo(rs)
	}
	return nil
}

// BuildRoutineSignatureInfo 将例程形参转为 SignatureInformation。
func BuildRoutineSignatureInfo(rs *RoutineSignature) *SignatureInformation {
	if rs == nil {
		return nil
	}
	params := rs.Parameters
	parts := make([]string, 0, len(params))
	for _, p := range params {
		parts = append(parts, p.Label)
	}
	label := rs.Name + "(" + strings.Join(parts, ", ") + ")"
	if rs.ReturnType != "" {
		label += " RETURNS " + rs.ReturnType
	}
	detail := rs.Kind
	if detail == "" {
		detail = "routine"
	}
	return &SignatureInformation{
		Label:         label,
		Documentation: detail,
		Parameters:    params,
	}
}

func (s *Server) formatting(conn *Connection, params json.RawMessage) (any, error) {
	provider, ok := s.parser(conn).(FormatProvider)
	if !ok {
		return []map[string]any{}, nil
	}
	var p struct {
		TextDocument struct {
			URI string `json:"uri"`
		} `json:"textDocument"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}
	doc, found := conn.Docs.get(p.TextDocument.URI)
	if !found {
		return []map[string]any{}, nil
	}
	formatted, ok := provider.FormatDocument(doc.Text)
	if !ok || formatted == doc.Text {
		return []map[string]any{}, nil
	}
	end := OffsetToPosition(doc.Text, len(doc.Text))
	return []map[string]any{
		{
			"range": Range{
				Start: Position{Line: 0, Character: 0},
				End:   end,
			},
			"newText": formatted,
		},
	}, nil
}
