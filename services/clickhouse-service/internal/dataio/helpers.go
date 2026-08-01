package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"

	"niuma/services/clickhouse-service/internal/session"
)

// requirePath 校验路径非空。
func requirePath(path string) error {
	if strings.TrimSpace(path) == "" {
		return errPathRequired
	}
	return nil
}

func isProtectedDatabase(name string) bool {
	switch strings.TrimSpace(name) {
	case "system", "information_schema", "INFORMATION_SCHEMA":
		return true
	default:
		return false
	}
}

// requireRelation 校验 database 和 table 均非空。
func requireRelation(database, table string) error {
	if strings.TrimSpace(database) == "" || strings.TrimSpace(table) == "" {
		return errRelationRequired
	}
	return nil
}

// defaultCsvOptions 填充 CsvOptions 缺省值。
func defaultCsvOptions(opts CsvOptions) CsvOptions {
	format := resolveImportFormat(opts)
	opts.Format = string(format)
	if opts.Delimiter == "" {
		if format == FormatTSV {
			opts.Delimiter = "\t"
		} else {
			opts.Delimiter = ","
		}
	}
	if opts.Encoding == "" {
		opts.Encoding = "utf-8"
	}
	if opts.SkipRows < 0 {
		opts.SkipRows = 0
	}
	return opts
}

// skipUTF8BOM 若流以 UTF-8 BOM 开头则跳过，否则把已读字节还回去。
func skipUTF8BOM(r io.Reader) (io.Reader, error) {
	br := bufio.NewReader(r)
	bom, err := br.Peek(3)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if len(bom) >= 3 && bom[0] == 0xEF && bom[1] == 0xBB && bom[2] == 0xBF {
		_, _ = br.Discard(3)
	}
	return br, nil
}

// openDB 使用 session.Connect 建立短连 *sql.DB，连接到指定 database。
func openDB(ctx context.Context, connect session.ConnectParams, database string) (*sql.DB, func(), error) {
	p := connect
	if db := strings.TrimSpace(database); db != "" {
		p.Options.Database = db
	}
	db, tunnelStop, err := session.Connect(ctx, p)
	if err != nil {
		return nil, nil, fmt.Errorf("clickhouse: open db: %w", err)
	}
	stop := func() {
		_ = db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
	}
	return db, stop, nil
}

// openNativeConn 使用 session.ConnectNative 建立短连（PrepareBatch）。
func openNativeConn(ctx context.Context, connect session.ConnectParams, database string) (clickhouse.Conn, func(), error) {
	p := connect
	if db := strings.TrimSpace(database); db != "" {
		p.Options.Database = db
	}
	conn, stop, err := session.ConnectNative(ctx, p)
	if err != nil {
		return nil, nil, fmt.Errorf("clickhouse: open native: %w", err)
	}
	return conn, stop, nil
}

// quoteIdent 用反引号包裹标识符（包内小写别名）。
func quoteIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}

// countingWriter 包装 io.Writer，累计写入字节数，并按节流间隔触发进度回调。
type countingWriter struct {
	w          io.Writer
	n          int64
	lastEmit   time.Time
	onProgress func(int64)
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	if c.onProgress != nil && time.Since(c.lastEmit) > 200*time.Millisecond {
		c.lastEmit = time.Now()
		c.onProgress(c.n)
	}
	return n, err
}

// countingReader 包装 io.Reader，累计读取字节数，并按节流间隔触发进度回调。
type countingReader struct {
	r          io.Reader
	n          int64
	lastEmit   time.Time
	onProgress func(int64)
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	if c.onProgress != nil && time.Since(c.lastEmit) > 200*time.Millisecond {
		c.lastEmit = time.Now()
		c.onProgress(c.n)
	}
	return n, err
}
