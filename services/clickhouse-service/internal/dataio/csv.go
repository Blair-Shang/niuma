package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
)

// exportCsv 执行 SELECT * 并按 format 写出（csv / tsv / json_each_row）。
// NULL 值写为 CsvOptions.NullString；文本格式固定 UTF-8（CSV/TSV 带 BOM）。
func exportCsv(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	database, table, outputPath string,
	opts CsvOptions,
) error {
	opts = defaultCsvOptions(opts)
	format := resolveImportFormat(opts)
	if format == FormatParquet {
		return fmt.Errorf("clickhouse: parquet export is not supported yet")
	}
	if format == FormatJSONEachRow {
		return exportJSONEachRow(ctx, db, taskID, m, database, table, outputPath, opts)
	}
	if format == FormatTSV {
		return exportTSV(ctx, db, taskID, m, database, table, outputPath, opts)
	}

	qn := quoteIdent(database) + "." + quoteIdent(table)
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+qn)
	if err != nil {
		return fmt.Errorf("clickhouse: export csv query: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("clickhouse: export csv columns: %w", err)
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return fmt.Errorf("clickhouse: export csv column types: %w", err)
	}
	typeNames := make([]string, len(colTypes))
	for i, ct := range colTypes {
		typeNames[i] = normalizeTypeName(ct.DatabaseTypeName())
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("clickhouse: create csv file: %w", err)
	}
	defer f.Close()

	cw := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("exported %d bytes", n))
	}}

	// CSV 写 BOM 方便 Excel；TSV/JSON 不写，避免污染首列
	if _, err := cw.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return fmt.Errorf("clickhouse: write csv bom: %w", err)
	}

	w := csv.NewWriter(cw)
	delim := []rune(opts.Delimiter)
	if len(delim) > 0 {
		w.Comma = delim[0]
	}

	if opts.Header {
		if err := w.Write(cols); err != nil {
			return fmt.Errorf("clickhouse: write csv header: %w", err)
		}
	}

	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}

	var rowCount int64
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return fmt.Errorf("clickhouse: export csv scan: %w", err)
		}
		record := make([]string, len(cols))
		for i, v := range vals {
			record[i] = csvCellString(v, opts.NullString, typeNames[i])
		}
		if err := w.Write(record); err != nil {
			return fmt.Errorf("clickhouse: write csv row: %w", err)
		}
		rowCount++
		if rowCount%1000 == 0 {
			w.Flush()
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("clickhouse: export csv rows: %w", err)
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return fmt.Errorf("clickhouse: flush csv: %w", err)
	}

	m.emitProgress(taskID, PhaseRunning, cw.n, rowCount, fmt.Sprintf("exported %d rows, %d bytes", rowCount, cw.n))
	return nil
}

// exportTSV 按 ClickHouse TabSeparated / TSVWithNames 写出（反斜杠转义，无 BOM）。
func exportTSV(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	database, table, outputPath string,
	opts CsvOptions,
) error {
	qn := quoteIdent(database) + "." + quoteIdent(table)
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+qn)
	if err != nil {
		return fmt.Errorf("clickhouse: export tsv query: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("clickhouse: export tsv columns: %w", err)
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return fmt.Errorf("clickhouse: export tsv column types: %w", err)
	}
	typeNames := make([]string, len(colTypes))
	for i, ct := range colTypes {
		typeNames[i] = normalizeTypeName(ct.DatabaseTypeName())
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("clickhouse: create tsv file: %w", err)
	}
	defer f.Close()

	cw := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("exported %d bytes", n))
	}}
	bw := bufio.NewWriter(cw)
	nullTok := tsvNullToken(opts)

	if opts.Header {
		if err := writeTSVRecord(bw, cols); err != nil {
			return fmt.Errorf("clickhouse: write tsv header: %w", err)
		}
	}

	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}

	var rowCount int64
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return fmt.Errorf("clickhouse: export tsv scan: %w", err)
		}
		record := make([]string, len(cols))
		for i, v := range vals {
			if v == nil {
				record[i] = nullTok
			} else {
				record[i] = csvCellString(v, nullTok, typeNames[i])
			}
		}
		if err := writeTSVRecord(bw, record); err != nil {
			return fmt.Errorf("clickhouse: write tsv row: %w", err)
		}
		rowCount++
		if rowCount%1000 == 0 {
			_ = bw.Flush()
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("clickhouse: export tsv rows: %w", err)
	}
	if err := bw.Flush(); err != nil {
		return err
	}
	m.emitProgress(taskID, PhaseRunning, cw.n, rowCount, fmt.Sprintf("exported %d rows, %d bytes", rowCount, cw.n))
	return nil
}

