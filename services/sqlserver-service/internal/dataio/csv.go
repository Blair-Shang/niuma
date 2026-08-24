package dataio

import (
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

func defaultCsvOptions(opts CsvOptions) CsvOptions {
	if opts.Delimiter == "" {
		opts.Delimiter = ","
	}
	if opts.NullString == "" {
		opts.NullString = "\\N"
	}
	if opts.Encoding == "" {
		opts.Encoding = "utf-8"
	}
	return opts
}

func exportCsv(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	schema, table, outputPath string,
	opts CsvOptions,
) error {
	opts = defaultCsvOptions(opts)
	qn := qualifiedName(schema, table)

	rows, err := db.QueryContext(ctx, "SELECT * FROM "+qn)
	if err != nil {
		return fmt.Errorf("sqlserver: export csv query: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("sqlserver: export csv columns: %w", err)
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return fmt.Errorf("sqlserver: export csv column types: %w", err)
	}
	typeNames := make([]string, len(colTypes))
	for i, ct := range colTypes {
		typeNames[i] = strings.ToUpper(strings.TrimSpace(ct.DatabaseTypeName()))
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("sqlserver: create csv file: %w", err)
	}
	defer f.Close()

	cw := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}
	if _, err := cw.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return fmt.Errorf("sqlserver: write csv bom: %w", err)
	}
	w := csv.NewWriter(cw)
	delim := []rune(opts.Delimiter)
	if len(delim) > 0 {
		w.Comma = delim[0]
	}

	if opts.Header {
		if err := w.Write(cols); err != nil {
			return fmt.Errorf("sqlserver: write csv header: %w", err)
		}
	}

	raw := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range raw {
		ptrs[i] = &raw[i]
	}

	var rowCount int64
	for rows.Next() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := rows.Scan(ptrs...); err != nil {
			return fmt.Errorf("sqlserver: export csv scan: %w", err)
		}
		rec := make([]string, len(cols))
		for i, v := range raw {
			dbType := ""
			if i < len(typeNames) {
				dbType = typeNames[i]
			}
			rec[i] = formatCsvCell(v, opts.NullString, dbType)
		}
		if err := w.Write(rec); err != nil {
			return fmt.Errorf("sqlserver: write csv row: %w", err)
		}
		rowCount++
		if rowCount%500 == 0 {
			w.Flush()
			m.emitProgress(taskID, PhaseRunning, cw.n, rowCount, fmt.Sprintf("exported %d rows", rowCount))
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("sqlserver: export csv rows: %w", err)
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return fmt.Errorf("sqlserver: flush csv: %w", err)
	}
	m.emitProgress(taskID, PhaseRunning, cw.n, rowCount, fmt.Sprintf("exported %d rows total", rowCount))
	return nil
}

func formatCsvCell(v interface{}, nullString, dbType string) string {
	if v == nil {
		return nullString
	}
	switch t := v.(type) {
	case []byte:
		if utf8.Valid(t) {
			return string(t)
		}
		return fmt.Sprintf("0x%x", t)
	case string:
		return t
	case time.Time:
		return formatTemporalCSV(t, dbType)
	case bool:
		if t {
			return "1"
		}
		return "0"
	default:
		return fmt.Sprint(t)
	}
}

func formatTemporalCSV(t time.Time, kind string) string {
	switch {
	case strings.Contains(kind, "DATE") && !strings.Contains(kind, "TIME") && kind != "DATETIME" && kind != "DATETIME2" && kind != "DATETIMEOFFSET":
		if kind == "DATE" {
			return t.Format("2006-01-02")
		}
	case kind == "TIME":
		if t.Nanosecond() == 0 {
			return t.Format("15:04:05")
		}
		return t.Format("15:04:05.9999999")
	}
	if t.Nanosecond() == 0 {
		return t.Format("2006-01-02 15:04:05")
	}
	return t.Format("2006-01-02 15:04:05.9999999")
}

