package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"strings"
	"time"

	"niuma/services/dameng-service/internal/session"
)

func requirePath(path string) error {
	if strings.TrimSpace(path) == "" {
		return errPathRequired
	}
	return nil
}

func requireRelation(schema, table string) error {
	if strings.TrimSpace(schema) == "" || strings.TrimSpace(table) == "" {
		return errRelationRequired
	}
	return nil
}

func schemaOrEmpty(schema string) string {
	return strings.TrimSpace(schema)
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func quoteLiteral(s string) string {
	return `'` + strings.ReplaceAll(s, `'`, `''`) + `'`
}

func qualifiedName(schema, table string) string {
	return quoteIdent(schema) + "." + quoteIdent(table)
}

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

func openDB(ctx context.Context, connect session.ConnectParams) (*sql.DB, func(), error) {
	db, stop, err := session.Connect(ctx, connect)
	if err != nil {
		return nil, nil, fmt.Errorf("dameng: open db: %w", err)
	}
	return db, func() {
		_ = db.Close()
		if stop != nil {
			stop()
		}
	}, nil
}

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
