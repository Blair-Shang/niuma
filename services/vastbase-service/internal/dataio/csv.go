package dataio

import (
	"context"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func exportCsv(
	ctx context.Context,
	pool *pgxpool.Pool,
	taskID string,
	m *Manager,
	schema, table, outputPath string,
	opts CsvOptions,
) error {
	opts = defaultCsvOptions(opts)
	qn := qualified(schema, table)
	sql := fmt.Sprintf("COPY %s TO STDOUT WITH (%s)", qn, csvWithClause(opts))

	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("vastbase: create csv: %w", err)
	}
	defer f.Close()

	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	w := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("exported %d bytes", n))
	}}
	_, err = conn.Conn().PgConn().CopyTo(ctx, w, sql)
	if err != nil {
		return fmt.Errorf("vastbase: copy to csv: %w", err)
	}
	m.emitProgress(taskID, PhaseRunning, w.n, 0, fmt.Sprintf("exported %d bytes", w.n))
	return nil
}

func importCsv(
	ctx context.Context,
	pool *pgxpool.Pool,
	taskID string,
	m *Manager,
	schema, table, inputPath string,
	opts CsvOptions,
) error {
	opts = defaultCsvOptions(opts)
	qn := qualified(schema, table)

	f, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("vastbase: open csv: %w", err)
	}
	defer f.Close()

	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if opts.Truncate {
		if _, err := tx.Exec(ctx, "TRUNCATE TABLE "+qn); err != nil {
			return fmt.Errorf("vastbase: truncate before import: %w", err)
		}
		m.emitProgress(taskID, PhaseRunning, 0, 0, "truncated")
	}

	sql := fmt.Sprintf("COPY %s FROM STDIN WITH (%s)", qn, csvWithClause(opts))
	r := &countingReader{r: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("imported %d bytes", n))
	}}
	_, err = tx.Conn().PgConn().CopyFrom(ctx, r, sql)
	if err != nil {
		return fmt.Errorf("vastbase: copy from csv: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	m.emitProgress(taskID, PhaseRunning, r.n, 0, fmt.Sprintf("imported %d bytes", r.n))
	return nil
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
