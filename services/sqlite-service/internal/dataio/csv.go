package dataio

import (
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strings"
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
	qn := quoteIdent(schema) + "." + quoteIdent(table)

	rows, err := db.QueryContext(ctx, "SELECT * FROM "+qn)
	if err != nil {
		return fmt.Errorf("sqlite: export csv query: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("sqlite: export csv columns: %w", err)
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("sqlite: create csv file: %w", err)
	}
	defer f.Close()

	cw := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}
	// UTF-8 BOM：对齐 Excel / Navicat / DBeaver / MySQL 导出，避免中文乱码
	if _, err := cw.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return fmt.Errorf("sqlite: write csv bom: %w", err)
	}
	w := csv.NewWriter(cw)
	delim := []rune(opts.Delimiter)
	if len(delim) > 0 {
		w.Comma = delim[0]
	}

	if opts.Header {
		if err := w.Write(cols); err != nil {
			return fmt.Errorf("sqlite: write csv header: %w", err)
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
			return fmt.Errorf("sqlite: export csv scan: %w", err)
		}
		rec := make([]string, len(cols))
		for i, v := range raw {
			rec[i] = formatCsvCell(v, opts.NullString)
		}
		if err := w.Write(rec); err != nil {
			return fmt.Errorf("sqlite: write csv row: %w", err)
		}
		rowCount++
		if rowCount%500 == 0 {
			w.Flush()
			m.emitProgress(taskID, PhaseRunning, cw.n, rowCount, fmt.Sprintf("exported %d rows", rowCount))
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("sqlite: export csv rows: %w", err)
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return fmt.Errorf("sqlite: flush csv: %w", err)
	}
	m.emitProgress(taskID, PhaseRunning, cw.n, rowCount, fmt.Sprintf("exported %d rows total", rowCount))
	return nil
}

func formatCsvCell(v interface{}, nullString string) string {
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
	default:
		return fmt.Sprint(t)
	}
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
		return fmt.Errorf("sqlite: open csv file: %w", err)
	}
	defer f.Close()

	cr := &countingReader{r: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("read %d bytes", n))
	}}

	qn := quoteIdent(schema) + "." + quoteIdent(table)

	if opts.Truncate {
		if _, err := db.ExecContext(ctx, "DELETE FROM "+qn); err != nil {
			return fmt.Errorf("sqlite: delete before import: %w", err)
		}
		m.emitProgress(taskID, PhaseRunning, 0, 0, "truncated")
	}

	baseReader, err := skipUTF8BOM(cr)
	if err != nil {
		return fmt.Errorf("sqlite: skip csv bom: %w", err)
	}

	r := csv.NewReader(baseReader)
	delim := []rune(opts.Delimiter)
	if len(delim) > 0 {
		r.Comma = delim[0]
	}
	r.LazyQuotes = true
	r.TrimLeadingSpace = false

	var cols []string
	if opts.Header {
		raw, err := r.Read()
		if err != nil {
			return fmt.Errorf("sqlite: read csv header: %w", err)
		}
		cols = normalizeCsvHeader(raw)
	}

	const batchSize = 100
	var (
		batch    [][]string
		rowCount int64
		srcCols  []string
		dstCols  []string
		colIndex []int
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
			return fmt.Errorf("sqlite: column map produced no target columns")
		}
		return nil
	}

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
			return fmt.Errorf("sqlite: batch insert: %w", err)
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
		record, err := r.Read()
		if err != nil {
			if err == io.EOF {
				break
			}
			return fmt.Errorf("sqlite: read csv: %w", err)
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
	for ri, row := range batch {
		if ri > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString("(")
		for ci := range cols {
			if ci > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString("?")
			var v interface{}
			if ci < len(row) {
				cell := row[ci]
				if cell == nullString {
					v = nil
				} else {
					v = cell
				}
			}
			args = append(args, v)
		}
		sb.WriteString(")")
	}
	return sb.String(), args
}
