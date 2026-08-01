package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"
)

// dumpTarget 描述单个待转储对象。
type dumpTarget struct {
	Name   string
	Engine string
	Kind   string // table | view | materialized_view | dictionary
}

const (
	batchInsertMaxRows  = 100
	batchInsertMaxBytes = 1 << 20
)

// dumpSql 生成 ClickHouse 结构/数据转储（纯 Go；无 BEGIN/COMMIT；无 DELIMITER）。
func dumpSql(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	params DumpParams,
) error {
	targets, err := resolveDumpTargets(ctx, db, params)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		return fmt.Errorf("clickhouse: no objects to dump")
	}

	f, err := os.Create(params.OutputPath)
	if err != nil {
		return fmt.Errorf("clickhouse: create dump file: %w", err)
	}
	defer f.Close()

	bw := bufio.NewWriterSize(f, 256*1024)
	defer func() { _ = bw.Flush() }()

	cw := &countingWriter{w: bw, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}

	header := fmt.Sprintf(
		"-- NiuMa ClickHouse dump\n-- format: niuma-clickhouse-dump/1\n-- database: %s\n-- generated: %s\n-- mode: %s\n-- dropIfExists: %v\n-- truncateBeforeData: %v\n-- includeCreateDatabase: %v\n-- note: object names are unqualified so restore can target another database\n-- note: no BEGIN/COMMIT (ClickHouse has no traditional multi-statement transactions)\n\n",
		params.Database,
		time.Now().UTC().Format(time.RFC3339),
		params.Mode,
		params.DropIfExists,
		params.TruncateBeforeData,
		params.IncludeCreateDatabase,
	)
	if _, err := cw.Write([]byte(header)); err != nil {
		return err
	}

	includeStructure := params.Mode == DumpStructureAndData || params.Mode == DumpStructureOnly
	includeData := params.Mode == DumpStructureAndData || params.Mode == DumpDataOnly

	if includeStructure && params.IncludeCreateDatabase && len(params.Tables) == 0 {
		qn := quoteIdent(params.Database)
		block := fmt.Sprintf("-- Database\nCREATE DATABASE IF NOT EXISTS %s;\n\n", qn)
		if _, err := cw.Write([]byte(block)); err != nil {
			return err
		}
	}

	total := len(targets)
	for i, t := range targets {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		m.emitProgress(taskID, PhaseRunning, cw.n, int64(i+1),
			fmt.Sprintf("dumping %s (%d/%d)", t.Name, i+1, total))

		obj := quoteIdent(t.Name)
		isDataTable := t.Kind == "table"

		if includeStructure {
			if params.DropIfExists {
				drop := fmt.Sprintf("DROP TABLE IF EXISTS %s;\n", obj)
				if t.Kind == "view" {
					drop = fmt.Sprintf("DROP VIEW IF EXISTS %s;\n", obj)
				}
				if t.Kind == "dictionary" {
					drop = fmt.Sprintf("DROP DICTIONARY IF EXISTS %s;\n", obj)
				}
				if _, err := cw.Write([]byte(drop)); err != nil {
					return err
				}
			}
			var ddlStr string
			var err error
			if t.Kind == "dictionary" {
				ddlStr, err = fetchCreateDictionarySQL(ctx, db, params.Database, t.Name)
			} else {
				ddlStr, err = fetchCreateSQL(ctx, db, params.Database, t.Name)
			}
			if err != nil {
				return err
			}
			ddlStr = stripDatabaseQualifier(ddlStr, params.Database)
			block := fmt.Sprintf("-- Object: %s (%s)\n%s;\n\n", t.Name, t.Engine, strings.TrimRight(ddlStr, "; \n\t"))
			if _, err := cw.Write([]byte(block)); err != nil {
				return err
			}
		}

		if includeData && isDataTable {
			if params.TruncateBeforeData {
				trunc := fmt.Sprintf("TRUNCATE TABLE %s;\n", obj)
				if _, err := cw.Write([]byte(trunc)); err != nil {
					return err
				}
			}
			if err := writeInsertData(ctx, db, cw, taskID, m, params.Database, t.Name); err != nil {
				return err
			}
		}
	}

	m.emitProgress(taskID, PhaseRunning, cw.n, int64(total),
		fmt.Sprintf("dumped %d object(s)", total))
	return nil
}

