package sqllsp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func (s *Server) hover(ctx context.Context, conn *Connection, params json.RawMessage) (any, error) {
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
	return s.buildHover(ctx, conn, p.TextDocument.URI, doc.Text, p.Position)
}

func (s *Server) buildHover(ctx context.Context, conn *Connection, uri, text string, pos Position) (any, error) {
	if s.Catalog == nil {
		return nil, nil
	}
	offset := OffsetFromPosition(text, pos)
	catalogDB, defaultSchema := s.catalogScope(conn, uri)
	refs := ExtractTableRefs(text, offset)

	left, right, start, end, ok := QualifiedIdentAt(text, offset)
	if !ok {
		return nil, nil
	}

	var md string
	if left != "" && right != "" {
		// qualifier.column 或 schema.table
		if sch, tbl, resolved := ResolveDotQualifier(refs, left, defaultSchema); resolved {
			hits, _, err := s.Catalog.ListColumns(ctx, CatalogParams{
				SessionID: conn.SessionID,
				Database:  catalogDB,
				Schema:    sch,
				Table:     tbl,
				Prefix:    right,
				Limit:     MaxCatalogLimit,
			})
			if err == nil {
				for _, h := range hits {
					if strings.EqualFold(h.Name, right) {
						qual := tbl
						if sch != "" {
							qual = sch + "." + tbl
						}
						md = fmt.Sprintf("```sql\n%s.%s\n```\n\n%s", qual, h.Name, h.DataType)
						break
					}
				}
			}
		}
		if md == "" {
			// schema.table
			sch := left
			tbl := right
			hits, _, err := s.Catalog.ListTables(ctx, CatalogParams{
				SessionID: conn.SessionID,
				Database:  catalogDB,
				Schema:    sch,
				Prefix:    tbl,
				Limit:     50,
			})
			if err == nil {
				for _, h := range hits {
					if strings.EqualFold(h.Name, tbl) {
						typ := h.Type
						if typ == "" {
							typ = "table"
						}
						md = fmt.Sprintf("```sql\n%s.%s\n```\n\n%s", sch, h.Name, typ)
						break
					}
				}
			}
		}
	} else {
		// 单标识符：别名/表名
		name := right
		if sch, tbl, resolved := ResolveDotQualifier(refs, name, defaultSchema); resolved {
			qual := tbl
			if sch != "" {
				qual = sch + "." + tbl
			}
			aliasNote := ""
			if !strings.EqualFold(name, tbl) {
				aliasNote = fmt.Sprintf("\n\nalias `%s`", name)
			}
			md = fmt.Sprintf("```sql\n%s\n```%s", qual, aliasNote)
		} else if defaultSchema != "" {
			hits, _, err := s.Catalog.ListTables(ctx, CatalogParams{
				SessionID: conn.SessionID,
				Database:  catalogDB,
				Schema:    defaultSchema,
				Prefix:    name,
				Limit:     20,
			})
			if err == nil {
				for _, h := range hits {
					if strings.EqualFold(h.Name, name) {
						typ := h.Type
						if typ == "" {
							typ = "table"
						}
						md = fmt.Sprintf("```sql\n%s.%s\n```\n\n%s", defaultSchema, h.Name, typ)
						break
					}
				}
			}
		}
	}

	if md == "" {
		return nil, nil
	}
	return map[string]any{
		"contents": map[string]any{
			"kind":  "markdown",
			"value": md,
		},
		"range": Range{
			Start: OffsetToPosition(text, start),
			End:   OffsetToPosition(text, end),
		},
	}, nil
}
