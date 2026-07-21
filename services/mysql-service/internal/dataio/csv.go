package dataio

import (
	"context"
	"database/sql"
	"encoding/csv"
	"fmt"
	"os"
	"strings"
)

// exportCsv 执行 SELECT * 并将结果以 CSV 格式写入文件。
// NULL 值写为 CsvOptions.NullString；文件编码固定 UTF-8。
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

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("mysql: create csv file: %w", err)
	}
	defer f.Close()

	cw := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("exported %d bytes", n))
	}}

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
			record[i] = csvCellString(v, opts.NullString)
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

	r := csv.NewReader(cr)
	delim := []rune(opts.Delimiter)
	if len(delim) > 0 {
		r.Comma = delim[0]
	}
	r.LazyQuotes = true
	r.TrimLeadingSpace = false

	// 读取标题行
	var cols []string
	if opts.Header {
		cols, err = r.Read()
		if err != nil {
			return fmt.Errorf("mysql: read csv header: %w", err)
		}
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
		sqlStr, args := buildBatchInsert(qn, cols, batch, opts.NullString)
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
			// io.EOF 是正常结束
			break
		}
		// 首次读取若无 Header，从数据行推断列数生成占位列名
		if cols == nil {
			cols = make([]string, len(record))
			for i := range cols {
				cols[i] = fmt.Sprintf("col%d", i+1)
			}
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
func csvCellString(v interface{}, nullString string) string {
	if v == nil {
		return nullString
	}
	switch val := v.(type) {
	case []byte:
		return string(val)
	case string:
		return val
	default:
		return fmt.Sprintf("%v", val)
	}
}

// quoteIdent 用反引号包裹 MySQL 标识符（包内小写别名）。
func quoteIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}
