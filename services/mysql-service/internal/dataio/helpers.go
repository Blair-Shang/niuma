package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"strings"
	"time"

	"niuma/services/mysql-service/internal/session"
)

// requirePath 校验路径非空。
func requirePath(path string) error {
	if strings.TrimSpace(path) == "" {
		return errPathRequired
	}
	return nil
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
	if opts.Delimiter == "" {
		opts.Delimiter = ","
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
// 调用方在用完后需调用返回的 stop 函数关闭连接。
func openDB(ctx context.Context, connect session.ConnectParams, database string) (*sql.DB, func(), error) {
	p := connect
	if db := strings.TrimSpace(database); db != "" {
		p.Options.Database = db
	}
	db, tunnelStop, err := session.Connect(ctx, p)
	if err != nil {
		return nil, nil, fmt.Errorf("mysql: open db: %w", err)
	}
	stop := func() {
		db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
	}
	return db, stop, nil
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