func exportJSONEachRow(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	database, table, outputPath string,
	opts CsvOptions,
) error {
	qn := quoteIdent(database) + "." + quoteIdent(table)
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+qn)
	if err != nil {
		return fmt.Errorf("clickhouse: export json query: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("clickhouse: export json columns: %w", err)
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return fmt.Errorf("clickhouse: export json column types: %w", err)
	}
	typeNames := make([]string, len(colTypes))
	for i, ct := range colTypes {
		typeNames[i] = normalizeTypeName(ct.DatabaseTypeName())
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("clickhouse: create json file: %w", err)
	}
	defer f.Close()

	cw := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("exported %d bytes", n))
	}}
	bw := bufio.NewWriter(cw)

	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}

	var rowCount int64
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return fmt.Errorf("clickhouse: export json scan: %w", err)
		}
		obj := make(map[string]any, len(cols))
		for i, name := range cols {
			obj[name] = jsonCellValue(vals[i], opts.NullString, typeNames[i])
		}
		raw, err := json.Marshal(obj)
		if err != nil {
			return fmt.Errorf("clickhouse: marshal json row: %w", err)
		}
		if _, err := bw.Write(raw); err != nil {
			return err
		}
		if err := bw.WriteByte('\n'); err != nil {
			return err
		}
		rowCount++
		if rowCount%1000 == 0 {
			_ = bw.Flush()
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("clickhouse: export json rows: %w", err)
	}
	if err := bw.Flush(); err != nil {
		return err
	}
	m.emitProgress(taskID, PhaseRunning, cw.n, rowCount, fmt.Sprintf("exported %d rows, %d bytes", rowCount, cw.n))
	return nil
}

