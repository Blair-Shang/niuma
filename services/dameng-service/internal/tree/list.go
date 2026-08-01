// Package tree lists Dameng schemas and schema-scoped objects.
package tree

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type ListParams struct {
	Filter        string
	Limit         int
	ExcludeSystem bool
	Schema        string
	Types         []string
	RoutineKinds  []string
}
type SchemaItem struct {
	Name string `json:"name"`
}
type SchemaResult struct {
	Schemas   []SchemaItem `json:"schemas"`
	Truncated bool         `json:"truncated,omitempty"`
}
type ObjectItem struct {
	Name string `json:"name"`
	Type string `json:"type"`
}
type ObjectResult struct {
	Tables    []ObjectItem `json:"tables,omitempty"`
	Routines  []ObjectItem `json:"routines,omitempty"`
	Sequences []ObjectItem `json:"sequences,omitempty"`
	Truncated bool         `json:"truncated,omitempty"`
}

const (
	DefaultLimit = 500
	MaxLimit     = 5000
)

func limit(n int) int {
	if n <= 0 {
		return DefaultLimit
	}
	if n > MaxLimit {
		return MaxLimit
	}
	return n
}
func IsSystemUser(n string) bool {
	switch strings.ToUpper(strings.TrimSpace(n)) {
	case "SYS", "SYSAUDITOR", "SYSSSO", "CTISYS", "SYSGEO", "INFORMATION_SCHEMA":
		return true
	}
	return false
}
func ListSchemas(ctx context.Context, db *sql.DB, p ListParams) (SchemaResult, error) {
	rows, e := db.QueryContext(ctx, "SELECT USERNAME FROM ALL_USERS WHERE UPPER(USERNAME) LIKE UPPER(?) ORDER BY USERNAME", strings.TrimSpace(p.Filter)+"%")
	if e != nil {
		rows, e = db.QueryContext(ctx, "SELECT USERNAME FROM USER_USERS WHERE UPPER(USERNAME) LIKE UPPER(?) ORDER BY USERNAME", strings.TrimSpace(p.Filter)+"%")
	}
	if e != nil {
		return SchemaResult{}, fmt.Errorf("dameng: list schemas: %w", e)
	}
	defer rows.Close()
	out := SchemaResult{}
	for rows.Next() {
		var n string
		if e = rows.Scan(&n); e != nil {
			return out, e
		}
		if p.ExcludeSystem && IsSystemUser(n) {
			continue
		}
		if len(out.Schemas) >= limit(p.Limit) {
			out.Truncated = true
			break
		}
		out.Schemas = append(out.Schemas, SchemaItem{n})
	}
	return out, rows.Err()
}
func ListTables(ctx context.Context, db *sql.DB, p ListParams) (ObjectResult, error) {
	types := map[string]bool{}
	for _, v := range p.Types {
		types[strings.ToLower(v)] = true
	}
	if len(types) == 0 {
		types["table"] = true
		types["view"] = true
	}
	out := ObjectResult{}
	add := func(q, typ string) error {
		if !types[typ] {
			return nil
		}
		r, e := db.QueryContext(ctx, q, p.Schema, strings.TrimSpace(p.Filter)+"%")
		if e != nil {
			return e
		}
		defer r.Close()
		for r.Next() {
			var n string
			if e = r.Scan(&n); e != nil {
				return e
			}
			if len(out.Tables) >= limit(p.Limit) {
				out.Truncated = true
				return nil
			}
			out.Tables = append(out.Tables, ObjectItem{n, typ})
		}
		return r.Err()
	}
	if e := add("SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER=? AND UPPER(TABLE_NAME) LIKE UPPER(?) ORDER BY TABLE_NAME", "table"); e != nil {
		return out, fmt.Errorf("dameng: list tables: %w", e)
	}
	if !out.Truncated {
		if e := add("SELECT VIEW_NAME FROM ALL_VIEWS WHERE OWNER=? AND UPPER(VIEW_NAME) LIKE UPPER(?) ORDER BY VIEW_NAME", "view"); e != nil {
			return out, fmt.Errorf("dameng: list views: %w", e)
		}
	}
	return out, nil
}
func ListRoutines(ctx context.Context, db *sql.DB, p ListParams) (ObjectResult, error) {
	allowed := map[string]bool{
		"PROCEDURE": true,
		"FUNCTION":  true,
		"PACKAGE":   true,
		"SYNONYM":   true,
		"TRIGGER":   true,
	}
	seen := map[string]bool{}
	types := make([]string, 0, len(p.Types))
	wantSynonym := false
	if len(p.Types) == 0 {
		types = []string{"PROCEDURE", "FUNCTION"}
	} else {
		for _, raw := range p.Types {
			t := strings.ToUpper(strings.TrimSpace(raw))
			if t == "" || !allowed[t] {
				continue
			}
			if t == "SYNONYM" {
				wantSynonym = true
				continue
			}
			if !seen[t] {
				types = append(types, t)
				seen[t] = true
			}
		}
	}
	if len(types) == 0 && !wantSynonym {
		types = []string{"PROCEDURE", "FUNCTION"}
	}

	o := ObjectResult{}
	filter := strings.TrimSpace(p.Filter) + "%"
	lim := limit(p.Limit)

	// 同义词：SYSOBJECTS(SYNOM) 优先，ALL_SYNONYMS 兜底
	if wantSynonym {
		items, truncated, e := listSynonyms(ctx, db, p.Schema, p.Filter, lim)
		if e != nil {
			return ObjectResult{}, e
		}
		o.Routines = append(o.Routines, items...)
		o.Truncated = truncated
		if o.Truncated || len(types) == 0 {
			return o, nil
		}
	}

	if len(types) == 0 {
		return o, nil
	}
	in := "'" + strings.Join(types, "','") + "'"
	query := "SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OWNER=? AND OBJECT_TYPE IN (" + in + ") AND UPPER(OBJECT_NAME) LIKE UPPER(?) ORDER BY OBJECT_NAME"
	r, e := db.QueryContext(ctx, query, p.Schema, filter)
	if e != nil {
		return ObjectResult{}, fmt.Errorf("dameng: list routines: %w", e)
	}
	defer r.Close()
	for r.Next() {
		var n, t string
		if e = r.Scan(&n, &t); e != nil {
			return o, e
		}
		kind := strings.ToLower(strings.TrimSpace(t))
		if len(o.Routines) >= lim {
			o.Truncated = true
			break
		}
		o.Routines = append(o.Routines, ObjectItem{n, kind})
	}
	return o, r.Err()
}
func ListSequences(ctx context.Context, db *sql.DB, p ListParams) (ObjectResult, error) {
	r, e := db.QueryContext(ctx, "SELECT SEQUENCE_NAME FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER=? AND UPPER(SEQUENCE_NAME) LIKE UPPER(?) ORDER BY SEQUENCE_NAME", p.Schema, strings.TrimSpace(p.Filter)+"%")
	if e != nil {
		return ObjectResult{}, fmt.Errorf("dameng: list sequences: %w", e)
	}
	defer r.Close()
	o := ObjectResult{}
	for r.Next() {
		var n string
		if e = r.Scan(&n); e != nil {
			return o, e
		}
		if len(o.Sequences) >= limit(p.Limit) {
			o.Truncated = true
			break
		}
		o.Sequences = append(o.Sequences, ObjectItem{n, "sequence"})
	}
	return o, r.Err()
}