func importCsv(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	schema, table, inputPath string,
	opts CsvOptions,
) error {
	opts = defaultCsvOptions(opts)

	f, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("sqlserver: open csv file: %w", err)
	}
	defer f.Close()

	cr := &countingReader{r: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("read %d bytes", n))
	}}
	src, err := skipUTF8BOM(cr)
	if err != nil {
		return err
	}

	qn := qualifiedName(schema, table)
	if opts.Truncate {
		if _, err := db.ExecContext(ctx, "TRUNCATE TABLE "+qn); err != nil {
			if _, delErr := db.ExecContext(ctx, "DELETE FROM "+qn); delErr != nil {
				return fmt.Errorf("sqlserver: truncate/delete: %w", err)
			}
		}
	}

	hasIdentity, err := tableHasIdentity(ctx, db, schema, table)
	if err != nil {
		return fmt.Errorf("sqlserver: identity check: %w", err)
	}
	if hasIdentity {
		if _, err := db.ExecContext(ctx, "SET IDENTITY_INSERT "+qn+" ON"); err != nil {
			return fmt.Errorf("sqlserver: identity insert on: %w", err)
		}
		defer func() {
			_, _ = db.ExecContext(context.Background(), "SET IDENTITY_INSERT "+qn+" OFF")
		}()
	}

	r := csv.NewReader(src)
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	delim := []rune(opts.Delimiter)
	if len(delim) > 0 {
		r.Comma = delim[0]
	}

	var srcCols []string
	colIndex := []int(nil)
	dstCols := []string(nil)
	prepared := false

	prepareCols := func(record []string) error {
		if prepared {
			return nil
		}
		if opts.Header {
			srcCols = normalizeCsvHeader(record)
			dstCols, colIndex = applyColumnMap(srcCols, opts.ColumnMap)
			prepared = true
			if len(dstCols) == 0 {
				return fmt.Errorf("sqlserver: no mapped columns")
			}
			return io.EOF // signal skip this record as data
		}
		srcCols = make([]string, len(record))
		for i := range record {
			srcCols[i] = fmt.Sprintf("col%d", i+1)
		}
		dstCols, colIndex = applyColumnMap(srcCols, opts.ColumnMap)
		if len(dstCols) == 0 {
			dstCols = srcCols
			colIndex = make([]int, len(srcCols))
			for i := range colIndex {
				colIndex[i] = i
			}
		}
		prepared = true
		return nil
	}

	const batchSize = 100
	var (
		batch    [][]string
		rowCount int64
	)

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		mapped := make([][]string, len(batch))
		for i, row := range batch {
			mapped[i] = projectRow(row, colIndex)
		}
		sqlStr, args := buildBatchInsert(qn, dstCols, mapped, opts.NullString)
		if _, err := db.ExecContext(ctx, sqlStr, args...); err != nil {
			return fmt.Errorf("sqlserver: batch insert: %w", err)
		}
		rowCount += int64(len(batch))
		batch = batch[:0]
		m.emitProgress(taskID, PhaseRunning, cr.n, rowCount, fmt.Sprintf("imported %d rows", rowCount))
		return nil
	}

	first := true
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		record, err := r.Read()
		if err != nil {
			if err == io.EOF {
				break
			}
			return fmt.Errorf("sqlserver: read csv: %w", err)
		}
		if first && opts.Header {
			if err := prepareCols(record); err != nil && err != io.EOF {
				return err
			}
			first = false
			continue
		}
		if first {
			if err := prepareCols(record); err != nil {
				return err
			}
			first = false
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

func buildBatchInsert(qn string, cols []string, batch [][]string, nullString string) (string, []interface{}) {
	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = quoteIdent(c)
	}

	var sb strings.Builder
	sb.WriteString("INSERT INTO ")
	sb.WriteString(qn)
	sb.WriteString(" (")
	sb.WriteString(strings.Join(quotedCols, ", "))
	sb.WriteString(") VALUES ")

	args := make([]interface{}, 0, len(batch)*len(cols))
	p := 1
	for ri, row := range batch {
		if ri > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString("(")
		for ci := range cols {
			if ci > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(fmt.Sprintf("@p%d", p))
			p++
			val := ""
			if ci < len(row) {
				val = row[ci]
			}
			if val == nullString {
				args = append(args, nil)
			} else {
				args = append(args, val)
			}
		}
		sb.WriteString(")")
	}
	return sb.String(), args
}