func stripDatabaseQualifier(sqlText, database string) string {
	db := strings.TrimSpace(database)
	if db == "" || sqlText == "" {
		return sqlText
	}
	out := strings.ReplaceAll(sqlText, quoteIdent(db)+".", "")
	// SHOW CREATE 视图/MV 中常见未加反引号的 db.table
	re := regexp.MustCompile(`(^|[^0-9A-Za-z_])` + regexp.QuoteMeta(db) + `\.`)
	return re.ReplaceAllString(out, "${1}")
}

func fetchCreateSQL(ctx context.Context, db *sql.DB, database, name string) (string, error) {
	qn := quoteIdent(database) + "." + quoteIdent(name)
	return scanCreateStatement(ctx, db, "SHOW CREATE TABLE "+qn, name)
}

func fetchCreateDictionarySQL(ctx context.Context, db *sql.DB, database, name string) (string, error) {
	qn := quoteIdent(database) + "." + quoteIdent(name)
	statement, err := scanCreateStatement(ctx, db, "SHOW CREATE DICTIONARY "+qn, name)
	if err == nil {
		return statement, nil
	}
	return scanCreateStatement(ctx, db, "SHOW CREATE TABLE "+qn, name)
}

func scanCreateStatement(ctx context.Context, db *sql.DB, q, name string) (string, error) {
	var statement string
	if err := db.QueryRowContext(ctx, q).Scan(&statement); err != nil {
		rows, qerr := db.QueryContext(ctx, q)
		if qerr != nil {
			return "", fmt.Errorf("clickhouse: show create %s: %w", name, err)
		}
		defer rows.Close()
		if !rows.Next() {
			return "", fmt.Errorf("clickhouse: show create %s: empty", name)
		}
		cols, cerr := rows.Columns()
		if cerr != nil {
			return "", cerr
		}
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return "", fmt.Errorf("clickhouse: show create %s: %w", name, err)
		}
		for _, v := range vals {
			var s string
			switch x := v.(type) {
			case string:
				s = x
			case []byte:
				s = string(x)
			}
			if len(s) > len(statement) {
				statement = s
			}
		}
	}
	statement = strings.TrimSpace(statement)
	if statement == "" {
		return "", fmt.Errorf("clickhouse: show create %s: empty ddl", name)
	}
	return statement, nil
}

func writeInsertData(
	ctx context.Context,
	db *sql.DB,
	cw *countingWriter,
	taskID string,
	m *Manager,
	database, table string,
) error {
	src := quoteIdent(database) + "." + quoteIdent(table)
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+src)
	if err != nil {
		return fmt.Errorf("clickhouse: dump select %s: %w", table, err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("clickhouse: dump columns %s: %w", table, err)
	}
	if len(cols) == 0 {
		return nil
	}

	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = quoteIdent(c)
	}
	colList := strings.Join(quotedCols, ", ")
	prefix := fmt.Sprintf("INSERT INTO %s (%s) VALUES\n", quoteIdent(table), colList)

	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}

	var (
		rowCount     int64
		rowsInBatch  int
		bytesInBatch int
		lastProgress time.Time
		rowBuf       strings.Builder
	)
	rowBuf.Grow(4 * 1024)

	endStatement := func() error {
		if rowsInBatch == 0 {
			return nil
		}
		if _, err := io.WriteString(cw, ";\n"); err != nil {
			return err
		}
		rowsInBatch = 0
		bytesInBatch = 0
		return nil
	}

	if _, err := cw.Write([]byte(fmt.Sprintf("-- Data: %s\n", table))); err != nil {
		return err
	}

	for rows.Next() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := rows.Scan(ptrs...); err != nil {
			return fmt.Errorf("clickhouse: dump scan %s: %w", table, err)
		}

		rowBuf.Reset()
		rowBuf.WriteByte('(')
		for i, v := range vals {
			if i > 0 {
				rowBuf.WriteString(", ")
			}
			writeValueLiteral(&rowBuf, v)
		}
		rowBuf.WriteByte(')')
		tuple := rowBuf.String()

		if rowsInBatch > 0 && (rowsInBatch >= batchInsertMaxRows || bytesInBatch+len(tuple)+2 >= batchInsertMaxBytes) {
			if err := endStatement(); err != nil {
				return err
			}
			if time.Since(lastProgress) >= 500*time.Millisecond {
				lastProgress = time.Now()
				m.emitProgress(taskID, PhaseRunning, cw.n, rowCount,
					fmt.Sprintf("dumped %d rows from %s", rowCount, table))
			}
		}

		if rowsInBatch == 0 {
			if _, err := io.WriteString(cw, prefix); err != nil {
				return err
			}
			bytesInBatch = len(prefix)
		} else {
			if _, err := io.WriteString(cw, ",\n"); err != nil {
				return err
			}
			bytesInBatch += 2
		}
		if _, err := io.WriteString(cw, tuple); err != nil {
			return err
		}
		bytesInBatch += len(tuple)
		rowsInBatch++
		rowCount++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("clickhouse: dump rows %s: %w", table, err)
	}
	if err := endStatement(); err != nil {
		return err
	}
	if rowCount > 0 {
		m.emitProgress(taskID, PhaseRunning, cw.n, rowCount,
			fmt.Sprintf("dumped %d rows from %s", rowCount, table))
	}
	if _, err := cw.Write([]byte("\n")); err != nil {
		return err
	}
	return nil
}