// importCsvNative 使用 native PrepareBatch 从 CSV/TSV/JSONEachRow 批量导入。
func importCsvNative(
	ctx context.Context,
	conn clickhouse.Conn,
	taskID string,
	m *Manager,
	database, table, inputPath string,
	opts CsvOptions,
) error {
	opts = defaultCsvOptions(opts)
	format := resolveImportFormat(opts)
	if format == FormatJSONEachRow {
		return importJSONEachRowNative(ctx, conn, taskID, m, database, table, inputPath, opts)
	}

	body, _, cleanup, err := openEncodedImportReader(inputPath, opts.Encoding)
	if err != nil {
		return err
	}
	defer cleanup()

	cr := &countingReader{r: body, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("read %d bytes", n))
	}}

	qn := quoteIdent(database) + "." + quoteIdent(table)

	if opts.Truncate {
		if err := conn.Exec(ctx, "TRUNCATE TABLE "+qn); err != nil {
			return fmt.Errorf("clickhouse: truncate before import: %w", err)
		}
		m.emitProgress(taskID, PhaseRunning, 0, 0, "truncated")
	}

	baseReader, err := skipUTF8BOM(cr)
	if err != nil {
		return fmt.Errorf("clickhouse: skip csv bom: %w", err)
	}

	var (
		readRecord func() ([]string, error)
		nullTok    = opts.NullString
	)
	if format == FormatTSV {
		tr := newTSVRecordReader(baseReader)
		readRecord = tr.Read
		nullTok = tsvNullToken(opts)
	} else {
		r := csv.NewReader(baseReader)
		delim := []rune(opts.Delimiter)
		if len(delim) > 0 {
			r.Comma = delim[0]
		}
		r.LazyQuotes = true
		r.TrimLeadingSpace = false
		r.FieldsPerRecord = -1
		readRecord = r.Read
	}

	var cols []string
	if opts.Header {
		raw, err := readRecord()
		if err != nil {
			return fmt.Errorf("clickhouse: read header: %w", err)
		}
		cols = normalizeCsvHeader(raw)
	}
	for i := 0; i < opts.SkipRows; i++ {
		if _, err := readRecord(); err != nil {
			if err == io.EOF {
				break
			}
			return fmt.Errorf("clickhouse: skip rows: %w", err)
		}
	}

	const batchSize = 5000
	var (
		batch     [][]string
		rowCount  int64
		errCount  uint64
		srcCols   []string
		dstCols   []string
		colIndex  []int
		insertSQL string
	)

	prepareCols := func(record []string) error {
		if srcCols != nil {
			return nil
		}
		if cols == nil {
			cols = make([]string, len(record))
			for i := range cols {
				cols[i] = fmt.Sprintf("col%d", i+1)
			}
		}
		srcCols = cols
		dstCols, colIndex = applyColumnMap(srcCols, opts.ColumnMap)
		if len(dstCols) == 0 {
			return fmt.Errorf("clickhouse: column map produced no target columns")
		}
		quotedCols := make([]string, len(dstCols))
		for i, c := range dstCols {
			quotedCols[i] = quoteIdent(c)
		}
		insertSQL = fmt.Sprintf("INSERT INTO %s (%s)", qn, strings.Join(quotedCols, ", "))
		return nil
	}

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		b, err := conn.PrepareBatch(ctx, insertSQL)
		if err != nil {
			return fmt.Errorf("clickhouse: prepare batch: %w", err)
		}
		for _, row := range batch {
			mapped := projectRow(row, colIndex)
			args := make([]any, len(dstCols))
			for ci := range dstCols {
				val := ""
				if ci < len(mapped) {
					val = mapped[ci]
				}
				if isImportNullToken(val, nullTok, format) {
					args[ci] = nil
				} else {
					args[ci] = val
				}
			}
			if err := b.Append(args...); err != nil {
				_ = b.Abort()
				return fmt.Errorf("clickhouse: batch append: %w", err)
			}
		}
		if err := b.Send(); err != nil {
			return fmt.Errorf("clickhouse: batch send: %w", err)
		}
		rowCount += int64(len(batch))
		batch = batch[:0]
		m.emitProgress(taskID, PhaseRunning, cr.n, rowCount, fmt.Sprintf("imported %d rows", rowCount))
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		record, err := readRecord()
		if err != nil {
			if err == io.EOF {
				break
			}
			errCount++
			if opts.MaxErrors > 0 && errCount <= opts.MaxErrors {
				m.emitProgress(taskID, PhaseRunning, cr.n, rowCount, fmt.Sprintf("skip bad row: %v", err))
				continue
			}
			return fmt.Errorf("clickhouse: read record: %w", err)
		}
		if err := prepareCols(record); err != nil {
			return err
		}
		batch = append(batch, record)
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := flush(); err != nil {
		return err
	}
	m.emitProgress(taskID, PhaseRunning, cr.n, rowCount, fmt.Sprintf("imported %d rows total", rowCount))
	return nil
}

