package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"strings"
	"time"

	"niuma/services/sqlserver-service/internal/session"
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

func quoteIdent(name string) string {
	return "[" + strings.ReplaceAll(name, "]", "]]") + "]"
}

func quoteLiteral(s string) string {
	return "N'" + strings.ReplaceAll(s, "'", "''") + "'"
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

func openDB(ctx context.Context, connect session.ConnectParams, database string) (*sql.DB, func(), error) {
	if strings.TrimSpace(database) != "" {
		connect.Options.Database = strings.TrimSpace(database)
	}
	db, stop, err := session.Connect(ctx, connect)
	if err != nil {
		return nil, nil, fmt.Errorf("sqlserver: open db: %w", err)
	}
	return db, func() {
		_ = db.Close()
		if stop != nil {
			stop()
		}
	}, nil
}

func tableHasIdentity(ctx context.Context, db *sql.DB, schema, table string) (bool, error) {
	const q = `SELECT COUNT(*) FROM sys.identity_columns WHERE object_id = OBJECT_ID(@p1)`
	var n int
	if err := db.QueryRowContext(ctx, q, schema+"."+table).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
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

func paramPlaceholders(start, count int) []string {
	out := make([]string, count)
	for i := 0; i < count; i++ {
		out[i] = fmt.Sprintf("@p%d", start+i)
	}
	return out
}
