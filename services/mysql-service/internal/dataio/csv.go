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
)

// exportCsv 执行 SELECT * 并将结果以 CSV 格式写入文件。
// NULL 值写为 CsvOptions.NullString；文件编码固定 UTF-8。
// 时间类型输出 MySQL 原生墙钟字面量（勿 Go 默认 "+0800 CST"），保证可再导入。
func exportCsv(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	database, table, outputPath string,
	opts CsvOptions,
) error {
	opts = defaultCsvOptions(opts)

	qn := quoteIdent(database) + "." + quoteIdent(table)
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+qn)
	if err != nil {
		return fmt.Errorf("mysql: export csv query: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("mysql: export csv columns: %w", err)
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return fmt.Errorf("mysql: export csv column types: %w", err)
	}
	typeNames := make([]string, len(colTypes))
	for i, ct := range colTypes {
		typeNames[i] = normalizeMysqlTypeName(ct.DatabaseTypeName())
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("mysql: create csv file: %w", err)
	}
	defer f.Close()

	cw := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("exported %d bytes", n))
	}}

	// UTF-8 BOM：对齐 Excel / Navicat / DBeaver 默认导出，避免中文乱码
	if _, err := cw.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return fmt.Errorf("mysql: write csv bom: %w", err)
	}

	w := csv.NewWriter(cw)
	// 多字节分隔符取第一个 rune
	delim := []rune(opts.Delimiter)
	if len(delim) > 0 {
		w.Comma = delim[0]
	}

	if opts.Header {
		if err := w.Write(cols); err != nil {
			return fmt.Errorf("mysql: write csv header: %w", err)
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
			return fmt.Errorf("mysql: export csv scan: %w", err)
		}
		record := make([]string, len(cols))
		for i, v := range vals {
			record[i] = csvCellString(v, opts.NullString, typeNames[i])
		}
		if err := w.Write(record); err != nil {
			return fmt.Errorf("mysql: write csv row: %w", err)
		}
		rowCount++
		if rowCount%1000 == 0 {
			w.Flush()
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("mysql: export csv rows: %w", err)
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return fmt.Errorf("mysql: flush csv: %w", err)
	}

	m.emitProgress(taskID, PhaseRunning, cw.n, rowCount, fmt.Sprintf("exported %d rows, %d bytes", rowCount, cw.n))
	return nil
}

// importCsv 从 CSV 文件读取数据，批量 INSERT 到目标表。
// NullString 值转为 NULL；可选在插入前 TRUNCATE 表。
func importCsv(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	database, table, inputPath string,
	opts CsvOptions,
) error {
	opts = defaultCsvOptions(opts)

	f, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("mysql: open csv file: %w", err)
	}
	defer f.Close()

	cr := &countingReader{r: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("read %d bytes", n))
	}}

	qn := quoteIdent(database) + "." + quoteIdent(table)

	if opts.Truncate {
		if _, err := db.ExecContext(ctx, "TRUNCATE TABLE "+qn); err != nil {
			return fmt.Errorf("mysql: truncate before import: %w", err)
		}
		m.emitProgress(taskID, PhaseRunning, 0, 0, "truncated")
	}

	baseReader, err := skipUTF8BOM(cr)
	if err != nil {
		return fmt.Errorf("mysql: skip csv bom: %w", err)
	}

	r := csv.NewReader(baseReader)
	delim := []rune(opts.Delimiter)
	if len(delim) > 0 {
		r.Comma = delim[0]
	}
	r.LazyQuotes = true
	r.TrimLeadingSpace = false

	// 读取标题行（trim 对齐前端列映射向导）
	var cols []string
	if opts.Header {
		raw, err := r.Read()
		if err != nil {
			return fmt.Errorf("mysql: read csv header: %w", err)
		}
		cols = normalizeCsvHeader(raw)
	}

	const batchSize = 100
	var (
		batch    [][]string
		rowCount int64
		srcCols  []string // 源列名（映射前）
		dstCols  []string // 目标表列名（映射后）
		colIndex []int    // 源列下标 → 写入顺序
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
			return fmt.Errorf("mysql: column map produced no target columns")
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
			return fmt.Errorf("mysql: batch insert: %w", err)
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
			return fmt.Errorf("mysql: read csv: %w", err)
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

// normalizeCsvHeader 与前端 parseCsvSourceColumns 对齐：trim；空名回落 colN。
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

// applyColumnMap 将源列名映射为目标表列；无映射表时同名直通。
// 返回目标列名列表与每个目标列对应的源下标。
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
	// 兼容键两侧 trim / 大小写差异（前端向导 trim 后写入 map）
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

// projectRow 按 colIndex 投影一行。
func projectRow(row []string, colIndex []int) []string {
	out := make([]string, len(colIndex))
	for i, srcIdx := range colIndex {
		if srcIdx < len(row) {
			out[i] = row[srcIdx]
		}
	}
	return out
}

// buildBatchInsert 构造批量 INSERT 语句及参数。
// 若单元格值等于 nullString，对应参数为 nil（插入 NULL）。
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

// csvCellString 将 SQL 扫描值转换为 CSV 单元格字符串；NULL 转为 nullString。
// dbType 为 ColumnTypes.DatabaseTypeName 规范化后的类型（DATE/DATETIME/…）。
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
		return formatMysqlTemporalCSV(val, dbType)
	default:
		return fmt.Sprintf("%v", val)
	}
}

// formatMysqlTemporalCSV 输出可被 MySQL 再接受的墙钟字面量（对齐 session.encode / Navicat）。
func formatMysqlTemporalCSV(t time.Time, kind string) string {
	if t.IsZero() {
		switch kind {
		case "DATE":
			return "0000-00-00"
		case "TIME":
			return "00:00:00"
		default:
			return "0000-00-00 00:00:00"
		}
	}
	switch kind {
	case "DATE":
		return t.Format("2006-01-02")
	case "TIME":
		if t.Nanosecond() == 0 {
			return t.Format("15:04:05")
		}
		return trimMysqlFraction(t.Format("15:04:05.000000000"))
	case "YEAR":
		return t.Format("2006")
	default:
		// DATETIME / TIMESTAMP / 未知：完整日期时间，禁止 "+0800 CST"
		if t.Nanosecond() == 0 {
			return t.Format("2006-01-02 15:04:05")
		}
		return trimMysqlFraction(t.Format("2006-01-02 15:04:05.000000000"))
	}
}

func normalizeMysqlTypeName(dataType string) string {
	s := strings.ToUpper(strings.TrimSpace(dataType))
	if i := strings.IndexByte(s, ' '); i >= 0 {
		s = s[:i]
	}
	if i := strings.IndexByte(s, '('); i >= 0 {
		s = s[:i]
	}
	return s
}

func trimMysqlFraction(s string) string {
	s = strings.TrimRight(s, "0")
	return strings.TrimRight(s, ".")
}

// quoteIdent 用反引号包裹 MySQL 标识符（包内小写别名）。
func quoteIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}