// importJSONEachRowNative 按行解析 JSON 对象并 PrepareBatch 导入。
func importJSONEachRowNative(
	ctx context.Context,
	conn clickhouse.Conn,
	taskID string,
	m *Manager,
	database, table, inputPath string,
	opts CsvOptions,
) error {
	opts = defaultCsvOptions(opts)
	body, _, cleanup, err := openEncodedImportReader(inputPath, opts.Encoding)
	if err != nil {
		return err
	}
	defer cleanup()

	cr := &countingReader{r: body, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("read %d bytes", n))
	}}
	baseReader, err := skipUTF8BOM(cr)
	if err != nil {
		return err
	}

	qn := quoteIdent(database) + "." + quoteIdent(table)
	if opts.Truncate {
		if err := conn.Exec(ctx, "TRUNCATE TABLE "+qn); err != nil {
			return fmt.Errorf("clickhouse: truncate before import: %w", err)
		}
		m.emitProgress(taskID, PhaseRunning, 0, 0, "truncated")
	}

	scanner := bufio.NewScanner(baseReader)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 10*1024*1024)

	const batchSize = 2000
	var (
		dstCols   []string
		insertSQL string
		batch     []map[string]any
		rowCount  int64
		errCount  uint64
		lineNo    int
		skipped   int
	)

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		b, err := conn.PrepareBatch(ctx, insertSQL)
		if err != nil {
			return fmt.Errorf("clickhouse: prepare batch: %w", err)
		}
		for _, obj := range batch {
			args := make([]any, len(dstCols))
			for i, col := range dstCols {
				val, ok := obj[col]
				if !ok {
					// 忽略大小写匹配
					for k, v := range obj {
						if strings.EqualFold(k, col) {
							val = v
							ok = true
							break
						}
					}
				}
				if !ok || val == nil {
					args[i] = nil
					continue
				}
				if s, isStr := val.(string); isStr && s == opts.NullString {
					args[i] = nil
				} else {
					args[i] = fmt.Sprint(val)
				}
			}
			if err := b.Append(args...); err != nil {
				_ = b.Abort()
				return fmt.Errorf("clickhouse: batch append: %w", err)
			}
		}
		if err := b.Send(); err != nil {
			return fmt.Errorf("clickhouse: batch send: %w", err)
		}
		rowCount += int64(len(batch))
		batch = batch[:0]
		m.emitProgress(taskID, PhaseRunning, cr.n, rowCount, fmt.Sprintf("imported %d rows", rowCount))
		return nil
	}

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if skipped < opts.SkipRows {
			skipped++
			continue
		}
		var obj map[string]any
		if err := json.Unmarshal([]byte(line), &obj); err != nil {
			errCount++
			if opts.MaxErrors > 0 && errCount <= opts.MaxErrors {
				continue
			}
			return fmt.Errorf("clickhouse: json line %d: %w", lineNo, err)
		}
		if insertSQL == "" {
			keys := make([]string, 0, len(obj))
			for k := range obj {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			if len(opts.ColumnMap) > 0 {
				dstCols, _ = applyColumnMap(keys, opts.ColumnMap)
			} else {
				dstCols = keys
			}
			if len(dstCols) == 0 {
				return fmt.Errorf("clickhouse: json object has no mapped columns")
			}
			quoted := make([]string, len(dstCols))
			for i, c := range dstCols {
				quoted[i] = quoteIdent(c)
			}
			insertSQL = fmt.Sprintf("INSERT INTO %s (%s)", qn, strings.Join(quoted, ", "))
		}
		batch = append(batch, obj)
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("clickhouse: read json lines: %w", err)
	}
	if err := flush(); err != nil {
		return err
	}
	m.emitProgress(taskID, PhaseRunning, cr.n, rowCount, fmt.Sprintf("imported %d rows total", rowCount))
	return nil
}

func normalizeCsvHeader(raw []string) []string {
	out := make([]string, len(raw))
	for i, c := range raw {
		name := strings.TrimSpace(c)
		if name == "" {
			name = fmt.Sprintf("col%d", i+1)
		}
		out[i] = name
	}
	return out
}