func resolveDumpTargets(ctx context.Context, db *sql.DB, params DumpParams) ([]dumpTarget, error) {
	wantNames := make(map[string]bool)
	for _, n := range params.Tables {
		if n = strings.TrimSpace(n); n != "" {
			wantNames[n] = true
		}
	}

	rows, err := db.QueryContext(ctx, `
SELECT name, engine
FROM system.tables
WHERE database = ?
  AND name NOT LIKE '.inner%'
ORDER BY
  CASE
    WHEN engine = 'View' THEN 1
    WHEN engine = 'MaterializedView' THEN 2
    ELSE 0
  END,
  name
`, params.Database)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: list tables: %w", err)
	}
	defer rows.Close()

	var out []dumpTarget
	for rows.Next() {
		var name, engine string
		if err := rows.Scan(&name, &engine); err != nil {
			return nil, err
		}
		if len(wantNames) > 0 && !wantNames[name] {
			continue
		}
		kind := classifyEngine(engine)
		if kind == "table" && !params.IncludeTables {
			continue
		}
		if kind == "view" && !params.IncludeViews {
			continue
		}
		if kind == "materialized_view" && !params.IncludeMaterializedViews {
			continue
		}
		if kind == "dictionary" {
			// 字典以 system.dictionaries 为准，避免与 Dictionary 引擎表重复。
			continue
		}
		out = append(out, dumpTarget{Name: name, Engine: engine, Kind: kind})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if params.IncludeDictionaries {
		dicts, derr := listDumpDictionaries(ctx, db, params.Database, wantNames)
		if derr != nil {
			return nil, derr
		}
		out = append(out, dicts...)
	}

	// 表 → 视图 → MV → 字典，便于还原依赖
	tables := make([]dumpTarget, 0, len(out))
	views := make([]dumpTarget, 0, len(out))
	mvs := make([]dumpTarget, 0, len(out))
	dicts := make([]dumpTarget, 0, len(out))
	for _, t := range out {
		switch t.Kind {
		case "view":
			views = append(views, t)
		case "materialized_view":
			mvs = append(mvs, t)
		case "dictionary":
			dicts = append(dicts, t)
		default:
			tables = append(tables, t)
		}
	}
	ordered := append(tables, views...)
	ordered = append(ordered, mvs...)
	ordered = append(ordered, dicts...)
	return ordered, nil
}

func listDumpDictionaries(ctx context.Context, db *sql.DB, database string, wantNames map[string]bool) ([]dumpTarget, error) {
	rows, err := db.QueryContext(ctx, `
SELECT name
FROM system.dictionaries
WHERE database = ?
ORDER BY name
`, database)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: list dictionaries: %w", err)
	}
	defer rows.Close()

	var out []dumpTarget
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		if len(wantNames) > 0 && !wantNames[name] {
			continue
		}
		out = append(out, dumpTarget{Name: name, Engine: "Dictionary", Kind: "dictionary"})
	}
	return out, rows.Err()
}

func classifyEngine(engine string) string {
	switch strings.TrimSpace(engine) {
	case "View":
		return "view"
	case "MaterializedView":
		return "materialized_view"
	case "Dictionary":
		return "dictionary"
	default:
		return "table"
	}
}

