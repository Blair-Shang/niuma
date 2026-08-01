package dataio

import (
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"regexp"
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
		return fmt.Errorf("dameng: export csv query: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("dameng: export csv columns: %w", err)
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return fmt.Errorf("dameng: export csv column types: %w", err)
	}
	typeNames := make([]string, len(colTypes))
	for i, ct := range colTypes {
		typeNames[i] = normalizeDamengTypeName(ct.DatabaseTypeName())
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("dameng: create csv file: %w", err)
	}
	defer f.Close()

	cw := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}
	if _, err := cw.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return fmt.Errorf("dameng: write csv bom: %w", err)
	}
	w := csv.NewWriter(cw)
	delim := []rune(opts.Delimiter)
	if len(delim) > 0 {
		w.Comma = delim[0]
	}

	if opts.Header {
		if err := w.Write(cols); err != nil {
			return fmt.Errorf("dameng: write csv header: %w", err)
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
			return fmt.Errorf("dameng: export csv scan: %w", err)
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
			return fmt.Errorf("dameng: write csv row: %w", err)
		}
		rowCount++
		if rowCount%500 == 0 {
			w.Flush()
			m.emitProgress(taskID, PhaseRunning, cw.n, rowCount, fmt.Sprintf("exported %d rows", rowCount))
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("dameng: export csv rows: %w", err)
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return fmt.Errorf("dameng: flush csv: %w", err)
	}
	m.emitProgress(taskID, PhaseRunning, cw.n, rowCount, fmt.Sprintf("exported %d rows total", rowCount))
	return nil
}

// formatCsvCell 将扫描值转为 CSV 文本。时间类型输出达梦可再导入的墙钟字面量，
// 禁止 Go 默认 "+0800 CST"（否则批量 INSERT 触发 Error 6015）。
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
		return formatDamengTemporalCSV(t, dbType)
	default:
		return fmt.Sprint(t)
	}
}

// formatDamengTemporalCSV 对齐 session.cell / dump.sqlLiteral，禁止时区后缀。
// 达梦 DATE 含时分秒（类 Oracle），故 DATE 也输出完整日期时间。
func formatDamengTemporalCSV(t time.Time, kind string) string {
	switch kind {
	case "TIME":
		if t.Nanosecond() == 0 {
			return t.Format("15:04:05")
		}
		return t.Format("15:04:05.999999")
	default:
		// DATE / DATETIME / TIMESTAMP / 未知
		return t.Format("2006-01-02 15:04:05.999999")
	}
}

func normalizeDamengTypeName(dataType string) string {
	s := strings.ToUpper(strings.TrimSpace(dataType))
	if i := strings.IndexByte(s, '('); i >= 0 {
		s = s[:i]
	}
	if i := strings.IndexByte(s, ' '); i >= 0 {
		s = s[:i]
	}
	return s
}

// goTimeWithZoneRe 匹配 Go time.Time.String() / fmt.Sprint 带偏移与区名的输出。
var goTimeWithZoneRe = regexp.MustCompile(
	`^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)? [+-]\d{4} [A-Za-z0-9_/+-]+$`,
)

// normalizeCsvImportCell 把历史错误导出的 "+0800 CST" 等改回达梦可接受的墙钟字面量。
func normalizeCsvImportCell(cell string) string {
	s := strings.TrimSpace(cell)
	if !goTimeWithZoneRe.MatchString(s) {
		return cell
	}
	layouts := []string{
		"2006-01-02 15:04:05.999999999 -0700 MST",
		"2006-01-02 15:04:05 -0700 MST",
	}
	for _, layout := range layouts {
		if tm, err := time.Parse(layout, s); err == nil {
			return formatDamengTemporalCSV(tm, "")
		}
	}
	return cell
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
		return fmt.Errorf("dameng: open csv file: %w", err)
	}
	defer f.Close()

	cr := &countingReader{r: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("read %d bytes", n))
	}}

	qn := qualifiedName(schema, table)

	if opts.Truncate {
		if _, err := db.ExecContext(ctx, "DELETE FROM "+qn); err != nil {
			return fmt.Errorf("dameng: delete before import: %w", err)
		}
		m.emitProgress(taskID, PhaseRunning, 0, 0, "truncated")
	}

	baseReader, err := skipUTF8BOM(cr)
	if err != nil {
		return fmt.Errorf("dameng: skip csv bom: %w", err)
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
			return fmt.Errorf("dameng: read csv header: %w", err)
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
			return fmt.Errorf("dameng: column map produced no target columns")
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
			return fmt.Errorf("dameng: batch insert: %w", err)
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
			return fmt.Errorf("dameng: read csv: %w", err)
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
					v = normalizeCsvImportCell(cell)
				}
			}
			args = append(args, v)
		}
		sb.WriteString(")")
	}
	return sb.String(), args
}
