package sqllsp

import (
	"context"
	"fmt"
	"strings"
)

// semanticDiagnostics 基于 catalog 的未知表/列 Warning（语法诊断之外）。
func (s *Server) semanticDiagnostics(ctx context.Context, conn *Connection, uri, text string) []Diagnostic {
	if s.Catalog == nil || conn == nil {
		return nil
	}
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}
	// 半成品降噪：尾部开放结构少报
	if strings.HasSuffix(trimmed, ",") || strings.HasSuffix(trimmed, "(") ||
		strings.HasSuffix(strings.ToLower(trimmed), " from") ||
		strings.HasSuffix(strings.ToLower(trimmed), " join") {
		return nil
	}

	if ctx.Err() != nil {
		return nil
	}

	// 局部名集合：方言若提供 LocalScopeProvider，则过程体不再整段跳过
	localSet := map[string]struct{}{}
	parser := s.parser(conn)
	if lp, ok := parser.(LocalScopeProvider); ok {
		for _, n := range lp.LocalNames(text) {
			localSet[strings.ToLower(strings.TrimSpace(n))] = struct{}{}
		}
	} else {
		// 无局部作用域信息时：含 BEGIN…END 的过程/函数仍整段跳过（避免变量误报）
		lower := strings.ToLower(trimmed)
		if strings.Contains(lower, " begin") || strings.HasPrefix(lower, "begin") {
			if strings.Contains(lower, "end") && (strings.Contains(lower, "procedure") || strings.Contains(lower, "function") || strings.Contains(lower, "trigger")) {
				return nil
			}
		}
	}

	catalogDB, defaultSchema := s.catalogScope(conn, uri)
	src := s.SourceName
	if src == "" {
		src = "sqllsp"
	}

	var diags []Diagnostic
	for _, span := range splitDocumentForSemantic(parser, text) {
		if ctx.Err() != nil {
			return diags
		}
		stmt := span.Text
		if strings.TrimSpace(stmt) == "" {
			continue
		}
		stmtStart := span.Start
		refs := scanTableRefs(stmt)
		for i := range refs {
			refs[i].StartByte += stmtStart
			refs[i].EndByte += stmtStart
		}
		cteSet := map[string]struct{}{}
		for _, name := range ExtractCTENames(stmt) {
			cteSet[strings.ToLower(name)] = struct{}{}
		}

		tablesBySchema := map[string]map[string]struct{}{}
		schemaFailed := map[string]bool{}
		schemaTruncated := map[string]bool{}
		ensureTables := func(sch string) (map[string]struct{}, bool) {
			sch = strings.TrimSpace(sch)
			if sch == "" {
				return nil, false
			}
			if schemaFailed[sch] || schemaTruncated[sch] {
				return nil, false
			}
			if m, ok := tablesBySchema[sch]; ok {
				return m, true
			}
			hits, trunc, err := s.Catalog.ListTables(ctx, CatalogParams{
				SessionID: conn.SessionID,
				Database:  catalogDB,
				Schema:    sch,
				Limit:     MaxCatalogLimit,
			})
			if err != nil {
				schemaFailed[sch] = true
				return nil, false
			}
			if trunc {
				// 截断时不报未知表，避免假阳性
				schemaTruncated[sch] = true
				return nil, false
			}
			m := make(map[string]struct{}, len(hits))
			for _, h := range hits {
				m[strings.ToLower(h.Name)] = struct{}{}
			}
			tablesBySchema[sch] = m
			return m, true
		}

		for _, r := range refs {
			if r.Virtual {
				continue
			}
			sch := coalesceSchema(r.Schema, defaultSchema)
			if sch == "" || r.Name == "" {
				continue
			}
			if _, isLocal := localSet[strings.ToLower(r.Name)]; isLocal {
				continue
			}
			if _, isCTE := cteSet[strings.ToLower(r.Name)]; isCTE {
				continue
			}
			set, ok := ensureTables(sch)
			if !ok {
				continue
			}
			if _, exists := set[strings.ToLower(r.Name)]; exists {
				continue
			}
			start := OffsetToPosition(text, r.StartByte)
			end := OffsetToPosition(text, r.EndByte)
			diags = append(diags, Diagnostic{
				Range:    Range{Start: start, End: end},
				Severity: 2, // Warning
				Source:   src,
				Message:  fmt.Sprintf("unknown table: %s.%s", sch, r.Name),
			})
		}

		for _, qr := range FindQualifiedColumnRefs(stmt) {
			if _, isCTE := cteSet[strings.ToLower(qr.Qualifier)]; isCTE {
				continue
			}
			sch, tbl, ok := ResolveDotQualifier(refs, qr.Qualifier, defaultSchema)
			if !ok {
				continue
			}
			if sch == "" {
				continue
			}
			if _, isLocal := localSet[strings.ToLower(qr.Column)]; isLocal {
				continue
			}
			hits, trunc, err := s.Catalog.ListColumns(ctx, CatalogParams{
				SessionID: conn.SessionID,
				Database:  catalogDB,
				Schema:    sch,
				Table:     tbl,
				Limit:     MaxCatalogLimit,
			})
			if err != nil || trunc {
				continue
			}
			// 关系未解析到任何列时不报未知列（常见于系统表落到默认 schema、或 catalog 未覆盖）。
			if len(hits) == 0 {
				continue
			}
			found := false
			for _, h := range hits {
				if strings.EqualFold(h.Name, qr.Column) {
					found = true
					break
				}
			}
			if found {
				continue
			}
			absStart := stmtStart + qr.Start
			absEnd := stmtStart + qr.End
			diags = append(diags, Diagnostic{
				Range: Range{
					Start: OffsetToPosition(text, absStart),
					End:   OffsetToPosition(text, absEnd),
				},
				Severity: 2,
				Source:   src,
				Message:  fmt.Sprintf("unknown column: %s.%s", qr.Qualifier, qr.Column),
			})
		}
	}

	return diags
}

func splitDocumentForSemantic(parser DialectParser, text string) []StatementSpan {
	if sp, ok := parser.(StatementSplitter); ok {
		spans := sp.SplitStatements(text)
		if len(spans) > 0 {
			return spans
		}
	}
	return splitStatementsNaive(text)
}

// splitStatementsNaive 按顶层分号分句；跳过空尾片段（文档以 ; 结尾时）。
func splitStatementsNaive(text string) []StatementSpan {
	var out []StatementSpan
	start := 0
	depth := 0
	inStr := byte(0)
	for i := 0; i < len(text); i++ {
		c := text[i]
		if inStr != 0 {
			if c == inStr {
				if i+1 < len(text) && text[i+1] == inStr {
					i++
					continue
				}
				inStr = 0
			}
			continue
		}
		switch c {
		case '\'', '"', '`':
			inStr = c
		case '(':
			depth++
		case ')':
			if depth > 0 {
				depth--
			}
		case ';':
			if depth == 0 {
				frag := text[start:i]
				if strings.TrimSpace(frag) != "" {
					out = append(out, StatementSpan{Start: start, Text: frag})
				}
				start = i + 1
			}
		}
	}
	if start < len(text) {
		frag := text[start:]
		if strings.TrimSpace(frag) != "" {
			out = append(out, StatementSpan{Start: start, Text: frag})
		}
	}
	if len(out) == 0 && strings.TrimSpace(text) != "" {
		return []StatementSpan{{Start: 0, Text: text}}
	}
	return out
}
