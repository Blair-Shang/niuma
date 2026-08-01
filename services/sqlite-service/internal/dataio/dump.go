package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"
)

type dumpObject struct {
	Name string
	Type string // table | view | index | trigger
	SQL  string
}

func dumpSql(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	params DumpParams,
) error {
	schema := schemaOrMain(params.Schema)
	objects, err := resolveDumpObjects(ctx, db, schema, params)
	if err != nil {
		return err
	}
	if len(objects) == 0 {
		return fmt.Errorf("sqlite: no objects to dump")
	}

	f, err := os.Create(params.OutputPath)
	if err != nil {
		return fmt.Errorf("sqlite: create dump file: %w", err)
	}
	defer f.Close()

	bw := bufio.NewWriterSize(f, 256*1024)
	defer func() { _ = bw.Flush() }()

	cw := &countingWriter{w: bw, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}

	header := fmt.Sprintf(
		"-- NiuMa SQLite dump\n-- format: niuma-sqlite-dump/1\n-- schema: %s\n-- generated: %s\n-- mode: %s\n-- dropIfExists: %v\n-- truncateBeforeData: %v\n\nPRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n\n",
		schema,
		time.Now().UTC().Format(time.RFC3339),
		params.Mode,
		params.DropIfExists,
		params.TruncateBeforeData,
	)
	if _, err := cw.Write([]byte(header)); err != nil {
		return err
	}

	includeStructure := params.Mode == DumpStructureAndData || params.Mode == DumpStructureOnly
	includeData := params.Mode == DumpStructureAndData || params.Mode == DumpDataOnly

	total := len(objects)
	for i, obj := range objects {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		m.emitProgress(taskID, PhaseRunning, cw.n, int64(i+1),
			fmt.Sprintf("dumping %s (%d/%d)", obj.Name, i+1, total))

		isTable := obj.Type == "table"
		unqualified := quoteIdent(obj.Name)

		if includeStructure {
			if params.DropIfExists {
				kw := strings.ToUpper(obj.Type)
				if kw == "TABLE" || kw == "VIEW" || kw == "TRIGGER" || kw == "INDEX" {
					drop := fmt.Sprintf("DROP %s IF EXISTS %s;\n", kw, unqualified)
					if _, err := cw.Write([]byte(drop)); err != nil {
						return err
					}
				}
			}
			ddl := strings.TrimRight(strings.TrimSpace(obj.SQL), ";")
			if ddl != "" {
				block := fmt.Sprintf("-- Object: %s (%s)\n%s;\n\n", obj.Name, obj.Type, ddl)
				if _, err := cw.Write([]byte(block)); err != nil {
					return err
				}
			}
		}

		if includeData && isTable {
			if params.TruncateBeforeData {
				trunc := fmt.Sprintf("DELETE FROM %s;\n", unqualified)
				if _, err := cw.Write([]byte(trunc)); err != nil {
					return err
				}
			}
			src := quoteIdent(schema) + "." + quoteIdent(obj.Name)
			if err := writeInsertData(ctx, db, cw, taskID, m, src, obj.Name); err != nil {
				return err
			}
		}
	}

	footer := "COMMIT;\nPRAGMA foreign_keys=ON;\n"
	if _, err := cw.Write([]byte(footer)); err != nil {
		return err
	}
	m.emitProgress(taskID, PhaseRunning, cw.n, int64(total),
		fmt.Sprintf("dumped %d object(s)", total))
	return nil
}

func resolveDumpObjects(ctx context.Context, db *sql.DB, schema string, params DumpParams) ([]dumpObject, error) {
	master := quoteIdent(schema) + ".sqlite_master"
	q := fmt.Sprintf(
		`SELECT name, type, sql FROM %s WHERE name NOT LIKE 'sqlite_%%' AND sql IS NOT NULL ORDER BY
CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'view' THEN 3 WHEN 'trigger' THEN 4 ELSE 5 END, name`,
		master,
	)
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("sqlite: list dump objects: %w", err)
	}
	defer rows.Close()

	want := make(map[string]struct{}, len(params.Tables))
	for _, t := range params.Tables {
		t = strings.TrimSpace(t)
		if t != "" {
			want[t] = struct{}{}
		}
	}

	var out []dumpObject
	for rows.Next() {
		var name, typ, sqlText string
		if err := rows.Scan(&name, &typ, &sqlText); err != nil {
			return nil, err
		}
		typ = strings.ToLower(strings.TrimSpace(typ))
		switch typ {
		case "table":
			if !params.IncludeTables {
				continue
			}
		case "view":
			if !params.IncludeViews {
				continue
			}
		case "trigger":
			if !params.IncludeTriggers {
				continue
			}
		case "index":
			if !params.IncludeIndexes {
				continue
			}
			// 主键/唯一约束常以 sqlite_autoindex_* 出现且 sql 为空；已排除
		default:
			continue
		}
		if len(want) > 0 {
			if _, ok := want[name]; !ok {
				continue
			}
		}
		out = append(out, dumpObject{Name: name, Type: typ, SQL: sqlText})
	}
	return out, rows.Err()
}

func writeInsertData(
	ctx context.Context,
	db *sql.DB,
	cw *countingWriter,
	taskID string,
	m *Manager,
	qualifiedTable, tableName string,
) error {
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+qualifiedTable)
	if err != nil {
		return fmt.Errorf("sqlite: dump select %s: %w", tableName, err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return err
	}
	if len(cols) == 0 {
		return nil
	}

	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = quoteIdent(c)
	}
	colList := strings.Join(quotedCols, ", ")
	target := quoteIdent(tableName)

	raw := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range raw {
		ptrs[i] = &raw[i]
	}

	const batchSize = 50
	var (
		batch    [][]string
		rowCount int64
	)

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		var sb strings.Builder
		sb.WriteString("INSERT INTO ")
		sb.WriteString(target)
		sb.WriteString(" (")
		sb.WriteString(colList)
		sb.WriteString(") VALUES\n")
		for i, row := range batch {
			if i > 0 {
				sb.WriteString(",\n")
			}
			sb.WriteString("(")
			sb.WriteString(strings.Join(row, ", "))
			sb.WriteString(")")
		}
		sb.WriteString(";\n")
		if _, err := cw.Write([]byte(sb.String())); err != nil {
			return err
		}
		batch = batch[:0]
		m.emitProgress(taskID, PhaseRunning, cw.n, rowCount,
			fmt.Sprintf("dumped %s: %d rows", tableName, rowCount))
		return nil
	}

	for rows.Next() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		vals := make([]string, len(cols))
		for i, v := range raw {
			vals[i] = sqlLiteral(v)
		}
		batch = append(batch, vals)
		rowCount++
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return flush()
}

func sqlLiteral(v interface{}) string {
	if v == nil {
		return "NULL"
	}
	switch t := v.(type) {
	case []byte:
		// 文本优先；非 UTF-8 用 X'hex'
		if len(t) == 0 {
			return "''"
		}
		allPrintable := true
		for _, b := range t {
			if b < 0x20 && b != '\t' && b != '\n' && b != '\r' {
				allPrintable = false
				break
			}
		}
		if allPrintable {
			return quoteLiteral(string(t))
		}
		return fmt.Sprintf("X'%x'", t)
	case string:
		return quoteLiteral(t)
	case int64:
		return fmt.Sprintf("%d", t)
	case float64:
		return fmt.Sprintf("%g", t)
	case bool:
		if t {
			return "1"
		}
		return "0"
	default:
		return quoteLiteral(fmt.Sprint(t))
	}
}