func applyColumnMap(srcCols []string, columnMap map[string]string) ([]string, []int) {
	if len(columnMap) == 0 {
		idx := make([]int, len(srcCols))
		out := make([]string, len(srcCols))
		for i, src := range srcCols {
			idx[i] = i
			out[i] = strings.TrimSpace(src)
		}
		return out, idx
	}
	lookup := make(map[string]string, len(columnMap)*2)
	for k, v := range columnMap {
		lookup[k] = v
		tk := strings.TrimSpace(k)
		if tk != k {
			lookup[tk] = v
		}
		lk := strings.ToLower(tk)
		if _, ok := lookup[lk]; !ok {
			lookup[lk] = v
		}
	}
	var dst []string
	var idx []int
	for i, src := range srcCols {
		key := strings.TrimSpace(src)
		target, ok := lookup[key]
		if !ok {
			target, ok = lookup[strings.ToLower(key)]
		}
		if !ok || strings.TrimSpace(target) == "" {
			continue
		}
		dst = append(dst, strings.TrimSpace(target))
		idx = append(idx, i)
	}
	return dst, idx
}

func projectRow(row []string, colIndex []int) []string {
	out := make([]string, len(colIndex))
	for i, srcIdx := range colIndex {
		if srcIdx < len(row) {
			out[i] = row[srcIdx]
		}
	}
	return out
}

func isImportNullToken(val, nullTok string, format ImportFormat) bool {
	if nullTok != "" && val == nullTok {
		return true
	}
	// ClickHouse TabSeparated 默认 NULL 记号
	if format == FormatTSV && val == tsvDefaultNull {
		return true
	}
	return false
}

func csvCellString(v interface{}, nullString string, dbType string) string {
	if v == nil {
		return nullString
	}
	switch val := v.(type) {
	case []byte:
		return string(val)
	case string:
		return val
	case time.Time:
		return formatTemporalCSV(val, dbType)
	default:
		return fmt.Sprintf("%v", val)
	}
}

// jsonCellValue 导出 JSONEachRow 时尽量保留数字 / 布尔 / 数组 / Map 类型。
func jsonCellValue(v interface{}, nullString string, dbType string) any {
	if v == nil {
		if nullString != "" {
			return nullString
		}
		return nil
	}
	switch val := v.(type) {
	case bool,
		float32, float64,
		int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64:
		return val
	case json.Number:
		if i, err := val.Int64(); err == nil {
			return i
		}
		if f, err := val.Float64(); err == nil {
			return f
		}
		return val.String()
	case []byte:
		return string(val)
	case string:
		return val
	case time.Time:
		return formatTemporalCSV(val, dbType)
	default:
		rv := reflect.ValueOf(v)
		switch rv.Kind() {
		case reflect.Pointer:
			if rv.IsNil() {
				if nullString != "" {
					return nullString
				}
				return nil
			}
			return jsonCellValue(rv.Elem().Interface(), nullString, dbType)
		case reflect.Slice, reflect.Array, reflect.Map:
			return v
		default:
			return fmt.Sprint(v)
		}
	}
}

func formatTemporalCSV(t time.Time, kind string) string {
	if t.IsZero() {
		if kind == "DATE" {
			return "1970-01-01"
		}
		return "1970-01-01 00:00:00"
	}
	switch kind {
	case "DATE":
		return t.Format("2006-01-02")
	default:
		if t.Nanosecond() == 0 {
			return t.Format("2006-01-02 15:04:05")
		}
		s := t.Format("2006-01-02 15:04:05.000000000")
		s = strings.TrimRight(s, "0")
		return strings.TrimRight(s, ".")
	}
}

func normalizeTypeName(dataType string) string {
	s := strings.ToUpper(strings.TrimSpace(dataType))
	if i := strings.IndexByte(s, '('); i >= 0 {
		s = s[:i]
	}
	if i := strings.IndexByte(s, ' '); i >= 0 {
		s = s[:i]
	}
	return s
}