func writeValueLiteral(b *strings.Builder, v interface{}) {
	if v == nil {
		b.WriteString("NULL")
		return
	}
	switch val := v.(type) {
	case []byte:
		writeQuotedBytes(b, val)
	case string:
		writeQuotedString(b, val)
	case int64:
		fmt.Fprintf(b, "%d", val)
	case int32:
		fmt.Fprintf(b, "%d", val)
	case int16:
		fmt.Fprintf(b, "%d", val)
	case int8:
		fmt.Fprintf(b, "%d", val)
	case int:
		fmt.Fprintf(b, "%d", val)
	case uint64:
		fmt.Fprintf(b, "%d", val)
	case uint32:
		fmt.Fprintf(b, "%d", val)
	case uint16:
		fmt.Fprintf(b, "%d", val)
	case uint8:
		fmt.Fprintf(b, "%d", val)
	case uint:
		fmt.Fprintf(b, "%d", val)
	case float32:
		fmt.Fprintf(b, "%g", val)
	case float64:
		fmt.Fprintf(b, "%g", val)
	case bool:
		if val {
			b.WriteByte('1')
		} else {
			b.WriteByte('0')
		}
	case time.Time:
		b.WriteByte('\'')
		if val.Nanosecond() == 0 {
			b.WriteString(val.Format("2006-01-02 15:04:05"))
		} else {
			s := val.Format("2006-01-02 15:04:05.000000000")
			s = strings.TrimRight(s, "0")
			s = strings.TrimRight(s, ".")
			b.WriteString(s)
		}
		b.WriteByte('\'')
	case []interface{}:
		writeArrayLiteral(b, val)
	case map[string]interface{}:
		writeMapLiteral(b, val)
	default:
		rv := reflect.ValueOf(v)
		switch rv.Kind() {
		case reflect.Pointer, reflect.Interface:
			if rv.IsNil() {
				b.WriteString("NULL")
				return
			}
			writeValueLiteral(b, rv.Elem().Interface())
		case reflect.Slice, reflect.Array:
			if rv.Kind() == reflect.Slice && rv.Type().Elem().Kind() == reflect.Uint8 {
				writeQuotedBytes(b, append([]byte(nil), rv.Bytes()...))
				return
			}
			items := make([]interface{}, rv.Len())
			for i := 0; i < rv.Len(); i++ {
				items[i] = rv.Index(i).Interface()
			}
			writeArrayLiteral(b, items)
		case reflect.Map:
			writeReflectMapLiteral(b, rv)
		default:
			writeQuotedString(b, fmt.Sprintf("%v", v))
		}
	}
}

func writeArrayLiteral(b *strings.Builder, items []interface{}) {
	b.WriteByte('[')
	for i, item := range items {
		if i > 0 {
			b.WriteString(", ")
		}
		writeValueLiteral(b, item)
	}
	b.WriteByte(']')
}

func writeMapLiteral(b *strings.Builder, m map[string]interface{}) {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	b.WriteString("map(")
	for i, k := range keys {
		if i > 0 {
			b.WriteString(", ")
		}
		writeQuotedString(b, k)
		b.WriteString(", ")
		writeValueLiteral(b, m[k])
	}
	b.WriteByte(')')
}

func writeReflectMapLiteral(b *strings.Builder, rv reflect.Value) {
	keys := rv.MapKeys()
	sort.Slice(keys, func(i, j int) bool {
		return fmt.Sprint(keys[i].Interface()) < fmt.Sprint(keys[j].Interface())
	})
	b.WriteString("map(")
	for i, k := range keys {
		if i > 0 {
			b.WriteString(", ")
		}
		writeValueLiteral(b, k.Interface())
		b.WriteString(", ")
		writeValueLiteral(b, rv.MapIndex(k).Interface())
	}
	b.WriteByte(')')
}

func writeQuotedString(b *strings.Builder, s string) {
	b.WriteByte('\'')
	for i := 0; i < len(s); i++ {
		switch c := s[i]; c {
		case '\'':
			b.WriteString(`\'`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case 0:
			b.WriteString(`\0`)
		default:
			b.WriteByte(c)
		}
	}
	b.WriteByte('\'')
}

func writeQuotedBytes(b *strings.Builder, data []byte) {
	b.WriteByte('\'')
	for i := 0; i < len(data); i++ {
		switch c := data[i]; c {
		case '\'':
			b.WriteString(`\'`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case 0:
			b.WriteString(`\0`)
		default:
			b.WriteByte(c)
		}
	}
	b.WriteByte('\'')
}
